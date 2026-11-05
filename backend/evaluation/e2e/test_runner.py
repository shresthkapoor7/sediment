"""Offline unit checks for local runner safety; no provider clients are called."""
import contextlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from evaluation.e2e.budget import Budget, BudgetExceeded, cost, reserve_cost
from evaluation.e2e.run import main, read_results, select_cases
from evaluation.e2e.regressions import REGRESSIONS, run_regression
from evaluation.e2e.report import summarize


class BudgetTests(unittest.IsolatedAsyncioTestCase):
    def request(self):
        return {"model": "gpt-6-astra", "messages": [{"role": "user", "content": "hello"}], "max_completion_tokens": 4096}

    async def test_preflight_stops_call_without_spending(self):
        send = AsyncMock()
        budget = Budget({"openai": 0.01})
        with self.assertRaises(BudgetExceeded):
            await budget.call("openai", self.request(), send)
        send.assert_not_awaited()
        self.assertTrue(budget.blocked)

    async def test_actual_usage_releases_unused_reservation(self):
        budget = Budget({"openai": 1})
        response = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=100, completion_tokens=10))
        await budget.call("openai", self.request(), AsyncMock(return_value=response))
        self.assertAlmostEqual(budget.summary()["openai"]["recorded_usd"], 0.0015)
        self.assertEqual(budget.summary()["openai"]["reserved_unknown_usd"], 0)

    async def test_timeout_reservation_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'budget.json'
            cap = reserve_cost("openai", self.request()) * 1.5
            budget = Budget({"openai": cap}, path)
            with self.assertRaises(TimeoutError):
                await budget.call("openai", self.request(), AsyncMock(side_effect=TimeoutError))
            restarted = Budget({"openai": cap}, path)
            send = AsyncMock()
            with self.assertRaises(BudgetExceeded):
                await restarted.call("openai", self.request(), send)
            send.assert_not_awaited()

    async def test_underestimate_blocks_further_requests(self):
        budget = Budget({"openai": 100})
        response = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=100000, completion_tokens=100000))
        await budget.call("openai", self.request(), AsyncMock(return_value=response))
        with self.assertRaises(BudgetExceeded):
            await budget.call("openai", self.request(), AsyncMock())

    def test_pricing_tiers_and_cache(self):
        self.assertAlmostEqual(cost("openai", "gpt-6-astra", {"prompt_tokens": 272000, "completion_tokens": 1000}), 2.77)
        self.assertAlmostEqual(cost("openai", "gpt-6-astra", {"prompt_tokens": 272001, "completion_tokens": 1000}), 5.51502)
        self.assertAlmostEqual(cost("openai", "gpt-6-astra", {"prompt_tokens": 1000, "prompt_tokens_details": {"cached_tokens": 1000}}), 0.001)
        self.assertAlmostEqual(cost("anthropic", "claude-haiku-5-5", {"input_tokens": 1, "cache_read_input_tokens": 100000, "output_tokens": 1000}), 0.0075005)
        with self.assertRaises(ValueError):
            cost("openai", "unknown", {})
        for value in (float('nan'), float('inf'), -1):
            with self.assertRaises(ValueError):
                Budget({"openai": value})


class RunnerTests(unittest.TestCase):
    def test_default_is_offline_plan(self):
        with patch('evaluation.e2e.run.execute', side_effect=AssertionError("must not execute")):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(['generate', '--profile', 'smoke']), 0)

    def test_smoke_covers_all_topics_and_workflows(self):
        cases = select_cases(SimpleNamespace(profile='smoke', cases=None))
        self.assertEqual(len(cases), 6)
        self.assertEqual(len({c['topic'] for c in cases}), 6)
        self.assertEqual(len({c['workflow'] for c in cases}), 5)

    def test_full_includes_functional_regressions(self):
        self.assertEqual(len(select_cases(SimpleNamespace(profile='full', cases=None))), 33)

    def test_live_requires_budget(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                main(['generate', '--live'])

    def test_selected_manifest_controls_report_denominator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'results.jsonl'
            path.write_text(json.dumps({'event':'result', 'run_id':'one', 'case':'fista_standard',
                'status':'smoke_passed', 'target_calls':2, 'judge_calls':0})+'\n')
            (path.parent/'manifest.json').write_text(json.dumps({'cases':['fista_standard']}))
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(summarize(path), 0)
            self.assertIn('1/1 completed', output.getvalue())
            self.assertIn('NOT RUN', output.getvalue())

    def test_read_keeps_results_before_interrupted_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'results.jsonl'
            path.write_text('{"event":"result","case":"one"}\n{"partial":')
            self.assertEqual(list(read_results(path)), ['one'])


class RegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_suggestion_is_searched(self):
        class Response:
            def __init__(self, data): self.data = data
            def raise_for_status(self): pass
            def json(self): return self.data
        api = SimpleNamespace(post=AsyncMock(side_effect=[
            Response({'needs_clarification':True,'options':['psychology','biology','philosophy']}),
            Response({'papers':[{'title':'P'}]}), Response({'papers':[], 'disambiguation':[{'title':'B'}]}),
            Response({'papers':[]}),
        ]))
        result = await run_regression(api, REGRESSIONS[0])
        self.assertEqual(len(result['option_searches']), 3)
        self.assertEqual(len(result['failures']), 1)
        self.assertIn('philosophy', result['failures'][0])

    async def test_chain_of_thought_checks_foundation_and_deep_mode(self):
        class Response:
            def __init__(self, data): self.data = data
            def raise_for_status(self): pass
            def json(self): return self.data
        for actual_mode, title, expected_failures in [
            ('deep', 'Chain-Of-Thought Prompting Elicits Reasoning in Large Language Models', 0),
            ('standard', 'Recent application of chain of thought', 2),
        ]:
            api = SimpleNamespace(post=AsyncMock(side_effect=[
                Response({'needs_clarification':False,'refined_query':'chain-of-thought prompting'}),
                Response({'papers':[{'title':title}], 'meta':{'traceMode':actual_mode}}),
            ]))
            result = await run_regression(api, REGRESSIONS[2])
            self.assertEqual(len(result['failures']), expected_failures)
            self.assertEqual(api.post.await_args.kwargs['json']['query'], 'chain-of-thought prompting')

    async def test_missing_source_never_calls_judge(self):
        from evaluation.e2e.run import judge_case
        from evaluation.e2e.dataset import CASES
        events = []
        with patch('evaluation.e2e.run.Judges', side_effect=AssertionError('must not judge')):
            await judge_case(CASES[0], {}, Budget({'openai':0}), None,
                             lambda event, **row: events.append(row), False)
        self.assertEqual(events[0]['judge_status'], 'missing_generation')
        self.assertEqual(events[0]['judge_calls'], 0)


if __name__ == '__main__':
    unittest.main()
