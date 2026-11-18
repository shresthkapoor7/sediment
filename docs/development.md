# Development

Everything you need to run, configure and test Sediment. For what the pieces do, see [architecture.md](architecture.md).

## Repository

```
sediment/
├── frontend/   Next.js app (Vercel)
├── backend/    FastAPI app (Railway)
├── supabase/   Database migrations
└── docs/       These docs
```

## Running locally

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Generate `ACTOR_KEY_SECRET` once and keep it stable across restarts and deployments:

```bash
openssl rand -hex 32
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database

Apply the migrations in `supabase/migrations` to your Supabase project, in order.

## Environment variables

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | Backend URL (defaults to `http://127.0.0.1:8000`) |
| `NEXT_PUBLIC_USE_API_PROXY` | No | `true` routes expensive API calls through Next.js server-side proxy handlers |
| `NEXT_PUBLIC_APP_VERSION` | No | App version string (defaults to `0.1.0`) |

With `NEXT_PUBLIC_USE_API_PROXY=true`, set one of these server-only variables as the proxy target: `BACKEND_INTERNAL_URL` or `RAILWAY_API_URL`.

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ACTOR_KEY_SECRET` | Yes | Server-only secret used to hash caller IPs into anonymous usage buckets |
| `TRUST_RAILWAY_PROXY_HEADERS` | No | `true` on Railway, so client IPs come from Railway's proxy headers |
| `TRUSTED_PROXY_CIDRS` | No | Proxy CIDRs allowed to supply client IP headers (defaults to `100.0.0.0/8`) |
| `OPENALEX_API_KEY` | No | OpenAlex API key |
| `OPENALEX_MAILTO` | No | Contact email for OpenAlex |
| `LLM_MODEL` | No | Claude model ID (defaults to `claude-haiku-5-5`) |

Limits are set in `backend/app/config.py`: `daily_usage_limit_usd` (spend per anonymous user per day), `agent_turn_budget_usd` (spend per agent message), `agent_max_iterations` (tool rounds per message) and `full_paper_access_enabled` (full-text reading, off for now).

## Privacy and usage limits

- Expensive routes are limited per anonymous user: a daily spend cap and a short-window burst limit.
- The anonymous key is an HMAC of the caller's IP with a server-only secret. Only the derived key is stored, never the raw IP.
- This is for cost control and abuse prevention, not identity or tracking.
- Feed chats are not stored. Canvas chats are stored with the canvas they belong to.

## Tests

```bash
# the same commands CI runs (.github/workflows/test.yml)
cd backend && PYTHONPATH=. python -m unittest discover -s tests
cd frontend && npm run lint && npm run build
```

## Evaluations

The model evaluations in `backend/evaluation` were written for the earlier lineage-tracing mode and are kept for reference. Paid suites are skipped unless explicitly enabled.

| Suite | Enable with |
|---|---|
| [Canonical API evals](../backend/evaluation/e2e/README.md) | `RUN_E2E_EVALS=1` |
| [Custom-judge evals](../backend/evaluation/README.md) | `RUN_LLM_EVALS=1` |
| [Mathematics evals](../backend/evaluation/ragas_math/README.md) | `RUN_RAGAS_EVALS=1` |
| [Retrieval evaluation](../backend/scripts/evaluate_retrieval.py) | Needs indexed papers, Supabase and Voyage |
