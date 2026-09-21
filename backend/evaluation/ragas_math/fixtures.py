"""Source-backed math catalogs. No provider or application imports at discovery."""
from copy import deepcopy
import json
from pathlib import Path

DATA_PATH = Path(__file__).with_name("cases.json")
TOPICS = json.loads(DATA_PATH.read_text(encoding="utf-8"))["topics"]


class MathCatalog:
    """Replay a bounded pool, not live OpenAlex search or retrieval recall."""

    def __init__(self, topic):
        self.topic = topic
        self.papers = {paper["openalexId"]: paper for paper in topic["papers"]}
        self.calls = []

    def paper(self, paper_id):
        source = self.papers[paper_id]
        return {
            **{key: deepcopy(source[key]) for key in ("openalexId", "title", "year", "abstract")},
            "detail": source["abstract"],
            "referencedWorksCount": len(self.topic["references"].get(paper_id, [])),
        }

    async def search_papers(self, query, limit=10):
        self.calls.append({"tool": "search", "query": query, "limit": limit})
        return [self.paper(pid) for pid in list(self.papers)[:limit]]

    async def fetch_work(self, paper_id):
        self.calls.append({"tool": "work", "paper_id": paper_id})
        return self.paper(paper_id) if paper_id in self.papers else None

    async def fetch_references(self, paper_id, limit=20):
        self.calls.append({"tool": "references", "paper_id": paper_id, "limit": limit})
        return [self.paper(pid) for pid in self.topic["references"].get(paper_id, [])[:limit]]

    async def fetch_related_earlier_papers_for_query(self, paper, query, limit=20):
        self.calls.append({"tool": "related", "paper_id": paper["openalexId"], "query": query})
        return []


def reference_contexts(topic):
    """Independent gold evidence, never augmented with generated claims."""
    return [
        f"{p['title']} ({p['year']}; {p['openalexId']}): {p['abstract']} "
        f"Source: {p['source']} [{p['source_locator']}]"
        for p in topic["papers"]
    ] + topic["evidence"]


def candidate_view(graph):
    """Exclude retrieved abstracts and search logs: judge generated output only."""
    return {
        "seedPaperId": graph.get("seedPaperId"),
        "papers": [{key: p.get(key) for key in ("openalexId", "title", "year", "summary")}
                   for p in graph.get("papers", [])],
        "edges": graph.get("edges", []),
        "traceNotes": graph.get("traceNotes", []),
    }


def claim_text(graph):
    """Faithfulness scores generated claims, not easy copied metadata or tool logs."""
    parts = []
    for paper in graph.get("papers", []):
        summary = (paper.get("summary") or "").strip()
        if summary and summary != "Seed paper selected for this query.":
            parts.append(f"Summary for {paper['title']}: {summary}")
    parts.extend(f"Canvas note: {note['text']}" for note in graph.get("traceNotes", []))
    return "\n\n".join(parts)
