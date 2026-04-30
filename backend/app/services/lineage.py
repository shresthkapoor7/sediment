from __future__ import annotations

import logging
import re
from collections import deque

from .llm import LLMClient
from .openalex import OpenAlexClient
from .text_utils import meaningful_token_list, normalize_text
from ..models import TraversalSettings

logger = logging.getLogger(__name__)

DEPTH = 1
BREADTH = 2
SEARCH_LIMIT = 10
REFERENCE_LIMIT = 20
TOP_N = 5
DISAMBIGUATION_COUNT = 3
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


async def trace_lineage(
    concept: str,
    openalex: OpenAlexClient,
    llm: LLMClient,
    seed_openalex_id: str | None = None,
    settings: TraversalSettings | None = None,
    ip: str = "unknown",
) -> dict:
    concept = concept.strip()
    if not concept:
        return _empty_response(concept)

    resolved = _resolve_settings(settings)
    search_results = await openalex.search_papers(concept, limit=SEARCH_LIMIT)
    if not search_results:
        return _empty_response(concept)

    chosen_seed = None
    confidence = None

    if seed_openalex_id:
        chosen_seed = next((paper for paper in search_results if paper["openalexId"] == seed_openalex_id), None)
        if chosen_seed is None:
            chosen_seed = await openalex.fetch_work(seed_openalex_id)
        confidence = "high"
    else:
        chosen_seed = _pick_clear_title_match(concept, search_results)
        if chosen_seed is not None:
            confidence = "high"
        else:
            decision = await llm.choose_seed(concept, search_results, ip=ip)
            confidence = decision.get("confidence")
            seed_index = decision.get("index")
            if confidence == "low" or seed_index is None:
                return {
                    "seedPaperId": None,
                    "papers": [],
                    "edges": [],
                    "rootIds": [],
                    "meta": {
                        "query": concept,
                        "mode": "needs_disambiguation",
                        "confidence": confidence or "low",
                        "cacheHit": False,
                    },
                    "disambiguation": [
                        {
                            "openalexId": paper["openalexId"],
                            "title": paper["title"],
                            "year": paper.get("year"),
                        }
                        for paper in search_results[:DISAMBIGUATION_COUNT]
                    ],
                }
            chosen_seed = search_results[seed_index]

    if not chosen_seed:
        return _empty_response(concept)

    chosen_seed, seed_refs, seed_refs_inferred = await _resolve_viable_seed(
        chosen_seed,
        concept,
        openalex,
        resolved["reference_limit"],
    )
    if not chosen_seed:
        return _empty_response(concept)

    seed_id = chosen_seed["openalexId"]
    seen: dict[str, dict] = {
        seed_id: {"paper": _graph_paper(chosen_seed, summary="Seed paper selected for this query.")}
    }
    edges: set[tuple[str, str, str]] = set()
    has_inferred_edges = False

    queue: deque[tuple[dict, int, list[dict] | None, bool]] = deque([(chosen_seed, 0, seed_refs, seed_refs_inferred)])

    while queue:
        current_paper, depth, prefetched_refs, refs_inferred = queue.popleft()
        if depth >= resolved["depth"]:
            continue

        refs = prefetched_refs if prefetched_refs is not None else await openalex.fetch_references(
            current_paper["openalexId"],
            limit=resolved["reference_limit"],
        )
        if not refs:
            continue

        ranked = await llm.rank_references(concept, current_paper, refs, top_n=resolved["top_n"], ip=ip)
        next_level_ids = []
        for paper in ranked:
            paper_id = paper.get("openalexId")
            if not paper_id:
                continue

            if paper_id not in seen:
                seen[paper_id] = {"paper": paper}
            else:
                if paper.get("summary") and not seen[paper_id]["paper"].get("summary"):
                    seen[paper_id]["paper"]["summary"] = paper["summary"]

            relation = "inferred" if refs_inferred else "influenced"
            edges.add((paper_id, current_paper["openalexId"], relation))
            if refs_inferred:
                has_inferred_edges = True
            else:
                next_level_ids.append(paper_id)

        for paper_id in next_level_ids[:resolved["breadth"]]:
            next_paper = next((paper for paper in refs if paper.get("openalexId") == paper_id), None)
            if next_paper:
                queue.append((next_paper, depth + 1, None, False))

    papers = sorted(
        (item["paper"] for item in seen.values()),
        key=lambda paper: ((paper.get("year") is None), paper.get("year") or 0, paper.get("title", "")),
    )

    child_ids = {child_id for _, child_id, _ in edges}
    root_ids = [
        paper["openalexId"]
        for paper in papers
        if paper["openalexId"] not in child_ids
    ]

    return {
        "seedPaperId": seed_id,
        "papers": papers,
        "edges": [
            {
                "parentOpenalexId": parent_id,
                "childOpenalexId": child_id,
                "relation": relation,
            }
            for parent_id, child_id, relation in sorted(edges)
        ],
        "rootIds": root_ids,
        "meta": {
            "query": concept,
            "mode": "resolved_inferred" if has_inferred_edges else "resolved",
            "confidence": confidence or "high",
            "cacheHit": False,
        },
        "disambiguation": None,
    }


async def expand_lineage(
    paper_id: str,
    concept: str,
    openalex: OpenAlexClient,
    llm: LLMClient,
    settings: TraversalSettings | None = None,
    ip: str = "unknown",
) -> dict:
    concept = concept.strip()
    resolved = _resolve_settings(settings)
    source_paper = await openalex.fetch_work(paper_id)
    if not source_paper:
        return _empty_response(concept)

    refs = await openalex.fetch_references(paper_id, limit=resolved["reference_limit"])
    if not refs:
        return {
            "seedPaperId": paper_id,
            "papers": [_graph_paper(source_paper, summary="Expanded source paper.")],
            "edges": [],
            "rootIds": [paper_id],
            "meta": {
                "query": concept,
                "mode": "resolved",
                "confidence": "high",
                "cacheHit": False,
            },
            "disambiguation": None,
        }

    ranked = await llm.rank_references(concept, source_paper, refs, top_n=resolved["top_n"], ip=ip)
    papers = [_graph_paper(source_paper, summary="Expanded source paper.")]
    edges = []
    for paper in ranked:
        paper_id_ranked = paper.get("openalexId")
        if not paper_id_ranked:
            continue
        papers.append(_graph_paper(paper, summary=paper.get("summary", "")))
        edges.append({
            "parentOpenalexId": paper_id_ranked,
            "childOpenalexId": source_paper["openalexId"],
            "relation": "influenced",
        })

    return {
        "seedPaperId": source_paper["openalexId"],
        "papers": papers,
        "edges": edges,
        "rootIds": [paper["openalexId"] for paper in papers if paper["openalexId"] != source_paper["openalexId"]],
        "meta": {
            "query": concept,
            "mode": "resolved",
            "confidence": "high",
            "cacheHit": False,
        },
        "disambiguation": None,
    }


def _empty_response(query: str) -> dict:
    return {
        "seedPaperId": None,
        "papers": [],
        "edges": [],
        "rootIds": [],
        "meta": {
            "query": query,
            "mode": "resolved",
            "confidence": None,
            "cacheHit": False,
        },
        "disambiguation": None,
    }


def _graph_paper(paper: dict, summary: str = "") -> dict:
    return {
        "openalexId": paper.get("openalexId", ""),
        "title": paper.get("title", ""),
        "year": paper.get("year"),
        "summary": summary,
        "detail": paper.get("detail", ""),
        "authors": paper.get("authors", []),
        "doi": paper.get("doi"),
        "oaUrl": paper.get("oaUrl"),
        "concepts": paper.get("concepts", []),
        "type": paper.get("type"),
        "citedByCount": paper.get("citedByCount", 0),
        "referencesCount": paper.get("referencedWorksCount", 0),
    }


async def _resolve_viable_seed(
    chosen_seed: dict,
    concept: str,
    openalex: OpenAlexClient,
    reference_limit: int,
) -> tuple[dict | None, list[dict], bool]:
    refs = await openalex.fetch_references(chosen_seed["openalexId"], limit=reference_limit)
    if len(refs) >= 3:
        return chosen_seed, refs, False

    logger.info(
        "Fewer than 3 indexed refs for chosen seed '%s' (found %d), falling back to related earlier papers",
        chosen_seed.get("title"),
        len(refs),
    )
    fallback_refs = await openalex.fetch_related_earlier_papers_for_query(
        chosen_seed,
        concept,
        limit=reference_limit,
    )
    if fallback_refs:
        return chosen_seed, fallback_refs, True

    return chosen_seed, refs, False


def _normalize_query_text(text: str) -> str:
    return normalize_text(text)


def _pick_clear_title_match(concept: str, papers: list[dict]) -> dict | None:
    query_norm = _normalize_query_text(concept)
    if not query_norm:
        return None

    query_tokens = list(dict.fromkeys(meaningful_token_list(query_norm, min_len=2)))
    if not query_tokens:
        return None

    scored: list[tuple[float, dict]] = []
    for paper in papers:
        title_norm = _normalize_query_text(paper.get("title", ""))
        if not title_norm:
            continue

        title_tokens = set(title_norm.split())
        overlap = sum(1 for token in query_tokens if token in title_tokens)
        if overlap == 0:
            continue

        score = overlap / len(query_tokens)
        if title_norm == query_norm:
            score += 3.0
        elif query_norm in title_norm or title_norm in query_norm:
            score += 1.5
        if title_norm.startswith(query_tokens[0]):
            score += 0.5
        score += min((paper.get("citedByCount") or 0) / 10000, 0.2)
        scored.append((score, paper))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_paper = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0

    if best_score >= 0.8 and best_score >= second_score + 0.25:
        return best_paper

    return None


def _resolve_settings(settings: TraversalSettings | None) -> dict[str, int]:
    depth = DEPTH
    breadth = BREADTH
    reference_limit = REFERENCE_LIMIT
    top_n = TOP_N

    if settings:
        if settings.depth is not None:
            depth = max(1, min(settings.depth, 3))
        if settings.breadth is not None:
            breadth = max(1, min(settings.breadth, 5))
        if settings.referenceLimit is not None:
            reference_limit = max(5, min(settings.referenceLimit, 50))
        if settings.topN is not None:
            top_n = max(1, min(settings.topN, 8))

    return {
        "depth": depth,
        "breadth": breadth,
        "reference_limit": reference_limit,
        "top_n": top_n,
    }
