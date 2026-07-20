from __future__ import annotations

import logging
import re
from collections import deque
from typing import Any

from .llm import LLMClient
from .openalex import OpenAlexClient
from .text_utils import meaningful_token_list, normalize_text
from ..models import MAX_TIMELINE_NOTES, MAX_TIMELINE_PAPERS, TraversalSettings

logger = logging.getLogger(__name__)

DEPTH = 1
BREADTH = 2
SEARCH_LIMIT = 10
REFERENCE_LIMIT = 20
TOP_N = 5
DISAMBIGUATION_COUNT = 3
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
TRACE_NOTE_KINDS = {"field_note", "question", "insight", "todo", "contradiction"}
TRACE_NOTE_COLORS = {"paper", "amber", "blue", "green", "rose"}
TRACE_NOTE_RELATIONS = {"about", "question", "insight", "todo", "contradiction"}


async def trace_lineage(
    concept: str,
    openalex: OpenAlexClient,
    llm: LLMClient,
    seed_openalex_id: str | None = None,
    settings: TraversalSettings | None = None,
    ip: str = "unknown",
    trace_mode: str = "standard",
) -> dict:
    if trace_mode == "deep":
        deep_trace = await _trace_lineage_deep(
            concept,
            openalex,
            llm,
            seed_openalex_id=seed_openalex_id,
            settings=settings,
            ip=ip,
        )
        if deep_trace is not None:
            await _attach_trace_notes(deep_trace, concept, llm, ip=ip)
            return deep_trace

    graph = await _trace_lineage_standard(
        concept,
        openalex,
        llm,
        seed_openalex_id=seed_openalex_id,
        settings=settings,
        ip=ip,
    )
    if not graph.get("papers"):
        graph.setdefault("meta", {})["traceMode"] = "standard"
        return graph
    await _attach_trace_notes(graph, concept, llm, ip=ip)
    graph.setdefault("meta", {})["traceMode"] = "standard"
    graph["traceSummary"] = _standard_trace_summary(
        concept,
        graph,
        requested_deep_trace=trace_mode == "deep",
        selection_reason=str(graph.pop("_traceSelectionReason", "") or ""),
    )
    return graph


async def _trace_lineage_standard(
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
    trace_evidence = _new_trace_evidence()
    search_concept = concept
    search_results = await openalex.search_papers(search_concept, limit=SEARCH_LIMIT)
    _record_trace_search(trace_evidence, search_concept, search_results)
    if not search_results:
        fallback_query = _focused_fallback_query(concept)
        if fallback_query:
            logger.info("No OpenAlex results for verbose query=%r; retrying focused query=%r", concept, fallback_query)
            search_results = await openalex.search_papers(fallback_query, limit=SEARCH_LIMIT)
            _record_trace_search(trace_evidence, fallback_query, search_results)
            if search_results:
                search_concept = fallback_query
    if not search_results:
        return _empty_response(concept)

    chosen_seed = None
    confidence = None
    selection_reason = ""

    if seed_openalex_id:
        chosen_seed = next((paper for paper in search_results if paper["openalexId"] == seed_openalex_id), None)
        if chosen_seed is None:
            chosen_seed = await openalex.fetch_work(seed_openalex_id)
        confidence = "high"
        selection_reason = "Used the seed paper selected by the user."
    else:
        chosen_seed = _pick_clear_title_match(search_concept, search_results)
        if chosen_seed is not None:
            confidence = "high"
            selection_reason = "The query closely matched this paper's title."
        else:
            decision = await llm.choose_seed(search_concept, search_results, ip=ip)
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
            selection_reason = str(decision.get("reason") or "Selected the best topical match from OpenAlex candidates.")

    if not chosen_seed:
        return _empty_response(concept)

    chosen_seed, seed_refs, seed_refs_inferred = await _resolve_viable_seed(
        chosen_seed,
        search_concept,
        openalex,
        resolved["reference_limit"],
        trace_evidence,
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

        if prefetched_refs is not None:
            refs = prefetched_refs
        else:
            refs = await openalex.fetch_references(
                current_paper["openalexId"],
                limit=resolved["reference_limit"],
            )
            _record_reference_lookup(trace_evidence, current_paper, refs)
        if not refs:
            continue

        ranked = await llm.rank_references(search_concept, current_paper, refs, top_n=resolved["top_n"], ip=ip)
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
        "traceEvidence": trace_evidence,
        "_traceSelectionReason": selection_reason,
    }


async def _trace_lineage_deep(
    concept: str,
    openalex: OpenAlexClient,
    llm: LLMClient,
    *,
    seed_openalex_id: str | None,
    settings: TraversalSettings | None,
    ip: str,
) -> dict | None:
    concept = concept.strip()
    if not concept:
        return None

    resolved = _resolve_settings(settings)
    known_papers: dict[str, dict] = {}
    direct_reference_edges: set[tuple[str, str]] = set()
    search_count = 0
    reference_count = 0
    activity: list[str] = []
    trace_evidence = _new_trace_evidence()

    def register_papers(papers: list[dict]) -> None:
        for paper in papers:
            paper_id = _normalize_openalex_id(paper.get("openalexId"))
            if not paper_id:
                continue
            existing = known_papers.get(paper_id)
            if existing is None:
                known_papers[paper_id] = dict(paper)
            elif paper.get("detail") and not existing.get("detail"):
                existing.update(paper)

    def resolve_known_id(value: Any) -> str | None:
        paper = known_papers.get(_normalize_openalex_id(value))
        return str(paper.get("openalexId")) if paper else None

    required_seed_id = _normalize_openalex_id(seed_openalex_id)
    selected_seed: dict[str, Any] | None = None
    if required_seed_id:
        seed = await openalex.fetch_work(seed_openalex_id or required_seed_id)
        if seed:
            register_papers([seed])
            selected_seed = _deep_trace_paper_payload(seed)
        else:
            selected_seed = {"openalexId": seed_openalex_id}

    async def tool_runner(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        nonlocal search_count, reference_count

        if name == "search_openalex_papers":
            query = str(tool_input.get("query") or "").strip()[:300]
            if not query:
                return {"status": "error", "message": "A focused OpenAlex query is required."}
            limit = tool_input.get("limit")
            limit = limit if isinstance(limit, int) else 6
            papers = await openalex.search_papers(query, limit=max(1, min(limit, 8)))
            register_papers(papers)
            _record_trace_search(trace_evidence, query, papers)
            search_count += 1
            activity.append(f'Searched OpenAlex for “{query}” and reviewed {len(papers)} candidates.')
            return {
                "status": "completed",
                "query": query,
                "papers": [_deep_trace_paper_payload(paper) for paper in papers],
            }

        if name == "get_openalex_references":
            paper_id = resolve_known_id(tool_input.get("paperId"))
            if not paper_id:
                return {
                    "status": "error",
                    "message": "References can only be read for an OpenAlex paper returned earlier in this trace.",
                }
            limit = tool_input.get("limit")
            limit = limit if isinstance(limit, int) else resolved["reference_limit"]
            references = await openalex.fetch_references(paper_id, limit=max(1, min(limit, 12)))
            register_papers(references)
            child_id = _normalize_openalex_id(paper_id)
            direct_reference_edges.update(
                (_normalize_openalex_id(reference.get("openalexId")), child_id)
                for reference in references
                if _normalize_openalex_id(reference.get("openalexId"))
            )
            reference_count += 1
            title = str(known_papers.get(child_id, {}).get("title") or paper_id)
            _record_reference_lookup(
                trace_evidence,
                {"openalexId": paper_id, "title": title},
                references,
            )
            activity.append(f'Inspected {len(references)} references from “{title}”.')
            return {
                "status": "completed",
                "paperId": paper_id,
                "papers": [_deep_trace_paper_payload(paper) for paper in references],
            }

        if name == "finish_deep_trace":
            if search_count == 0 or reference_count == 0:
                return {
                    "status": "error",
                    "message": "Search OpenAlex and inspect at least one known paper's references before finishing.",
                }
            proposal, reason = _validate_deep_trace_proposal(
                tool_input,
                known_papers,
                direct_reference_edges,
                required_seed_id=required_seed_id,
            )
            if proposal is None:
                return {"status": "error", "message": reason}
            return {"status": "completed", "proposal": proposal}

        return {"status": "error", "message": "Unknown deep-trace tool."}

    agent_kwargs: dict[str, Any] = {"ip": ip}
    if selected_seed is not None:
        agent_kwargs["selected_seed"] = selected_seed
    proposal = await llm.trace_lineage_agentic(concept, tool_runner, **agent_kwargs)
    if not isinstance(proposal, dict):
        logger.info("Deep trace did not return a validated final proposal; falling back to the standard trace for query=%r", concept)
        return None
    proposal.setdefault("meta", {})["query"] = concept
    proposal["traceEvidence"] = trace_evidence
    papers = proposal.get("papers") if isinstance(proposal.get("papers"), list) else []
    seed_id = _normalize_openalex_id(proposal.get("seedPaperId"))
    seed = next((paper for paper in papers if _normalize_openalex_id(paper.get("openalexId")) == seed_id), None)
    seed_title = str((seed or {}).get("title") or proposal.get("seedPaperId") or "the selected seed")
    proposal["traceSummary"] = {
        "traceMode": "deep",
        "rationale": (
            f'Ran a deep trace for “{concept}”, following {reference_count} reference set'
            f'{"s" if reference_count != 1 else ""} after {search_count} OpenAlex search'
            f'{"es" if search_count != 1 else ""}. “{seed_title}” anchors the final {len(papers)}-paper lineage.'
        ),
        "steps": activity[:8],
    }
    return proposal


def _deep_trace_paper_payload(paper: dict) -> dict:
    return {
        "openalexId": paper.get("openalexId"),
        "title": paper.get("title"),
        "year": paper.get("year"),
        "abstract": str(paper.get("abstract") or paper.get("detail") or "")[:500],
        "primaryTopic": paper.get("primaryTopic"),
        "citedByCount": paper.get("citedByCount", 0),
        "referencedWorksCount": paper.get("referencedWorksCount", 0),
    }


def _validate_deep_trace_proposal(
    raw: dict[str, Any],
    known_papers: dict[str, dict],
    direct_reference_edges: set[tuple[str, str]],
    *,
    required_seed_id: str | None = None,
) -> tuple[dict | None, str]:
    raw_papers = raw.get("papers")
    if not isinstance(raw_papers, list) or not raw_papers:
        return None, "Choose at least one researched paper for the trace."

    selected: dict[str, tuple[str, str]] = {}
    for raw_paper in raw_papers[:MAX_TIMELINE_PAPERS]:
        if not isinstance(raw_paper, dict):
            return None, "Each selected paper must include an OpenAlex ID and summary."
        normalized_id = _normalize_openalex_id(raw_paper.get("paperId"))
        paper = known_papers.get(normalized_id)
        if not paper:
            return None, "Selected papers must come from this trace's OpenAlex results."
        summary = str(raw_paper.get("summary") or "").strip()
        if not summary:
            return None, "Each selected paper needs a concise lineage summary."
        selected[normalized_id] = (str(paper.get("openalexId")), summary[:1_000])

    seed_normalized_id = _normalize_openalex_id(raw.get("seedPaperId"))
    if seed_normalized_id not in selected:
        return None, "The seed paper must be one of the selected researched papers."
    if required_seed_id and seed_normalized_id != required_seed_id:
        return None, "The user-selected seed paper must remain the trace seed."

    edges: list[dict[str, str]] = []
    edge_keys: set[tuple[str, str]] = set()
    raw_edges = raw.get("edges")
    if not isinstance(raw_edges, list):
        return None, "Edges must be an array."
    for raw_edge in raw_edges[:MAX_TIMELINE_PAPERS * 2]:
        if not isinstance(raw_edge, dict):
            return None, "Each edge must identify two selected papers."
        parent_id = _normalize_openalex_id(raw_edge.get("parentPaperId"))
        child_id = _normalize_openalex_id(raw_edge.get("childPaperId"))
        if not parent_id or not child_id or parent_id == child_id or parent_id not in selected or child_id not in selected:
            return None, "Edges must connect two different selected papers."
        key = (parent_id, child_id)
        if key in edge_keys:
            continue
        edge_keys.add(key)
        relation = "influenced" if key in direct_reference_edges else "inferred"
        edges.append({
            "parentOpenalexId": selected[parent_id][0],
            "childOpenalexId": selected[child_id][0],
            "relation": relation,
        })

    if len(selected) > 1:
        adjacency = {paper_id: set() for paper_id in selected}
        for parent_id, child_id in edge_keys:
            adjacency[parent_id].add(child_id)
            adjacency[child_id].add(parent_id)
        reachable = {seed_normalized_id}
        pending = deque([seed_normalized_id])
        while pending:
            paper_id = pending.popleft()
            for neighbor_id in adjacency[paper_id] - reachable:
                reachable.add(neighbor_id)
                pending.append(neighbor_id)
        if len(reachable) != len(selected):
            return None, "Edges must form one connected lineage containing the seed paper."

    raw_notes = raw.get("notes")
    if not isinstance(raw_notes, list) or not 1 <= len(raw_notes) <= min(3, MAX_TIMELINE_NOTES):
        return None, "Create between one and three helpful canvas notes before finishing."
    trace_notes: list[dict] = []
    for index, raw_note in enumerate(raw_notes, start=1):
        if not isinstance(raw_note, dict):
            return None, "Each canvas note must include text, kind, color, and connected papers."
        text = str(raw_note.get("text") or "").strip()
        kind = raw_note.get("kind")
        color = raw_note.get("color")
        relation = raw_note.get("relation")
        raw_paper_ids = raw_note.get("paperIds")
        if not text or kind not in TRACE_NOTE_KINDS or color not in TRACE_NOTE_COLORS or relation not in TRACE_NOTE_RELATIONS:
            return None, "Each canvas note has invalid text, kind, color, or relation."
        if not isinstance(raw_paper_ids, list) or not raw_paper_ids:
            return None, "Connect each canvas note to at least one selected paper."
        note_id = f"trace-note-{index}"
        connections: list[dict[str, str]] = []
        connected_ids: set[str] = set()
        for raw_paper_id in raw_paper_ids[:5]:
            paper_id = _normalize_openalex_id(raw_paper_id)
            if paper_id not in selected:
                return None, "Canvas notes can only connect to selected papers."
            if paper_id in connected_ids:
                continue
            connected_ids.add(paper_id)
            connections.append({
                "noteId": note_id,
                "paperId": selected[paper_id][0],
                "relation": relation,
            })
        trace_notes.append({
            "id": note_id,
            "text": text[:1_200],
            "kind": kind,
            "color": color,
            "connections": connections,
        })

    papers = [
        _graph_paper(known_papers[paper_id], summary=summary)
        for paper_id, (_, summary) in selected.items()
    ]
    papers.sort(key=lambda paper: ((paper.get("year") is None), paper.get("year") or 0, paper.get("title", "")))
    child_ids = {edge["childOpenalexId"] for edge in edges}
    return {
        "seedPaperId": selected[seed_normalized_id][0],
        "papers": papers,
        "edges": edges,
        "rootIds": [paper["openalexId"] for paper in papers if paper["openalexId"] not in child_ids],
        "meta": {
            "query": "",
            "mode": "resolved_inferred" if any(edge["relation"] == "inferred" for edge in edges) else "resolved",
            "confidence": "high",
            "cacheHit": False,
            "traceMode": "deep",
        },
        "disambiguation": None,
        "traceNotes": trace_notes,
    }, ""


async def _attach_trace_notes(graph: dict, concept: str, llm: LLMClient, *, ip: str) -> None:
    existing_notes = graph.get("traceNotes")
    if isinstance(existing_notes, list) and existing_notes:
        return

    papers = [paper for paper in graph.get("papers", []) if isinstance(paper, dict) and paper.get("openalexId")]
    if not papers:
        graph["traceNotes"] = []
        return

    planner = getattr(llm, "generate_trace_notes", None)
    if callable(planner):
        try:
            planned_notes = await planner(
                concept,
                papers,
                graph.get("edges") if isinstance(graph.get("edges"), list) else [],
                ip=ip,
            )
            trace_notes = _normalize_planned_trace_notes(planned_notes, papers)
            if trace_notes:
                graph["traceNotes"] = trace_notes
                return
        except Exception:
            logger.warning("Trace-note planner failed; using verified graph fallback", exc_info=True)

    _ensure_trace_notes_from_graph(graph, papers)


def _normalize_planned_trace_notes(raw_notes: Any, papers: list[dict]) -> list[dict]:
    if not isinstance(raw_notes, list):
        return []

    paper_ids = {
        _normalize_openalex_id(paper.get("openalexId")): str(paper["openalexId"])
        for paper in papers
        if _normalize_openalex_id(paper.get("openalexId"))
    }
    notes: list[dict] = []
    for raw_note in raw_notes:
        if len(notes) >= min(3, MAX_TIMELINE_NOTES):
            break
        if not isinstance(raw_note, dict):
            continue
        text = str(raw_note.get("text") or "").strip()
        kind = str(raw_note.get("kind") or "").strip()
        color = str(raw_note.get("color") or "").strip()
        relation = str(raw_note.get("relation") or "").strip()
        raw_paper_ids = raw_note.get("paperIds")
        if (
            not text
            or kind not in TRACE_NOTE_KINDS
            or color not in TRACE_NOTE_COLORS
            or relation not in TRACE_NOTE_RELATIONS
            or not isinstance(raw_paper_ids, list)
        ):
            continue

        connected_paper_ids: list[str] = []
        for raw_paper_id in raw_paper_ids:
            paper_id = paper_ids.get(_normalize_openalex_id(raw_paper_id))
            if paper_id and paper_id not in connected_paper_ids:
                connected_paper_ids.append(paper_id)
            if len(connected_paper_ids) == 5:
                break
        if not connected_paper_ids:
            continue

        note_id = f"trace-note-{len(notes) + 1}"
        notes.append({
            "id": note_id,
            "text": text[:1_200],
            "kind": kind,
            "color": color,
            "connections": [
                {"noteId": note_id, "paperId": paper_id, "relation": relation}
                for paper_id in connected_paper_ids
            ],
        })
    return notes


def _ensure_trace_notes_from_graph(graph: dict, papers: list[dict]) -> None:
    """Produce one factual note only when the model note planner is unavailable."""

    paper_by_id = {_normalize_openalex_id(paper.get("openalexId")): paper for paper in papers}
    seed = paper_by_id.get(_normalize_openalex_id(graph.get("seedPaperId"))) or papers[-1]
    seed_id = str(seed["openalexId"])

    def paper_summary(paper: dict) -> str:
        summary = str(paper.get("summary") or "").strip()
        if summary and not summary.lower().startswith("seed paper selected"):
            return summary[:240]
        detail = str(paper.get("detail") or "").strip()
        if detail:
            return detail[:240]
        return "Its role is represented by the reference link shown in this trace."

    edge_candidates: list[tuple[dict, dict, str]] = []
    for raw_edge in graph.get("edges", []):
        if not isinstance(raw_edge, dict):
            continue
        parent = paper_by_id.get(_normalize_openalex_id(raw_edge.get("parentOpenalexId")))
        child = paper_by_id.get(_normalize_openalex_id(raw_edge.get("childOpenalexId")))
        if parent and child and parent is not child:
            edge_candidates.append((parent, child, str(raw_edge.get("relation") or "inferred")))

    seed_edges = [
        edge for edge in edge_candidates
        if _normalize_openalex_id(edge[1].get("openalexId")) == _normalize_openalex_id(seed_id)
    ]
    relevant_edges = seed_edges or edge_candidates
    connected_papers: list[dict] = []
    for parent, child, _relation in relevant_edges:
        for paper in (parent, child):
            if paper not in connected_papers:
                connected_papers.append(paper)
            if len(connected_papers) == 5:
                break
        if len(connected_papers) == 5:
            break
    if not connected_papers:
        graph["traceNotes"] = []
        return

    predecessors = [parent for parent, child, _relation in relevant_edges if child is seed][:3]
    predecessor_names = ", ".join(f'“{paper.get("title") or paper["openalexId"]}”' for paper in predecessors)
    if predecessor_names:
        opening = f'{predecessor_names} feed into “{seed.get("title") or seed_id}” in the displayed lineage.'
    else:
        opening = "This note follows the verified reference links displayed in the trace."
    roles = " ".join(
        f'**{paper.get("title") or paper["openalexId"]}:** {paper_summary(paper)}'
        for paper in connected_papers
    )
    graph["traceNotes"] = [{
        "id": "trace-note-1",
        "text": f"**Lineage evidence:** {opening} {roles}",
        "kind": "insight",
        "color": "blue",
        "connections": [
            {"noteId": "trace-note-1", "paperId": str(paper["openalexId"]), "relation": "insight"}
            for paper in connected_papers
        ],
    }]


def _standard_trace_summary(
    concept: str,
    graph: dict,
    *,
    requested_deep_trace: bool,
    selection_reason: str,
) -> dict:
    papers = [paper for paper in graph.get("papers", []) if isinstance(paper, dict)]
    seed_id = _normalize_openalex_id(graph.get("seedPaperId"))
    seed = next((paper for paper in papers if _normalize_openalex_id(paper.get("openalexId")) == seed_id), None)
    seed_title = str((seed or {}).get("title") or graph.get("seedPaperId") or "the best matching paper")
    inferred = sum(1 for edge in graph.get("edges", []) if isinstance(edge, dict) and edge.get("relation") == "inferred")
    if requested_deep_trace:
        rationale = (
            f'“{seed_title}” anchors this {len(papers)}-paper trace of “{concept}”. '
            "I completed it with the focused reference pass when Deep trace did not return a validated final proposal."
        )
        steps = [
            f'Resolved the query to “{seed_title}”.',
            f'Ranked reference papers and kept {len(papers)} papers in the final lineage.',
        ]
        if selection_reason:
            steps.insert(2, f'Seed selection: {selection_reason}')
        return {"traceMode": "deep", "rationale": rationale, "steps": steps}

    steps = [
        f'Resolved the query to “{seed_title}”.',
        f'Ranked relevant references and kept {len(papers)} papers in the final lineage.',
    ]
    if selection_reason:
        steps.insert(1, f'Seed selection: {selection_reason}')
    if inferred:
        steps.append(f'Included {inferred} conceptual link{"s" if inferred != 1 else ""} where direct reference data was unavailable.')
    return {
        "traceMode": "standard",
        "rationale": (
            f'Quick trace resolved “{concept}” to “{seed_title}” and ranked the references most useful for explaining '
            f'how the concept developed.'
        ),
        "steps": steps,
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
            "mode": "no_results",
            "confidence": None,
            "cacheHit": False,
        },
        "disambiguation": None,
    }


def _new_trace_evidence() -> dict[str, list[dict]]:
    return {"searches": [], "referenceLookups": []}


def _trace_source_paper(paper: dict) -> dict | None:
    paper_id = str(paper.get("openalexId") or "").strip()
    title = str(paper.get("title") or "").strip()
    if not paper_id or not title:
        return None
    raw_authors = paper.get("authors")
    authors = raw_authors if isinstance(raw_authors, list) else []
    return {
        "openalexId": paper_id,
        "title": title[:500],
        "year": paper.get("year") if isinstance(paper.get("year"), int) else None,
        "authors": [str(author)[:200] for author in authors if isinstance(author, str) and author.strip()][:3],
    }


def _record_trace_search(trace_evidence: dict[str, list[dict]], query: str, papers: list[dict]) -> None:
    if not query.strip() or len(trace_evidence["searches"]) >= 8:
        return
    snapshots = [snapshot for paper in papers[:10] if (snapshot := _trace_source_paper(paper))]
    trace_evidence["searches"].append({"query": query.strip()[:300], "papers": snapshots})


def _record_reference_lookup(
    trace_evidence: dict[str, list[dict]],
    source_paper: dict,
    papers: list[dict],
    *,
    kind: str = "references",
) -> None:
    source_id = str(source_paper.get("openalexId") or "").strip()
    source_title = str(source_paper.get("title") or source_id).strip()
    if not source_id or not source_title or len(trace_evidence["referenceLookups"]) >= 8:
        return
    snapshots = [snapshot for paper in papers[:12] if (snapshot := _trace_source_paper(paper))]
    trace_evidence["referenceLookups"].append({
        "paperId": source_id,
        "paperTitle": source_title[:500],
        "kind": "related" if kind == "related" else "references",
        "papers": snapshots,
    })


def _focused_fallback_query(query: str) -> str | None:
    """Retry the leading concept when a user combines several concepts in one OpenAlex query."""
    compact = " ".join(query.split())
    if len(compact) < 24:
        return None
    leading_concept = re.split(r"[,;\n]", compact, maxsplit=1)[0].strip(" \t\"'")
    if len(leading_concept) < 5 or leading_concept.casefold() == compact.casefold():
        return None
    return leading_concept[:300]


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
        "isOa": paper.get("isOa", False),
        "oaStatus": paper.get("oaStatus"),
        "hasFulltext": paper.get("hasFulltext", False),
        "hasContentPdf": paper.get("hasContentPdf", False),
        "hasContentTei": paper.get("hasContentTei", False),
        "oaLicense": paper.get("oaLicense"),
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
    trace_evidence: dict[str, list[dict]],
) -> tuple[dict | None, list[dict], bool]:
    refs = await openalex.fetch_references(chosen_seed["openalexId"], limit=reference_limit)
    _record_reference_lookup(trace_evidence, chosen_seed, refs)
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
    _record_reference_lookup(trace_evidence, chosen_seed, fallback_refs, kind="related")
    if fallback_refs:
        return chosen_seed, fallback_refs, True

    return chosen_seed, refs, False


def _normalize_query_text(text: str) -> str:
    return normalize_text(text)


def _normalize_openalex_id(value: Any) -> str:
    return str(value or "").strip().upper()


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
            depth = max(1, min(settings.depth, 2))
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
