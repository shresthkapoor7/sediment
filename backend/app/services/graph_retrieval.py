from __future__ import annotations

from typing import Any

from .text_utils import meaningful_tokens, normalize_text


def retrieve_graph_context(
    graph_data: object,
    papers: list[dict[str, Any]],
    query: str,
    *,
    notes: list[dict[str, Any]] | None = None,
    note_connections: list[dict[str, str]] | None = None,
    limit: int = 6,
) -> dict[str, Any]:
    """Deterministically retrieve a compact, one-hop evidence subgraph for a query."""
    safe_limit = min(max(limit, 1), 10)
    nodes = _graph_nodes(graph_data, papers)
    adjacency = _graph_adjacency(graph_data, nodes)
    edge_relations = _edge_relations(graph_data)
    query_tokens = meaningful_tokens(query)

    ranked = sorted(
        nodes.items(),
        key=lambda item: (-_paper_score(item[1]["paper"], query_tokens), item[0]),
    )
    seed_ids = [node_id for node_id, _ in ranked[:min(3, safe_limit)]]
    selected_ids = list(seed_ids)

    for node_id in seed_ids:
        for neighbor_id in _neighbors(node_id, adjacency):
            if neighbor_id not in selected_ids:
                selected_ids.append(neighbor_id)
            if len(selected_ids) >= safe_limit:
                break
        if len(selected_ids) >= safe_limit:
            break

    for node_id, _ in ranked:
        if len(selected_ids) >= safe_limit:
            break
        if node_id not in selected_ids:
            selected_ids.append(node_id)

    selected_set = set(selected_ids)
    selected_papers = [
        {
            "openalexId": paper.get("openalexId"),
            "title": paper.get("title"),
            "year": paper.get("year"),
            "summary": str(paper.get("summary") or paper.get("detail") or "")[:500],
            "matchScore": _paper_score(paper, query_tokens),
            "retrievalRole": "seed" if node_id in seed_ids else "neighbor",
        }
        for node_id in selected_ids
        if (paper := nodes[node_id]["paper"])
    ]

    relationships: list[dict[str, str]] = []
    for parent_id in sorted(selected_set):
        for child_id in adjacency.get(parent_id, []):
            if child_id not in selected_set:
                continue
            parent = nodes[parent_id]["paper"]
            child = nodes[child_id]["paper"]
            parent_paper_id = str(parent.get("openalexId") or "")
            child_paper_id = str(child.get("openalexId") or "")
            if not parent_paper_id or not child_paper_id:
                continue
            relationships.append({
                "parentPaperId": parent_paper_id,
                "childPaperId": child_paper_id,
                "relation": edge_relations.get(f"{parent_id}->{child_id}", "inferred"),
            })

    paper_id_by_node_id = {
        node_id: str(node["paper"].get("openalexId") or "")
        for node_id, node in nodes.items()
    }
    selected_paper_ids = {
        paper_id_by_node_id[node_id]
        for node_id in selected_set
        if paper_id_by_node_id.get(node_id)
    }
    relevant_notes = _relevant_notes(
        notes or [],
        note_connections or [],
        selected_paper_ids,
        query_tokens,
    )
    return {
        "scope": "graph_structure",
        "query": query,
        "seedPaperIds": [paper_id_by_node_id[node_id] for node_id in seed_ids if paper_id_by_node_id.get(node_id)],
        "papers": selected_papers,
        "relationships": relationships,
        "notes": relevant_notes,
    }


def _graph_nodes(graph_data: object, papers: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    raw_nodes = graph_data.get("nodes") if isinstance(graph_data, dict) else None
    nodes: dict[int, dict[str, Any]] = {}
    if isinstance(raw_nodes, dict):
        for raw_id, raw_node in raw_nodes.items():
            try:
                node_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            paper = raw_node.get("paper") if isinstance(raw_node, dict) else None
            if isinstance(paper, dict) and isinstance(paper.get("openalexId"), str):
                nodes[node_id] = {"paper": paper}
    if nodes:
        return nodes
    return {
        index: {"paper": paper}
        for index, paper in enumerate(papers, start=1)
        if isinstance(paper.get("openalexId"), str)
    }


def _graph_adjacency(graph_data: object, nodes: dict[int, dict[str, Any]]) -> dict[int, list[int]]:
    raw_adjacency = graph_data.get("adjacency") if isinstance(graph_data, dict) else None
    adjacency = {node_id: [] for node_id in nodes}
    if not isinstance(raw_adjacency, dict):
        return adjacency
    for raw_parent_id, raw_child_ids in raw_adjacency.items():
        try:
            parent_id = int(raw_parent_id)
        except (TypeError, ValueError):
            continue
        if parent_id not in nodes or not isinstance(raw_child_ids, list):
            continue
        children: list[int] = []
        for raw_child_id in raw_child_ids:
            try:
                child_id = int(raw_child_id)
            except (TypeError, ValueError):
                continue
            if child_id in nodes and child_id != parent_id and child_id not in children:
                children.append(child_id)
        adjacency[parent_id] = children
    return adjacency


def _edge_relations(graph_data: object) -> dict[str, str]:
    raw_relations = graph_data.get("edgeRelations") if isinstance(graph_data, dict) else None
    if not isinstance(raw_relations, dict):
        return {}
    return {
        key: relation
        for key, relation in raw_relations.items()
        if isinstance(key, str) and relation in {"influenced", "inferred"}
    }


def _neighbors(node_id: int, adjacency: dict[int, list[int]]) -> list[int]:
    neighbors = set(adjacency.get(node_id, []))
    neighbors.update(parent_id for parent_id, children in adjacency.items() if node_id in children)
    return sorted(neighbors)


def _paper_score(paper: dict[str, Any], query_tokens: set[str]) -> int:
    if not query_tokens:
        return 0
    title = normalize_text(str(paper.get("title") or ""))
    summary = normalize_text(str(paper.get("summary") or paper.get("detail") or ""))
    concepts = normalize_text(" ".join(str(value) for value in paper.get("concepts", []) if isinstance(value, str)))
    return (
        4 * len(query_tokens & meaningful_tokens(title))
        + len(query_tokens & meaningful_tokens(summary))
        + 2 * len(query_tokens & meaningful_tokens(concepts))
    )


def _relevant_notes(
    notes: list[dict[str, Any]],
    note_connections: list[dict[str, str]],
    selected_paper_ids: set[str],
    query_tokens: set[str],
) -> list[dict[str, Any]]:
    connections_by_note: dict[str, list[dict[str, str]]] = {}
    for connection in note_connections:
        note_id = str(connection.get("noteId") or "")
        paper_id = str(connection.get("paperId") or "")
        if note_id and paper_id in selected_paper_ids:
            connections_by_note.setdefault(note_id, []).append(connection)

    ranked: list[tuple[int, str, dict[str, Any]]] = []
    for note in notes:
        note_id = str(note.get("id") or "")
        if not note_id or note_id not in connections_by_note:
            continue
        score = len(query_tokens & meaningful_tokens(str(note.get("text") or "")))
        ranked.append((score, note_id, note))
    return [
        {
            "id": note_id,
            "text": str(note.get("text") or "")[:1_000],
            "kind": note.get("kind"),
            "color": note.get("color"),
            "connections": connections_by_note[note_id],
        }
        for _, note_id, note in sorted(ranked, key=lambda item: (-item[0], item[1]))[:4]
    ]
