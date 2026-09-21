# Lineage and canvas-note evaluations

The main suite is now the [30-case API evaluation](e2e/README.md), covering AI
and mathematics with explicit paper recall, context recall, stage-input
faithfulness, and scientific correctness. Run it for the combined evaluation.
The eight tests documented below remain available as the historical custom-judge
suite; they are not additionally run by the 30-case command.

Eight opt-in cases judge whether Sediment produces scientifically correct,
useful lineage graphs and notes for a topic. They use the existing `unittest`
framework and `aiohttp`, with real Claude calls and OpenAI `gpt-6-astra` as judge.

| Cases | Production path | What is judged |
|---|---|---|
| 01–02 | Standard and deep `trace_lineage` | Transformer ancestry: seq2seq, soft alignment, supporting residual connections |
| 03–04 | Standard and deep `trace_lineage` | RAG ancestry: DPR retrieval, BART generation, REALM as related work |
| 05–06 | Standard and deep `trace_lineage` | ResNet ancestry: VGG, normalization, gated highway versus identity shortcuts |
| 07 | `generate_trace_notes` | A multi-step seq2seq → Transformer → RAG explanation with all material papers connected |
| 08 | `generate_trace_notes` | REALM/RAG conceptual comparison without claiming verified citation or derivation from an inferred edge |

The six trace cases run the actual orchestration, seed selection, reference
ranking, graph construction, note generation, and (in deep mode) agent tool loop
and proposal validation. Astra receives the **final graph, paper summaries, and
canvas notes**. It judges topic relevance, required foundational coverage,
scientific accuracy, relationship claims, note usefulness, and note grounding.
All criteria must pass. A deep trace falling back to standard fails explicitly.

## Reference evidence and scope

`lineage_reference.json` contains curated paraphrases, primary-paper URLs,
reference-list provenance, expected foundations, and a year convention.
`llm_cases.json` defines the eight rubrics. Reference facts and expected selections
are withheld from Claude and supplied separately to the judge. Source URLs are
provenance: the judge does not browse, and must grade against the included facts.

The OpenAlex adapter replays a small topic-specific catalog, including an unrelated
distractor, and explicit reference lists. Every search returns that same pool;
search queries are recorded but not matched against a live index. This isolates
**lineage synthesis and note quality given bibliographic evidence**. It does not
measure live OpenAlex retrieval recall, field-wide completeness, HTTP routes, or
persistence. The catalogs are partial, not claims of exhaustive historical ancestry.
Paper IDs prefixed with `fixture:` are local aliases, never real OpenAlex IDs.

The note uncertainty case intentionally withholds verified citation evidence;
a conceptual edge must not be promoted to a verified dependency by the note.
Publication years use conference years where applicable; earlier preprints do
not count as contradictions. Citation evidence alone is not proof of invention
or direct methodological dependence.

## Run

Use the backend environment with `requirements.txt` installed. In `backend/.env`
(ignored by Git), or in your shell, configure:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
# Optional: otherwise uses the application's default Claude model.
LLM_MODEL=claude-haiku-4-5-20251001
```

Both keys are required. The OpenAI project needs access to `gpt-6-astra`; no model
fallback is used. No server, OpenAlex key, or Supabase credentials are required.
Usage persistence is mocked; provider charges still apply.

From `backend/`, discover all eight without API calls:

```bash
.venv/bin/python -m unittest discover -s evaluation -p 'test_llm_judge.py' -v
```

Run one paid case:

```bash
RUN_LLM_EVALS=1 .venv/bin/python -m unittest evaluation.test_llm_judge.LLMJudgeEvals.test_01_transformer_standard -v
```

Run all eight and save the detailed outputs:

```bash
RUN_LLM_EVALS=1 .venv/bin/python -m unittest discover -s evaluation -p 'test_llm_judge.py' -v > /tmp/sediment-lineage-evals.jsonl
```

Use `python` instead of `.venv/bin/python` if your backend environment is already
activated. Add `-f` to stop after the first failure. The opt-in flag must be in
the process environment, not only `.env`.

Unlike the earlier small service-method suite, full tracing requires multiple
Claude calls per case. Limits are 4 target calls per standard trace, 10 per deep
trace (including any fallback), and 1 per notes-only case: **at most 44 Claude
calls and 8 Astra calls**. Normal deep traces can finish sooner. SDK retries are
disabled. Target calls have a 90-second client timeout, and each complete trace
has a 360-second timeout. Target output limits remain production defaults
(1,024 tokens for JSON calls; 1,600 per deep-agent iteration). Each judge call
has a 120-second total timeout and a 4,096-output-token limit. These are bounds,
not a dollar budget.

## Interpret results

The JSONL stream contains `candidate` events with the output, tool lookups,
model, target call count, usage and errors, followed by `judgment` events with per-criterion
verdicts, reasons, response ID, and judge usage. The two event types repeat target
usage: count it once per case. A candidate event remains available if structural
validation or the judge subsequently fails. Target API/budget errors hidden by
fallback fail after emitting the candidate and before calling the judge. Errors before a
candidate exists are reported by `unittest` on stderr.

Deterministic checks reject empty graphs, unknown paper IDs, invalid connections,
missing notes, and mode fallback. Astra handles semantic correctness. Missing
criteria, incomplete judge responses, refusals, malformed output, or API errors
fail rather than count as passes. Inspect the criterion reasons before changing
prompts or rubrics. A single model-judged run is a baseline, not a reliability
estimate. The earlier suite's 7/8 result does **not** apply to this replacement.

Primary references are linked alongside each fixture in `lineage_reference.json`.
API references: [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
