from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.models import ChatRequest, GlobalChatRequest
from app.routers.chat import chat, chat_global
from app.services.chat_memory import ChatContext


class PersistentChatRouterTests(unittest.IsolatedAsyncioTestCase):
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
        )

        with patch("app.routers.chat.limiter.claim_request", AsyncMock()):
            with patch(
                "app.routers.chat._load_persistent_context",
                AsyncMock(return_value=(AsyncMock(), graph, memory, context)),
            ):
                with patch("app.routers.chat._llm.chat_about_paper_agentic", AsyncMock(side_effect=answer)):
                    response = await chat(req, request)

        self.assertEqual(events, ["persist:user", "model", "persist:assistant"])
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
