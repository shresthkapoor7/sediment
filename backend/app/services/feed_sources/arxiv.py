from __future__ import annotations

from ...config import settings
from .base import Paper, SourceError, arxiv_id, fetch, parse_records
from .openalex import ARXIV_SOURCE_ID, OpenAlexSource


class ArxivSource(OpenAlexSource):
    """arXiv-primary papers retrieved exclusively through OpenAlex."""
    name = 'arxiv'
    source_filter = 'primary_location.source.id:' + ARXIV_SOURCE_ID
    # Old Atom offsets and cached empty responses must never reach this adapter.
    cache_namespace = 'arxiv-openalex-v1'
    cursor_version = cache_namespace

    @staticmethod
    def parse(raw: dict) -> Paper | None:
        primary = raw.get('primary_location') or {}
        if (primary.get('source') or {}).get('id', '').rsplit('/', 1)[-1] != ARXIV_SOURCE_ID:
            return None
        paper = OpenAlexSource.parse(raw)
        if not paper or not paper.arxiv_id: return None
        return paper.model_copy(update={
            'id': 'arxiv:' + paper.arxiv_id, 'sources': ['arxiv', 'openalex'],
            'url': 'https://arxiv.org/abs/' + paper.arxiv_id, 'preprint': True,
        })

    async def get(self, identifier: str) -> Paper | None:
        identifier = arxiv_id(identifier)
        if not identifier: return None
        params = {'filter': self.source_filter + ',doi:https://doi.org/10.48550/arxiv.' + identifier, 'per_page': 1}
        if settings.openalex_api_key: params['api_key'] = settings.openalex_api_key
        data = await fetch('https://api.openalex.org/works', params)
        if not isinstance(data, dict): raise SourceError('Invalid OpenAlex response')
        papers = parse_records(data.get('results'), self.parse)
        return papers[0] if papers else None
