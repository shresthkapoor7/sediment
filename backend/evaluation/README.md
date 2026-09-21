# LLM-as-judge evals

Eight fixed cases exercise the real `LLMClient` methods against Anthropic, then
have OpenAI `gpt-6-astra` grade the results. This uses the backend's existing
`unittest` framework and `aiohttp` dependency: no additional eval platform,
SDK dependency, or hosted dataset is needed for this small suite. Production
prompts and response parsing are reused rather than copied into the evaluator.

The scope is service-level output quality. These cases do not cover HTTP routes,
live retrieval, the agent tool loop, or database persistence. Paper IDs prefixed
with `fixture:` are local labels, never fetched. Only usage persistence is mocked
so the suite does not write to Supabase or consume application usage quotas.
Provider charges still apply.

## Setup and execution

Use the backend environment with `requirements.txt` installed. Put these in
`backend/.env` (ignored by Git), or export them in your shell:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
# Optional: uses the application's default Claude model when omitted.
LLM_MODEL=claude-haiku-4-5-20251001
```

Both keys are needed: Claude is the system under test; Astra is the judge.
The OpenAI project must have access to `gpt-6-astra`. The judge model is fixed in
`test_llm_judge.py`; there is no fallback to another model. No running backend,
OpenAlex key, or Supabase credentials are required.

From `backend/`, first discover all cases without making API calls:

```bash
python -m unittest discover -s evaluation -p 'test_llm_judge.py' -v
```

All eight should be skipped. To run one paid case:

```bash
RUN_LLM_EVALS=1 python -m unittest evaluation.test_llm_judge.LLMJudgeEvals.test_01_preserve_paper_title -v
```

To run the suite, stopping at the first failure or API error:

```bash
RUN_LLM_EVALS=1 python -m unittest discover -s evaluation -p 'test_llm_judge.py' -v -f
```

The opt-in flag must be set in the process environment, not just `.env`.
A complete run makes 8 target calls and 8 judge calls, sequentially, with no
retries. Target calls allow up to 1,024 output tokens each and a 90-second client
timeout; judge calls allow up to 4,096 output tokens each and a 120-second total
timeout. These are per-call bounds, not a dollar budget.

## Reading results

Each case supplies explicit criteria instead of matching exact answer wording.
Astra returns a strict JSON verdict with a reason for each criterion. Every
criterion must pass; missing/reordered criteria, incomplete output, refusals,
invalid JSON, and API failures fail the test rather than count as a pass.

The runner prints one JSON report per judged case to stdout, including the
candidate, criterion verdicts, model IDs, judge token usage, and response ID.
`unittest` progress goes to stderr. To save reports, redirect stdout to a local
file, for example `/tmp/sediment-evals.jsonl`. Reports contain fixture inputs'
resulting answers, so review them before sharing. Judge requests use `store=false`.

These are model judgments, not deterministic proof. Review the reasons before
changing prompts or criteria; keep fixtures stable when comparing revisions.
The suite has not been run against live APIs as part of its implementation.
Only syntax, fixture/signature consistency, and skipped discovery were checked.

API references: [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
