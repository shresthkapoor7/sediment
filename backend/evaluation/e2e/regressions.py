"""Functional clarification regressions, kept separate from scientific gold scores."""
REGRESSIONS = [
    {"id": "meaning_of_life_options", "query": "what is the meaning of life", "workflow": "options", "topic": None},
    {"id": "chain_of_thought_standard", "query": "chain of thought llm", "workflow": "clarified_standard", "topic": None},
    {"id": "chain_of_thought_deep", "query": "chain of thought llm", "workflow": "clarified_deep", "topic": None},
]


async def run_regression(api, case):
    response = await api.post("/api/clarify", json={"query": case["query"]})
    response.raise_for_status()
    clarification = response.json()
    failures = []
    if case["workflow"] == "options":
        queries = clarification.get("options") or []
        if not clarification.get("needs_clarification") or not 2 <= len(queries) <= 4:
            failures.append("vague question did not offer 2-4 clarification options")
    elif clarification.get("needs_clarification"):
        queries = [q for q in clarification.get("options", [])
                   if any(term in q.lower() for term in ("language model", "llm", "prompt"))][:1]
        if not queries:
            failures.append("no language-model interpretation offered")
    else:
        queries = [clarification.get("refined_query") or case["query"]]
    outcomes = []
    for query in queries:
        mode = "deep" if case["workflow"] == "clarified_deep" else "standard"
        response = await api.post("/api/search", json={"query": query, "traceMode": mode})
        response.raise_for_status()
        graph = response.json()
        outcomes.append({"query": query, "graph": graph})
        if not graph.get("papers") and not graph.get("disambiguation"):
            failures.append(f"clarification option returned no usable papers: {query}")
        if case["workflow"] != "options":
            titles = [p["title"].casefold().replace("-", " ") for p in
                      graph.get("papers", []) + (graph.get("disambiguation") or [])]
            if not any("chain of thought prompting elicits reasoning in large language models" in t for t in titles):
                failures.append("foundational chain-of-thought paper absent from graph/seed choices")
            if mode == "deep" and graph.get("meta", {}).get("traceMode") != "deep":
                failures.append("requested deep trace fell back")
    return {"clarification": clarification, "option_searches": outcomes, "failures": failures}
