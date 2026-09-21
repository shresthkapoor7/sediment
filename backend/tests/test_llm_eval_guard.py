"""Offline unit checks for the legacy eval guard; no model output is evaluated."""
from contextlib import redirect_stdout
import io
import json
import os
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from evaluation import test_llm_judge as harness


class TargetErrorGuardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        network = patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        environment = patch.dict(os.environ, {
            "OPENAI_API_KEY": "offline", "ANTHROPIC_API_KEY": "offline",
            "ACTOR_KEY_SECRET": "offline",
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.create = AsyncMock()
        client = SimpleNamespace(messages=SimpleNamespace(create=self.create), close=AsyncMock())
        client.with_options = Mock(return_value=client)
        self.service = SimpleNamespace(client=client, model="offline")
        self.case = harness.LLMJudgeEvals("runTest")
        self.addAsyncCleanup(self.cleanup_harness)
        with patch("dotenv.load_dotenv"), patch("app.services.llm.LLMClient", return_value=self.service):
            await self.case.asyncSetUp()

    async def cleanup_harness(self):
        while self.case._cleanups:
            function, args, kwargs = self.case._cleanups.pop()
            result = function(*args, **kwargs)
            if hasattr(result, "__await__"):
                await result

    async def test_successful_usage_survives_a_later_api_failure(self):
        usage = {"input_tokens": 7, "output_tokens": 3}
        response = SimpleNamespace(usage=SimpleNamespace(model_dump=lambda: usage))
        failure = TimeoutError("Provider error body must not be recorded")
        self.create.side_effect = [response, failure]
        self.case.call_limit = 2
        self.assertIs(await self.service.client.messages.create(), response)
        with self.assertRaises(TimeoutError) as raised:
            await self.service.client.messages.create()
        self.assertIs(raised.exception, failure)
        self.assertEqual(self.case.target_calls, 2)
        self.assertEqual(self.case.target_usage, [usage])
        self.assertEqual(self.case.target_errors, ["TimeoutError"])

    async def check_hidden_failure(self, budget_exhausted=False):
        candidate = {"meta": {"traceMode": "standard"}, "traceNotes": [{"text": "Fallback note"}]}
        self.create.side_effect = TimeoutError("Provider error body must not be recorded")

        async def fallback_trace(*args, **kwargs):
            if budget_exhausted:
                self.case.call_limit = 0
            try:
                await self.service.client.messages.create()
            except (TimeoutError, RuntimeError):
                return candidate
            self.fail("Expected the synthetic target failure")

        case = next(c for c in harness.CASES if c["kind"] == "trace" and c["trace_mode"] == "standard")
        with patch("app.services.lineage.trace_lineage", side_effect=fallback_trace), \
                patch("aiohttp.ClientSession") as judge, redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(AssertionError, "Target API/budget error hidden"):
                await self.case.evaluate_case(case)
        judge.assert_not_called()
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event"], "candidate")
        self.assertEqual(events[0]["candidate"], candidate)
        expected = "Evaluation target-call budget exhausted" if budget_exhausted else "TimeoutError"
        self.assertEqual(events[0]["target_errors"], [expected])
        self.assertEqual(events[0]["target_calls"], 0 if budget_exhausted else 1)
        self.assertEqual(events[0]["target_usage"], [])
        if budget_exhausted:
            self.create.assert_not_awaited()

    async def test_hidden_api_failure_emits_candidate_and_skips_judge(self):
        await self.check_hidden_failure()

    async def test_hidden_budget_failure_emits_candidate_and_skips_judge(self):
        await self.check_hidden_failure(budget_exhausted=True)
