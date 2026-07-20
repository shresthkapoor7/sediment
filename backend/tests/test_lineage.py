from __future__ import annotations

import unittest

from app.models import LineageGraphResponse
from app.services.lineage import (
    _normalize_planned_trace_notes,
    _validate_deep_trace_proposal,
    trace_lineage,
)


class DeepTraceTests(unittest.IsolatedAsyncioTestCase):
    async def test_deep_trace_retains_an_explicit_user_selected_seed(self) -> None:
        class FakeOpenAlex:
            def __init__(self):
                self.fetched_work_ids: list[str] = []

            async def fetch_work(self, paper_id: str):
                self.fetched_work_ids.append(paper_id)
                if paper_id == "W2":
                    return {"openalexId": "W2", "title": "Selected Seed", "year": 2017}
                return None

            async def search_papers(self, _query: str, limit: int = 10):
                return [{"openalexId": "W3", "title": "Alternate Seed", "year": 2018}]

            async def fetch_references(self, paper_id: str, limit: int = 20):
                test_case.assertEqual(paper_id, "W2")
                return [{"openalexId": "W1", "title": "Foundation", "year": 2014}]

        class FakeLlm:
            async def trace_lineage_agentic(self, _concept, tool_runner, ip="unknown", selected_seed=None):
                test_case.assertEqual(selected_seed["openalexId"], "W2")
                await tool_runner("search_openalex_papers", {"query": "selected seed"})
                await tool_runner("get_openalex_references", {"paperId": "W2"})
                rejected = await tool_runner("finish_deep_trace", {
                    "seedPaperId": "W3",
                    "papers": [
                        {"paperId": "W2", "summary": "The user-selected seed."},
                        {"paperId": "W3", "summary": "A tempting alternate seed."},
                    ],
                    "edges": [{"parentPaperId": "W2", "childPaperId": "W3"}],
                    "notes": [{"text": "Compare the two candidate seed papers.", "kind": "question", "color": "amber", "paperIds": ["W2", "W3"], "relation": "question"}],
                })
                test_case.assertEqual(rejected["status"], "error")
                test_case.assertIn("user-selected seed", rejected["message"])
                finished = await tool_runner("finish_deep_trace", {
                    "seedPaperId": "W2",
                    "papers": [
                        {"paperId": "W1", "summary": "A direct foundation for the selected seed."},
                        {"paperId": "W2", "summary": "The seed chosen by the user."},
                    ],
                    "edges": [{"parentPaperId": "W1", "childPaperId": "W2"}],
                    "notes": [{"text": "The foundation directly leads into the selected seed.", "kind": "insight", "color": "green", "paperIds": ["W1", "W2"], "relation": "insight"}],
                })
                return finished.get("proposal")

        test_case = self
        openalex = FakeOpenAlex()
        graph = await trace_lineage(
            "selected seed",
            openalex,
            FakeLlm(),
            seed_openalex_id="W2",
            trace_mode="deep",
        )

        self.assertEqual(openalex.fetched_work_ids, ["W2"])
        self.assertEqual(graph["seedPaperId"], "W2")
        self.assertEqual({paper["openalexId"] for paper in graph["papers"]}, {"W1", "W2"})
        self.assertEqual(graph["traceEvidence"]["searches"][0]["query"], "selected seed")
        self.assertEqual(
            [paper["openalexId"] for paper in graph["traceEvidence"]["referenceLookups"][0]["papers"]],
            ["W1"],
        )

    async def test_deep_trace_rejects_disconnected_paper_selections(self) -> None:
        proposal, reason = _validate_deep_trace_proposal(
            {
                "seedPaperId": "W1",
                "papers": [
                    {"paperId": "W1", "summary": "The selected seed."},
                    {"paperId": "W2", "summary": "An unconnected candidate."},
                ],
                "edges": [],
                "notes": [{"text": "A note.", "kind": "insight", "color": "green", "paperIds": ["W1"], "relation": "insight"}],
            },
            {
                "W1": {"openalexId": "W1", "title": "Seed", "year": 2017},
                "W2": {"openalexId": "W2", "title": "Disconnected", "year": 2012},
            },
            set(),
        )

        self.assertIsNone(proposal)
        self.assertIn("connected lineage", reason)

    async def test_trace_note_normalization_skips_invalid_entries_and_keeps_later_notes(self) -> None:
        notes = _normalize_planned_trace_notes(
            [
                "not a note",
                {
                    "text": "This connects the precursor to the seed.",
                    "kind": "insight",
                    "color": "green",
                    "paperIds": ["W1", "W2"],
                    "relation": "insight",
                },
            ],
            [
                {"openalexId": "W1", "title": "Foundation"},
                {"openalexId": "W2", "title": "Seed"},
            ],
        )

        self.assertEqual(len(notes), 1)
        self.assertEqual({connection["paperId"] for connection in notes[0]["connections"]}, {"W1", "W2"})

    async def test_verbose_comma_separated_query_retries_its_leading_concept(self) -> None:
        full_query = "Attention Is All You Need, transformers, neural networks, perceptron model all of it"

        class FakeOpenAlex:
            def __init__(self):
                self.queries: list[str] = []

            async def search_papers(self, query: str, limit: int = 10):
                self.queries.append(query)
                if query == full_query:
                    return []
                if query == "Attention Is All You Need":
                    return [{"openalexId": "W2", "title": "Attention Is All You Need", "year": 2017}]
                return []

            async def fetch_references(self, paper_id: str, limit: int = 20):
                test_case.assertEqual(paper_id, "W2")
                return [
                    {"openalexId": "W1", "title": "Attention Mechanism", "year": 2014},
                    {"openalexId": "W3", "title": "Sequence Modeling", "year": 2015},
                    {"openalexId": "W4", "title": "Neural Translation", "year": 2016},
                ]

        class FakeLlm:
            async def rank_references(self, _concept, _seed, papers, top_n=8, ip="unknown"):
                test_case.assertEqual(_concept, "Attention Is All You Need")
                return [{**paper, "summary": "A verified precursor in the final lineage."} for paper in papers]

        test_case = self
        openalex = FakeOpenAlex()
        graph = await trace_lineage(full_query, openalex, FakeLlm())

        self.assertEqual(openalex.queries, [full_query, "Attention Is All You Need"])
        self.assertEqual(graph["meta"]["mode"], "resolved")
        self.assertGreater(len(graph["papers"]), 0)
        self.assertIsNotNone(graph.get("traceSummary"))

    async def test_no_results_returns_no_trace_report_or_canvas_graph(self) -> None:
        class FakeOpenAlex:
            async def search_papers(self, _query: str, limit: int = 10):
                return []

        graph = await trace_lineage("an unfindable research phrase", FakeOpenAlex(), object())

        self.assertEqual(graph["meta"]["mode"], "no_results")
        self.assertEqual(graph["papers"], [])
        self.assertNotIn("traceSummary", graph)
        LineageGraphResponse(**graph)

    async def test_quick_trace_includes_colored_notes_and_a_trace_report(self) -> None:
        class FakeOpenAlex:
            async def search_papers(self, _query: str, limit: int = 10):
                return [{
                    "openalexId": "W2",
                    "title": "Seed Paper",
                    "year": 2017,
                    "detail": "The current form of the concept.",
                }]

            async def fetch_references(self, paper_id: str, limit: int = 20):
                test_case.assertEqual(paper_id, "W2")
                return [{
                    "openalexId": "W1",
                    "title": "Foundation Paper",
                    "year": 2012,
                    "detail": "An early foundation.",
                }]

            async def fetch_related_earlier_papers_for_query(self, _paper, _query, limit: int = 20):
                return []

        class FakeLlm:
            async def rank_references(self, _concept, _seed, papers, top_n=8, ip="unknown"):
                return [{**papers[0], "summary": "Established the central idea used by the seed paper."}]

        test_case = self
        graph = await trace_lineage("Seed Paper", FakeOpenAlex(), FakeLlm())

        self.assertEqual(graph["traceSummary"]["traceMode"], "standard")
        self.assertIn("Quick trace resolved", graph["traceSummary"]["rationale"])
        self.assertEqual([(note["kind"], note["color"]) for note in graph["traceNotes"]], [
            ("insight", "blue"),
        ])
        self.assertEqual(
            {connection["paperId"] for connection in graph["traceNotes"][0]["connections"]},
            {"W1", "W2"},
        )
        self.assertIn("Lineage evidence", graph["traceNotes"][0]["text"])
        self.assertEqual(graph["traceEvidence"]["searches"], [{
            "query": "Seed Paper",
            "papers": [{"openalexId": "W2", "title": "Seed Paper", "year": 2017, "authors": []}],
        }])
        self.assertEqual(graph["traceEvidence"]["referenceLookups"][0], {
            "paperId": "W2",
            "paperTitle": "Seed Paper",
            "kind": "references",
            "papers": [{"openalexId": "W1", "title": "Foundation Paper", "year": 2012, "authors": []}],
        })
        LineageGraphResponse(**graph)

    async def test_trace_note_planner_receives_the_whole_graph_and_can_link_a_lineage_arc(self) -> None:
        class FakeOpenAlex:
            async def search_papers(self, _query: str, limit: int = 10):
                return [{"openalexId": "W4", "title": "Seed Paper", "year": 2018}]

            async def fetch_references(self, paper_id: str, limit: int = 20):
                test_case.assertEqual(paper_id, "W4")
                return [
                    {"openalexId": "W1", "title": "Early Method", "year": 2010},
                    {"openalexId": "W2", "title": "Middle Method", "year": 2013},
                    {"openalexId": "W3", "title": "Recent Method", "year": 2016},
                ]

        class FakeLlm:
            async def rank_references(self, _concept, _seed, papers, top_n=8, ip="unknown"):
                return [
                    {**paper, "summary": f'{paper["title"]} supplies a distinct step in the lineage.'}
                    for paper in papers
                ]

            async def generate_trace_notes(self, concept, papers, edges, ip="unknown"):
                test_case.assertEqual(concept, "Seed Paper")
                test_case.assertEqual({paper["openalexId"] for paper in papers}, {"W1", "W2", "W3", "W4"})
                test_case.assertEqual(
                    {(edge["parentOpenalexId"], edge["childOpenalexId"]) for edge in edges},
                    {("W1", "W4"), ("W2", "W4"), ("W3", "W4")},
                )
                return [{
                    "text": "The seed combines three distinct earlier strands rather than extending only one predecessor.",
                    "kind": "insight",
                    "color": "green",
                    "paperIds": ["W1", "W2", "W3", "W4"],
                    "relation": "insight",
                }]

        test_case = self
        graph = await trace_lineage("Seed Paper", FakeOpenAlex(), FakeLlm())

        self.assertEqual(len(graph["traceNotes"]), 1)
        self.assertEqual(
            {connection["paperId"] for connection in graph["traceNotes"][0]["connections"]},
            {"W1", "W2", "W3", "W4"},
        )
        self.assertIn("three distinct earlier strands", graph["traceNotes"][0]["text"])
        LineageGraphResponse(**graph)

    async def test_deep_trace_builds_validated_graph_and_colored_notes(self) -> None:
        class FakeOpenAlex:
            def __init__(self):
                self.search_queries: list[str] = []
                self.reference_requests: list[str] = []

            async def search_papers(self, query: str, limit: int = 10):
                self.search_queries.append(query)
                return [
                    {
                        "openalexId": "W3",
                        "title": "Attention Is All You Need",
                        "year": 2017,
                        "detail": "Introduced the Transformer architecture.",
                    },
                    {
                        "openalexId": "W1",
                        "title": "Unrelated Candidate",
                        "year": 2012,
                        "detail": "A searched but unselected work.",
                    },
                ]

            async def fetch_references(self, paper_id: str, limit: int = 20):
                self.reference_requests.append(paper_id)
                return [{
                    "openalexId": "W2",
                    "title": "Neural Machine Translation by Jointly Learning to Align and Translate",
                    "year": 2014,
                    "detail": "Introduced neural attention for translation.",
                }]

        class FakeLlm:
            async def trace_lineage_agentic(self, concept, tool_runner, ip="unknown"):
                test_case.assertEqual(concept, "attention mechanisms")
                searched = await tool_runner("search_openalex_papers", {"query": concept, "limit": 4})
                test_case.assertEqual(searched["status"], "completed")
                references = await tool_runner("get_openalex_references", {"paperId": "W3", "limit": 6})
                test_case.assertEqual(references["papers"][0]["openalexId"], "W2")
                finished = await tool_runner("finish_deep_trace", {
                    "seedPaperId": "W3",
                    "papers": [
                        {"paperId": "W2", "summary": "Made attention practical for neural translation."},
                        {"paperId": "W3", "summary": "Replaced recurrence with attention-only sequence modeling."},
                    ],
                    "edges": [{"parentPaperId": "W2", "childPaperId": "W3", "relation": "influenced"}],
                    "notes": [
                        {
                            "text": "Attention in translation is a key bridge to Transformer-style modeling.",
                            "kind": "insight",
                            "color": "green",
                            "paperIds": ["W2", "W3"],
                            "relation": "insight",
                        },
                        {
                            "text": "Check whether the Transformer changes the translation assumptions established by earlier attention work.",
                            "kind": "question",
                            "color": "amber",
                            "paperIds": ["W3"],
                            "relation": "question",
                        },
                    ],
                })
                return finished.get("proposal")

        test_case = self
        openalex = FakeOpenAlex()
        graph = await trace_lineage(
            "attention mechanisms",
            openalex,
            FakeLlm(),
            trace_mode="deep",
        )

        self.assertEqual(openalex.search_queries, ["attention mechanisms"])
        self.assertEqual(openalex.reference_requests, ["W3"])
        self.assertEqual(graph["meta"]["traceMode"], "deep")
        self.assertEqual(graph["edges"], [{
            "parentOpenalexId": "W2",
            "childOpenalexId": "W3",
            "relation": "influenced",
        }])
        self.assertEqual([(note["kind"], note["color"]) for note in graph["traceNotes"]], [
            ("insight", "green"),
            ("question", "amber"),
        ])
        self.assertEqual(
            {connection["paperId"] for connection in graph["traceNotes"][0]["connections"]},
            {"W2", "W3"},
        )
        self.assertEqual(
            [connection["paperId"] for connection in graph["traceNotes"][1]["connections"]],
            ["W3"],
        )
        LineageGraphResponse(**graph)

    async def test_deep_trace_falls_back_to_ranked_trace_without_a_final_model_plan(self) -> None:
        class FakeOpenAlex:
            async def search_papers(self, _query: str, limit: int = 10):
                return [{"openalexId": "W2", "title": "topic", "year": 2017}]

            async def fetch_references(self, paper_id: str, limit: int = 20):
                test_case.assertEqual(paper_id, "W2")
                return [{"openalexId": "W1", "title": "Foundation Work", "year": 2012}]

            async def fetch_related_earlier_papers_for_query(self, _paper, _query, limit: int = 20):
                return []

        class FakeLlm:
            async def trace_lineage_agentic(self, _concept, tool_runner, ip="unknown"):
                await tool_runner("search_openalex_papers", {"query": "topic"})
                await tool_runner("get_openalex_references", {"paperId": "W2"})
                return None

            async def rank_references(self, _concept, _seed, papers, top_n=8, ip="unknown"):
                return [{**papers[0], "summary": "Established the approach used by the later work."}]

        test_case = self
        graph = await trace_lineage("topic", FakeOpenAlex(), FakeLlm(), trace_mode="deep")

        self.assertEqual(graph["meta"]["traceMode"], "standard")
        self.assertEqual([paper["openalexId"] for paper in graph["papers"]], ["W1", "W2"])
        self.assertEqual(graph["edges"][0]["relation"], "influenced")
        self.assertEqual(len(graph["traceNotes"]), 1)
        self.assertEqual(graph["traceSummary"]["traceMode"], "deep")

    async def test_deep_trace_marks_unverified_claimed_influence_as_inferred(self) -> None:
        class FakeOpenAlex:
            async def search_papers(self, _query: str, limit: int = 10):
                return [
                    {"openalexId": "W3", "title": "Later Work", "year": 2017},
                    {"openalexId": "W1", "title": "Conceptually Related Work", "year": 2012},
                ]

            async def fetch_references(self, _paper_id: str, limit: int = 20):
                return [{"openalexId": "W2", "title": "Direct Reference", "year": 2014}]

        class FakeLlm:
            async def trace_lineage_agentic(self, _concept, tool_runner, ip="unknown"):
                await tool_runner("search_openalex_papers", {"query": "topic"})
                await tool_runner("get_openalex_references", {"paperId": "W3"})
                finished = await tool_runner("finish_deep_trace", {
                    "seedPaperId": "W3",
                    "papers": [
                        {"paperId": "W1", "summary": "An earlier conceptual precursor."},
                        {"paperId": "W3", "summary": "A later application of the concept."},
                    ],
                    "edges": [{"parentPaperId": "W1", "childPaperId": "W3", "relation": "influenced"}],
                    "notes": [
                        {"text": "Earlier framing carried into a later application.", "kind": "insight", "color": "blue", "paperIds": ["W1", "W3"], "relation": "insight"},
                        {"text": "Compare the earlier framing with its later application.", "kind": "field_note", "color": "paper", "paperIds": ["W1", "W3"], "relation": "about"},
                    ],
                })
                return finished.get("proposal")

        graph = await trace_lineage("topic", FakeOpenAlex(), FakeLlm(), trace_mode="deep")
        self.assertEqual(graph["edges"][0]["relation"], "inferred")
