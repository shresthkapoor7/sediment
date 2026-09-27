from __future__ import annotations

from .base import Paper, SearchPage, SearchRequest, arxiv_id, clean, fetch, safe_url, parse_records, SourceError


class HuggingFaceSource:
    name = 'huggingface'

    @staticmethod
    def parse(record: dict) -> Paper | None:
        raw = record.get('paper') or record
        identifier = arxiv_id(raw.get('id'))
        if not identifier: return None
        thumbnail = safe_url(record.get('thumbnail') or raw.get('thumbnail'))
        # Only known provider-hosted thumbnail URLs are handed to the browser.
        if thumbnail and not thumbnail.startswith('https://cdn-thumbnails.huggingface.co/'):
            thumbnail = None
        return Paper(id='arxiv:' + identifier, arxiv_id=identifier,
                     title=clean(raw.get('title')), abstract=clean(raw.get('summary')),
                     authors=[a.get('name', '') for a in (raw.get('authors') or []) if a.get('name')],
                     published=(raw.get('publishedAt') or '')[:10] or None,
                     sources=['huggingface'], url='https://huggingface.co/papers/' + identifier,
                     thumbnail=thumbnail, preprint=True)

    async def search(self, request: SearchRequest) -> SearchPage:
        # Hub paper search is a bounded candidate source without a public paging
        # cursor. Do not invent offset parameters or repeat its first page.
        if request.cursor: return SearchPage(papers=[])
        rows = await fetch('https://huggingface.co/api/papers/search', {'q': request.query})
        if not isinstance(rows, list): raise SourceError('Invalid Hugging Face response')
        papers = parse_records(rows[:100], self.parse)
        return SearchPage(papers=[p for p in papers if p.published and
                          request.since.isoformat() <= p.published <= request.until.isoformat()][:request.limit])

    async def get(self, identifier: str) -> Paper | None:
        identifier = arxiv_id(identifier)
        if not identifier: return None
        papers = parse_records([await fetch('https://huggingface.co/api/papers/' + identifier)], self.parse)
        return papers[0] if papers else None
