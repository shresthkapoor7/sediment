from __future__ import annotations

import logging
import re
from collections import deque

from .llm import LLMClient
from .openalex import OpenAlexClient
from .text_utils import meaningful_token_list, normalize_text
from ..models import TraversalSettings

logger = logging.getLogger(__name__)

DEPTH = 6
BREADTH = 1
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

    concept_graph = await _trace_concept_backbone(
        concept,
        chosen_seed,
        openalex,
        llm,
        resolved,
        confidence,
        ip,
    )
    if concept_graph is not None:
        return concept_graph

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
        ranked_papers = [paper for paper in [ranked.get("primary"), *ranked.get("supporting", [])] if paper]
        primary_ancestor_id = None if refs_inferred else ranked.get("primary", {}).get("openalexId") if isinstance(ranked.get("primary"), dict) else None
        next_level_ids = []
        for paper in ranked_papers:
            paper_id = paper.get("openalexId")
            if not paper_id:
                continue

            if paper_id not in seen:
                seen[paper_id] = {"paper": paper}
            else:
                if paper.get("summary") and not seen[paper_id]["paper"].get("summary"):
                    seen[paper_id]["paper"]["summary"] = paper["summary"]

            relation = (
                "inferred"
                if refs_inferred
                else "primary" if paper_id == primary_ancestor_id else "supporting"
            )
            edges.add((paper_id, current_paper["openalexId"], relation))
            if refs_inferred:
                has_inferred_edges = True
            elif paper_id == primary_ancestor_id:
                next_level_ids.insert(0, paper_id)
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
    ranked_papers = [paper for paper in [ranked.get("primary"), *ranked.get("supporting", [])] if paper]
    primary_ancestor_id = ranked.get("primary", {}).get("openalexId") if isinstance(ranked.get("primary"), dict) else None
    papers = [_graph_paper(source_paper, summary="Expanded source paper.")]
    edges = []
    for paper in ranked_papers:
        paper_id_ranked = paper.get("openalexId")
        if not paper_id_ranked:
            continue
        papers.append(_graph_paper(paper, summary=paper.get("summary", "")))
        edges.append({
            "parentOpenalexId": paper_id_ranked,
            "childOpenalexId": source_paper["openalexId"],
            "relation": "primary" if paper_id_ranked == primary_ancestor_id else "supporting",
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


def _graph_paper(paper: dict, summary: str = "", lineage_label: str | None = None) -> dict:
    return {
        "openalexId": paper.get("openalexId", ""),
        "title": paper.get("title", ""),
        "lineageLabel": lineage_label,
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
            depth = max(1, min(settings.depth, 8))
        if settings.breadth is not None:
            breadth = max(1, min(settings.breadth, 4))
        if settings.referenceLimit is not None:
            reference_limit = max(5, min(settings.referenceLimit, 30))
        if settings.topN is not None:
            top_n = max(1, min(settings.topN, 6))

    return {
        "depth": depth,
        "breadth": breadth,
        "reference_limit": reference_limit,
        "top_n": top_n,
    }


async def _trace_concept_backbone(
    query: str,
    seed_paper: dict,
    openalex: OpenAlexClient,
    llm: LLMClient,
    resolved: dict[str, int],
    confidence: str | None,
    ip: str,
) -> dict | None:
    plan = await llm.plan_concept_lineage(
        query,
        seed_paper,
        depth=resolved["depth"],
        breadth=resolved["breadth"],
        top_n=resolved["top_n"],
        ip=ip,
    )
    backbone = plan.get("backbone", [])
    supporting = plan.get("supporting", [])
    if not backbone:
        return None

    seed_year = seed_paper.get("year")
    seen_ids = {seed_paper["openalexId"]}
    max_year = seed_year if isinstance(seed_year, int) else None

    # Resolve from newest to oldest so earlier concepts are constrained by the next stage's year.
    resolved_backbone: list[dict] = []
    for step in reversed(backbone):
        resolved_step = await _resolve_concept_representative(
            step,
            openalex,
            llm,
            seen_ids,
            year_ceiling=max_year,
            ip=ip,
        )
        if resolved_step is None:
            continue
        resolved_backbone.append(resolved_step)
        seen_ids.add(resolved_step["paper"]["openalexId"])
        step_year = resolved_step["paper"].get("year")
        if isinstance(step_year, int):
            max_year = step_year

    resolved_backbone.reverse()
    if not resolved_backbone:
        return None

    papers = []
    edges: list[dict] = []

    for item in resolved_backbone:
        paper = item["paper"]
        papers.append(_graph_paper(
            paper,
            summary=item["concept"].get("reason", paper.get("summary", "")),
            lineage_label=item["concept"].get("concept"),
        ))

    papers.append(_graph_paper(seed_paper, summary="Seed paper selected for this query."))

    for index in range(len(resolved_backbone) - 1):
        parent_id = resolved_backbone[index]["paper"]["openalexId"]
        child_id = resolved_backbone[index + 1]["paper"]["openalexId"]
        edges.append({
            "parentOpenalexId": parent_id,
            "childOpenalexId": child_id,
            "relation": "primary",
        })

    last_backbone_id = resolved_backbone[-1]["paper"]["openalexId"]
    edges.append({
        "parentOpenalexId": last_backbone_id,
        "childOpenalexId": seed_paper["openalexId"],
        "relation": "primary",
    })

    concept_name_to_paper_id = {
        item["concept"]["concept"].lower(): item["paper"]["openalexId"]
        for item in resolved_backbone
    }

    for item in supporting:
        attach_to = item.get("attach_to", "").lower()
        anchor_id = concept_name_to_paper_id.get(attach_to)
        if not anchor_id:
            continue
        anchor_paper = next(
            (step["paper"] for step in resolved_backbone if step["paper"]["openalexId"] == anchor_id),
            None,
        )
        anchor_year = anchor_paper.get("year") if anchor_paper else seed_year
        resolved_support = await _resolve_concept_representative(
            item,
            openalex,
            llm,
            seen_ids,
            year_ceiling=anchor_year,
            ip=ip,
        )
        if resolved_support is None:
            continue
        seen_ids.add(resolved_support["paper"]["openalexId"])
        papers.append(_graph_paper(
            resolved_support["paper"],
            summary=resolved_support["concept"].get("reason", resolved_support["paper"].get("summary", "")),
            lineage_label=resolved_support["concept"].get("concept"),
        ))
        edges.append({
            "parentOpenalexId": resolved_support["paper"]["openalexId"],
            "childOpenalexId": anchor_id,
            "relation": "supporting",
        })

    child_ids = {edge["childOpenalexId"] for edge in edges}
    root_ids = [paper["openalexId"] for paper in papers if paper["openalexId"] not in child_ids]

    return {
        "seedPaperId": seed_paper["openalexId"],
        "papers": sorted(
            papers,
            key=lambda paper: ((paper.get("year") is None), paper.get("year") or 0, paper.get("title", "")),
        ),
        "edges": edges,
        "rootIds": root_ids,
        "meta": {
            "query": query,
            "mode": "resolved",
            "confidence": confidence or "high",
            "cacheHit": False,
        },
        "disambiguation": None,
    }


async def _resolve_concept_representative(
    concept_item: dict,
    openalex: OpenAlexClient,
    llm: LLMClient,
    seen_ids: set[str],
    year_ceiling: int | None,
    ip: str,
) -> dict | None:
    query = concept_item.get("query") or concept_item.get("concept")
    paper_hint = concept_item.get("paper_hint")
    year_hint = concept_item.get("year_hint")
    concept = concept_item.get("concept")
    search_terms = []
    for term in (paper_hint, query, concept):
        if isinstance(term, str) and term.strip():
            normalized = term.strip()
            if normalized not in search_terms:
                search_terms.append(normalized)

    if not search_terms:
        return None

    candidates: list[dict] = []
    seen_candidate_ids: set[str] = set()
    for term in search_terms:
        term_candidates = await openalex.search_papers(term, limit=SEARCH_LIMIT)
        for paper in term_candidates:
            paper_id = paper.get("openalexId")
            if not paper_id or paper_id in seen_candidate_ids:
                continue
            seen_candidate_ids.add(paper_id)
            candidates.append(paper)

    candidates = _filter_representative_candidates(candidates, year_ceiling, seen_ids)
    if not candidates:
        return None

    chosen_paper = None
    if isinstance(paper_hint, str) and paper_hint.strip():
        chosen_paper = _pick_best_representative_match(paper_hint, candidates, year_hint)
    if chosen_paper is None and isinstance(query, str) and query.strip():
        chosen_paper = _pick_best_representative_match(query, candidates, year_hint)
    if chosen_paper is None and isinstance(concept, str) and concept.strip():
        chosen_paper = _pick_best_representative_match(concept, candidates, year_hint)
    if chosen_paper is None:
        decision = await llm.choose_seed(search_terms[0], candidates, ip=ip)
        index = decision.get("index")
        if isinstance(index, int) and 0 <= index < len(candidates):
            chosen_paper = candidates[index]

    if chosen_paper is None:
        chosen_paper = candidates[0]

    return {
        "concept": concept_item,
        "paper": chosen_paper,
    }


def _filter_representative_candidates(
    candidates: list[dict],
    year_ceiling: int | None,
    seen_ids: set[str],
) -> list[dict]:
    filtered = [paper for paper in candidates if paper.get("openalexId") not in seen_ids]
    if year_ceiling is not None:
        year_filtered = [
            paper for paper in filtered
            if paper.get("year") is None or paper.get("year") <= year_ceiling
        ]
        if year_filtered:
            filtered = year_filtered

    preferred_types = [
        paper for paper in filtered
        if (paper.get("type") or "").lower() not in {"book", "review", "editorial"}
    ]
    if preferred_types:
        filtered = preferred_types

    return filtered


def _pick_best_representative_match(
    query: str,
    papers: list[dict],
    year_hint: int | None = None,
) -> dict | None:
    query_norm = _normalize_query_text(query)
    if not query_norm:
        return None

    query_tokens = list(dict.fromkeys(meaningful_token_list(query_norm, min_len=2)))
    scored: list[tuple[float, int, dict]] = []

    for paper in papers:
        title_norm = _normalize_query_text(paper.get("title", ""))
        if not title_norm:
            continue

        title_tokens = set(meaningful_token_list(title_norm, min_len=2))
        overlap = sum(1 for token in query_tokens if token in title_tokens)
        if overlap == 0 and query_norm != title_norm and query_norm not in title_norm and title_norm not in query_norm:
            continue

        score = overlap / max(len(query_tokens), 1)
        if title_norm == query_norm:
            score += 4.0
        elif query_norm in title_norm or title_norm in query_norm:
            score += 2.0

        paper_year = paper.get("year")
        if isinstance(year_hint, int) and isinstance(paper_year, int):
            year_delta = abs(paper_year - year_hint)
            if year_delta == 0:
                score += 1.5
            elif year_delta <= 1:
                score += 1.0
            elif year_delta <= 3:
                score += 0.5
            else:
                score -= min(year_delta * 0.1, 1.5)

        scored.append((score, paper_year if isinstance(paper_year, int) else 9999, paper))

    if not scored:
        return None

    scored.sort(key=lambda item: (-item[0], item[1], item[2].get("title", "")))
    best_score = scored[0][0]
    if best_score < 0.9:
        return None
    return scored[0][2]
