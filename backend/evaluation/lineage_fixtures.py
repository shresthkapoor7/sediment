"""Deterministic bibliographic inputs, separate from held-out judge expectations."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

REFERENCE = json.loads(Path(__file__).with_name("lineage_reference.json").read_text())
PAPERS = {paper["openalexId"]: paper for paper in REFERENCE["papers"]}


def target_paper(paper_id):
    # Do not expose the judge's reference facts, expected IDs, or source annotations.
    paper = deepcopy(PAPERS[paper_id])
    paper.pop("source")
    paper["referencedWorksCount"] = 3 if any(
        topic["seed"] == paper_id for topic in REFERENCE["topics"].values()
    ) else 0
    return paper


class FixtureOpenAlex:
    """Replay a bounded candidate pool; evaluate synthesis, not search recall.

    Every search returns the same topic-specific pool, including a distractor.
    Queries are recorded, but query matching and the live OpenAlex index are
    intentionally outside this test's scope. Reference lookups use explicit lists.
    """
    def __init__(self, topic):
        self.topic = REFERENCE["topics"][topic]
        self.ids = [self.topic["seed"], *self.topic["ancestors"], self.topic["distractor"]]
        self.calls = []

    async def search_papers(self, query, limit=10):
        self.calls.append({"tool": "search", "query": query, "limit": limit})
        return [target_paper(paper_id) for paper_id in self.ids[:limit]]

    async def fetch_work(self, paper_id):
        self.calls.append({"tool": "work", "paper_id": paper_id})
        return target_paper(paper_id) if paper_id in self.ids else None

    async def fetch_references(self, paper_id, limit=20):
        self.calls.append({"tool": "references", "paper_id": paper_id, "limit": limit})
        ids = self.topic["ancestors"] if paper_id == self.topic["seed"] else []
        return [target_paper(value) for value in ids[:limit]]

    async def fetch_related_earlier_papers_for_query(self, paper, query, limit=20):
        self.calls.append({"tool": "related", "paper_id": paper["openalexId"], "query": query})
        return []


def notes_inputs(case):
    return {
        "concept": case["concept"],
        "papers": [dict(target_paper(pid), summary=PAPERS[pid]["abstract"]) for pid in case["paper_ids"]],
        "edges": [dict(parentOpenalexId=parent, childOpenalexId=child, relation=relation)
                  for parent, child, relation in case["edges"]],
    }


def judge_reference(case):
    if case["kind"] == "trace":
        topic = REFERENCE["topics"][case["topic"]]
        ids = [topic["seed"], *topic["ancestors"], topic["distractor"]]
        facts = topic["facts"]
        edges = [[parent, topic["seed"], "influenced"] for parent in topic["ancestors"]]
        concept = topic["concept"]
    else:
        ids, facts, edges, concept = case["paper_ids"], case["reference_facts"], case["edges"], case["concept"]
    return {
        "concept": concept,
        "papers": [PAPERS[pid] for pid in ids],
        "reference_facts": facts,
        "evidence_edges": edges,
        "year_policy": REFERENCE["year_policy"],
    }
