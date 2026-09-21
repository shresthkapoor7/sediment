"""Observe real provider results and exact prompts without changing their content."""
from contextvars import ContextVar
from copy import deepcopy
import json
import re
from unittest.mock import patch


def json_after(text, marker):
    if marker not in text:
        raise ValueError(f"Application prompt changed: missing {marker!r}")
    return json.JSONDecoder().raw_decode(text.split(marker, 1)[1].lstrip())[0]


def stage_contexts(stage):
    """Only evidence actually sent to the model, never gold or its own output."""
    messages = stage["requests"][-1]["messages"]
    if stage["name"] != "trace_lineage_agentic":
        prompt = messages[-1]["content"]
        markers = ("Seed paper:\n", "Candidates:\n") if stage["name"] == "rank_references" else ("Papers:\n", "Edges:\n")
        return [json.dumps(json_after(prompt, marker), ensure_ascii=False) for marker in markers]
    contexts = []
    for message in messages:
        if message["role"] != "user":
            continue
        content = message["content"]
        if isinstance(content, str):
            selected = re.search(r"<selected_seed>(.*?)</selected_seed>", content, re.S)
            if selected:
                contexts.append(json.dumps(json.loads(selected[1]), ensure_ascii=False))
        else:
            for block in content:
                if block.get("type") != "tool_result" or block.get("is_error"):
                    continue
                result = re.search(r"<untrusted_openalex_tool_result>\s*(.*?)\s*</untrusted_openalex_tool_result>", block["content"], re.S)
                if result:
                    data = json.loads(result[1])
                    if data.get("status") == "completed" and "papers" in data:
                        contexts.append(json.dumps(data, ensure_ascii=False))
    if not contexts:
        raise ValueError("Deep generation had no captured scientific evidence")
    return contexts


def stage_response(stage):
    output = stage["output"]
    if stage["name"] == "rank_references":
        return "\n".join(f"{p['title']}: {p['summary']}" for p in output)
    if stage["name"] == "generate_trace_notes":
        return "\n".join(n["text"] for n in output)
    # Include deep notes AND summaries. Edge verification is a separate exact check;
    # causal interpretations in prose are also judged here and in the gold rubric.
    return "\n".join([*(f"{p['title']}: {p['summary']}" for p in output["papers"]),
                       *(n["text"] for n in output["traceNotes"])])


class Capture:
    def __init__(self, stack, target, target_limit):
        self.stages, self.retrieval, self.requests, self.errors, self.usage = [], [], [], [], []
        self.target_limit, self.provider_calls = target_limit, 0
        self.current_stage = ContextVar("evaluation_stage", default=None)
        self.retrieval_depth = ContextVar("evaluation_retrieval_depth", default=0)
        self.resolving = False
        from app.services.llm import LLMClient
        from app.services import openalex
        original_create = target.client.messages.create

        async def create(**kwargs):
            if len(self.requests) >= self.target_limit:
                self.errors.append("target call budget exceeded")
                raise RuntimeError(self.errors[-1])
            request = deepcopy({k: kwargs[k] for k in ("model", "messages", "max_tokens") if k in kwargs})
            self.requests.append(request)
            stage = self.current_stage.get()
            if stage is not None:
                stage["requests"].append(request)
            try:
                result = await original_create(**kwargs)
            except Exception as exc:
                self.errors.append(f"target API: {type(exc).__name__}")
                raise
            self.usage.append(result.usage.model_dump())
            return result

        stack.enter_context(patch.object(target.client.messages, "create", create))
        for name in ("rank_references", "generate_trace_notes", "trace_lineage_agentic", "clarify_query", "choose_seed"):
            original = getattr(LLMClient, name)

            def stage_wrapper(name, original):
                async def wrapped(client, *args, **kwargs):
                    stage = {"name": name, "requests": []}
                    self.stages.append(stage)
                    token = self.current_stage.set(stage)
                    try:
                        result = await original(client, *args, **kwargs)
                        stage["output"] = deepcopy(result)
                        if not result:
                            self.errors.append(f"empty generation: {name}")
                        return result
                    except Exception as exc:
                        self.errors.append(f"generation {name}: {type(exc).__name__}")
                        raise
                    finally:
                        self.current_stage.reset(token)
                return wrapped
            stack.enter_context(patch.object(LLMClient, name, stage_wrapper(name, original)))

        for name in ("search_papers", "fetch_work", "fetch_references", "hydrate_works",
                     "fetch_related_earlier_papers", "fetch_related_earlier_papers_for_query"):
            original = getattr(openalex.OpenAlexClient, name)

            def retrieval_wrapper(name, original):
                async def wrapped(client, *args, **kwargs):
                    depth = self.retrieval_depth.get()
                    token = self.retrieval_depth.set(depth + 1)
                    try:
                        result = await original(client, *args, **kwargs)
                        if depth == 0 and not self.resolving:
                            self.retrieval.append({"method": name, "args": deepcopy(args),
                                                   "kwargs": deepcopy(kwargs), "result": deepcopy(result)})
                        return result
                    finally:
                        self.retrieval_depth.reset(token)
                return wrapped
            stack.enter_context(patch.object(openalex.OpenAlexClient, name, retrieval_wrapper(name, original)))
        original_get = openalex._get

        async def get(*args, **kwargs):
            self.provider_calls += 1
            if self.provider_calls > 60:
                self.errors.append("OpenAlex call budget exceeded")
                raise RuntimeError(self.errors[-1])
            try:
                return await original_get(*args, **kwargs)
            except Exception as exc:
                self.errors.append(f"OpenAlex API: {type(exc).__name__}")
                raise
        stack.enter_context(patch.object(openalex, "_get", get))

    def papers(self):
        # Keep different evidence versions, not only the first metadata-only hit.
        seen, papers = set(), []
        for call in self.retrieval:
            values = call["result"] if isinstance(call["result"], list) else [call["result"]]
            for paper in values:
                if not paper:
                    continue
                key = json.dumps(paper, sort_keys=True)
                if key not in seen:
                    seen.add(key)
                    papers.append(paper)
        return papers

    def scientific_stages(self):
        return [s for s in self.stages if s["name"] in
                {"rank_references", "generate_trace_notes", "trace_lineage_agentic"} and s.get("output")]

    def snapshot(self):
        return {"stages": self.stages, "retrieval": self.retrieval, "target_requests": self.requests,
                "target_usage": self.usage, "target_errors": self.errors,
                "target_calls": len(self.requests), "openalex_calls": self.provider_calls}
