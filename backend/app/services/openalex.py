from __future__ import annotations

from typing import Optional
import asyncio
import logging
import re

import aiohttp

logger = logging.getLogger(__name__)

BASE = "https://api.openalex.org"
REQUEST_DELAY = 0.1
SEARCH_SELECT = ",".join([
    "id",
    "display_name",
    "publication_year",
    "authorships",
    "doi",
    "cited_by_count",
    "primary_topic",
    "abstract_inverted_index",
    "referenced_works",
])


class OpenAlexError(Exception):
    pass


def _extract_openalex_id(raw_id: str | None) -> Optional[str]:
    if not raw_id:
        return None
    return raw_id.rstrip("/").split("/")[-1]


def _abstract_from_inverted_index(index: Optional[dict]) -> str:
    if not index:
        return ""

    positions: dict[int, str] = {}
    for token, idxs in index.items():
        if not isinstance(idxs, list):
            continue
        for pos in idxs:
            if isinstance(pos, int):
                positions[pos] = token

    if not positions:
        return ""

    return " ".join(positions[i] for i in sorted(positions))


_GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "lambda": "λ", "mu": "μ",
    "nu": "ν", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ",
    "phi": "φ", "psi": "ψ", "omega": "ω",
}

_LAYOUT_CMDS = re.compile(
    r"\\(?:noindent|newline|linebreak|pagebreak|smallskip|medskip|bigskip|hspace|vspace|par)\b"
)


def _clean_abstract(text: str) -> str:
    """Clean LaTeX macros from raw abstract text so it reads as plain prose."""
    # \frac{a}{b} -> a/b
    text = re.sub(r"\\frac\{([^}]*)\}\{([^}]*)\}", r"\1/\2", text)
    # formatting macros: unwrap content
    text = re.sub(r"\\(?:emph|textbf|textit|textrm|mathrm|mathbf|mathit)\{([^}]*)\}", r"\1", text)
    # any remaining \cmd{...} -> contents
    text = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", text)
    # Greek letters -> unicode
    text = re.sub(r"\\([a-zA-Z]+)\b", lambda m: _GREEK.get(m.group(1), ""), text)
    # layout-only commands
    text = _LAYOUT_CMDS.sub("", text)
    # orphan braces
    text = text.replace("{", "").replace("}", "")
    return text.strip()


def _build_detail(abstract: str, primary_topic: Optional[str], cited_by_count: int) -> str:
    abstract = _clean_abstract(abstract.strip())
    if abstract:
        return abstract[:560]

    parts = []
    if primary_topic:
        parts.append(f"Primary topic: {primary_topic}.")
    if cited_by_count:
        parts.append(f"Cited by {cited_by_count} works in OpenAlex.")
    return " ".join(parts)


async def _get(session: aiohttp.ClientSession, url: str, params: dict) -> dict:
    await asyncio.sleep(REQUEST_DELAY)
    try:
        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                return await resp.json()
            text = await resp.text()
            logger.error("OpenAlex error %s for %s: %s", resp.status, url, text)
            raise OpenAlexError(f"OpenAlex error {resp.status}")
    except OpenAlexError:
        raise
    except asyncio.TimeoutError as exc:
        logger.error("Timeout fetching %s", url)
        raise OpenAlexError(f"Timeout fetching {url}") from exc
    except aiohttp.ClientError as exc:
        logger.error("Transport error fetching %s: %s", url, exc)
        raise OpenAlexError(f"Transport error: {exc}") from exc


class OpenAlexClient:
    def __init__(self, api_key: str = "", mailto: str = ""):
        self.api_key = api_key
        self.mailto = mailto
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self) -> "OpenAlexClient":
        self._session = aiohttp.ClientSession(headers={"User-Agent": "Sediment/1.0"})
        return self

    async def __aexit__(self, *_):
        if self._session:
            await self._session.close()
            self._session = None

    def _session_or_raise(self) -> aiohttp.ClientSession:
        if self._session is None:
            raise RuntimeError("Use 'async with OpenAlexClient() as client:'")
        return self._session

    def _base_params(self) -> dict:
        params: dict[str, str] = {}
        if self.api_key:
            params["api_key"] = self.api_key
        if self.mailto:
            params["mailto"] = self.mailto
        return params

    def _normalize_work(self, work: dict) -> Optional[dict]:
        openalex_id = _extract_openalex_id(work.get("id"))
        title = work.get("display_name") or ""
        if not openalex_id or not title:
            return None

        abstract = _abstract_from_inverted_index(work.get("abstract_inverted_index"))
        primary_topic = (work.get("primary_topic") or {}).get("display_name")

        return {
            "openalexId": openalex_id,
            "title": title,
            "abstract": abstract,
            "detail": _build_detail(abstract, primary_topic, work.get("cited_by_count", 0)),
            "year": work.get("publication_year"),
            "authors": [
                authorship.get("author", {}).get("display_name", "")
                for authorship in work.get("authorships", [])
                if authorship.get("author", {}).get("display_name")
            ],
            "doi": work.get("doi"),
            "citedByCount": work.get("cited_by_count", 0),
            "primaryTopic": primary_topic,
            "referencedWorks": [
                ref_id for ref_id in (_extract_openalex_id(item) for item in work.get("referenced_works", [])) if ref_id
            ],
            "referencedWorksCount": len(work.get("referenced_works", [])),
        }

    async def search_papers(self, query: str, limit: int = 8) -> list[dict]:
        # Run title search and broad search in parallel, merge with title matches first.
        # Title search catches specific paper titles; broad search catches general concepts.
        title_params = {
            **self._base_params(),
            "filter": f"display_name.search:{query}",
            "per-page": str(limit),
            "select": SEARCH_SELECT,
        }
        broad_params = {
            **self._base_params(),
            "filter": f"title_and_abstract.search:{query}",
            "per-page": str(limit),
            "select": SEARCH_SELECT,
        }

        title_data, broad_data = await asyncio.gather(
            _get(self._session_or_raise(), f"{BASE}/works", title_params),
            _get(self._session_or_raise(), f"{BASE}/works", broad_params),
            return_exceptions=True,
        )

        if isinstance(title_data, Exception) and isinstance(broad_data, Exception):
            raise OpenAlexError(
                "OpenAlex search failed for both title and broad queries: "
                f"title={title_data}, broad={broad_data}"
            )

        seen_ids: set[str] = set()
        results: list[dict] = []

        for data in (title_data, broad_data):
            if isinstance(data, Exception):
                continue
            for work in data.get("results", []):
                normalized = self._normalize_work(work)
                if normalized and normalized["openalexId"] not in seen_ids:
                    seen_ids.add(normalized["openalexId"])
                    results.append(normalized)

        return results[:limit * 2]  # give LLM more candidates to pick from

    async def fetch_work(self, openalex_id: str) -> Optional[dict]:
        params = {**self._base_params(), "select": SEARCH_SELECT}
        data = await _get(self._session_or_raise(), f"{BASE}/works/{openalex_id}", params)
        return self._normalize_work(data)

    async def hydrate_works(self, openalex_ids: list[str]) -> list[dict]:
        unique_ids = []
        seen = set()
        for paper_id in openalex_ids:
            if paper_id and paper_id not in seen:
                unique_ids.append(paper_id)
                seen.add(paper_id)

        if not unique_ids:
            return []

        params = {
            **self._base_params(),
            "filter": f"openalex:{'|'.join(unique_ids)}",
            "per-page": str(len(unique_ids)),
            "select": SEARCH_SELECT,
        }
        data = await _get(self._session_or_raise(), f"{BASE}/works", params)
        results = []
        for work in data.get("results", []):
            normalized = self._normalize_work(work)
            if normalized:
                results.append(normalized)

        order = {paper_id: i for i, paper_id in enumerate(unique_ids)}
        results.sort(key=lambda item: order.get(item["openalexId"], 10**9))
        return results

    async def fetch_references(self, openalex_id: str, limit: int = 25) -> list[dict]:
        work = await self.fetch_work(openalex_id)
        if not work:
            return []
        return await self.hydrate_works(work.get("referencedWorks", [])[:limit])

    async def fetch_related_earlier_papers(self, paper: dict, limit: int = 20) -> list[dict]:
        """Fallback for papers with no indexed references — search by topic/title keywords."""
        year = paper.get("year")
        title = paper.get("title", "")
        primary_topic = paper.get("primaryTopic")

        # Build a focused query from the title (strip subtitle after colon)
        short_title = title.split(":")[0].strip() if ":" in title else title
        query = primary_topic or short_title

        params: dict = {
            **self._base_params(),
            "filter": f"title_and_abstract.search:{query}",
            "per-page": str(limit),
            "select": SEARCH_SELECT,
            "sort": "cited_by_count:desc",
        }
        if year:
            params["filter"] += f",publication_year:<{year}"

        data = await _get(self._session_or_raise(), f"{BASE}/works", params)
        results = []
        for work in data.get("results", []):
            normalized = self._normalize_work(work)
            if normalized and normalized["openalexId"] != paper.get("openalexId"):
                results.append(normalized)
        return results[:limit]
