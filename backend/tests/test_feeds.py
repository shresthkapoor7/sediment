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
        return SearchPage(papers=[paper(i).model_copy(update={'sources': [self.name]}) for i in range(start, start+24)], next_cursor=str(start+24) if start<48 else None)


class FeedTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_visit_does_not_search(self):
        source=Source(); service=FeedService(Repo(),[source])
        self.assertEqual((await service.read('u'))['papers'], [])
        self.assertEqual(source.calls,0)

    async def test_pagination_cache_reload_and_idempotent_cursor(self):
        source=Source(); repo=Repo(); service=FeedService(repo,[source])
        first=await service.mutate('u','interests','robot learning')
        self.assertEqual(len(first['papers']),10)
        second=await service.mutate('u','more',cursor=first['cursor'])
        self.assertEqual(source.calls,1)
        self.assertFalse({p['id'] for p in first['papers']} & {p['id'] for p in second['papers']})
        repeat=await service.mutate('u','more',cursor=first['cursor'])
        self.assertEqual(second['papers'],repeat['papers'])
        self.assertEqual(first['papers'],(await FeedService(repo,[source]).read('u'))['papers'])
        third=await service.mutate('u','more',cursor=second['cursor'])
        self.assertEqual(source.calls,2)
        self.assertEqual(len(third['papers']),10)

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
        self.assertEqual(len(result['papers']),10)
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
        self.assertEqual(len(first['papers']),10)
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
        self.assertEqual(len(third['papers']),10)
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
        state['papers']=[paper(i).model_copy(update={'sources':['arxiv'] if i<10 else ['openalex']}).model_dump() for i in range(11)]
        selected=await service.mutate('u','source',source='arxiv')
        # A later arXiv record links the OpenAlex paper already in the snapshot.
        source.search=AsyncMock(return_value=SearchPage(papers=[paper(10)]))
        more=await service.mutate('u','more',cursor=selected['cursor'],source='arxiv')
        self.assertEqual([p['id'] for p in more['papers']],[paper(10).id])
        self.assertIsNone(more['cursor'])

    async def test_paper_details_merge_cached_sources_without_search(self):
        repo=Repo(); source=Source(); service=FeedService(repo,[source])
        arxiv=paper(1,abstract='Full original abstract',authors=['Jane Doe'])
        oa=arxiv.model_copy(update={'id':'openalex:W123','openalex_id':'W123','sources':['openalex'],'doi':'10.1234/example','topics':['Robotics']})
        repo.paper_records=AsyncMock(side_effect=[[oa],[arxiv,oa]])
        result=await service.paper('openalex-W123')
        self.assertEqual(result.id,'openalex:W123')
        self.assertEqual(result.abstract,'Full original abstract')
        self.assertEqual(set(result.sources),{'arxiv','openalex'})
        self.assertEqual(result.topics,['Robotics'])
        self.assertEqual(source.calls,0)

    async def test_paper_detail_missing_and_invalid_ids(self):
        repo=Repo(); repo.paper_records=AsyncMock(return_value=[])
        service=FeedService(repo,[Source()])
        for slug in ['arxiv-2609.99999','openalex-W999','not-a-paper','openalex-W1,or=anything']:
            with self.assertRaises(HTTPException) as ctx: await service.paper(slug)
            self.assertEqual(ctx.exception.status_code,404)
        self.assertEqual(repo.paper_records.await_count,2)

    async def test_arxiv_failure_keeps_cached_papers_visible_and_retries_possible(self):
        repo = Repo(); source = Source(); source.name = 'arxiv'
        service = FeedService(repo, [source])
        await service.mutate('u', 'interests', 'robot learning')
        repo.rows['u']['papers'] = repo.rows['u']['papers'][:5]
        repo.cache_rows.clear()
        repo.release = AsyncMock(wraps=repo.release)
        source.search = AsyncMock(side_effect=SourceError('Provider returned HTTP 429', status=429))
        result = await service.mutate('u', 'source', source='arxiv')
        self.assertEqual(len(result['papers']), 5)
        self.assertEqual(result['warnings'], ['arxiv'])
        self.assertIsNotNone(result['cursor'])
        self.assertFalse(repo.rows['u']['streams'][0]['done'])
        provider_releases = [call.args for call in repo.release.await_args_list if call.args[0] == 'provider:arxiv']
        self.assertEqual(provider_releases, [])

    async def test_arxiv_outage_without_cached_matches_is_clear_and_preserves_state(self):
        repo = Repo(); source = Source(); source.name = 'arxiv'
        service = FeedService(repo, [source])
        await service.mutate('u', 'interests', 'robot learning')
        repo.rows['u']['papers'] = []
        old = copy.deepcopy(repo.rows['u'])
        repo.cache_rows.clear()
        for failure, message in [
            (SourceError('Provider request timed out'), 'from OpenAlex'),
            (SourceError('Provider returned HTTP 429', status=429), 'from OpenAlex'),
        ]:
            with self.subTest(failure=str(failure)):
                source.search = AsyncMock(side_effect=failure)
                with self.assertRaises(HTTPException) as caught:
                    await service.mutate('u', 'source', source='arxiv')
                self.assertEqual(caught.exception.status_code, 503)
                self.assertIn(message, caught.exception.detail)
                self.assertNotIn('minute', caught.exception.detail)
                self.assertNotIn('Retry-After', caught.exception.headers or {})
                self.assertEqual(repo.rows['u'], old)

    async def test_failed_provider_is_not_retried_for_each_interest_in_one_update(self):
        good = Source(); bad = Source(); bad.name = 'arxiv'
        bad.search = AsyncMock(side_effect=SourceError('offline'))
        result = await FeedService(Repo(), [good, bad]).mutate('u', 'interests', 'robot learning, physics, climate')
        bad.search.assert_awaited_once()
        self.assertEqual(result['warnings'], ['arxiv'])
        self.assertTrue(result['papers'])

    async def test_old_arxiv_streams_restart_without_losing_cards_or_revision(self):
        from app.services.feed_sources.arxiv import ArxivSource
        repo = Repo(); old_source = Source(); old_source.name = 'arxiv'
        initial = await FeedService(repo, [old_source]).mutate('u', 'interests', 'robot learning')
        repo.rows['u']['papers'] = repo.rows['u']['papers'][:5]
        repo.rows['u']['streams'][0].update(cursor='48', done=True)
        source = ArxivSource()
        source.search = AsyncMock(return_value=SearchPage(papers=[paper(i) for i in range(5, 29)], next_cursor='opaque-next'))
        service = FeedService(repo, [source])
        selected = await service.mutate('u', 'source', source='arxiv')
        self.assertIsNone(source.search.await_args.args[0].cursor)
        self.assertEqual(selected['revision'], initial['revision'])
        self.assertEqual(selected['papers'][:5], initial['papers'][:5])
        self.assertEqual(repo.rows['u']['streams'][0]['cursor_version'], source.cursor_version)
        second = await service.mutate('u', 'more', cursor=selected['cursor'], source='arxiv')
        self.assertFalse({p['id'] for p in selected['papers']} & {p['id'] for p in second['papers']})
        source.search.assert_awaited_once()
        # The next upstream request continues the new opaque cursor, not Atom offsets.
        await service.mutate('u', 'more', cursor=second['cursor'], source='arxiv')
        self.assertEqual(source.search.await_args.args[0].cursor, 'opaque-next')

    async def test_old_arxiv_query_cache_is_not_reused(self):
        import hashlib
        from app.services.feed_sources.arxiv import ArxivSource
        from app.services.feed_sources.base import SearchRequest
        repo = Repo(); source = ArxivSource()
        request = SearchRequest(query='robot learning', since=date(2026,6,1), until=date(2026,9,28))
        old_key = hashlib.sha256((source.name + request.model_dump_json()).encode()).hexdigest()
        repo.cache_rows[old_key] = SearchPage(papers=[], next_cursor='24')
        source.search = AsyncMock(return_value=SearchPage(papers=[paper(1)]))
        result = await FeedService(repo, [source]).source_page(source, request)
        self.assertEqual(len(result.papers), 1)
        source.search.assert_awaited_once()
        self.assertEqual(repo.locks, set())

    async def test_native_huggingface_stream_restarts_with_openalex_cursor(self):
        from app.services.feed_sources.huggingface import HuggingFaceSource
        repo = Repo()
        await FeedService(repo, [Source()]).mutate('u', 'interests', 'robot learning')
        state = repo.rows['u']
        state['papers'] = [paper(0).model_copy(update={'sources': ['huggingface']}).model_dump()]
        state['streams'][0].update(done=True, cursor=None)
        revision = state['revision']
        source = HuggingFaceSource()
        source.search = AsyncMock(return_value=SearchPage(papers=[
            paper(i).model_copy(update={'sources': ['huggingface']}) for i in range(1, 24)
        ], next_cursor='openalex-next'))
        result = await FeedService(repo, [source]).mutate('u', 'source', source='huggingface')
        self.assertEqual(len(result['papers']), 10)
        self.assertEqual(result['revision'], revision)
        self.assertEqual(result['papers'][0]['id'], paper(0).id)
        self.assertIsNone(source.search.await_args.args[0].cursor)
        self.assertEqual(repo.rows['u']['streams'][0]['cursor'], 'openalex-next')
        self.assertEqual(repo.rows['u']['streams'][0]['cursor_version'], source.cursor_version)
