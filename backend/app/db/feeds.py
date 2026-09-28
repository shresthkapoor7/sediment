from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from .supabase import SupabaseClient
from ..services.feed_sources.base import Paper, SearchPage


class FeedRepository:
    def __init__(self):
        self.db = SupabaseClient()

    async def get(self, user_id: str) -> dict | None:
        row = await self.db._request('GET', '/rest/v1/research_feeds?user_id=eq.' + quote(user_id, safe='') + '&select=state',
                                     expect_single=True, allow_empty=True)
        return row['state'] if row else None

    async def paper_records(self, identifiers: dict[str, str]) -> list[Paper]:
        clauses = []
        for field, value in identifiers.items():
            if field not in {'id', 'arxiv_id', 'openalex_id', 'doi'}: continue
            escaped = value.replace('\\', '\\\\').replace('"', '\\"')
            clauses.append(f'data->>{field}.eq."{escaped}"')
        if not clauses: return []
        query = quote('(' + ','.join(clauses) + ')', safe='')
        rows = await self.db._request('GET', '/rest/v1/feed_papers?select=data&limit=20&or=' + query)
        return [Paper.model_validate(row['data']) for row in rows]

    async def claim(self, key: str, token: str, seconds: int = 180) -> bool:
        return await self.db.rpc('claim_feed_lease', {'p_key': key, 'p_token': token, 'p_seconds': seconds})

    async def release(self, key: str, token: str, cooldown: int = 0):
        await self.db.rpc('release_feed_lease', {'p_key': key, 'p_token': token, 'p_cooldown': cooldown})

    async def save(self, user_id: str, token: str, state: dict):
        if not await self.db.rpc('save_research_feed', {'p_user_id': user_id, 'p_token': token, 'p_state': state}):
            raise RuntimeError('Feed refresh expired; please retry.')

    async def cached(self, key: str) -> SearchPage | None:
        row = await self.db._request('GET', '/rest/v1/feed_query_cache?key=eq.' + key + '&select=*',
                                     expect_single=True, allow_empty=True)
        if not row: return None
        # Postgres omits trailing fractional zeros; Python 3.9 fromisoformat
        # rejects some of those valid timestamps (for example, five digits).
        expires = row['expires_at']
        timestamp_format = '%Y-%m-%dT%H:%M:%S' + ('.%f' if '.' in expires else '') + '%z'
        if datetime.strptime(expires, timestamp_format) <= datetime.now(timezone.utc):
            return None
        ids = row['paper_ids']
        if not ids: return SearchPage(papers=[], next_cursor=row['next_cursor'])
        # IDs are generated exclusively from validated provider identifiers.
        values = ','.join('"' + value.replace('"', '') + '"' for value in ids)
        rows = await self.db._request('GET', '/rest/v1/feed_papers?select=id,data&id=in.' + quote('(' + values + ')', safe=''))
        by_id = {r['id']: r['data'] for r in rows}
        if any(identifier not in by_id for identifier in ids): return None
        return SearchPage(papers=[Paper.model_validate(by_id[i]) for i in ids], next_cursor=row['next_cursor'])

    async def cache(self, key: str, source: str, page: SearchPage):
        now = datetime.now(timezone.utc)
        ids = [source + ':' + paper.id for paper in page.papers]
        if page.papers:
            unique = {identifier: {'id': identifier, 'data': paper.model_dump(), 'updated_at': now.isoformat()}
                      for identifier, paper in zip(ids, page.papers)}
            await self.db._request('POST', '/rest/v1/feed_papers?on_conflict=id', json=list(unique.values()),
                                   headers={'Prefer': 'resolution=merge-duplicates,return=minimal'})
        await self.db._request('POST', '/rest/v1/feed_query_cache?on_conflict=key',
                               json={'key': key, 'paper_ids': ids, 'next_cursor': page.next_cursor,
                                     'expires_at': (now + timedelta(minutes=15)).isoformat()},
                               headers={'Prefer': 'resolution=merge-duplicates,return=minimal'})
