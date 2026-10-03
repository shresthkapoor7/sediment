"""Source-specific adapters built on the shared OpenAlex client."""
from __future__ import annotations

from ...config import settings
from .base import Paper, SourceError, arxiv_id, fetch, parse_records
from .openalex import (
    ARXIV_SOURCE_ID,
    HUGGINGFACE_SOURCE_ID,
    BIORXIV_SOURCE_IDS,
    MEDRXIV_SOURCE_IDS,
    OpenAlexSource,
)


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


class HuggingFaceSource(OpenAlexSource):
    """Hugging Face repository papers retrieved exclusively through OpenAlex."""
    name = 'huggingface'
    source_filter = 'primary_location.source.id:' + HUGGINGFACE_SOURCE_ID + ',primary_location.source.type:repository'
    # Restart exhausted native-API streams and avoid their cached pages.
    cache_namespace = 'huggingface-openalex-v1'
    cursor_version = cache_namespace

    @staticmethod
    def parse(raw: dict) -> Paper | None:
        source = (raw.get('primary_location') or {}).get('source') or {}
        if (source.get('id') or '').rsplit('/', 1)[-1] != HUGGINGFACE_SOURCE_ID:
            return None
        return OpenAlexSource.parse(raw)


class BioRxivSource(OpenAlexSource):
    name = 'biorxiv'
    source_filter = 'primary_location.source.id:' + '|'.join(BIORXIV_SOURCE_IDS) + ',primary_location.source.type:repository'


class MedRxivSource(OpenAlexSource):
    name = 'medrxiv'
    source_filter = 'primary_location.source.id:' + '|'.join(MEDRXIV_SOURCE_IDS) + ',primary_location.source.type:repository'


class JournalSource(OpenAlexSource):
    name = 'journals'
    source_filter = 'primary_location.source.type:journal'


class RepositorySource(OpenAlexSource):
    name = 'repositories'
    source_filter = 'primary_location.source.type:repository'
