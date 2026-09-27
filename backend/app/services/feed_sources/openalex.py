from __future__ import annotations

from ...config import settings
from ..openalex import _abstract_from_inverted_index
from .base import Paper, SearchPage, SearchRequest, arxiv_id, clean, doi_id, fetch, safe_url


class OpenAlexSource:
    name = 'openalex'

    @staticmethod
    def parse(raw: dict) -> Paper | None:
        identifier = (raw.get('id') or '').rsplit('/', 1)[-1]
        if not identifier.startswith('W') or not identifier[1:].isdigit(): return None
        doi = doi_id(raw.get('doi'))
        locations = raw.get('locations') or []
        arxiv = next((value for location in locations for key in ('landing_page_url', 'pdf_url')
                      if (value := arxiv_id(location.get(key)))), None)
        if doi and doi.startswith('10.48550/arxiv.'):
            arxiv = arxiv_id(doi[len('10.48550/arxiv.'):]) or arxiv
        primary = raw.get('primary_location') or {}
        return Paper(id='openalex:' + identifier, openalex_id=identifier, arxiv_id=arxiv, doi=doi,
                     title=clean(raw.get('display_name')), abstract=clean(_abstract_from_inverted_index(raw.get('abstract_inverted_index'))),
                     authors=[a['author']['display_name'] for a in raw.get('authorships', []) if a.get('author', {}).get('display_name')],
                     published=raw.get('publication_date'), sources=['openalex'],
                     topics=[t['display_name'] for t in raw.get('topics', []) if t.get('display_name')],
                     url=safe_url(raw.get('doi')) or safe_url(primary.get('landing_page_url')) or 'https://openalex.org/' + identifier,
                     preprint=raw.get('type') == 'preprint')

    async def search(self, request: SearchRequest) -> SearchPage:
        params = {'search': request.query, 'filter': f'from_publication_date:{request.since},to_publication_date:{request.until},type:article|preprint|review,is_retracted:false,is_paratext:false',
                  'sort': 'publication_date:desc', 'per_page': request.limit, 'cursor': request.cursor or '*'}
        if settings.openalex_api_key: params['api_key'] = settings.openalex_api_key
        data = await fetch('https://api.openalex.org/works', params)
        papers = [p for raw in data.get('results', []) if (p := self.parse(raw))]
        return SearchPage(papers=papers, next_cursor=(data.get('meta') or {}).get('next_cursor') if papers else None)

    async def get(self, identifier: str) -> Paper | None:
        identifier = identifier.rsplit('/', 1)[-1]
        if not identifier.startswith('W') or not identifier[1:].isdigit(): return None
        return self.parse(await fetch('https://api.openalex.org/works/' + identifier,
                                     {'api_key': settings.openalex_api_key} if settings.openalex_api_key else {}))
