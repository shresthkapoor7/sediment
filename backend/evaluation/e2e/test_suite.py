"""Canonical 30 API evaluations. Discovery is offline; paid execution is opt-in."""
import asyncio
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
import uuid

from evaluation.e2e.capture import Capture
from evaluation.e2e.dataset import CASES, DATASET_SHA256, TOPICS, matches, paper
from evaluation.e2e.metrics import JUDGE_MODEL, Judges, THRESHOLDS, manual_metrics

RUN_ID = uuid.uuid4().hex
CODE_SHA256 = hashlib.sha256(b"".join(p.read_bytes() for p in sorted(Path(__file__).parent.glob("*.py")))).hexdigest()
TARGET_LIMITS = {"standard": 4, "deep": 10, "clarify": 5, "selected_seed": 10, "expand": 1}


def emit(event, **fields):
    print(json.dumps({"event": event, "run_id": RUN_ID, **fields}, ensure_ascii=False, allow_nan=False), flush=True)


@unittest.skipUnless(os.environ.get("RUN_E2E_EVALS") == "1", "paid API evals require RUN_E2E_EVALS=1")
class EndToEndEvals(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
            self.assertTrue(os.environ.get(key, "").strip(), f"Set {key}")
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            "RAGAS_DO_NOT_TRACK": "true",
            "ACTOR_KEY_SECRET": os.environ.get("ACTOR_KEY_SECRET") or "local-evaluation-only",
        }))
        from anthropic import AsyncAnthropic
        from openai import AsyncOpenAI
        import httpx
        from app.main import app
        from app.config import settings
        from app.routers import clarify, expand, search
        from app.services.llm import LLMClient
        from app.services.usage_limiter import limiter

        self.target = LLMClient(os.environ["ANTHROPIC_API_KEY"], settings.llm_model)
        await self.target.client.close()
        self.target.client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=90, max_retries=0)
        self.addAsyncCleanup(self.target.client.close)
        self.openai = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120, max_retries=0)
        self.addAsyncCleanup(self.openai.close)
        # Same application, prompts and real provider clients. Isolate only billing DB
        # writes and local quota accounting; do not modify production implementation.
        for router in (clarify, expand, search):
            self.stack.enter_context(patch.object(router, "_llm", self.target))
        for method in ("claim_request", "record_usage"):
            self.stack.enter_context(patch.object(limiter, method, AsyncMock()))
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://evaluation")
        self.addAsyncCleanup(self.api.aclose)
        self.judges = Judges(self.openai)

    async def request_graph(self, case, topic, capture, record):
        from app.config import settings
        from app.services.openalex import OpenAlexClient
        query = case["query"]
        workflow = case["workflow"]
        selected_id = None
        if workflow in {"selected_seed", "expand"}:
            # Simulate the user's selection. Resolver evidence is explicitly excluded
            # from app recall: the app must retrieve its own evidence after selection.
            capture.resolving = True
            try:
                async with OpenAlexClient(settings.openalex_api_key, settings.openalex_mailto) as client:
                    seed = paper(topic, topic["seed"])
                    candidates = await client.search_papers(seed["title"], limit=8)
                    selected_id = next((p["openalexId"] for p in candidates if matches(p, seed)), None)
            finally:
                capture.resolving = False
            if selected_id is None:
                raise RuntimeError("Could not resolve the requested seed in live OpenAlex")
            record["selected_seed_id"] = selected_id
        if workflow == "clarify":
            # A full canonical title is unambiguous; unnecessary clarification is a failure.
            query = paper(topic, topic["seed"])["title"]
            response = await self.api.post("/api/clarify", json={"query": query})
            response.raise_for_status()
            clarification = response.json()
            record["clarification"] = clarification
            self.assertFalse(clarification["needs_clarification"], "Unambiguous paper title required clarification")
            query = clarification.get("refined_query") or query
        traversal = {"depth": 1, "breadth": 2, "topN": 5, "referenceLimit": 20}
        if workflow == "expand":
            path = "/api/expand"
            payload = {"paperId": selected_id, "conceptContext": query, "settings": traversal}
        else:
            path = "/api/search"
            payload = {"query": query, "settings": traversal,
                       "traceMode": "deep" if workflow in {"deep", "selected_seed"} else "standard"}
            if selected_id:
                payload["seedOpenalexId"] = selected_id
        record["request"] = {"path": path, "json": payload}
        response = await self.api.post(path, json=payload)
        record["http_status"] = response.status_code
        response.raise_for_status()
        return response.json()

    async def evaluate_case(self, case):
        topic = TOPICS[case["topic"]]
        capture = Capture(self.stack, self.target, TARGET_LIMITS[case["workflow"]])
        record = {"case": case["id"], "topic": case["topic"], "workflow": case["workflow"],
                  "dataset_sha256": DATASET_SHA256, "code_sha256": CODE_SHA256,
                  "target_model": self.target.model, "judge_model": JUDGE_MODEL,
                  "thresholds": THRESHOLDS, "status": "error", "failures": []}
        phase = "application"
        try:
            graph = await asyncio.wait_for(self.request_graph(case, topic, capture, record), 360)
            record["graph"] = graph
            emit("candidate", **record, **capture.snapshot())
            if capture.errors:
                raise RuntimeError("Provider/generation error hidden by application fallback")
            scores, failures = manual_metrics(topic, case["workflow"], graph, capture)
            record["manual"] = scores
            record["failures"].extend(failures)
            if record.get("selected_seed_id") and graph.get("seedPaperId") != record["selected_seed_id"]:
                record["failures"].append("selected seed ID was changed")
            phase = "judge"
            record["failures"].extend(await self.judges.score(case, topic, graph, capture, record))
            record["status"] = "failed" if record["failures"] else "passed"
        except AssertionError as exc:
            record["status"] = "failed"
            record["failures"].append(str(exc))
            raise
        except Exception as exc:
            record["error"] = {"phase": phase, "type": type(exc).__name__}
            # Traceback retained by unittest; avoid serializing provider exceptions/headers.
            raise
        finally:
            emit("result", **record, **capture.snapshot(), judge_calls=self.judges.calls,
                 judge_usage=self.judges.usage, judge_steps=self.judges.steps)
        self.assertFalse(record["failures"], "; ".join(record["failures"]))


def make_case(case):
    async def test(self):
        await self.evaluate_case(case)
    test.__doc__ = f"{case['topic']} via {case['workflow']}: faithfulness, recall, correctness."
    return test


for _case in CASES:
    setattr(EndToEndEvals, f"test_{_case['id']}", make_case(_case))

if __name__ == "__main__":
    unittest.main()
