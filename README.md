# Sediment

[![Sediment](home.jpg)](https://sediment-seven.vercel.app)

> Trace any research concept back through time. Knowledge, layered.

Sediment is an agentic research lineage explorer, built to be the 'cursor for academic research.' Enter any concept or paper, and sediment recursively compiles its intellectual ancestry: mapping the exact theoretical dependencies, seminal citations, and core breakthroughs that made it possible, rendered as an interactive, chronological graph you can deep-trace and expand.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js on Vercel | `frontend/` |
| Backend | FastAPI on Railway | `backend/` |
| Database | Supabase (hosted Postgres) | Tree state persistence |
| Graph Data | OpenAlex | Public paper graph: search, metadata, references |
| Agent | Claude | Seed selection, ranking, summaries, chat |
| Canvas | SVG in React | Hand-rolled, no React Flow |
| Export | Markdown serializer | Obsidian-ready |

## Repo Structure

```
sediment/
├── frontend/        # Next.js app (deployed to Vercel)
├── backend/         # FastAPI app (deployed to Railway)
└── README.md
```

## Features

- **Concept → Timeline** — backend fetches OpenAlex graph data, ranks lineage with Claude, renders left-to-right chronological map
- **Click to branch** — drill into any node, a new parallel lane expands in place
- **Obsidian export** — full tree as wikilinked markdown, frontmatter per paper
- **Shareable URLs** — no login, tree state persisted via Supabase short ID
- **Anonymous usage cap** — backend enforces a daily spend limit and burst limit using hashed anonymous actor keys instead of storing raw caller IPs

## Security And Privacy Notes

- Sediment currently uses a server-derived anonymous actor key for usage limits on expensive API routes.
- That actor key is derived from the caller's IP address using a server-only HMAC secret.
- The usage limiter stores the derived actor key, not the raw IP address, for daily budget and burst-limit enforcement.
- This is intended for abuse prevention and cost control, not account-level identity or behavioral profiling.

## Environment Variables

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | Backend URL (defaults to `http://127.0.0.1:8000`) |
| `NEXT_PUBLIC_USE_API_PROXY` | No | Set to `true` to route expensive API calls through Next.js server-side proxy handlers instead of calling the backend directly |
| `NEXT_PUBLIC_APP_VERSION` | No | App version string (defaults to `0.1.0`) |

When `NEXT_PUBLIC_USE_API_PROXY=true`, configure one of these server-only frontend env vars for the proxy target:

- `BACKEND_INTERNAL_URL`
- `RAILWAY_API_URL`

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ACTOR_KEY_SECRET` | Yes | Server-only secret used to HMAC-hash caller IPs into anonymous usage buckets for rate limiting and daily spend caps |
| `TRUST_RAILWAY_PROXY_HEADERS` | No | Set to `true` on Railway so the backend uses Railway-provided client IP headers instead of the proxy peer IP |
| `TRUSTED_PROXY_CIDRS` | No | Comma-separated proxy CIDRs allowed to supply trusted client IP headers. Defaults to `100.0.0.0/8` for Railway-style proxy networks |
| `OPENALEX_API_KEY` | No | OpenAlex API key (polite pool, optional) |
| `OPENALEX_MAILTO` | No | Email for OpenAlex polite pool |
| `LLM_MODEL` | No | Claude model ID (defaults to `claude-haiku-4-5-20251001`) |

## Running Locally

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Generate `ACTOR_KEY_SECRET` once and keep it stable across restarts and deployments:

```bash
openssl rand -hex 32
```
