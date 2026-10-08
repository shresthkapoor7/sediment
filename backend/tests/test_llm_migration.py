from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.services.llm import LLMClient, LLMParseError


class HaikuMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_json_parser_skips_thinking_blocks(self):
        client = LLMClient(api_key="test-key", model="claude-haiku-5-5")
        response = SimpleNamespace(
            content=[
                SimpleNamespace(type="thinking", thinking="", signature="signed"),
                SimpleNamespace(type="text", text='{"needs_clarification": false, "refined_query": "chain-of-thought prompting"}'),
            ],
            usage=SimpleNamespace(input_tokens=10, output_tokens=10),
            stop_reason="end_turn",
        )
        client.client.messages.create = AsyncMock(return_value=response)
        with patch.object(client, "_record_response_usage", AsyncMock()):
            result = await client.clarify_query("chain of thought")
        self.assertEqual(result["refined_query"], "chain-of-thought prompting")
        kwargs = client.client.messages.create.await_args.kwargs
        self.assertEqual(kwargs["thinking"], {"type": "adaptive"})
        self.assertEqual(kwargs["output_config"], {"effort": "low"})
        self.assertGreaterEqual(kwargs["max_tokens"], 4096)

    async def test_json_rejects_truncation_and_refusal_even_with_parseable_text(self):
        client = LLMClient(api_key="test-key", model="claude-haiku-5-5")
        for reason in ["refusal", "max_tokens", "model_context_window_exceeded"]:
            client.client.messages.create = AsyncMock(return_value=SimpleNamespace(
                content=[SimpleNamespace(type="text", text='{}')], stop_reason=reason,
            ))
            with patch.object(client, "_record_response_usage", AsyncMock()):
                with self.assertRaises(LLMParseError):
                    await client._prompt_json("test")

    def test_legacy_model_options_are_unchanged(self):
        client = LLMClient(api_key="test-key", model="claude-haiku-4-5-20251001")
        self.assertEqual(client._generation_options(1024), {"max_tokens": 1024})

    async def test_agent_requests_allow_room_for_thinking(self):
        client = LLMClient(api_key="test-key", model="claude-haiku-5-5")
        client.client.messages.create = AsyncMock()
        await client._message(max_tokens=1600, messages=[], tools=[], tool_choice={"type": "auto"})
        kwargs = client.client.messages.create.await_args.kwargs
        self.assertEqual(kwargs["output_config"], {"effort": "medium"})
        self.assertGreaterEqual(kwargs["max_tokens"], 8192)
