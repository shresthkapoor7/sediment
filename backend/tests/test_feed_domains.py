import unittest
from datetime import date
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from app.services.feeds import FeedService
from app.services.feed_domains import DOMAIN_SOURCES
from app.services.feed_sources.base import SearchRequest, SearchPage, SourceError
from app.services.feed_sources.openalex import BioRxivSource, MedRxivSource, JournalSource, RepositorySource, OpenAlexSource
from test_feeds import Repo, paper


class DomainTests(unittest.IsolatedAsyncioTestCase):
    async def test_domain_change_rebuilds_streams_and_invalidates_cursor(self):
        repo = Repo()
        service = FeedService(repo)
        for source in service.sources:
            source.search = AsyncMock(return_value=SearchPage(papers=[paper(i) for i in range(24)]))
        first = await service.mutate('u', 'interests', 'robot learning', domain='ai')
        second = await service.mutate('u', 'interests', 'robot learning', domain='biomed')
        self.assertNotEqual(first['revision'], second['revision'])
        self.assertEqual(second['availableSources'], list(DOMAIN_SOURCES['biomed']))
        self.assertEqual(set(s['source'] for s in repo.rows['u']['streams']), set(DOMAIN_SOURCES['biomed']))
        self.assertEqual((await service.read('u'))['domain'], 'biomed')
        with self.assertRaises(HTTPException):
            await service.mutate('u', 'more', cursor=first['cursor'])
        next(s for s in service.sources if s.name == 'huggingface').search.assert_awaited_once()
        for source in service.sources:
            source.search = AsyncMock(side_effect=SourceError('offline'))
        with self.assertRaises(HTTPException):
            await service.mutate('u', 'interests', 'different interests', domain='math_physics')
        self.assertEqual((await service.read('u'))['domain'], 'biomed')

    async def test_cache_is_partitioned_by_domain(self):
        source = OpenAlexSource()
        source.search = AsyncMock(return_value=SearchPage(papers=[]))
        service = FeedService(Repo(), [source])
        request = SearchRequest(query='learning', since=date(2026, 1, 1), until=date(2026, 2, 1), domain='ai')
        await service.source_page(source, request)
        await service.source_page(source, request.model_copy(update={'domain': 'biomed'}))
        await service.source_page(source, request)
        self.assertEqual(source.search.await_count, 2)

    async def test_openalex_filters_and_source_membership(self):
        for provider, source_id, source_type in [
            (BioRxivSource(), 'S4306402567', 'repository'),
            (MedRxivSource(), 'S3005729997', 'repository'),
            (JournalSource(), 'S123', 'journal'),
            (RepositorySource(), 'S123', 'repository'),
        ]:
            with self.subTest(source=provider.name):
                raw = {'id': 'https://openalex.org/W123', 'display_name': 'Biology',
                       'primary_location': {'source': {'id': 'https://openalex.org/' + source_id, 'type': source_type}}}
                with patch('app.services.feed_sources.openalex.fetch', AsyncMock(return_value={
                    'meta': {'next_cursor': 'opaque'}, 'results': [raw],
                })) as fetch:
                    result = await provider.search(SearchRequest(query='biology', since=date(2026, 1, 1), until=date(2026, 2, 1), domain='biomed'))
                filters = fetch.await_args.args[1]['filter']
                self.assertIn('primary_topic.field.id:11|13|24|27|28|30', filters)
                self.assertIn('primary_location.source.type:' + source_type, filters)
                if provider.name in ('biorxiv', 'medrxiv'):
                    self.assertIn('primary_location.source.id:' + source_id, filters)
                self.assertIn(provider.name, result.papers[0].sources)
                self.assertEqual(result.papers[0].id, 'openalex:W123')
                self.assertEqual(result.next_cursor, 'opaque')

    async def test_all_includes_each_source_and_openalex_is_exclusive(self):
        from app.services.feeds import matches_source
        repo = Repo()
        service = FeedService(repo)
        for source in service.sources:
            name = source.name
            base = {'arxiv': 0, 'journals': 100, 'openalex': 200}.get(name, 300)
            memberships = [name] if name == 'openalex' else [name, 'openalex']
            source.search = AsyncMock(return_value=SearchPage(papers=[
                paper(i).model_copy(update={'sources': memberships}) for i in range(base, base + 24)
            ]))
        result = await service.mutate('u', 'interests', 'robot learning', domain='math_physics')
        self.assertEqual(len(result['papers']), 30)
        for name in ('arxiv', 'journals', 'openalex'):
            self.assertEqual(sum(matches_source(p, name, 'math_physics') for p in result['papers']), 10)
        for provider in service.sources:
            for call in provider.search.await_args_list:
                self.assertLessEqual(call.args[0].limit, 10)
        self.assertEqual(len({p['id'] for p in result['papers']}), 30)
        for name in ('arxiv', 'journals', 'openalex'):
            selected = await service.mutate('u', 'source', source=name)
            self.assertEqual(len(selected['papers']), 10)
            self.assertTrue(all(matches_source(p, name, 'math_physics') for p in selected['papers']))
        exclusive = await service.mutate('u', 'source', source='openalex')
        self.assertTrue(all(p['sources'] == ['openalex'] for p in exclusive['papers']))
        # A source tab fetches papers that must appear when returning to All.
        repo.rows['u']['papers'].append(paper(999).model_copy(update={'sources': ['journals', 'openalex']}).model_dump())
        combined = await service.mutate('u', 'source', source='all')
        self.assertEqual(len(combined['papers']), 30)
        seen = {p['id'] for p in combined['papers']}
        while combined['cursor']:
            combined = await service.mutate('u', 'more', cursor=combined['cursor'])
            self.assertLessEqual(len(combined['papers']), 30)
            self.assertFalse(seen & {p['id'] for p in combined['papers']})
            seen.update(p['id'] for p in combined['papers'])
        self.assertEqual(len(seen), 73)
        self.assertIn(paper(999).id, seen)

    async def test_openalex_query_excludes_other_domain_tabs(self):
        with patch('app.services.feed_sources.openalex.fetch', AsyncMock(return_value={'meta': {}, 'results': []})) as fetch:
            await OpenAlexSource().search(SearchRequest(query='learning', domain='ai', since=date(2026,1,1), until=date(2026,2,1)))
        filters = fetch.await_args.args[1]['filter']
        self.assertIn('primary_location.source.id:!S4306400194', filters)
        self.assertIn('primary_location.source.id:!S7407051994', filters)
        self.assertIn('primary_location.source.type:!journal', filters)

    def test_openalex_membership_depends_on_visible_domain_tabs(self):
        from app.services.feeds import matches_source
        journal = paper(1).model_copy(update={'sources': ['openalex', 'journals']})
        repository = paper(2).model_copy(update={'sources': ['openalex', 'repositories']})
        self.assertFalse(matches_source(journal, 'openalex', 'ai'))
        self.assertFalse(matches_source(repository, 'openalex', 'general'))
        self.assertTrue(matches_source(repository, 'openalex', 'ai'))
        self.assertTrue(matches_source(journal, 'all', 'ai'))
