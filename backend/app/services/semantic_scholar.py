from typing import Optional
import logging
import aiohttp
import asyncio

logger = logging.getLogger(__name__)

FIELDS = "title,abstract,year,authors,citationCount,externalIds,url"
BASE = "https://api.semanticscholar.org/graph/v1/paper"
SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search"

RETRY_DELAYS = [10, 20, 40]  # seconds to wait on 429
REQUEST_DELAY = 3.0           # polite delay between all requests


HEADERS = {"User-Agent": "Sediment/1.0 (research lineage explorer; contact via github)"}


async def _get(session: aiohttp.ClientSession, url: str, params: dict) -> Optional[dict]:
    """GET with polite delay + retry on 429."""
    await asyncio.sleep(REQUEST_DELAY)
    for attempt, delay in enumerate([0] + RETRY_DELAYS):
        if delay:
            logger.info(f"Rate limited, waiting {delay}s before retry {attempt}...")
            await asyncio.sleep(delay)
        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                return await resp.json()
            if resp.status == 429:
                continue
            logger.error(f"S2 error {resp.status} for {url}")
            return None
    logger.error(f"Giving up after retries for {url}")
    return None


class SemanticScholarClient:
    def __init__(self, api_key: str = ""):
        self.headers = {**HEADERS, "x-api-key": api_key} if api_key else {**HEADERS}

    def _extract_arxiv_id(self, paper: dict) -> Optional[str]:
        return paper.get("externalIds", {}).get("ArXiv")

    def _normalize(self, paper: dict) -> dict:
        return {
            "s2Id": paper.get("paperId"),
            "title": paper.get("title", ""),
            "abstract": paper.get("abstract", ""),
            "year": paper.get("year"),
            "authors": [a["name"] for a in paper.get("authors", [])],
            "citationCount": paper.get("citationCount", 0),
            "arxivId": self._extract_arxiv_id(paper),
        }

    async def search_papers(self, query: str, limit: int = 10) -> list[dict]:
        """Search by concept name, sorted by citation count."""
        params = {"query": query, "limit": limit, "fields": FIELDS}
        async with aiohttp.ClientSession(headers=self.headers) as session:
            data = await _get(session, SEARCH, params)
            if not data:
                return []
            return [self._normalize(p) for p in data.get("data", []) if p.get("title")]

    async def fetch_references(self, paper_id: str, limit: int = 100) -> list[dict]:
        """Get papers this paper cites (its intellectual ancestors)."""
        params = {"fields": FIELDS, "limit": limit}
        url = f"{BASE}/{paper_id}/references"
        async with aiohttp.ClientSession(headers=self.headers) as session:
            data = await _get(session, url, params)
            if not data:
                return []
            results = []
            for item in data.get("data", []):
                cited = item.get("citedPaper", {})
                if cited.get("title") and cited.get("year"):
                    results.append(self._normalize(cited))
            return results

    async def fetch_paper(self, paper_id: str) -> Optional[dict]:
        """Fetch a single paper by ID."""
        params = {"fields": FIELDS}
        async with aiohttp.ClientSession(headers=self.headers) as session:
            data = await _get(session, f"{BASE}/{paper_id}", params)
            if not data:
                return None
            return self._normalize(data)
