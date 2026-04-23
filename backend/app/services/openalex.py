from __future__ import annotations

from typing import Optional
import asyncio
import logging
import re
from math import log10

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
    "topics",
    "type",
    "best_oa_location",
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
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
    "into", "of", "on", "or", "the", "through", "to", "with", "using",
    "via", "based", "toward", "towards",
}


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


def _build_detail(abstract: str) -> str:
    return _clean_abstract(abstract.strip())


def _normalize_text(text: str) -> str:
    return _NON_ALNUM.sub(" ", text.lower()).strip()


def _informative_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for token in _normalize_text(text).split():
        if len(token) <= 2 or token in _STOPWORDS:
            continue
        if token.endswith("s") and len(token) > 4:
            token = token[:-1]
        tokens.append(token)
    return tokens


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

        oa_location = work.get("best_oa_location")
        oa_location = oa_location if isinstance(oa_location, dict) else {}
        _raw_oa_url = oa_location.get("pdf_url") or oa_location.get("landing_page_url") or None
        oa_url = _raw_oa_url if _raw_oa_url and _raw_oa_url.startswith(("http://", "https://")) else None

        topics = work.get("topics")
        concepts = [
            t["display_name"]
            for t in (topics if isinstance(topics, list) else [])
            if t.get("display_name")
        ][:5]

        return {
            "openalexId": openalex_id,
            "title": title,
            "abstract": abstract,
            "detail": _build_detail(abstract),
            "year": work.get("publication_year"),
            "authors": [
                authorship.get("author", {}).get("display_name", "")
                for authorship in work.get("authorships", [])
                if authorship.get("author", {}).get("display_name")
            ],
            "doi": work.get("doi"),
            "oaUrl": oa_url,
            "concepts": concepts,
            "type": work.get("type"),
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
            "sort": "cited_by_count:desc",
        }
        broad_params = {
            **self._base_params(),
            "filter": f"title_and_abstract.search:{query}",
            "per-page": str(limit),
            "select": SEARCH_SELECT,
            "sort": "cited_by_count:desc",
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

        results.sort(key=lambda item: item.get("citedByCount") or 0, reverse=True)
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

    async def fetch_related_earlier_papers_for_query(
        self,
        paper: dict,
        user_query: str,
        limit: int = 20,
    ) -> list[dict]:
        """Fallback for missing references using the user's query plus seed title cues."""
        year = paper.get("year")
        title = paper.get("title", "")
        if not year:
            return await self.fetch_related_earlier_papers(paper, limit=limit)

        title_head = title.split(":")[0].strip() if ":" in title else title.strip()
        title_tokens = _informative_tokens(title)
        query_tokens = _informative_tokens(user_query)
        title_anchor_tokens = title_tokens[1:] if len(title_tokens) > 3 else title_tokens

        title_phrase_tokens = title_anchor_tokens[:4]
        query_phrase_tokens = query_tokens[:4]

        search_queries: list[str] = []
        if title_phrase_tokens:
            search_queries.append(f"\"{' '.join(title_phrase_tokens)}\"")
        if query_phrase_tokens:
            search_queries.append(" ".join(query_phrase_tokens))
        if title_phrase_tokens and query_phrase_tokens:
            search_queries.append(f"\"{' '.join(title_phrase_tokens)}\" {' '.join(query_phrase_tokens)}")
        if title_head and title_head.lower() != title.lower():
            search_queries.append(f"\"{title_head}\"")
        if paper.get("primaryTopic"):
            topic_tokens = _informative_tokens(paper["primaryTopic"])[:4]
            if topic_tokens and query_phrase_tokens:
                search_queries.append(f"{' '.join(topic_tokens)} {' '.join(query_phrase_tokens)}")

        deduped_queries: list[str] = []
        seen_queries: set[str] = set()
        for query in search_queries:
            normalized_query = " ".join(query.split())
            if normalized_query and normalized_query not in seen_queries:
                seen_queries.add(normalized_query)
                deduped_queries.append(normalized_query)

        if not deduped_queries:
            return await self.fetch_related_earlier_papers(paper, limit=limit)

        async def _search(query: str) -> list[dict]:
            params: dict[str, str] = {
                **self._base_params(),
                "filter": f"title_and_abstract.search:{query},publication_year:<{year}",
                "per-page": str(limit),
                "select": SEARCH_SELECT,
                "sort": "cited_by_count:desc",
            }
            data = await _get(self._session_or_raise(), f"{BASE}/works", params)
            results: list[dict] = []
            for work in data.get("results", []):
                normalized = self._normalize_work(work)
                if normalized and normalized["openalexId"] != paper.get("openalexId"):
                    results.append(normalized)
            return results

        batches = await asyncio.gather(*[_search(query) for query in deduped_queries], return_exceptions=True)

        merged: dict[str, tuple[float, dict]] = {}
        seen_title_keys: set[str] = set()
        target_tokens = set(title_anchor_tokens)
        query_only_tokens = {token for token in query_tokens if token not in title_tokens}
        for batch in batches:
            if isinstance(batch, Exception):
                continue
            for candidate in batch:
                candidate_id = candidate["openalexId"]
                candidate_tokens = set(_informative_tokens(candidate.get("title", "")))
                overlap = len(target_tokens & candidate_tokens)
                if overlap == 0:
                    continue
                query_overlap = len(query_only_tokens & candidate_tokens)
                if overlap < 2 and query_overlap == 0:
                    continue

                score = overlap * 2.0
                score += query_overlap * 1.5
                score += min(log10((candidate.get("citedByCount") or 0) + 1), 4.0) * 0.35
                if candidate.get("year") is not None:
                    score += max(0, (year - candidate["year"])) * 0.01

                existing = merged.get(candidate_id)
                if existing is None or score > existing[0]:
                    merged[candidate_id] = (score, candidate)

        ranked: list[dict] = []
        for _, candidate in sorted(merged.values(), key=lambda item: item[0], reverse=True):
            title_key = _normalize_text(candidate.get("title", ""))
            if title_key in seen_title_keys:
                continue
            seen_title_keys.add(title_key)
            ranked.append(candidate)
        if ranked:
            return ranked[:limit]

        return await self.fetch_related_earlier_papers(paper, limit=limit)
