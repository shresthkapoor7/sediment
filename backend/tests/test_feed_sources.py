import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from app.services.feed_sources.base import Paper, SearchRequest, arxiv_id, doi_id, identity_keys, SourceError
from app.services.feed_sources.arxiv import ArxivSource
from app.services.feed_sources.huggingface import HuggingFaceSource
from app.services.feed_sources.openalex import OpenAlexSource


class FeedSourcesTests(unittest.IsolatedAsyncioTestCase):
    def test_cross_source_identifiers(self):
        self.assertEqual(arxiv_id('https://arxiv.org/pdf/2401.12345v3.pdf'), '2401.12345')
        self.assertEqual(doi_id('https://doi.org/10.1234/ABC'), '10.1234/abc')
        hf = HuggingFaceSource.parse({'paper': {'id': '2401.12345', 'title': 'A study'}})
        oa = OpenAlexSource.parse({'id': 'https://openalex.org/W123', 'doi': 'https://doi.org/10.48550/arXiv.2401.12345'})
        self.assertTrue(identity_keys(hf) & identity_keys(oa))


    async def test_hf_uses_paper_date_not_feature_date(self):
        rows = [{'paper': {'id': '2401.12345', 'publishedAt': '2024-01-01', 'title': 'Old'}, 'publishedAt': '2026-09-26'}]
        with patch('app.services.feed_sources.huggingface.fetch', AsyncMock(return_value=rows)):
            result = await HuggingFaceSource().search(SearchRequest(query='AI', since=date(2026,9,1), until=date(2026,9,27)))
        self.assertEqual(result.papers, [])

    def test_title_alone_does_not_merge(self):
        a = Paper(id='a', title='An identical title about machine learning', authors=['Jane'], url='https://example.org')
        b = a.model_copy(update={'id': 'b', 'authors': ['John']})
        self.assertFalse(identity_keys(a) & identity_keys(b))

    async def test_malformed_source_envelope_is_a_provider_failure(self):
        request=SearchRequest(query='robotics', since=date(2026,9,1), until=date(2026,9,27))
        with patch('app.services.feed_sources.huggingface.fetch', AsyncMock(return_value={'error':'unavailable'})):
            with self.assertRaises(SourceError): await HuggingFaceSource().search(request)
        with patch('app.services.feed_sources.openalex.fetch', AsyncMock(return_value=[])):
            with self.assertRaises(SourceError): await OpenAlexSource().search(request)

    async def test_malformed_record_does_not_hide_usable_results(self):
        request=SearchRequest(query='robotics', since=date(2026,9,1), until=date(2026,9,27))
        rows=[None, {'paper':{'id':'2609.12345','title':'Robot learning','publishedAt':'2026-09-27','authors':None}}]
        with patch('app.services.feed_sources.huggingface.fetch', AsyncMock(return_value=rows)):
            result=await HuggingFaceSource().search(request)
        self.assertEqual(len(result.papers),1)


    async def test_transport_preserves_rate_limit_status_without_response_body(self):
        from unittest.mock import MagicMock
        from app.services.feed_sources.base import fetch
        with patch('app.services.feed_sources.base.aiohttp.ClientSession') as factory:
            session = MagicMock()
            factory.return_value.__aenter__.return_value = session
            response = session.get.return_value.__aenter__.return_value
            response.status = 429
            with self.assertRaises(SourceError) as caught:
                await fetch('https://api.openalex.org/works')
            self.assertEqual(caught.exception.status, 429)
            self.assertEqual(str(caught.exception), 'Provider returned HTTP 429')

    def arxiv_work(self):
        return {'id': 'https://openalex.org/W123', 'display_name': 'Robot learning',
                'publication_date': '2026-09-24', 'type': 'preprint',
                'primary_location': {'source': {'id': 'https://openalex.org/S4306400194'},
                                     'landing_page_url': 'https://arxiv.org/abs/2609.12345v2'},
                'abstract_inverted_index': {'Full': [0], 'abstract': [1]},
                'authorships': [{'author': {'display_name': 'Jane Doe'}}]}

    async def test_arxiv_search_uses_filtered_openalex_and_opaque_pagination(self):
        raw = self.arxiv_work()
        with patch('app.services.feed_sources.openalex.fetch', AsyncMock(return_value={
            'meta': {'next_cursor': 'next-openalex-cursor'}, 'results': [raw],
        })) as fetch:
            page = await ArxivSource().search(SearchRequest(query='robot learning', since=date(2026,6,1), until=date(2026,9,28), cursor='openalex-cursor', limit=12))
        url, params = fetch.await_args.args
        self.assertEqual(url, 'https://api.openalex.org/works')
        self.assertIn('primary_location.source.id:S4306400194', params['filter'])
        self.assertEqual(params['cursor'], 'openalex-cursor')
        self.assertEqual(params['per_page'], 12)
        paper = page.papers[0]
        self.assertEqual(paper.id, 'arxiv:2609.12345')
        self.assertEqual(paper.openalex_id, 'W123')
        self.assertEqual(paper.sources, ['arxiv', 'openalex'])
        self.assertEqual(paper.url, 'https://arxiv.org/abs/2609.12345')
        self.assertEqual(paper.abstract, 'Full abstract')
        self.assertEqual(paper.authors, ['Jane Doe'])
        self.assertEqual(paper.published, '2026-09-24')
        self.assertEqual(page.next_cursor, 'next-openalex-cursor')
        self.assertTrue(identity_keys(paper) & identity_keys(OpenAlexSource.parse(raw)))

    async def test_arxiv_skips_unverified_records_without_losing_next_page(self):
        raw = self.arxiv_work()
        raw['primary_location']['landing_page_url'] = None
        other = self.arxiv_work()
        other['primary_location']['source']['id'] = 'https://openalex.org/S999'
        with patch('app.services.feed_sources.openalex.fetch', AsyncMock(return_value={
            'meta': {'next_cursor': 'next'}, 'results': [raw, other],
        })):
            page = await ArxivSource().search(SearchRequest(query='robot learning', since=date(2026,6,1), until=date(2026,9,28)))
        self.assertEqual(page.papers, [])
        self.assertEqual(page.next_cursor, 'next')

    async def test_arxiv_get_uses_openalex_and_preserves_canonical_id(self):
        with patch('app.services.feed_sources.arxiv.fetch', AsyncMock(return_value={'results': [self.arxiv_work()]})) as fetch:
            paper = await ArxivSource().get('https://arxiv.org/abs/2609.12345v2')
            self.assertIsNone(await ArxivSource().get('not-an-id'))
        fetch.assert_awaited_once()
        url, params = fetch.await_args.args
        self.assertEqual(url, 'https://api.openalex.org/works')
        self.assertIn('doi:https://doi.org/10.48550/arxiv.2609.12345', params['filter'])
        self.assertEqual(paper.id, 'arxiv:2609.12345')
