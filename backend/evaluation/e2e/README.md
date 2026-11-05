# Local lineage evaluation: capture once, inspect and judge later

This is the main suite for **faithfulness, recall, and scientific correctness**.
It is manually invoked locally, never scheduled or added to pull-request CI.
The default local profile runs these 30 scientific cases plus three functional
clarification regressions. Historical eight-case and six-case suites remain separate.

Each topic has five independently reported cases:

| Topic | Standard search | Deep search | Clarify → search | Selected seed → deep | Expand paper |
|---|---|---|---|---|---|
| Transformer | ✓ | ✓ | ✓ | ✓ | ✓ |
| Retrieval-augmented generation | ✓ | ✓ | ✓ | ✓ | ✓ |
| ResNet | ✓ | ✓ | ✓ | ✓ | ✓ |
| FISTA | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADMM | ✓ | ✓ | ✓ | ✓ | ✓ |
| Compressed sensing | ✓ | ✓ | ✓ | ✓ | ✓ |

The manifest is `cases.json`. Gold papers and source-backed scientific expectations
reuse the existing AI/math catalogs. `dataset.py` adds three core reference facts
per topic. Gold aliases never enter live app inputs. Selected-seed and expansion
cases resolve a canonical paper through OpenAlex, then send its real ID to the API.
That preparatory lookup is excluded from recall: the app must retrieve evidence itself.
Clarification cases use an unambiguous paper title and then follow its refined query.

The suite sends HTTP requests through the **full production FastAPI app** using
ASGITransport: validation, middleware, routes, real OpenAlex retrieval, Claude
orchestration, graph construction, and response serialization. It covers the
backend lineage experience, including notes; it does **not** cover browser rendering,
chat, document ingestion, database persistence, or deployment/network infrastructure.
Only usage quotas and usage database writes are replaced. No server or database is
needed. Application code and prompts are unchanged. Expansion does not generate notes
in production, so notes are explicitly N/A for its six cases.

## Which measurements belong where?

| Measurement | Implementation | Evidence / denominator | Pass threshold |
|---|---|---|---|
| Retrieval paper recall | Manual, exact normalized titles | Required foundations actually returned to the app / two required foundations | 1.0 |
| Final lineage paper recall | Manual | Required foundations in the returned graph / two required foundations | 1.0 |
| Note foundation recall | Manual | Required foundations linked to final notes / two required foundations; expansion N/A | 1.0 |
| Verified-edge precision | Manual | Direct-reference edges supported by actual OpenAlex references / claimed direct-reference edges | 1.0 when applicable |
| Generation faithfulness | Ragas `Faithfulness`, Astra | Supported generated claims / extracted claims, separately for each scientific generation stage | ≥ 0.90 for **every** stage |
| Retrieved-context recall | Batched atomic-fact verdicts, Astra | Support for each of three gold facts in the app's actual retrieved evidence; mean across the three | 1.0 |
| Scientific correctness and usefulness | Ragas `RubricsScoreWithReference`, Astra | Final summaries, edges and notes against independent scientific expectations and source evidence | ≥ 4/5 |

Manual checks also require the correct seed, valid IDs and note connections,
connected graph, correct roots, nonempty relationships, and the requested trace mode.
A selected seed must preserve its exact ID. Inferred edges are reported separately;
they are not silently counted as verified citations. Causal interpretations in prose
are subject to faithfulness and correctness judgments. Link coverage alone does not
establish that a note is useful: the scientific rubric judges what it actually says.

**Faithfulness never receives the gold catalog as its context.** The recorder observes
exact outbound Anthropic requests before the client mutates its conversation:

- Ranking: the seed metadata and candidate fields actually in the ranking prompt.
- Notes: the truncated paper summaries and graph edges actually in the note prompt.
- Deep trace: successful OpenAlex tool results and any selected-seed evidence actually
  present before final generation. Assistant claims and failed tool results are excluded.

Each stage's output is judged separately. This prevents good paper summaries from
hiding unfaithful notes in an average. The final independent correctness rubric can
reject notes that faithfully repeat an upstream scientific error. Additional papers
outside the curated answer key may be supported by actual retrieved evidence; they
are not automatically wrong. Gold evidence takes precedence on known contradictions.

Context recall measures the evidence retrieved by the backend, including evidence
not selected into the final prompt. Final paper recall measures what survived into
the lineage. For recall/correctness judging, duplicate abstract/detail text is removed and raw
reference-ID lists are omitted (citation edges are checked deterministically). All
distinct scientific prose remains; the unmodified retrieval is saved separately.
A single structured judge request returns an ordered binary verdict and reason
for every one of the three atomic facts. Missing, duplicate or reordered IDs fail
validation; all three facts stay in the denominator. This `batched_atomic_facts_v1`
metric is versioned and is not numerically identical to the historical Ragas
per-fact statement decomposition. Keep the distinction when comparing old scores. This is not exhaustive
recall of the entire field. Title matching tolerates punctuation, capitalization and
Unicode differences, but not arbitrary alternate titles; inspect missing-paper reports
for bibliographic variants before changing gold. No fuzzy-title judge can silently
rescue a missing paper.

These are strict initial regression thresholds, not calibrated accuracy claims.
OpenAlex coverage changes and its abstracts may not support all expected facts.
A low context score is an evidence gap; a low faithfulness score means unsupported
by that stage's input, not necessarily universally false. Inspect saved reasons.

## Setup and commands

From `backend/`, use Python 3.11+ and the isolated optional dependencies:

```bash
python3.11 -m venv .venv-ragas
.venv-ragas/bin/python -m pip install -r evaluation/requirements-ragas.txt
```

Use your existing `backend/.env` for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
OpenAlex configuration (`OPENALEX_API_KEY`, optional `OPENALEX_MAILTO`). This suite
uses live OpenAlex, unlike the historical fixture suites. Claude uses the app's
`LLM_MODEL`; the judge is fixed to `gpt-6-astra` with no fallback. The OpenAI project
must have access. Ragas telemetry is disabled. No embeddings or hosted Ragas account.

Discover exactly 30 cases without making calls (all skip by default):

```bash
.venv-ragas/bin/python -m unittest discover -s evaluation/e2e -p test_suite.py -v
```

Check all 30 workflows and failure handling with the network blocked, no API spend:

```bash
.venv-ragas/bin/python -m evaluation.e2e.check_offline
```

## Local workflow

All commands below run from `backend/`. **Without `--live`, the runner only prints
a plan and makes no provider calls.** Do not put these commands in CI.

```bash
# See the six-case smoke selection (all six topics and five workflow types).
.venv-ragas/bin/python -m evaluation.e2e.run generate --profile smoke

# Capture all 33 cases once. This spends Anthropic/OpenAlex funds, NOT OpenAI credit.
# $3 is a chosen cap, not a forecast; lower or raise it before starting as desired.
.venv-ragas/bin/python -m evaluation.e2e.run generate --live \
  --max-anthropic-usd 3 --out logs/evals/capture-oct08

# Judge those saved outputs; never reruns Claude or OpenAlex.
# For a $68.57 OpenAI balance, a $45 cap leaves $23.57 for targeted follow-up.
.venv-ragas/bin/python -m evaluation.e2e.run judge --live \
  --source logs/evals/capture-oct08 --max-openai-usd 45 \
  --out logs/evals/judge-oct08

# Render the run's selected-case report, not an assumed 30-case denominator.
.venv-ragas/bin/python -m evaluation.e2e.report logs/evals/judge-oct08/results.jsonl
```

Generation itself runs exact retrieval/graph checks and labels results `smoke_passed`
or `smoke_failed`, never scientific-quality passes. A nonzero exit from generation
can mean useful captured cases failed checks; inspect and judge the saved artifacts.
Judging defaults to diagnostic coverage even when recall or seed checks fail. Use
`--skip-invalid` to avoid spending on empty/wrong-seed/unresolved/fallback graphs.
Skipped and unjudged cases are explicitly reported and never counted as passes.
Generation/provider errors cannot be rescued by a judge.

Use `--cases fista_standard,rag_deep` to select exact cases, or `--profile regressions`
for only the three new functional cases. Those exercise all offered meaning-of-life
options and clarified `chain of thought llm` in quick/deep mode, including presence
of the foundational paper. They do not have curated scientific gold, so never invoke
an AI judge or claim scientific correctness.

Interrupted run? Repeat the command with `--resume RUN_DIRECTORY` instead of `--out`,
using the same selection and budgets. Completed cases are not repeated; captured
candidate graphs missing a final result are recovered without target calls. A case
interrupted before any complete graph was saved must restart, with unknown previous
spend still reserved. Terminal error/failed cases are not silently retried by resume.
For explicit follow-up, select them in a new run with its own budget.

Successful structured judge responses are cached in the source directory's
`judge-cache/`, keyed by model, prompt, system instructions, schema and token limit.
A new judge run against the same source can reuse these after a partial judging
failure. Cache hits have zero new judge calls, but still reconstruct metrics. Use
`--fresh-judges` only when intentionally paying for independent judgments. Changing
the scoring method or prompt changes the cache key. Invalid semantic judgments can
be investigated and then rerun with `--fresh-judges`.

Each run directory contains `manifest.json`, `results.jsonl`, `report.md` and `budget.json`.
Directories default to timestamped paths under gitignored `backend/logs/evals/`,
not temporary OS storage. Back them up if needed. The manifest records the selected
cases, dataset hash, application/evaluation source fingerprint, Git revision, package
versions, target model and source-artifact hash. Resume refuses changed code/config.
Generation requests retain tools, thinking, effort and token settings. Secrets and
request headers are excluded. These local artifacts may contain your prompts and
paper evidence; they are not automatically uploaded or committed.

The old direct paid unittest entrypoint now directs you to this budgeted runner.
Offline discovery and `check_offline` remain available without credentials/spend.

## Spend control

OpenAI and Anthropic have independent, explicit USD caps because credit balances
are provider-specific. Before each call the runner reserves a conservative text
input estimate (serialized UTF-8 bytes plus framing allowance) and the full output
cap. It replaces the reservation with usage-based estimated cost after a response.
Timeouts, cancellations and missing usage keep the full reservation. Reservations
are saved before dispatch and survive resume; concurrent use of one run is locked.
If a usage-based cost exceeds its reservation, further calls are blocked.

This is a **local estimated-spend guard**, not a provider-enforced billing guarantee
or a measurement of your account balance. Token overhead and provider pricing can
change; use provider-side limits too if available. OpenAlex calls are counted and
bounded separately; their fees are not deducted from either LLM budget. Failed
requests may be billed even if no response usage arrives.

Rates verified 2026-10-08, standard service only:
[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) and
[Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
The guard refuses unknown models until pricing is added. Astra uses $10/$50 per
million input/output tokens, $1 cached input; above 272K input, input/cache double
and output is $75. Haiku uses $0.10/$0.50 up to 100K prompt tokens, $0.50/$2.50 above,
including cached prompt tokens for tier selection; default five-minute writes are
1.25x input and reads 0.1x. Account discounts/taxes are not included.

## Bounds and diagnosis

Cases run sequentially with SDK retries disabled and one Instructor attempt.
Per case: Claude limits are 4 standard, 10 deep, 5 clarify, 10 selected-seed, 1 expand;
Astra has a hard limit of 14 calls; OpenAlex has a hard limit of 60 requests, including
seed resolution. The 30 scientific cases retain a ceiling of **180 Claude and 420 Astra
calls**, in addition to the run-wide spend guard. The three functional cases each
allow up to 21 Claude calls and no Astra calls (243 Claude maximum across all 33).
Typical scientific paths now use 4 or 6 Astra calls per case (144 total before cache
hits): two per faithful generation stage, one batched fact check, one correctness
rubric. Batching saves 60 judge calls across the 30 cases; actual dollar savings
depend on input, output and cached tokens. Output-token cap per Astra call is 4,096. Claude uses the
production limits. SDK timeouts: 90 seconds Claude, 120 seconds Astra; complete
backend workflow: 360 seconds; each judge metric also has an outer timeout.

Stdout is JSONL. `candidate` saves the graph and captured requests/retrieval before
judging. `result` saves status, missing papers, per-stage faithful claims/verdicts,
per-fact recall, correctness reasons, call counts and usage. Results retain partial
work if a judge fails. Count usage from `result` only, not both events. Setup failures
appear in unittest stderr and as missing cases in the report. Keys/headers are not
included in recorder output.

Provider errors, empty generations, invalid judge output, omitted NLI claims, and
hidden note/deep fallbacks cannot pass. Invalid/NaN scores do not become zeros or get
excluded from a success average. A report shows errors and unrun cases explicitly.
The offline checker exercises all 30 API flows with synthetic external responses,
plus negative controls for faithfulness, recall, correctness, missing foundations,
reversed citation edges, omitted NLI claims, and a provider failure masked by fallback.
It also checks context isolation and reporting. **Offline success proves wiring,
not model quality.** A prior paid run was reported in the development conversation,
but its temporary raw artifacts were not recovered. No paid quality run has yet
validated this revised runner; do not treat offline synthetic scores as results.

Metric definitions: [Ragas faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/),
[Ragas context recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/),
[reference rubrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/rubrics_based/).
