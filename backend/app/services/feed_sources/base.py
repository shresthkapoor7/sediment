from __future__ import annotations

import asyncio
import hashlib
import html
import re
from datetime import date
from typing import Literal, Protocol, Optional
from urllib.parse import urlparse

import aiohttp
from pydantic import BaseModel, Field

from ..feed_domains import Domain

Source = Literal['arxiv', 'huggingface', 'openalex', 'biorxiv', 'medrxiv', 'journals', 'repositories']


class Paper(BaseModel):
    id: str
    title: str
    abstract: str = ''
    authors: list[str] = Field(default_factory=list)
    published: Optional[str] = None
    updated: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    openalex_id: Optional[str] = None
    topics: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    url: str
    thumbnail: Optional[str] = None
    preprint: bool = False


class SearchRequest(BaseModel):
    domain: Domain = 'general'
    query: str = Field(min_length=1, max_length=300)
    since: date
    until: date
    cursor: Optional[str] = None
    limit: int = Field(default=24, ge=1, le=50)


class SearchPage(BaseModel):
    papers: list[Paper]
    next_cursor: Optional[str] = None


class PaperSource(Protocol):
    name: Source
    async def search(self, request: SearchRequest) -> SearchPage: ...
    async def get(self, identifier: str) -> Paper | None: ...


class SourceError(RuntimeError):
    """Deliberately excludes provider bodies and credential-bearing request URLs."""

    def __init__(self, message: str, *, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def clean(value: Optional[str]) -> str:
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value if isinstance(value, str) else '')).split())


def doi_id(value: Optional[str]) -> Optional[str]:
    value = value.strip().lower() if isinstance(value, str) else ''
    value = re.sub(r'^(?:https?://(?:dx\.)?doi.org/|doi:\s*)', '', value)
    return value if re.fullmatch(r'10\.\d{4,9}/\S+', value) else None


def arxiv_id(value: Optional[str]) -> Optional[str]:
    value = value.strip() if isinstance(value, str) else ''
    value = re.sub(r'^https?://(?:export\.)?arxiv.org/(?:abs|pdf)/', '', value)
    value = re.sub(r'\.pdf$', '', value)
    value = re.sub(r'v\d+$', '', value)
    return value if re.fullmatch(r'(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+/\d{7})', value) else None


def safe_url(value: Optional[str]) -> Optional[str]:
    try:
        parsed = urlparse(value or '')
        return value if parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username else None
    except ValueError:
        return None


def identity_keys(paper: Paper) -> set[str]:
    keys = {paper.id}
    if paper.doi: keys.add('doi:' + paper.doi)
    if paper.arxiv_id: keys.add('arxiv:' + paper.arxiv_id)
    if paper.openalex_id: keys.add('openalex:' + paper.openalex_id)
    # An exact normalized title AND complete author list is a conservative fallback.
    title = re.sub(r'\W+', '', paper.title.casefold())
    authors = sorted(re.sub(r'\W+', '', a.casefold()) for a in paper.authors)
    if len(title) > 30 and authors and all(authors):
        keys.add('title-authors:' + hashlib.sha256((title + '|'.join(authors)).encode()).hexdigest())
    return keys


async def fetch(url: str, params: dict | None = None):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=18, connect=5),
                                         headers={'User-Agent': 'Sediment/0.1 (research discovery)'}) as session:
            async with session.get(url, params=params) as response:
                if response.status != 200:
                    raise SourceError(f'Provider returned HTTP {response.status}', status=response.status)
                # Never fetch PDFs; bound metadata response size as well.
                body = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    body.extend(chunk)
                    if len(body) > 4_000_000: raise SourceError('Provider response too large')
                import json
                return json.loads(body)
    except asyncio.TimeoutError:
        raise SourceError('Provider request timed out') from None
    except (aiohttp.ClientError, ValueError):
        raise SourceError('Provider request failed') from None


def parse_records(rows, parser) -> list[Paper]:
    """A malformed record must not discard other providers' usable results."""
    if not isinstance(rows, list):
        raise SourceError('Invalid provider response')
    papers = []
    malformed = 0
    for row in rows:
        try:
            if not isinstance(row, dict): raise ValueError()
            paper = parser(row)
            if paper is not None: papers.append(paper)
        except (ValueError, TypeError, AttributeError, KeyError):
            malformed += 1
    if rows and malformed == len(rows):
        raise SourceError('Invalid provider records')
    return papers
