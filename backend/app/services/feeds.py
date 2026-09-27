from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from ..config import settings
from ..db.feeds import FeedRepository
from .feed_sources.base import Paper, SearchRequest, SourceError, identity_keys
from .feed_sources.arxiv import ArxivSource
from .feed_sources.huggingface import HuggingFaceSource
from .feed_sources.openalex import OpenAlexSource

PAGE_SIZE = 12
MAX_PAPERS = 600
MAX_FETCHES = 9
STOP = set('i me my we our am are is the a an of for to in on at by with about interested interests curious exploring explore research papers recent latest new please show find want learn more how what and or that this it'.split())
# Keep compound research phrases; expand only unambiguous common acronyms.
SYNONYMS = {'llm': 'large language models', 'llms': 'large language models', 'ai': 'artificial intelligence',
            'rl': 'reinforcement learning', 'nlp': 'natural language processing'}


def plan_queries(interests: str) -> list[str]:
    pieces = re.split(r'[,;\n]|\band\b', interests.lower())
    queries = []
    for piece in pieces:
        words = re.findall(r'[\w-]+', piece)
        words = [w for w in words if w not in STOP]
        query = ' '.join(SYNONYMS.get(w, w) for w in words[:10]).strip()[:200]
        if query and query not in queries: queries.append(query)
    if len(queries) > 3:
        raise HTTPException(400, 'Choose up to three research topics for this feed.')
    return queries


def terms(text: str) -> set[str]:
    return {w for w in re.findall(r'[\w-]+', text.casefold()) if len(w) > 2 and w not in STOP}


def relevance(paper: Paper, queries: list[str]) -> float:
    title = terms(paper.title)
    text = terms(' '.join([paper.title, paper.abstract, *paper.topics]))
    scores = []
    for query in queries:
        wanted = terms(query)
        if not wanted: continue
        overlap = len(wanted & text) / len(wanted)
        scores.append(overlap + .25 * len(wanted & title) / len(wanted))
    return max(scores, default=0)


def merge_papers(existing: list[Paper], incoming: list[Paper]) -> list[Paper]:
    """Transitive identity union, preserving the earliest card ID and order."""
    result: list[Paper] = []
    aliases: list[set[str]] = []
    for paper in [*existing, *incoming]:
        keys = identity_keys(paper)
        matches = [i for i, known in enumerate(aliases) if known & keys]
        if not matches:
            result.append(paper.model_copy(deep=True)); aliases.append(keys); continue
        first = matches[0]
        combined = result[first]
        for candidate in [*(result[i] for i in matches[1:]), paper]:
            combined.abstract = max([combined.abstract, candidate.abstract], key=len)
            combined.authors = max([combined.authors, candidate.authors], key=len)
            combined.thumbnail = combined.thumbnail or candidate.thumbnail
            combined.doi = combined.doi or candidate.doi
            combined.arxiv_id = combined.arxiv_id or candidate.arxiv_id
            combined.openalex_id = combined.openalex_id or candidate.openalex_id
            combined.sources = list(dict.fromkeys([*combined.sources, *candidate.sources]))
            combined.topics = list(dict.fromkeys([*combined.topics, *candidate.topics]))[:12]
            # The preprint's initial submission date wins over later indexing or feature dates.
            if candidate.arxiv_id and candidate.preprint and candidate.published:
                combined.published = min(filter(None, [combined.published, candidate.published]))
            combined.preprint = combined.preprint or candidate.preprint
        for index in reversed(matches[1:]):
            keys |= aliases.pop(index); result.pop(index)
        aliases[first] |= keys | identity_keys(combined)
    return result


def cursor_for(user: str, revision: str, offset: int) -> str:
    payload = f'{revision}:{offset}'
    signature = hmac.new(settings.actor_key_secret.get_secret_value().encode(), f'{user}:{payload}'.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f'{payload}:{signature}'.encode()).decode().rstrip('=')


def cursor_offset(user: str, revision: str, cursor: str) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)).decode()
        rev, offset, signature = raw.split(':')
        expected = cursor_for(user, rev, int(offset))
        if not hmac.compare_digest(expected, cursor) or rev != revision or not 0 <= int(offset) <= MAX_PAPERS:
            raise ValueError()
        return int(offset)
    except (ValueError, UnicodeError):
        raise HTTPException(409, 'This feed changed. Reload it before loading more.') from None


class FeedService:
    def __init__(self, repository=None, sources=None):
        self.repo = repository or FeedRepository()
        self.sources = sources or [HuggingFaceSource(), ArxivSource(), OpenAlexSource()]

    def response(self, user: str, state: dict | None, offset: int = 0) -> dict:
        if not state:
            return {'interests': '', 'queries': [], 'papers': [], 'cursor': None, 'refreshedAt': None, 'warnings': [], 'revision': None}
        papers = []
        following = offset
        while following < len(state['papers']) and len(papers) < PAGE_SIZE:
            paper = state['papers'][following]
            following += 1
            if paper is not None: papers.append(paper)
        available = following < len(state['papers']) or (len(state['papers']) < MAX_PAPERS and any(not s['done'] for s in state['streams']))
        return {'interests': state['interests'], 'queries': state['queries'], 'papers': papers,
                'cursor': cursor_for(user, state['revision'], following) if available else None,
                'refreshedAt': state['refreshed_at'], 'warnings': state.get('warnings', []), 'revision': state['revision']}

    async def read(self, user: str) -> dict:
        return self.response(user, await self.repo.get(user))

    async def source_page(self, source, request):
        key = hashlib.sha256((source.name + request.model_dump_json()).encode()).hexdigest()
        cached = await self.repo.cached(key)
        if cached is not None: return cached
        token = str(uuid.uuid4())
        if source.name == 'arxiv':
            # A deployment-wide lease enforces arXiv's single-connection policy.
            acquired = False
            for _ in range(8):
                if await self.repo.claim('provider:arxiv', token, 30): acquired = True; break
                await asyncio.sleep(1)
            if not acquired: raise SourceError('arXiv is busy; try again shortly')
        try:
            page = await source.search(request)
        finally:
            if source.name == 'arxiv': await self.repo.release('provider:arxiv', token, 4)
        await self.repo.cache(key, source.name, page)
        return page

    async def fill(self, state: dict, needed: int):
        existing = [Paper.model_validate(p) for p in state['papers'] if p is not None]
        candidates = []
        warnings = set()
        fetched = successful = 0
        deadline = time.monotonic() + 110
        sources = {source.name: source for source in self.sources}
        # Round-robin prevents the first provider consuming the whole request budget.
        while len(merge_papers(existing, candidates)) < needed and fetched < MAX_FETCHES:
            active = [s for s in state['streams'] if not s['done'] and s['source'] not in warnings]
            if not active or time.monotonic() >= deadline: break
            for stream in active:
                if fetched >= MAX_FETCHES or time.monotonic() >= deadline: break
                fetched += 1
                request = SearchRequest(query=stream['query'], since=date.fromisoformat(state['since']),
                                        until=date.fromisoformat(state['until']), cursor=stream['cursor'], limit=24)
                try:
                    page = await self.source_page(sources[stream['source']], request)
                except SourceError:
                    warnings.add(stream['source']); continue
                successful += 1
                stream['done'] = page.next_cursor is None or page.next_cursor == stream['cursor']
                stream['cursor'] = page.next_cursor
                candidates.extend(p for p in page.papers if p.title and p.published and
                                  state['since'] <= p.published <= state['until'] and relevance(p, state['queries']) >= .65)
        if fetched and not successful:
            raise HTTPException(503, 'Paper sources are temporarily unavailable. Your existing feed is unchanged; please retry.')
        merged = merge_papers(existing, candidates)
        # Preserve the displayed prefix so an offset cursor never skips cards when
        # provider pages arrive or metadata is enriched.
        previous_ids = {p.id for p in existing}
        by_id = {p.id: p for p in merged}
        # Keep stable slots when a later record bridges two previously distinct
        # IDs. A tombstone avoids shifting every already-issued offset cursor.
        prefix = [by_id[p['id']].model_dump() if p and p['id'] in by_id else None for p in state['papers']]
        additions = [p for p in merged if p.id not in previous_ids]
        additions.sort(key=lambda p: (p.published or '', relevance(p, state['queries'])), reverse=True)
        state['papers'] = (prefix + [p.model_dump() for p in additions])[:MAX_PAPERS]
        state['warnings'] = sorted(warnings)

    async def mutate(self, user: str, action: str, interests: str | None = None, cursor: str | None = None):
        token = str(uuid.uuid4()); lock = 'feed:' + user
        if not await self.repo.claim(lock, token):
            raise HTTPException(409, 'A feed update is already running. Please try again shortly.')
        try:
            old = await self.repo.get(user)
            if action == 'more':
                if not old or not cursor: raise HTTPException(400, 'Create a feed before loading more.')
                offset = cursor_offset(user, old['revision'], cursor)
                if offset > len(old['papers']): raise HTTPException(400, 'Invalid feed position.')
                await self.fill(old, sum(p is not None for p in old['papers'][:offset]) + PAGE_SIZE)
                await self.repo.save(user, token, old)
                return self.response(user, old, offset)
            if action == 'refresh' and not old: raise HTTPException(400, 'Add interests first.')
            description = interests.strip() if interests is not None else old['interests']
            queries = plan_queries(description)
            if not queries: raise HTTPException(400, 'Describe at least one research topic.')
            if old and old['interests'] == description and (datetime.now(timezone.utc) - datetime.fromisoformat(old['refreshed_at'])).total_seconds() < 60:
                return self.response(user, old)
            today = datetime.now(timezone.utc).date()
            state = {'interests': description, 'queries': queries, 'revision': str(uuid.uuid4()),
                     'since': (today - timedelta(days=90)).isoformat(), 'until': today.isoformat(),
                     'refreshed_at': datetime.now(timezone.utc).isoformat(), 'papers': [], 'warnings': [],
                     'streams': [{'source': source.name, 'query': query, 'cursor': None, 'done': False}
                                 for query in queries for source in self.sources]}
            await self.fill(state, PAGE_SIZE)
            if action == 'refresh' and old:
                # Retain older matches after new discoveries, without losing metadata.
                state['papers'] = [p.model_dump() for p in merge_papers(
                    [Paper.model_validate(p) for p in state['papers']],
                    [Paper.model_validate(p) for p in old['papers'] if p is not None])][:MAX_PAPERS]
            await self.repo.save(user, token, state)
            return self.response(user, state)
        finally:
            await self.repo.release(lock, token)
