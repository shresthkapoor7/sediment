import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from app.services.feed_sources.base import Paper, SearchRequest, arxiv_id, doi_id, identity_keys
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

    def test_arxiv_revisions_and_dates(self):
        xml = '''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v2</id><title> A paper </title><published>2024-01-01T00:00:00Z</published><updated>2024-02-01T00:00:00Z</updated><author><name>Jane Doe</name></author><summary>Some abstract</summary></entry></feed>'''
        papers, _ = ArxivSource.parse(xml)
        self.assertEqual(papers[0].arxiv_id, '2401.12345')
        self.assertEqual(papers[0].published, '2024-01-01')
        self.assertEqual(papers[0].updated, '2024-02-01')

    async def test_hf_uses_paper_date_not_feature_date(self):
        rows = [{'paper': {'id': '2401.12345', 'publishedAt': '2024-01-01', 'title': 'Old'}, 'publishedAt': '2026-09-26'}]
        with patch('app.services.feed_sources.huggingface.fetch', AsyncMock(return_value=rows)):
            result = await HuggingFaceSource().search(SearchRequest(query='AI', since=date(2026,9,1), until=date(2026,9,27)))
        self.assertEqual(result.papers, [])

    def test_title_alone_does_not_merge(self):
        a = Paper(id='a', title='An identical title about machine learning', authors=['Jane'], url='https://example.org')
        b = a.model_copy(update={'id': 'b', 'authors': ['John']})
        self.assertFalse(identity_keys(a) & identity_keys(b))
