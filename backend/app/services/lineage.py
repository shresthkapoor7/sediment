import logging
from collections import deque
from .semantic_scholar import SemanticScholarClient
from .llm import LLMClient

logger = logging.getLogger(__name__)

DEPTH = 2      # how many levels back to trace
BREADTH = 3    # how many ancestors to recurse into at each level
TOP_N = 8      # how many papers Claude picks per level


async def trace_lineage(concept: str, s2: SemanticScholarClient, llm: LLMClient) -> list[dict]:
    """
    Given a concept string, trace its intellectual lineage.

    Returns list of LLMPaper-compatible dicts with parentIndex set.
    Ordered chronologically (oldest first).
    """
    # 1. Find seed paper
    search_results = await s2.search_papers(concept, limit=5)
    if not search_results:
        return []

    seed = search_results[0]
    seed_id = seed.get("s2Id")
    if not seed_id:
        logger.error(f"Seed paper missing s2Id: {seed.get('title')}")
        return []
    logger.info(f"Seed paper: {seed['title']} ({seed['year']})")

    # Track all papers and their parent relationships
    # paper_id -> {"paper": dict, "parent_id": str | None}
    seen: dict[str, dict] = {}
    seen[seed_id] = {"paper": seed, "parent_id": None}

    # BFS over citation graph — deque for O(1) popleft
    queue: deque = deque([(seed_id, 0)])  # (paper_id, depth)

    while queue:
        paper_id, depth = queue.popleft()
        if depth >= DEPTH:
            continue

        refs = await s2.fetch_references(paper_id, limit=80)
        if not refs:
            continue

        ranked = await llm.rank_references(concept, refs, top_n=TOP_N)

        new_papers = []
        for p in ranked:
            pid = p.get("s2Id")
            if not pid or pid in seen:
                continue
            seen[pid] = {"paper": p, "parent_id": paper_id}
            new_papers.append(pid)

        # Recurse into top BREADTH ancestors
        for pid in new_papers[:BREADTH]:
            queue.append((pid, depth + 1))
        # Rate limiting is handled by SemanticScholarClient._get's REQUEST_DELAY

    return _build_llm_paper_list(seen)


async def expand_lineage(paper_id: str, concept: str, s2: SemanticScholarClient, llm: LLMClient) -> list[dict]:
    """
    Expand a single paper's lineage one level.
    Returns LLMPaper-compatible dicts, all with parentIndex=None.
    The frontend merges them under the clicked node.
    """
    refs = await s2.fetch_references(paper_id, limit=80)
    if not refs:
        return []

    ranked = await llm.rank_references(concept, refs, top_n=5)
    return [{**p, "parentIndex": None} for p in ranked]


def _build_llm_paper_list(seen: dict) -> list[dict]:
    """Convert seen dict to sorted LLMPaper list with parentIndex values.

    Sorts chronologically (oldest first) and builds a simple linear chain
    (parentIndex = i-1). This is intentional: the BFS parent_id points to
    the NEWER paper that referenced each entry (opposite of display direction).
    A chronological chain correctly places the oldest paper as root (left)
    and newest as leaf (right) in the frontend's left-to-right timeline.
    """
    papers_list = list(seen.values())
    papers_list.sort(key=lambda x: (x["paper"].get("year") or 9999))

    result = []
    for i, item in enumerate(papers_list):
        p = item["paper"]
        result.append({
            "title": p.get("title", ""),
            "year": p.get("year") or 0,
            "summary": p.get("summary", ""),
            "authors": p.get("authors", []),
            "arxivId": p.get("arxivId"),
            "s2Id": p.get("s2Id"),
            "parentIndex": i - 1 if i > 0 else None,
        })

    return result
