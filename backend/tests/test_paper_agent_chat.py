from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.services.llm import LLMClient


class FakeBlock(SimpleNamespace):
    def model_dump(self, exclude_none: bool = True):
        return {
            key: value
            for key, value in self.__dict__.items()
            if not exclude_none or value is not None
        }


class FakeStream:
    def __init__(self, events, final_message):
        self._events = events
        self._final_message = final_message

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __aiter__(self):
        self._iter = iter(self._events)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc

    @property
    def text_stream(self):
        async def stream_text():
            for event in self._events:
                if getattr(event, "type", None) == "text" and getattr(event, "text", ""):
                    yield event.text

        return stream_text()

    async def get_final_message(self):
        return self._final_message


class PaperAgentChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_global_agent_receives_the_mentioned_papers_as_current_context(self) -> None:
        client = LLMClient(api_key="test-key", model="claude-test")
        final = SimpleNamespace(
            content=[FakeBlock(type="text", text="They are related through attention.")],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        )
        client.client.messages.create = AsyncMock(return_value=final)

        with patch("app.services.llm.limiter.record_usage", AsyncMock()):
            result = await client.chat_about_timeline_agentic(
                [
                    {"openalexId": "W1", "title": "First Paper", "year": 1993, "summary": "First"},
                    {"openalexId": "W2", "title": "Second Paper", "year": 2017, "summary": "Second"},
                ],
                "@First Paper and @Second Paper: how are they related?",
                mentioned_paper_ids=["W1", "W2"],
                tool_runner=AsyncMock(),
                ip="127.0.0.1",
            )

        prompt = client.client.messages.create.await_args.kwargs["messages"][-1]["content"]
        self.assertIn('"openalexId": "W1"', prompt)
        self.assertIn('"openalexId": "W2"', prompt)
        self.assertIn("do not ask the user to name the papers again", prompt)
        self.assertEqual(result["highlightedPaperIds"], ["W1", "W2"])

    async def test_tool_result_is_returned_and_citations_are_collected(self) -> None:
        client = LLMClient(api_key="test-key", model="claude-test")
        first = SimpleNamespace(
            content=[
                FakeBlock(
                    type="tool_use",
                    id="toolu_1",
                    name="search_paper_content",
                    input={"query": "methods"},
                )
            ],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        )
        final = SimpleNamespace(
            content=[FakeBlock(type="text", text="The method is grounded in the retrieved chunk [paper:W1:document:D1:chunk:0].")],
            usage=SimpleNamespace(input_tokens=20, output_tokens=7),
        )
        client.client.messages.create = AsyncMock(side_effect=[first, final])

        async def run_tool(name, tool_input):
            self.assertEqual(name, "search_paper_content")
            self.assertEqual(tool_input["query"], "methods")
            return {
                "status": "completed",
                "matches": [{
                    "content": "Relevant method text.",
                    "citation": {
                        "id": "paper:W1:document:D1:chunk:0",
                        "openalexId": "W1",
                        "title": "Paper",
                        "section": "Methods",
                        "chunkIndex": 0,
                        "sourceType": "openalex_tei",
                    },
                }],
                "citations": [{
                    "id": "paper:W1:document:D1:chunk:0",
                    "openalexId": "W1",
                    "title": "Paper",
                    "section": "Methods",
                    "chunkIndex": 0,
                    "sourceType": "openalex_tei",
                }],
            }

        with patch("app.services.llm.limiter.record_usage", AsyncMock()):
            result = await client.chat_about_paper_agentic(
                {"title": "Paper", "year": 2020, "summary": "Summary"},
                "What method did it use?",
                tool_runner=run_tool,
                ip="127.0.0.1",
            )

        self.assertIn("retrieved chunk", result["text"])
        self.assertEqual(result["toolUses"][0]["name"], "search_paper_content")
        self.assertEqual(result["citations"][0]["id"], "paper:W1:document:D1:chunk:0")
        self.assertEqual(client.client.messages.create.await_count, 2)

    async def test_streaming_emits_text_deltas_and_keeps_final_message(self) -> None:
        client = LLMClient(api_key="test-key", model="claude-test")
        final = SimpleNamespace(
            content=[FakeBlock(type="text", text="Hello world")],
            usage=SimpleNamespace(input_tokens=5, output_tokens=2),
        )
        client.client.messages.stream = lambda **_kwargs: FakeStream(
            [
                SimpleNamespace(type="text", text="Hello "),
                SimpleNamespace(type="text", text="world"),
            ],
            final,
        )
        chunks: list[str] = []

        async def emit(text: str) -> None:
            chunks.append(text)

        with patch("app.services.llm.limiter.record_usage", AsyncMock()):
            result = await client.chat_about_paper_agentic(
                {"title": "Paper", "year": 2020, "summary": "Summary"},
                "Say hello.",
                tool_runner=AsyncMock(),
                text_emitter=emit,
                ip="127.0.0.1",
            )

        self.assertEqual(chunks, ["Hello ", "world"])
        self.assertEqual(result["text"], "Hello world")
        self.assertTrue(result["textStreamed"])


if __name__ == "__main__":
    unittest.main()
