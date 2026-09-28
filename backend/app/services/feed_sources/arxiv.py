from __future__ import annotations

import asyncio
import re
import time
import xml.etree.ElementTree as ET

from .base import Paper, SearchPage, SearchRequest, SourceError, arxiv_id, clean, doi_id, fetch

ATOM = '{http://www.w3.org/2005/Atom}'
ARXIV = '{http://arxiv.org/schemas/atom}'
_lock = asyncio.Lock()
_last_request = 0.0
_blocked_until = 0.0


class ArxivSource:
    name = 'arxiv'

    async def _fetch(self, params: dict) -> str:
        global _last_request, _blocked_until
        # One connection, at least 3 seconds between calls. The feed repository also
        # holds a database lease so this remains serialized across API workers.
        async with _lock:
            if time.monotonic() < _blocked_until:
                raise SourceError('arXiv requests paused after a rate-limit response', status=429)
            await asyncio.sleep(max(0, 3.1 - (time.monotonic() - _last_request)))
            try:
                return await fetch('https://export.arxiv.org/api/query', params, xml=True)
            except SourceError as error:
                if error.status == 429:
                    _blocked_until = time.monotonic() + 60
                raise
            finally:
                _last_request = time.monotonic()

    @staticmethod
    def parse(text: str) -> tuple[list[Paper], int]:
        if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
            raise SourceError('Unexpected XML declaration')
        try:
            root = ET.fromstring(text)
            if root.tag != ATOM + 'feed':
                raise SourceError('Invalid arXiv feed')
            papers = []
            for entry in root.findall(ATOM + 'entry'):
                if (entry.findtext(ATOM + 'id') or '').startswith(('http://arxiv.org/api/errors', 'https://arxiv.org/api/errors')):
                    raise SourceError('arXiv returned an API error')
                identifier = arxiv_id(entry.findtext(ATOM + 'id'))
                if not identifier: continue
                papers.append(Paper(
                    id='arxiv:' + identifier, arxiv_id=identifier,
                    doi=doi_id(entry.findtext(ARXIV + 'doi')),
                    title=clean(entry.findtext(ATOM + 'title')),
                    abstract=clean(entry.findtext(ATOM + 'summary')),
                    authors=[clean(a.findtext(ATOM + 'name')) for a in entry.findall(ATOM + 'author')],
                    published=(entry.findtext(ATOM + 'published') or '')[:10] or None,
                    updated=(entry.findtext(ATOM + 'updated') or '')[:10] or None,
                    topics=[c.attrib['term'] for c in entry.findall(ATOM + 'category') if 'term' in c.attrib],
                    sources=['arxiv'], url='https://arxiv.org/abs/' + identifier, preprint=True,
                ))
            total = int(root.findtext('{http://a9.com/-/spec/opensearch/1.1/}totalResults') or len(papers))
            return papers, total
        except (ET.ParseError, ValueError):
            raise SourceError('Invalid arXiv response') from None

    async def search(self, request: SearchRequest) -> SearchPage:
        # Accept plain search text, never splice user-supplied arXiv query syntax.
        terms = re.findall(r'[\w-]+', request.query, re.UNICODE)[:12]
        query = ' AND '.join(f'all:"{term}"' for term in terms)
        query += f' AND submittedDate:[{request.since:%Y%m%d}0000 TO {request.until:%Y%m%d}2359]'
        start = int(request.cursor or '0')
        text = await self._fetch({'search_query': query, 'start': start, 'max_results': request.limit,
                                  'sortBy': 'submittedDate', 'sortOrder': 'descending'})
        papers, total = self.parse(text)
        return SearchPage(papers=papers, next_cursor=str(start + request.limit) if start + request.limit < total else None)

    async def get(self, identifier: str) -> Paper | None:
        identifier = arxiv_id(identifier)
        if not identifier: return None
        papers, _ = self.parse(await self._fetch({'id_list': identifier}))
        return papers[0] if papers else None
