from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from ..config import settings
from ..db.feeds import FeedRepository
from .feed_sources.base import Paper, SearchRequest, SourceError, identity_keys, arxiv_id
from .feed_sources.arxiv import ArxivSource
from .feed_sources.huggingface import HuggingFaceSource
from .feed_sources.openalex import OpenAlexSource

logger = logging.getLogger(__name__)

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


def cursor_for(user: str, revision: str, offset: int, source: str = "all") -> str:
    # Preserve existing all-paper cursors; bind filtered cursors to their source.
    payload = f'{revision}:{offset}' if source == "all" else f'{revision}:{source}:{offset}'
    signature = hmac.new(settings.actor_key_secret.get_secret_value().encode(), f'{user}:{payload}'.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f'{payload}:{signature}'.encode()).decode().rstrip('=')


def cursor_offset(user: str, revision: str, cursor: str, source: str = "all") -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)).decode()
        parts = raw.split(':')
        if source == 'all':
            rev, offset, signature = parts
        else:
            rev, cursor_source, offset, signature = parts
            if cursor_source != source: raise ValueError()
        expected = cursor_for(user, rev, int(offset), source)
        if not hmac.compare_digest(expected, cursor) or rev != revision or not 0 <= int(offset) <= MAX_PAPERS:
            raise ValueError()
        return int(offset)
    except (ValueError, UnicodeError):
        raise HTTPException(409, 'This feed changed. Reload it before loading more.') from None


def matches_source(paper, source: str) -> bool:
    return paper is not None and (source == 'all' or source in (paper.sources if isinstance(paper, Paper) else paper['sources']))


def source_papers(state: dict, source: str) -> list:
    if source == 'all': return state['papers']
    # Source membership can arrive later when another provider enriches an old
    # record. Append newly matching IDs to this view rather than losing them
    # behind a cursor that already scanned those global slots.
    by_id = {p['id']: p for p in state['papers'] if matches_source(p, source)}
    views = state.setdefault('source_views', {})
    order = views.setdefault(source, [])
    known = set(order)
    order.extend(identifier for identifier in by_id if identifier not in known)
    return [by_id.get(identifier) for identifier in order]


class FeedService:
    def __init__(self, repository=None, sources=None):
        self.repo = repository or FeedRepository()
        self.sources = sources or [HuggingFaceSource(), ArxivSource(), OpenAlexSource()]

    def response(self, user: str, state: dict | None, offset: int = 0, source: str = "all") -> dict:
        if not state:
            return {'interests': '', 'queries': [], 'papers': [], 'cursor': None, 'refreshedAt': None, 'warnings': [], 'revision': None, 'source': source}
        slots = source_papers(state, source)
        papers = []
        following = offset
        while following < len(slots) and len(papers) < PAGE_SIZE:
            paper = slots[following]
            following += 1
            if matches_source(paper, source): papers.append(paper)
        available = any(matches_source(p, source) for p in slots[following:]) or (len(state['papers']) < MAX_PAPERS and any(not s['done'] and (source == 'all' or s['source'] == source) for s in state['streams']))
        return {'interests': state['interests'], 'queries': state['queries'], 'papers': papers,
                'cursor': cursor_for(user, state['revision'], following, source) if available else None,
                'refreshedAt': state['refreshed_at'], 'warnings': state.get('warnings', []), 'revision': state['revision'], 'source': source}

    async def paper(self, slug: str) -> Paper:
        if slug.startswith('arxiv-') and arxiv_id(slug[6:].replace('_', '/')):
            identifier = arxiv_id(slug[6:].replace('_', '/'))
            canonical = 'arxiv:' + identifier
            identifiers = {'id': canonical, 'arxiv_id': identifier}
        elif re.fullmatch(r'openalex-W[0-9]+', slug):
            identifier = slug[9:]
            canonical = 'openalex:' + identifier
            identifiers = {'id': canonical, 'openalex_id': identifier}
        else:
            raise HTTPException(404, 'Paper not found.')
        records = await self.repo.paper_records(identifiers)
        if not records: raise HTTPException(404, 'This paper is not in the feed library.')
        # Public detail links read only cached metadata, never private feed state
        # or upstream providers. Enrich with records carrying the same identifiers.
        seed = next((p for p in records if p.id == canonical), records[0])
        aliases = {field: getattr(seed, field) for field in ('doi', 'arxiv_id', 'openalex_id') if getattr(seed, field)}
        if aliases: records.extend(await self.repo.paper_records(aliases))
        combined = merge_papers([seed], records)[0]
        combined.id = canonical
        combined.updated = max((p.updated for p in records if p.updated), default=None)
        return combined

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
        cooldown = 4
        try:
            page = await source.search(request)
        except SourceError as error:
            if error.status == 429: cooldown = 60
            raise
        finally:
            if source.name == 'arxiv': await self.repo.release('provider:arxiv', token, cooldown)
        await self.repo.cache(key, source.name, page)
        return page

    async def fill(self, state: dict, needed: int, source: str = "all"):
        existing = [Paper.model_validate(p) for p in state['papers'] if p is not None]
        candidates = []
        warnings = set()
        rate_limited = set()
        fetched = successful = 0
        deadline = time.monotonic() + 110
        sources = {provider.name: provider for provider in self.sources}
        # Round-robin prevents the first provider consuming the whole request budget.
        while sum(matches_source(p, source) for p in merge_papers(existing, candidates)) < needed and fetched < MAX_FETCHES and len(state['papers']) < MAX_PAPERS:
            active = [s for s in state['streams'] if not s['done'] and s['source'] not in warnings and (source == 'all' or s['source'] == source)]
            if not active or time.monotonic() >= deadline: break
            for stream in active:
                if stream['source'] in warnings: continue
                if fetched >= MAX_FETCHES or time.monotonic() >= deadline: break
                fetched += 1
                request = SearchRequest(query=stream['query'], since=date.fromisoformat(state['since']),
                                        until=date.fromisoformat(state['until']), cursor=stream['cursor'], limit=24)
                try:
                    page = await self.source_page(sources[stream['source']], request)
                except SourceError as error:
                    logger.warning('Feed provider %s unavailable: %s', stream['source'], error)
                    if error.status == 429: rate_limited.add(stream['source'])
                    warnings.add(stream['source']); continue
                successful += 1
                stream['done'] = page.next_cursor is None or page.next_cursor == stream['cursor']
                stream['cursor'] = page.next_cursor
                candidates.extend(p for p in page.papers if p.title and p.published and
                                  state['since'] <= p.published <= state['until'] and relevance(p, state['queries']) >= .65)
        if fetched and not successful and not any(matches_source(p, source) for p in existing):
            if source == 'arxiv':
                detail = ('arXiv rate-limited a request. We don’t have a reset time.'
                          if source in rate_limited else 'We couldn’t reach arXiv. We don’t know when it will respond.')
                raise HTTPException(503, detail + ' Other sources are still available.')
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
        state['warnings'] = sorted(warnings | ({s for s in state.get('warnings', []) if s != source} if source != 'all' else set()))

    async def mutate(self, user: str, action: str, interests: str | None = None, cursor: str | None = None, source: str = "all"):
        token = str(uuid.uuid4()); lock = 'feed:' + user
        if not await self.repo.claim(lock, token):
            raise HTTPException(409, 'A feed update is already running. Please try again shortly.')
        try:
            old = await self.repo.get(user)
            if action in ('more', 'source'):
                if not old or (action == 'more' and not cursor): raise HTTPException(400, 'Create a feed before loading more.')
                offset = cursor_offset(user, old['revision'], cursor, source) if action == 'more' else 0
                slots = source_papers(old, source)
                if offset > len(slots): raise HTTPException(400, 'Invalid feed position.')
                await self.fill(old, sum(p is not None for p in slots[:offset]) + PAGE_SIZE, source)
                result = self.response(user, old, offset, source)
                await self.repo.save(user, token, old)
                return result
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
