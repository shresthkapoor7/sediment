import copy
import unittest
from unittest.mock import AsyncMock
from fastapi import HTTPException
from app.services.feeds import FeedService, merge_papers, plan_queries, cursor_for, cursor_offset
from app.services.feed_sources.base import Paper, SearchPage, SourceError


def paper(i, **kwargs):
    return Paper(id=f'arxiv:2609.{i:05d}', arxiv_id=f'2609.{i:05d}', title=f'Robot learning study {i}',
                 published='2026-09-27', url=f'https://arxiv.org/abs/2609.{i:05d}', sources=['arxiv'], **kwargs)


class Repo:
    def __init__(self): self.rows = {}; self.locks = set(); self.cache_rows = {}
    async def get(self, user): return copy.deepcopy(self.rows.get(user))
    async def save(self, user, token, state): self.rows[user] = copy.deepcopy(state)
    async def claim(self, key, token, seconds=180):
        if key in self.locks: return False
        self.locks.add(key); return True
    async def release(self, key, token, cooldown=0): self.locks.discard(key)
    async def cached(self, key): return self.cache_rows.get(key)
    async def cache(self, key, source, page): self.cache_rows[key] = page


class Source:
    name = 'huggingface'
    def __init__(self): self.calls = 0
    async def search(self, request):
        self.calls += 1
        start = int(request.cursor or '0')
        return SearchPage(papers=[paper(i) for i in range(start, start+24)], next_cursor=str(start+24) if start<48 else None)


class FeedTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_visit_does_not_search(self):
        source=Source(); service=FeedService(Repo(),[source])
        self.assertEqual((await service.read('u'))['papers'], [])
        self.assertEqual(source.calls,0)

    async def test_pagination_cache_reload_and_idempotent_cursor(self):
        source=Source(); repo=Repo(); service=FeedService(repo,[source])
        first=await service.mutate('u','interests','robot learning')
        self.assertEqual(len(first['papers']),12)
        second=await service.mutate('u','more',cursor=first['cursor'])
        self.assertEqual(source.calls,1)
        self.assertFalse({p['id'] for p in first['papers']} & {p['id'] for p in second['papers']})
        repeat=await service.mutate('u','more',cursor=first['cursor'])
        self.assertEqual(second['papers'],repeat['papers'])
        self.assertEqual(first['papers'],(await FeedService(repo,[source]).read('u'))['papers'])
        third=await service.mutate('u','more',cursor=second['cursor'])
        self.assertEqual(source.calls,2)
        self.assertEqual(len(third['papers']),12)

    async def test_edit_invalidates_old_cursor(self):
        service=FeedService(Repo(),[Source()])
        first=await service.mutate('u','interests','robot learning')
        await service.mutate('u','interests','robotics and robot learning')
        with self.assertRaises(HTTPException) as ctx: await service.mutate('u','more',cursor=first['cursor'])
        self.assertEqual(ctx.exception.status_code,409)

    async def test_all_provider_failure_preserves_existing_feed(self):
        source=Source(); repo=Repo(); service=FeedService(repo,[source])
        await service.mutate('u','interests','robot learning')
        old=copy.deepcopy(repo.rows['u'])
        source.search=AsyncMock(side_effect=SourceError('offline'))
        with self.assertRaises(HTTPException): await service.mutate('u','interests','climate science')
        self.assertEqual(repo.rows['u'],old)

    async def test_partial_failure_returns_results_and_warning(self):
        good=Source(); bad=Source(); bad.name='openalex'; bad.search=AsyncMock(side_effect=SourceError('offline'))
        result=await FeedService(Repo(),[good,bad]).mutate('u','interests','robot learning')
        self.assertEqual(len(result['papers']),12)
        self.assertEqual(result['warnings'],['openalex'])

    def test_merge_cross_source_transitive_and_enrichment(self):
        a=paper(1)
        b=Paper(id='openalex:W1',doi='10.1234/a',title='Other spelling',url='https://example.org',sources=['openalex'])
        bridge=a.model_copy(update={'doi':'10.1234/a','thumbnail':'https://example.org/image','sources':['huggingface']})
        result=merge_papers([a,b],[bridge])
        self.assertEqual(len(result),1)
        self.assertEqual(set(result[0].sources),{'arxiv','openalex','huggingface'})
        self.assertTrue(result[0].thumbnail)

    def test_cursor_rejects_other_browser(self):
        with self.assertRaises(HTTPException): cursor_offset('b','revision',cursor_for('a','revision',12))

    def test_interest_planning(self):
        self.assertEqual(plan_queries('I am interested in machine learning, sleep and climate science'),['machine learning','sleep','climate science'])

    async def test_late_identity_bridge_keeps_cursor_slots(self):
        repo=Repo(); source=Source(); service=FeedService(repo,[source])
        await service.mutate('u','interests','robot learning')
        state=repo.rows['u']
        # Separate provider records can be linked by a later arXiv/DOI record.
        state['papers'][1]['arxiv_id']=None
        state['papers'][1]['id']='openalex:W9'
        state['papers'][1]['doi']='10.1234/bridge'
        bridge=Paper.model_validate(state['papers'][0]).model_copy(update={'doi':'10.1234/bridge'})
        source.search=AsyncMock(return_value=SearchPage(papers=[bridge,paper(99)]))
        result=await service.mutate('u','more',cursor=cursor_for('u',state['revision'],24))
        self.assertEqual([p['id'] for p in result['papers']],[paper(99).id])
        self.assertIsNone(repo.rows['u']['papers'][1])

    async def test_refresh_deduplicates_and_keeps_old_matches(self):
        repo=Repo(); source=Source(); service=FeedService(repo,[source])
        await service.mutate('u','interests','robot learning')
        repo.rows['u']['refreshed_at']='2020-01-01T00:00:00+00:00'
        repo.cache_rows.clear()
        source.search=AsyncMock(return_value=SearchPage(papers=[paper(99),paper(0)]))
        await service.mutate('u','refresh')
        ids=[p['id'] for p in repo.rows['u']['papers']]
        self.assertEqual(len(ids),25)
        self.assertEqual(len(set(ids)),25)
