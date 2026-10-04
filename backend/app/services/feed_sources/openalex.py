from __future__ import annotations

from ...config import settings
from ..feed_domains import DOMAIN_FIELDS, DOMAIN_SOURCES
from ..openalex import _abstract_from_inverted_index
from .base import Paper, SearchPage, SearchRequest, arxiv_id, clean, doi_id, fetch, safe_url, parse_records, SourceError


ARXIV_SOURCE_ID = 'S4306400194'
HUGGINGFACE_SOURCE_ID = 'S7407051994'
BIORXIV_SOURCE_IDS = ('S4306402567',)
MEDRXIV_SOURCE_IDS = ('S3005729997', 'S4306400573')


class OpenAlexSource:
    name = 'openalex'
    source_filter = ''

    def __init__(self):
        if self.name == 'openalex':
            self.cache_namespace = 'openalex-exclusive-v1'
            self.cursor_version = self.cache_namespace

    @staticmethod
    def parse(raw: dict) -> Paper | None:
        identifier = (raw.get('id') or '').rsplit('/', 1)[-1]
        if not identifier.startswith('W') or not identifier[1:].isdigit(): return None
        doi = doi_id(raw.get('doi'))
        primary = raw.get('primary_location') or {}
        is_arxiv = (primary.get('source') or {}).get('id', '').rsplit('/', 1)[-1] == ARXIV_SOURCE_ID
        source = primary.get('source') or {}
        source_id = (source.get('id') or '').rsplit('/', 1)[-1]
        memberships = ['openalex']
        if is_arxiv: memberships.append('arxiv')
        if source_id == HUGGINGFACE_SOURCE_ID: memberships.append('huggingface')
        if source_id in BIORXIV_SOURCE_IDS: memberships.append('biorxiv')
        if source_id in MEDRXIV_SOURCE_IDS: memberships.append('medrxiv')
        if source.get('type') == 'journal': memberships.append('journals')
        if source.get('type') == 'repository': memberships.append('repositories')
        locations = [primary, *(raw.get('locations') or [])]
        arxiv = next((value for location in locations for key in ('landing_page_url', 'pdf_url')
                      if (value := arxiv_id(location.get(key)))), None)
        if doi and doi.startswith('10.48550/arxiv.'):
            arxiv = arxiv_id(doi[len('10.48550/arxiv.'):]) or arxiv
        return Paper(id='openalex:' + identifier, openalex_id=identifier, arxiv_id=arxiv, doi=doi,
                     title=clean(raw.get('display_name')), abstract=clean(_abstract_from_inverted_index(raw.get('abstract_inverted_index'))),
                     authors=[a['author']['display_name'] for a in (raw.get('authorships') or []) if a.get('author', {}).get('display_name')],
                     published=raw.get('publication_date'), sources=memberships,
                     topics=[t['display_name'] for t in (raw.get('topics') or []) if t.get('display_name')],
                     url=safe_url(raw.get('doi')) or safe_url(primary.get('landing_page_url')) or 'https://openalex.org/' + identifier,
                     preprint=is_arxiv or source_id in (*BIORXIV_SOURCE_IDS, *MEDRXIV_SOURCE_IDS) or raw.get('type') == 'preprint')

    async def search(self, request: SearchRequest) -> SearchPage:
        params = {'search': request.query, 'filter': f'from_publication_date:{request.since},to_publication_date:{request.until},type:article|preprint|review,is_retracted:false,is_paratext:false',
                  'sort': 'publication_date:desc', 'per_page': request.limit, 'cursor': request.cursor or '*'}
        fields = DOMAIN_FIELDS[request.domain]
        if fields: params['filter'] += ',primary_topic.field.id:' + '|'.join(fields)
        if self.source_filter: params['filter'] += ',' + self.source_filter
        if self.name == 'openalex':
            # OpenAlex is the remainder outside this domain's named source tabs.
            excluded = {'arxiv': (ARXIV_SOURCE_ID,), 'huggingface': (HUGGINGFACE_SOURCE_ID,),
                        'biorxiv': BIORXIV_SOURCE_IDS, 'medrxiv': MEDRXIV_SOURCE_IDS}
            for source in DOMAIN_SOURCES[request.domain]:
                for identifier in excluded.get(source, ()):
                    params['filter'] += ',primary_location.source.id:!' + identifier
                if source in ('journals', 'repositories'):
                    params['filter'] += ',primary_location.source.type:!' + ('journal' if source == 'journals' else 'repository')
        if settings.openalex_api_key: params['api_key'] = settings.openalex_api_key
        data = await fetch('https://api.openalex.org/works', params)
        if not isinstance(data, dict) or not isinstance(data.get('meta'), dict):
            raise SourceError('Invalid OpenAlex response')
        papers = parse_records(data.get('results'), self.parse)
        return SearchPage(papers=papers, next_cursor=(data.get('meta') or {}).get('next_cursor') if data.get('results') else None)

    async def get(self, identifier: str) -> Paper | None:
        identifier = identifier.rsplit('/', 1)[-1]
        if not identifier.startswith('W') or not identifier[1:].isdigit(): return None
        papers = parse_records([await fetch('https://api.openalex.org/works/' + identifier,
                               {'api_key': settings.openalex_api_key} if settings.openalex_api_key else {})], self.parse)
        return papers[0] if papers else None
