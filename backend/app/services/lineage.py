from __future__ import annotations

import logging
from collections import deque

from .llm import LLMClient
from .openalex import OpenAlexClient

logger = logging.getLogger(__name__)

DEPTH = 1
BREADTH = 2
SEARCH_LIMIT = 8
REFERENCE_LIMIT = 20
TOP_N = 5
DISAMBIGUATION_COUNT = 3


async def trace_lineage(
    concept: str,
    openalex: OpenAlexClient,
    llm: LLMClient,
    seed_openalex_id: str | None = None,
) -> dict:
    concept = concept.strip()
    if not concept:
        return _empty_response(concept)

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
        decision = await llm.choose_seed(concept, search_results)
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

    chosen_seed, seed_refs = await _resolve_viable_seed(chosen_seed, search_results, openalex)
    if not chosen_seed:
        return _empty_response(concept)

    seed_id = chosen_seed["openalexId"]
    seen: dict[str, dict] = {
        seed_id: {
            "paper": {
                "openalexId": seed_id,
                "title": chosen_seed["title"],
                "year": chosen_seed.get("year"),
                "summary": "Seed paper selected for this query.",
                "detail": chosen_seed.get("detail", ""),
                "authors": chosen_seed.get("authors", []),
                "doi": chosen_seed.get("doi"),
            }
        }
    }
    edges: set[tuple[str, str]] = set()

    queue: deque[tuple[dict, int, list[dict] | None]] = deque([(chosen_seed, 0, seed_refs)])

    while queue:
        current_paper, depth, prefetched_refs = queue.popleft()
        if depth >= DEPTH:
            continue

        refs = prefetched_refs if prefetched_refs is not None else await openalex.fetch_references(
            current_paper["openalexId"],
            limit=REFERENCE_LIMIT,
        )
        if not refs:
            continue

        ranked = await llm.rank_references(concept, current_paper, refs, top_n=TOP_N)
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

            edges.add((paper_id, current_paper["openalexId"]))
            next_level_ids.append(paper_id)

        for paper_id in next_level_ids[:BREADTH]:
            next_paper = next((paper for paper in refs if paper.get("openalexId") == paper_id), None)
            if next_paper:
                queue.append((next_paper, depth + 1, None))

    papers = sorted(
        (item["paper"] for item in seen.values()),
        key=lambda paper: ((paper.get("year") is None), paper.get("year") or 0, paper.get("title", "")),
    )

    child_ids = {child_id for _, child_id in edges}
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
                "relation": "influenced",
            }
            for parent_id, child_id in sorted(edges)
        ],
        "rootIds": root_ids,
        "meta": {
            "query": concept,
            "mode": "resolved",
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
) -> dict:
    concept = concept.strip()
    source_paper = await openalex.fetch_work(paper_id)
    if not source_paper:
        return _empty_response(concept)

    refs = await openalex.fetch_references(paper_id, limit=REFERENCE_LIMIT)
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

    ranked = await llm.rank_references(concept, source_paper, refs, top_n=min(5, TOP_N))
    papers = [_graph_paper(source_paper, summary="Expanded source paper.")]
    edges = []
    for paper in ranked:
        paper_id_ranked = paper.get("openalexId")
        if not paper_id_ranked:
            continue
        papers.append({
            "openalexId": paper_id_ranked,
            "title": paper.get("title", ""),
            "year": paper.get("year"),
            "summary": paper.get("summary", ""),
            "detail": paper.get("detail", ""),
            "authors": paper.get("authors", []),
            "doi": paper.get("doi"),
        })
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
        "openalexId": paper["openalexId"],
        "title": paper.get("title", ""),
        "year": paper.get("year"),
        "summary": summary,
        "detail": paper.get("detail", ""),
        "authors": paper.get("authors", []),
        "doi": paper.get("doi"),
    }


async def _resolve_viable_seed(
    chosen_seed: dict,
    search_results: list[dict],
    openalex: OpenAlexClient,
) -> tuple[dict | None, list[dict]]:
    candidates = [chosen_seed] + [
        paper for paper in search_results
        if paper.get("openalexId") != chosen_seed.get("openalexId")
    ]

    candidates.sort(
        key=lambda paper: (
            paper.get("openalexId") != chosen_seed.get("openalexId"),
            -(paper.get("referencedWorksCount") or 0),
            -(paper.get("citedByCount") or 0),
        ),
    )

    best_candidate = chosen_seed
    best_refs: list[dict] = []
    best_ref_count = -1

    for candidate in candidates[:4]:
        refs = await openalex.fetch_references(candidate["openalexId"], limit=REFERENCE_LIMIT)
        ref_count = len(refs)
        if ref_count > best_ref_count:
            best_candidate = candidate
            best_refs = refs
            best_ref_count = ref_count
        if ref_count >= 3:
            return candidate, refs

    return best_candidate, best_refs
