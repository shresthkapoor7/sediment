# Mathematics lineage evaluation with Ragas

This separate suite adds **six cases** without changing the existing eight
Astra-rubric evals. Each mathematics topic runs the real `trace_lineage` pipeline
in standard and deep modes, producing the final graph, summaries, and canvas notes:

| Topic | Mathematical failure modes |
|---|---|
| FISTA / accelerated proximal methods | Confusing objective-error rates with quadratic iterate convergence; omitting convexity assumptions |
| ADMM / operator splitting | Crediting a review with invention; claiming unconditional nonconvex convergence; mixing up splitting and multiplier antecedents |
| Compressed sensing | Dropping sparsity or sampling conditions; confusing sparse representation with reconstruction; claiming noisy exact recovery without conditions |

`cases.json` holds curated paper descriptions, explicit reference lists, primary
source URLs and section/reference locators, required foundations, and evaluation
expectations. Source paragraphs are paraphrases, not full paper text. Journal,
conference, and preprint year variations are not mathematical errors.

## Why these Ragas metrics

The suite uses Ragas 0.4.3's actual `Faithfulness` and
`RubricsScoreWithReference` implementations with `gpt-6-astra` through Ragas's
`llm_factory` and Instructor/OpenAI Chat Completions adapter. Claude remains the
system under test. No embedding model, dataset generation, or hosted Ragas service
is involved.

- **Faithfulness (0–1):** Ragas extracts atomic claims from generated summaries
  and notes, then tests their support in the source-backed reference contexts.
  Copied abstracts, tool logs, bibliography-only metadata, and the generic
  standard seed label are excluded from the answer being scored.
- **Mathematics rubric (1–5):** Ragas scores the final graph and notes for
  correct foundations, mathematical qualifications, historical attribution,
  explanatory value, and connections to the papers actually discussed.
  Material mathematical errors cap the rubric at 2; material evidence gaps or
  missing note connections cap it at 3.

Pass requires **faithfulness >= 0.90 AND rubric >= 4**, plus structural checks.
These are initial regression thresholds, not calibrated scientific accuracy
claims. Scores are not directly comparable to the older suite's binary criteria.

The `retrieved_contexts` input to Faithfulness is explicitly the fixed **gold
reference context**, not a measurement of live retrieval quality. Expected
selections and the grading reference are withheld from Claude. Its tools receive
paper metadata and short scientific descriptions. The fixed OpenAlex adapter
returns the same candidate pool, including a distractor, for each search and
records the queries; reference lookups return curated lists. This tests synthesis
and notes, not search recall or comprehensive coverage of mathematics literature.

A low faithfulness verdict means a claim is unsupported by this evidence; it need
not be universally false. Inspect saved claim-level reasons and source context
before calling an answer incorrect. Do not automatically add candidate claims
to the reference to improve scores.

## Isolated setup

From `backend/`, use Python 3.11+ and a separate environment:

```bash
python3.11 -m venv .venv-ragas
.venv-ragas/bin/python -m pip install -r evaluation/requirements-ragas.txt
```

The optional requirements include only the dependencies needed to import the
lineage service and run Ragas. They do not change production requirements or the
existing backend environment. Ragas 0.4.3's unconstrained dependencies currently
resolve to a LangChain Community version that removes a module Ragas imports;
the requirements pin the compatible versions checked during implementation.

Use the existing `backend/.env` or shell environment:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
# Optional; otherwise uses the application default.
LLM_MODEL=claude-haiku-4-5-20251001
```

No OpenAlex, Supabase, or Ragas account credentials are needed. Usage persistence
is mocked; provider charges still apply. Ragas telemetry is disabled before import.

## Commands

Discover only the new suite with no paid calls:

```bash
.venv-ragas/bin/python -m unittest discover -s evaluation -p 'test_ragas_math.py' -v
```

All six skip unless `RUN_RAGAS_EVALS=1` is in the process environment. This flag
is independent of the original suite's `RUN_LLM_EVALS` flag and must not be set
only in `.env`.

Run one case:

```bash
RUN_RAGAS_EVALS=1 .venv-ragas/bin/python -m unittest evaluation.test_ragas_math.RagasMathEvals.test_fista_standard -v
```

Run all six, saving outputs:

```bash
RUN_RAGAS_EVALS=1 .venv-ragas/bin/python -m unittest discover -s evaluation -p 'test_ragas_math.py' -v > /tmp/sediment-ragas-math.jsonl
```

Add `-f` to stop at the first failure. The original suite remains available with
its original commands and flag.

## Spend limits and output

Runs are sequential. Each standard case allows at most 4 Claude calls, each deep
case at most 10 (including fallback). Every scored case normally makes 3 Astra
calls: claim extraction, entailment judgments, and rubric scoring. The complete
suite is capped at **42 Claude calls and 18 Astra calls**. OpenAI and Anthropic
SDK retries are disabled; Instructor is limited to one total attempt.

Target calls use 90-second client timeouts and production output-token limits.
Each trace has a 360-second overall timeout. Judge calls have 120-second client
timeouts and 4,096 completion-token limits, with outer metric timeouts. These are
per-call and execution bounds, not a dollar budget. Deep-mode fallback, hidden
target API/budget errors, invalid IDs/connections, or absent notes fail the case.
NaN scores, incomplete/reordered NLI judgments, and invalid verdicts also fail.

Stdout contains JSONL events:

- `candidate`: full graph, catalog calls, target usage/counts, model, fixture hash.
- `metric`: faithfulness score and extracted claims with support verdicts/reasons.
- `judgment`: both scores, rubric feedback, judge usage/counts, and thresholds.

Judge steps appear in both metric and judgment records; do not count them twice.
`unittest` failures and setup/API errors go to stderr. No API keys are logged.
These files include generated text; review before sharing.

Implementation checks exercised all six production paths through real Ragas,
Instructor, and the OpenAI SDK with synthetic HTTP responses and blocked network
connections. Low-score rejection and missing-claim rejection were also checked.
This validates plumbing, not model quality. No paid run of this suite has been made.

Ragas references: [Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)
and [reference-based rubrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/rubrics_based/).
