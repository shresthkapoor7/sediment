import copy
import unittest
from datetime import date
from unittest.mock import AsyncMock
from fastapi import HTTPException
from app.services.feeds import FeedService, merge_papers, plan_queries, cursor_for, cursor_offset
from app.services.feed_sources.base import Paper, SearchPage, SourceError


def paper(i, **kwargs):
    return Paper(id=f'arxiv:2609.{i:05d}', arxiv_id=f'2609.{i:05d}', title=f'Robot learning study {i}',
                 published=date.today().isoformat(), url=f'https://arxiv.org/abs/2609.{i:05d}', sources=['arxiv'], **kwargs)


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

    async def test_query_cache_shared_between_browsers(self):
        repo=Repo(); source=Source(); service=FeedService(repo,[source])
        await service.mutate('first','interests','robot learning')
        await service.mutate('second','interests','robot learning')
        self.assertEqual(source.calls,1)

    async def test_exhaustion_returns_no_more_cursor(self):
        source=Source(); source.search=AsyncMock(return_value=SearchPage(papers=[paper(1)]))
        result=await FeedService(Repo(),[source]).mutate('u','interests','robot learning')
        self.assertEqual(len(result['papers']),1)
        self.assertIsNone(result['cursor'])

    async def test_conflicting_update_rejected_without_search(self):
        repo=Repo(); source=Source(); repo.locks.add('feed:u')
        with self.assertRaises(HTTPException) as ctx:
            await FeedService(repo,[source]).mutate('u','interests','robot learning')
        self.assertEqual(ctx.exception.status_code,409)
        self.assertEqual(source.calls,0)

    def test_extra_topics_not_silently_discarded(self):
        with self.assertRaises(HTTPException): plan_queries('robots, climate, medicine, quantum')

    async def test_source_selection_reads_beyond_the_all_papers_first_page(self):
        repo=Repo(); service=FeedService(repo,[Source()])
        await service.mutate('u','interests','robot learning')
        state=repo.rows['u']
        state['papers']=[paper(i).model_copy(update={'sources':['openalex'] if i<30 else ['arxiv'] if i<36 else ['huggingface']}).model_dump() for i in range(42)]
        state['streams']=[]
        first=await service.read('u')
        self.assertTrue(all(p['sources']==['openalex'] for p in first['papers']))
        arxiv=await service.mutate('u','source',source='arxiv')
        hf=await service.mutate('u','source',source='huggingface')
        self.assertEqual(len(arxiv['papers']),6)
        self.assertEqual(len(hf['papers']),6)
        self.assertIsNone(hf['cursor'])
        self.assertEqual(hf['source'],'huggingface')
        self.assertEqual(first['papers'],(await service.read('u'))['papers'])

    async def test_source_pagination_only_fetches_selected_provider(self):
        repo=Repo(); arxiv=Source(); arxiv.name='arxiv'
        hf=Source(); hf.search=AsyncMock(return_value=SearchPage(papers=[]))
        service=FeedService(repo,[arxiv,hf])
        first=await service.mutate('u','interests','robot learning')
        hf.search.reset_mock()
        selected=await service.mutate('u','source',source='arxiv')
        second=await service.mutate('u','more',cursor=selected['cursor'],source='arxiv')
        third=await service.mutate('u','more',cursor=second['cursor'],source='arxiv')
        self.assertEqual(len(third['papers']),12)
        self.assertFalse({p['id'] for p in selected['papers']} & {p['id'] for p in second['papers']})
        hf.search.assert_not_awaited()
        with self.assertRaises(HTTPException):
            await service.mutate('u','more',cursor=first['cursor'],source='arxiv')
        with self.assertRaises(HTTPException):
            await service.mutate('u','more',cursor=selected['cursor'],source='huggingface')

    async def test_late_source_membership_is_not_skipped_by_filtered_cursor(self):
        repo=Repo(); source=Source(); source.name='arxiv'; service=FeedService(repo,[source])
        await service.mutate('u','interests','robot learning')
        state=repo.rows['u']
        state['papers']=[paper(i).model_copy(update={'sources':['arxiv'] if i<12 else ['openalex']}).model_dump() for i in range(13)]
        selected=await service.mutate('u','source',source='arxiv')
        # A later arXiv record links the OpenAlex paper already in the snapshot.
        source.search=AsyncMock(return_value=SearchPage(papers=[paper(12)]))
        more=await service.mutate('u','more',cursor=selected['cursor'],source='arxiv')
        self.assertEqual([p['id'] for p in more['papers']],[paper(12).id])
        self.assertIsNone(more['cursor'])
