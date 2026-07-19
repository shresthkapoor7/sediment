from __future__ import annotations

import unittest

from app.services.graph_retrieval import retrieve_graph_context


class GraphRetrievalTests(unittest.TestCase):
    def test_retrieval_expands_relevant_seeds_through_lineage_and_notes(self) -> None:
        graph_data = {
            "nodes": {
                "1": {"paper": {"openalexId": "W1", "title": "Attention foundations", "year": 2017}},
                "2": {"paper": {"openalexId": "W2", "title": "Attention scaling", "year": 2018}},
                "3": {"paper": {"openalexId": "W3", "title": "Attention transfer", "year": 2019}},
                "4": {"paper": {"openalexId": "W4", "title": "Vision models", "year": 2020}},
                "5": {"paper": {"openalexId": "W5", "title": "Language models", "year": 2021}},
                "6": {"paper": {"openalexId": "W6", "title": "Optimization", "year": 2022}},
                "7": {"paper": {"openalexId": "W7", "title": "Unrelated bridge", "year": 2023}},
            },
            "adjacency": {"1": [7]},
            "edgeRelations": {"1->7": "influenced"},
        }
        papers = [node["paper"] for node in graph_data["nodes"].values()]

        result = retrieve_graph_context(
            graph_data,
            papers,
            "How did attention develop?",
            notes=[
                {"id": "note-1", "text": "The bridge extends the attention lineage.", "kind": "insight", "color": "blue"},
                {"id": "note-2", "text": "This is not connected to the retrieved evidence.", "kind": "todo", "color": "yellow"},
            ],
            note_connections=[
                {"noteId": "note-1", "paperId": "W7", "relation": "about"},
                {"noteId": "note-2", "paperId": "W4", "relation": "about"},
            ],
            limit=4,
        )

        self.assertEqual(result["scope"], "graph_structure")
        self.assertEqual(result["seedPaperIds"], ["W1", "W2", "W3"])
        self.assertEqual([paper["openalexId"] for paper in result["papers"]], ["W1", "W2", "W3", "W7"])
        self.assertEqual(result["papers"][-1]["retrievalRole"], "neighbor")
        self.assertEqual(result["relationships"], [{
            "parentPaperId": "W1",
            "childPaperId": "W7",
            "relation": "influenced",
        }])
        self.assertEqual([note["id"] for note in result["notes"]], ["note-1"])

    def test_retrieval_falls_back_to_visible_papers_without_saved_graph_data(self) -> None:
        result = retrieve_graph_context(
            None,
            [
                {"openalexId": "W1", "title": "Retrieval augmented generation", "year": 2020},
                {"openalexId": "W2", "title": "Unrelated paper", "year": 2021},
            ],
            "retrieval",
            limit=1,
        )

        self.assertEqual(result["seedPaperIds"], ["W1"])
        self.assertEqual([paper["openalexId"] for paper in result["papers"]], ["W1"])
        self.assertEqual(result["relationships"], [])
