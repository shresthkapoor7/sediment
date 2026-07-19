from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.models import ChatRequest, GlobalChatRequest
from app.routers.chat import chat, chat_global
from app.services.chat_memory import ChatContext


class PersistentChatRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_global_lineage_tools_search_then_return_a_validated_change(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [
            {"sequence_number": 3},
            {"sequence_number": 4},
        ]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "rootId": 1,
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"}},
                    "2": {"paper": {"openalexId": "W2", "title": "Optional Paper", "year": 2018, "summary": "Optional"}},
                },
            },
        }

        class FakeOpenAlex:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def search_papers(self, query, limit=8):
                if query != "residual learning" or limit != 5:
                    raise AssertionError(f"Unexpected OpenAlex search: {query!r}, limit={limit}")
                return [{
                    "openalexId": "W3",
                    "title": "Deep Residual Learning for Image Recognition",
                    "year": 2015,
                    "detail": "Residual connections enable deep networks.",
                    "authors": ["Kaiming He"],
                    "referencedWorks": ["W1"],
                    "referencedWorksCount": 1,
                    "citedByCount": 100,
                }]

        fake_openalex = FakeOpenAlex()

        async def answer(_papers, _question, **kwargs):
            search_result = await kwargs["tool_runner"](
                "search_openalex_papers",
                {"query": "residual learning"},
            )
            self.assertEqual(search_result["papers"][0]["openalexId"], "W3")
            change = await kwargs["tool_runner"](
                "update_lineage",
                {
                    "addPaperIds": ["W3"],
                    "removePaperIds": ["W2", "W1"],
                    "edges": [{"parentPaperId": "W3", "childPaperId": "W1", "relation": "influenced"}],
                },
            )
            self.assertEqual(change["removedPaperIds"], ["W2"])
            self.assertEqual(change["addedPapers"][0]["openalexId"], "W3")
            self.assertEqual(change["edges"][0]["parentOpenalexId"], "W3")
            self.assertIn({"paperId": "W1", "reason": "seed_paper"}, change["skipped"])
            return {
                "text": "Updated the lineage.",
                "highlightedPaperIds": ["W1"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
                "lineageChanges": [change],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[
                {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"},
                {"openalexId": "W2", "title": "Optional Paper", "year": 2018, "summary": "Optional"},
            ],
            question="Add residual learning and delete the optional paper.",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat.OpenAlexClient", return_value=fake_openalex):
                    with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                        response = await chat_global(req, request)

        self.assertEqual(response.lineageChanges[0]["addedPapers"][0]["openalexId"], "W3")
        self.assertEqual(response.lineageChanges[0]["removedPaperIds"], ["W2"])

    async def test_global_lineage_updates_retain_prior_papers_and_edges_within_one_turn(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [{"sequence_number": 3}, {"sequence_number": 4}]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "rootId": 1,
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"}},
                },
            },
        }

        class FakeOpenAlex:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def search_papers(self, _query, limit=8):
                if limit != 5:
                    raise AssertionError(f"Unexpected OpenAlex limit: {limit}")
                return [{
                    "openalexId": "W3",
                    "title": "Added Paper",
                    "year": 2015,
                    "detail": "A candidate paper.",
                    "authors": [],
                }]

        async def answer(_papers, _question, **kwargs):
            await kwargs["tool_runner"]("search_openalex_papers", {"query": "added paper"})
            first = await kwargs["tool_runner"]("update_lineage", {
                "addPaperIds": ["W3"],
                "edges": [
                    {"parentPaperId": "W3", "childPaperId": "W1", "relation": "influenced"},
                    {"parentPaperId": "W3", "childPaperId": "W404", "relation": "influenced"},
                    {"parentPaperId": "W3", "childPaperId": "W3", "relation": "influenced"},
                    {"parentPaperId": "W3", "childPaperId": "W1", "relation": "unsupported"},
                ],
            })
            self.assertIn({"paperId": "W3->W404", "reason": "edge_invalid_reference"}, first["skipped"])
            self.assertIn({"paperId": "W3->W3", "reason": "edge_self_loop"}, first["skipped"])
            self.assertIn({"paperId": "W3->W1", "reason": "edge_invalid_relation"}, first["skipped"])

            second = await kwargs["tool_runner"]("update_lineage", {
                "edges": [{"parentPaperId": "W1", "childPaperId": "W3", "relation": "inferred"}],
            })
            self.assertEqual(second["edges"], [{
                "parentOpenalexId": "W1",
                "childOpenalexId": "W3",
                "relation": "inferred",
            }])

            duplicate = await kwargs["tool_runner"]("update_lineage", {
                "edges": [{"parentPaperId": "W3", "childPaperId": "W1", "relation": "influenced"}],
            })
            self.assertEqual(duplicate["edges"], [])
            self.assertIn({"paperId": "W3->W1", "reason": "edge_duplicate"}, duplicate["skipped"])
            return {
                "text": "Updated the lineage.",
                "highlightedPaperIds": ["W3"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
                "lineageChanges": [first, second],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[{"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"}],
            question="Add a paper and connect it.",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._load_persistent_context", AsyncMock(return_value=(AsyncMock(), graph, memory, context))):
                with patch("app.routers.chat.OpenAlexClient", return_value=FakeOpenAlex()):
                    with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                        response = await chat_global(req, request)

        self.assertEqual(response.highlightedPaperIds, ["W3"])
        self.assertEqual(response.lineageChanges[1]["edges"][0]["childOpenalexId"], "W3")

    async def test_global_agent_can_search_cached_text_across_the_graph(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [{"sequence_number": 1}, {"sequence_number": 2}]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "First Paper", "year": 2017, "summary": "First"}},
                    "2": {"paper": {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"}},
                },
            },
        }

        test_case = self

        class FakeRetrieval:
            async def search_graph(self, paper_ids, query, *, limit, billing_ip):
                test_case.assertEqual(paper_ids, ["W1", "W2"])
                test_case.assertEqual(query, "How do their methods differ?")
                test_case.assertEqual(limit, 6)
                test_case.assertEqual(billing_ip, "127.0.0.1")
                return {
                    "scope": "graph",
                    "query": query,
                    "matches": [{
                        "content": "The methods differ.",
                        "citation": {"id": "paper:W1:document:D1:chunk:0", "openalexId": "W1"},
                    }],
                }

        async def answer(_papers, _question, **kwargs):
            result = await kwargs["tool_runner"]("search_graph_paper_content", {
                "query": "How do their methods differ?",
            })
            self.assertEqual(result["scope"], "graph")
            self.assertEqual(result["citations"][0]["openalexId"], "W1")
            return {
                "text": "Their methods differ.",
                "highlightedPaperIds": ["W1", "W2"],
                "suggestion": None,
                "toolUses": [],
                "citations": result["citations"],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[
                {"openalexId": "W1", "title": "First Paper", "year": 2017, "summary": "First"},
                {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"},
            ],
            question="How do their methods differ?",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._load_persistent_context", AsyncMock(return_value=(AsyncMock(), graph, memory, context))):
                with patch("app.routers.chat.PaperRetrievalService", return_value=FakeRetrieval()):
                    with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                        response = await chat_global(req, request)

        self.assertEqual(response.citations[0]["id"], "paper:W1:document:D1:chunk:0")

    async def test_global_agent_can_retrieve_structural_graph_context_without_indexed_text(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [{"sequence_number": 1}, {"sequence_number": 2}]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Attention foundations", "year": 2017, "summary": "Foundation"}},
                    "2": {"paper": {"openalexId": "W2", "title": "Attention scaling", "year": 2018, "summary": "Scaling"}},
                    "3": {"paper": {"openalexId": "W3", "title": "Unrelated bridge", "year": 2019, "summary": "Bridge"}},
                },
                "adjacency": {"1": [3]},
                "edgeRelations": {"1->3": "influenced"},
            },
        }

        async def answer(_papers, _question, **kwargs):
            result = await kwargs["tool_runner"]("retrieve_graph_context", {
                "query": "How did attention develop?",
            })
            self.assertEqual(result["scope"], "graph_structure")
            self.assertEqual(result["relationships"], [{
                "parentPaperId": "W1",
                "childPaperId": "W3",
                "relation": "influenced",
            }])
            self.assertEqual([paper["openalexId"] for paper in result["papers"]], ["W1", "W2", "W3"])
            return {
                "text": "The graph shows a lineage bridge.",
                "highlightedPaperIds": ["W1", "W3"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[
                {"openalexId": "W1", "title": "Attention foundations", "year": 2017, "summary": "Foundation"},
                {"openalexId": "W2", "title": "Attention scaling", "year": 2018, "summary": "Scaling"},
                {"openalexId": "W3", "title": "Unrelated bridge", "year": 2019, "summary": "Bridge"},
            ],
            question="How did attention develop?",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._load_persistent_context", AsyncMock(return_value=(AsyncMock(), graph, memory, context))):
                with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                    response = await chat_global(req, request)

        self.assertEqual(response.highlightedPaperIds, ["W1", "W3"])

    async def test_global_note_tools_read_and_mutate_canvas_notes_within_one_turn(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [{"sequence_number": 3}, {"sequence_number": 4}]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[{
                "role": "assistant",
                "sequence_number": 2,
                "content": "Created the requested canvas note.",
                "tool_uses": [{
                    "name": "create_timeline_notes",
                    "status": "completed",
                    "result": {"createdNotes": [{"id": "note-green"}]},
                }],
            }],
        )
        graph = {
            "data": {
                "rootId": 1,
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"}},
                    "2": {"paper": {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"}},
                },
            },
        }

        async def answer(_papers, _question, **kwargs):
            self.assertEqual(kwargs["timeline_note_index"], [
                {"id": "note-green", "kind": "field_note", "color": "green", "connectedPaperIds": ["W1"]},
                {"id": "note-green-2", "kind": "todo", "color": "green", "connectedPaperIds": []},
            ])
            green_notes = await kwargs["tool_runner"]("read_timeline_notes", {"colors": ["green"]})
            self.assertEqual({note["id"] for note in green_notes["notes"]}, {"note-green", "note-green-2"})

            duplicate = await kwargs["tool_runner"]("update_timeline_notes", {
                "connections": [{"noteId": "note-green", "paperId": "W1", "relation": "about"}],
            })
            self.assertEqual(duplicate["connections"], [])
            self.assertIn({"noteId": "note-green", "reason": "note_connection_duplicate"}, duplicate["skipped"])

            wrong_lineage = await kwargs["tool_runner"]("update_lineage", {
                "edges": [{"parentOpenalexId": "W1", "childOpenalexId": "W2", "relation": "influenced"}],
            })
            self.assertEqual(wrong_lineage["status"], "error")
            self.assertIn("canvas note", wrong_lineage["message"])

            created = await kwargs["tool_runner"]("create_timeline_notes", {
                "notes": [{
                    "text": "Compare both papers' training objectives.",
                    "kind": "question",
                    "color": "green",
                    "connectToPaperIds": ["W1"],
                    "relation": "question",
                }],
            })
            created_id = created["createdNotes"][0]["id"]

            updated = await kwargs["tool_runner"]("update_timeline_notes", {
                "updates": [{"noteId": "note-green", "text": "Resolved observation", "kind": "insight", "color": "blue"}],
                "deleteNoteIds": ["note-green-2"],
                "connections": [{"noteId": created_id, "paperId": "W2", "relation": "question"}],
                "disconnections": [{"noteId": "note-green", "paperId": "W1"}],
            })
            self.assertEqual(updated["updatedNotes"][0]["patch"]["color"], "blue")
            self.assertEqual(updated["deletedNoteIds"], ["note-green-2"])

            remaining_green = await kwargs["tool_runner"]("read_timeline_notes", {"colors": ["green"]})
            self.assertEqual([note["id"] for note in remaining_green["notes"]], [created_id])
            self.assertEqual(
                {connection["paperId"] for connection in remaining_green["notes"][0]["connections"]},
                {"W1", "W2"},
            )
            return {
                "text": "Updated the selected notes.",
                "highlightedPaperIds": [],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
                "lineageChanges": [],
                "noteChanges": [created, updated],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[
                {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"},
                {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"},
            ],
            question="Create a note, update the green note, delete the extra note, and connect the new note with @Second Paper.",
            mentionedPaperIds=["W2"],
            noteContext={
                "notes": [
                    {"id": "note-green", "text": "Initial observation", "kind": "field_note", "color": "green"},
                    {"id": "note-green-2", "text": "A second observation", "kind": "todo", "color": "green"},
                ],
                "connections": [
                    {"noteId": "note-green", "paperId": "W1", "relation": "about"},
                    {"noteId": "note-green", "paperId": "W404", "relation": "about"},
                ],
            },
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._load_persistent_context", AsyncMock(return_value=(AsyncMock(), graph, memory, context))):
                with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                    response = await chat_global(req, request)

        self.assertEqual(len(response.noteChanges), 2)
        self.assertEqual(response.noteChanges[0].createdNotes[0].color, "green")
        self.assertEqual(response.noteChanges[1].deletedNoteIds, ["note-green-2"])

    async def test_global_note_mutations_enforce_note_and_connection_limits(self) -> None:
        papers = [
            {"openalexId": f"W{index}", "title": f"Paper {index}", "year": 2000 + index, "summary": "Summary"}
            for index in range(1, 26)
        ]
        note_context = {
            "notes": [
                {"id": f"note-{index}", "text": f"Note {index}", "kind": "todo", "color": "paper"}
                for index in range(100)
            ],
            "connections": [
                {"noteId": f"note-{note_index}", "paperId": f"W{paper_index}", "relation": "about"}
                for note_index in range(20)
                for paper_index in range(1, 26)
            ],
        }

        async def answer(_papers, _question, **kwargs):
            created = await kwargs["tool_runner"]("create_timeline_notes", {
                "notes": [{"text": "Overflow", "kind": "todo", "color": "blue", "connectToPaperIds": ["W1"]}],
            })
            connected = await kwargs["tool_runner"]("update_timeline_notes", {
                "connections": [{"noteId": "note-20", "paperId": "W1", "relation": "todo"}],
            })
            self.assertEqual(created["createdNotes"], [])
            self.assertIn({"noteId": "<new note>", "reason": "note_limit_reached"}, created["skipped"])
            self.assertEqual(connected["connections"], [])
            self.assertIn({"noteId": "note-20", "reason": "note_connection_limit_reached"}, connected["skipped"])

            untouched = await kwargs["tool_runner"]("read_timeline_notes", {"noteIds": ["note-20"]})
            self.assertEqual(untouched["notes"][0]["connections"], [])
            return {"text": "No changes were needed.", "highlightedPaperIds": [], "suggestion": None, "toolUses": [], "citations": []}

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            papers=papers,
            question="Create a note and connect a canvas note.",
            noteContext=note_context,
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                await chat_global(req, request)

    async def test_global_node_color_tool_returns_validated_color_changes(self) -> None:
        async def answer(_papers, _question, **kwargs):
            colored = await kwargs["tool_runner"]("update_timeline_node_colors", {
                "updates": [
                    {"paperId": "https://openalex.org/W1", "borderColor": "green"},
                    {"paperId": "W404", "borderColor": "blue"},
                    {"paperId": "W2", "borderColor": "not-a-color"},
                    {"paperId": "W1", "borderColor": "rose"},
                ],
            })
            self.assertEqual(colored["nodeColorChanges"], [{"paperId": "W1", "borderColor": "green"}])
            self.assertIn({"paperId": "W404", "reason": "paper_not_in_timeline"}, colored["skipped"])
            self.assertIn({"paperId": "W2", "reason": "invalid_node_border_color"}, colored["skipped"])
            self.assertIn({"paperId": "W1", "reason": "node_color_duplicate"}, colored["skipped"])
            return {
                "text": "Colored Root Paper green.",
                "highlightedPaperIds": ["W1"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
                "nodeColorChanges": colored["nodeColorChanges"],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            papers=[
                {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"},
                {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"},
            ],
            question="Color @Root Paper green.",
            mentionedPaperIds=["W1"],
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                response = await chat_global(req, request)

        self.assertEqual(response.nodeColorChanges[0].paperId, "W1")
        self.assertEqual(response.nodeColorChanges[0].borderColor, "green")

    async def test_global_node_color_tool_skips_unchanged_colors(self) -> None:
        async def answer(_papers, _question, **kwargs):
            unchanged = await kwargs["tool_runner"]("update_timeline_node_colors", {
                "updates": [
                    {"paperId": "W1", "borderColor": "green"},
                    {"paperId": "W2", "borderColor": None},
                ],
            })
            self.assertEqual(unchanged["nodeColorChanges"], [])
            self.assertIn({"paperId": "W1", "reason": "node_color_unchanged"}, unchanged["skipped"])
            self.assertIn({"paperId": "W2", "reason": "node_color_unchanged"}, unchanged["skipped"])

            changed = await kwargs["tool_runner"]("update_timeline_node_colors", {
                "updates": [{"paperId": "W1", "borderColor": "rose"}],
            })
            self.assertEqual(changed["nodeColorChanges"], [{"paperId": "W1", "borderColor": "rose"}])

            current = await kwargs["tool_runner"]("read_timeline_node_colors", {"paperIds": ["W1"]})
            self.assertEqual(current["nodeColors"][0]["borderColor"], "rose")
            return {
                "text": "Root Paper is rose.",
                "highlightedPaperIds": ["W1"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
                "nodeColorChanges": changed["nodeColorChanges"],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            papers=[
                {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"},
                {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"},
            ],
            question="Color Root Paper rose.",
            nodeColorContext=[{"paperId": "W1", "borderColor": "green"}],
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                response = await chat_global(req, request)

        response_changes = [(change.paperId, change.borderColor) for change in response.nodeColorChanges]
        self.assertEqual(response_changes, [("W1", "rose")])
        self.assertNotIn(("W1", "green"), response_changes)
        self.assertNotIn(("W2", None), response_changes)

    async def test_global_node_color_reader_filters_current_colored_papers(self) -> None:
        async def answer(_papers, _question, **kwargs):
            green_nodes = await kwargs["tool_runner"]("read_timeline_node_colors", {"colors": ["green"]})
            self.assertEqual(green_nodes["nodeColors"], [{
                "paperId": "W1",
                "title": "Root Paper",
                "borderColor": "green",
            }])

            all_colored_nodes = await kwargs["tool_runner"]("read_timeline_node_colors", {})
            self.assertEqual(
                {node["paperId"] for node in all_colored_nodes["nodeColors"]},
                {"W1", "W2"},
            )
            return {"text": "The green paper is Root Paper.", "highlightedPaperIds": ["W1"], "suggestion": None, "toolUses": [], "citations": []}

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            papers=[
                {"openalexId": "W1", "title": "Root Paper", "year": 2017, "summary": "Root"},
                {"openalexId": "W2", "title": "Second Paper", "year": 2018, "summary": "Second"},
            ],
            question="Answer based on all green colored nodes.",
            nodeColorContext=[
                {"paperId": "https://openalex.org/W1", "borderColor": "green"},
                {"paperId": "W2", "borderColor": "blue"},
            ],
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                response = await chat_global(req, request)

        self.assertEqual(response.highlightedPaperIds, ["W1"])

    async def test_global_pending_confirmation_without_paper_id_uses_mentioned_paper(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [
            {"sequence_number": 3},
            {"sequence_number": 4},
        ]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[{
                "role": "assistant",
                "content": "Please confirm.",
                "sequence_number": 2,
                "tool_uses": [{
                    "name": "retrieve_paper_content",
                    "status": "needs_confirmation",
                    "result": {"message": "Please confirm."},
                }],
            }],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "First Paper", "year": 1993, "summary": "First"}},
                },
            },
        }
        ingestion = AsyncMock()
        ingestion.ingest.return_value = {"status": "ready", "paperId": "W1"}

        async def answer(_papers, _question, **kwargs):
            result = await kwargs["tool_runner"](
                "retrieve_paper_content",
                {"paperId": "W1", "confirmed": False},
            )
            self.assertEqual(result["status"], "ready")
            return {
                "text": "Indexed.",
                "highlightedPaperIds": ["W1"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[{"openalexId": "W1", "title": "First Paper", "year": 1993, "summary": "First"}],
            question="yes, go ahead",
            mentionedPaperIds=["W1"],
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat.PaperIngestionService", return_value=ingestion):
                    with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                        response = await chat_global(req, request)

        self.assertEqual(response.text, "Indexed.")
        ingestion.ingest.assert_awaited_once_with(
            "W1",
            graph["data"]["nodes"]["1"]["paper"],
            billing_ip="127.0.0.1",
        )

    async def test_global_chat_persists_mentioned_papers_with_the_user_message(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [
            {"sequence_number": 3},
            {"sequence_number": 4},
        ]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "First Paper", "year": 1993, "summary": "First"}},
                    "2": {"paper": {"openalexId": "W2", "title": "Second Paper", "year": 2017, "summary": "Second"}},
                },
            },
        }

        async def answer(_papers, question, **kwargs):
            self.assertEqual(question, "@First Paper and @Second Paper: how are they related?")
            self.assertEqual(kwargs["mentioned_paper_ids"], ["W1", "W2"])
            return {
                "text": "They are related.",
                "highlightedPaperIds": ["W1", "W2"],
                "suggestion": None,
                "toolUses": [],
                "citations": [],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = GlobalChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            papers=[
                {"openalexId": "W1", "title": "Client first", "year": 1993, "summary": "First"},
                {"openalexId": "W2", "title": "Client second", "year": 2017, "summary": "Second"},
            ],
            question="@First Paper and @Second Paper: how are they related?",
            mentionedPaperIds=["w1", "W2", "W1"],
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat._llm.chat_about_timeline_agentic", AsyncMock(side_effect=answer)):
                    response = await chat_global(req, request)

        self.assertEqual(response.text, "They are related.")
        user_append = memory.append.await_args_list[0]
        self.assertEqual(
            user_append.kwargs["tool_uses"],
            [{"name": "global_user_message", "mentionedPaperIds": ["W1", "W2"]}],
        )

    async def test_persists_user_before_agentic_model_and_assistant_after(self) -> None:
        events: list[str] = []
        memory = AsyncMock()

        async def append(_context, _user_id, role, _content, **_kwargs):
            events.append(f"persist:{role}")
            return {"sequence_number": 4 if role == "assistant" else 3}

        memory.append.side_effect = append
        context = ChatContext(
            session={"id": "session-1", "summary": "Earlier", "summary_through_sequence": 0},
            messages=[{"role": "user", "content": "Earlier question", "sequence_number": 1}],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Server Paper", "year": 2020, "summary": "Summary"}},
                },
            },
        }

        async def answer(*_args, **kwargs):
            events.append("model")
            self.assertEqual(kwargs["history"], [{"role": "user", "content": "Earlier question"}])
            self.assertEqual(kwargs["summary"], "Earlier")
            self.assertEqual(kwargs["selected_excerpt"], "Selected paper text")
            self.assertIn("tool_runner", kwargs)
            return {"text": "Answer", "suggestion": None, "toolUses": [], "citations": []}

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = ChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            paperId="W1",
            title="Client Paper",
            summary="Client summary",
            question="New question",
            selectedExcerpt="Selected paper text",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat._llm.chat_about_paper_agentic", AsyncMock(side_effect=answer)):
                    response = await chat(req, request)

        self.assertEqual(events, ["persist:user", "model", "persist:assistant"])
        self.assertEqual(
            memory.append.await_args_list[0].kwargs["tool_uses"],
            [{"name": "paper_selected_excerpt", "excerpt": "Selected paper text"}],
        )
        self.assertEqual(response.sessionId, "session-1")
        memory.maybe_summarize.assert_awaited_once()

    async def test_retrieve_tool_requires_user_confirmation(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [
            {"sequence_number": 1},
            {"sequence_number": 2},
        ]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Server Paper", "year": 2020, "summary": "Summary"}},
                },
            },
        }

        async def answer(*_args, **kwargs):
            result = await kwargs["tool_runner"]("retrieve_paper_content", {"confirmed": True})
            self.assertEqual(result["status"], "needs_confirmation")
            return {
                "text": "Please confirm that you want me to access and index the complete paper.",
                "suggestion": None,
                "toolUses": [{
                    "name": "retrieve_paper_content",
                    "status": result["status"],
                    "result": result,
                }],
                "citations": [],
            }

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = ChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            paperId="W1",
            title="Client Paper",
            summary="Client summary",
            question="What are the limitations?",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat._llm.chat_about_paper_agentic", AsyncMock(side_effect=answer)):
                    response = await chat(req, request)

        self.assertIn("confirm", response.text.lower())
        assistant_append = memory.append.await_args_list[-1]
        self.assertEqual(assistant_append.kwargs["tool_uses"][0]["status"], "needs_confirmation")

    async def test_pending_confirmation_allows_retrieve_tool(self) -> None:
        memory = AsyncMock()
        memory.append.side_effect = [
            {"sequence_number": 3},
            {"sequence_number": 4},
        ]
        context = ChatContext(
            session={"id": "session-1", "summary": None, "summary_through_sequence": 0},
            messages=[{
                "role": "assistant",
                "content": "Please confirm.",
                "sequence_number": 2,
                "tool_uses": [{
                    "name": "retrieve_paper_content",
                    "status": "needs_confirmation",
                    "result": {"message": "Please confirm."},
                }],
            }],
        )
        graph = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Server Paper", "year": 2020, "summary": "Summary"}},
                },
            },
        }
        ingestion = AsyncMock()
        ingestion.ingest.return_value = {
            "status": "ready",
            "documentId": "doc-1",
            "chunkCount": 3,
            "sourceType": "openalex_tei",
            "message": "Complete paper text is indexed and ready to search.",
        }

        async def answer(*_args, **kwargs):
            result = await kwargs["tool_runner"]("retrieve_paper_content", {"confirmed": False})
            self.assertEqual(result["status"], "ready")
            return {"text": "Indexed.", "suggestion": None, "toolUses": [], "citations": []}

        request = SimpleNamespace(state=SimpleNamespace(verified_client_ip="127.0.0.1"), client=None)
        req = ChatRequest(
            graphId="00000000-0000-0000-0000-000000000001",
            userId="00000000-0000-0000-0000-000000000002",
            paperId="W1",
            title="Client Paper",
            summary="Client summary",
            question="yes go ahead",
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat.PaperIngestionService", return_value=ingestion):
                    with patch("app.routers.chat._llm.chat_about_paper_agentic", AsyncMock(side_effect=answer)):
                        response = await chat(req, request)

        self.assertEqual(response.text, "Indexed.")
        ingestion.ingest.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
