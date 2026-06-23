from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.services.llm import LLMClient
from app.services.usage_limiter import ANTHROPIC_WEB_SEARCH_MICRO_USD, UsageLimiter
from app.services.voyage import (
    embedding_cost_micro_usd,
    estimate_tokens,
    rerank_cost_micro_usd,
)


class CostAccountingTests(unittest.IsolatedAsyncioTestCase):
    def test_voyage_embedding_and_rerank_cost_estimates(self) -> None:
        self.assertGreater(estimate_tokens("abcd"), 0)
        self.assertEqual(
            embedding_cost_micro_usd(["a" * 4000], model="voyage-4"),
            UsageLimiter.provider_cost_micro_usd(1000, 0.06),
        )
        self.assertEqual(
            rerank_cost_micro_usd("q" * 40, ["d" * 400, "e" * 400], model="rerank-2.5-lite"),
            UsageLimiter.provider_cost_micro_usd(220, 0.02),
        )

    async def test_web_search_result_records_fixed_fee(self) -> None:
        client = LLMClient(api_key="test-key", model="claude-test")
        response = SimpleNamespace(
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
            content=[SimpleNamespace(type="web_search_tool_result")],
        )

        with patch("app.services.llm.limiter.record_usage", AsyncMock()) as record_usage:
            with patch("app.services.llm.limiter.record_fixed_cost", AsyncMock()) as record_fixed:
                await client._record_response_usage(response, "127.0.0.1")

        record_usage.assert_awaited_once_with("127.0.0.1", 10, 5, "claude-test")
        record_fixed.assert_awaited_once_with(
            "127.0.0.1",
            ANTHROPIC_WEB_SEARCH_MICRO_USD,
            reason="anthropic_web_search",
        )


if __name__ == "__main__":
    unittest.main()
