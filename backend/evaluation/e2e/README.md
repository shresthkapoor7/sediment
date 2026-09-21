# Canonical 30-case lineage evaluation

This is the main suite for **faithfulness, recall, and scientific correctness**.
It preserves the eight custom-judge tests and six earlier Ragas tests as separate
historical suites; the command below runs exactly these 30, not all 44.

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
| Retrieved-context recall | Ragas `ContextRecall`, Astra | Support for each of three gold facts in the app's actual retrieved evidence; mean across the three | 1.0 |
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
the lineage. ContextRecall runs **once per gold fact** to keep all three facts in the
denominator; within a fact, Ragas classifies its statements. This is not exhaustive
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

Run one paid case:

```bash
RUN_E2E_EVALS=1 .venv-ragas/bin/python -m unittest evaluation.e2e.test_suite.EndToEndEvals.test_fista_standard -v
```

Run the full paid suite and save inspectable output:

```bash
RUN_E2E_EVALS=1 .venv-ragas/bin/python -m unittest discover -s evaluation/e2e -p test_suite.py -v > /tmp/sediment-e2e.jsonl
.venv-ragas/bin/python -m evaluation.e2e.report /tmp/sediment-e2e.jsonl
```

The opt-in flag must be in the process environment, not only `.env`. Add `-f` to
stop after a failure, or `-k fista` to run that topic's five cases. Report exit status
is nonzero for failed, errored or missing cases. Reports from different runs cannot
be concatenated; each result carries a run ID and dataset/code hashes.

## Bounds and diagnosis

Cases run sequentially with SDK retries disabled and one Instructor attempt.
Per case: Claude limits are 4 standard, 10 deep, 5 clarify, 10 selected-seed, 1 expand;
Astra has a hard limit of 14 calls; OpenAlex has a hard limit of 60 requests, including
seed resolution. The full suite is therefore capped at **180 Claude and 420 Astra
calls**, not a dollar budget. Typical successful paths use 6 or 8 Astra calls per
case (204 total): two per faithful generation stage, three fact-recall checks,
one correctness rubric. Output-token cap per Astra call is 4,096. Claude uses the
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
not model quality.** This suite has not been run against paid providers yet.

Metric definitions: [Ragas faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/),
[Ragas context recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/),
[reference rubrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/rubrics_based/).
