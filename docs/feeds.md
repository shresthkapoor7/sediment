# Personalized feeds

`/feeds` starts empty. The browser's existing `sediment_user_id` UUID owns its saved interests and feed snapshot in Supabase. Returning visits read that snapshot without querying paper providers. Clearing browser storage creates a different identity; this is anonymous browser persistence, not an authenticated account or cross-device sync.

## Setup

Apply the repository's earlier migrations, then [20260928000000_add_personal_feeds.sql](../supabase/migrations/20260928000000_add_personal_feeds.sql) through your normal Supabase migration process or SQL editor. The migration creates the feed tables and service-role-only RPCs. A service role API key cannot execute database migrations; application credentials alone do not install the schema.

The backend uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACTOR_KEY_SECRET`, and `OPENALEX_API_KEY` configuration. Keep `ACTOR_KEY_SECRET` consistent across workers and deployments: it signs pagination cursors. No Hugging Face token, arXiv token, LLM key, or image generation service is used by feeds.

The frontend follows the existing `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_USE_API_PROXY` configuration. When proxying, configure `BACKEND_INTERNAL_URL` or `RAILWAY_API_URL` on the Next.js server. The feed proxy declares a 180-second maximum duration; the hosting plan and any reverse proxy must support the backend's 165-second update timeout. Direct API calls use the backend's existing CORS configuration.

## Requests and behavior

| Request | Behavior |
| --- | --- |
| `GET /api/feeds?userId=<uuid>` | Restore interests and the first 12 cached papers; no external search. |
| `POST /api/feeds` with `userId`, `action: "interests"`, `interests` | Validate up to three topics, search recent metadata, persist a new feed revision, return up to 12 papers. |
| `POST /api/feeds` with `userId`, `action: "refresh"` | Search the saved interests and replace the revision, retaining earlier matches behind new discoveries. |
| `POST /api/feeds` with `userId`, `action: "more"`, `cursor` | Consume buffered candidates or fetch provider continuation pages; return up to 12 additional unique papers. |

Responses contain `interests`, `queries`, `papers`, `cursor`, `refreshedAt`, `warnings`, and `revision`. Cursors are opaque and signed for a browser ID and revision. A changed revision returns HTTP 409; reload before continuing. Repeating a cursor is safe. The client also merges repeated responses by paper ID.

Interest planning uses local tokenization and a few acronym expansions, not an LLM. Commas, semicolons, newlines, and “and” separate topics. Four or more topics are rejected rather than silently dropped. This is keyword matching, so broad plain-language interests can need refinement.

New searches cover the last 90 days by publication/submission date. Each update makes at most nine provider-page requests, with a time budget to leave room for persistence. Candidate pages contain up to 24 records each; **one frontend request can make several upstream requests**, while returning no more than 12 papers. A feed snapshot is capped at 600 candidate slots. Sparse results or exhausted providers can return fewer than 12; use the cursor, not the result count, to determine whether more can be requested.

Candidates are sorted by date within each newly fetched batch. Earlier pages remain stable while loading more; this is not a globally date-sorted merge of every provider's entire catalogue. Refresh starts a new revision. Partial provider failures return available results with a warning. If every attempted provider fails, the stored feed remains unchanged.

No cron, background ingestion, PDF downloads, or per-paper AI calls run. Identical provider queries share a 15-minute database cache across browsers. Repeated refreshes within 60 seconds reuse the current snapshot, and a refresh within the query-cache TTL may still reuse provider results. Manual refresh does not force cache invalidation. Expired query-cache rows are ignored, not automatically deleted; ordinary database maintenance can remove expired cache rows and unreferenced paper metadata as volume grows.

## Providers and future tools

The independent adapters live in [`backend/app/services/feed_sources`](../backend/app/services/feed_sources):

| Provider | Use | Continuation |
| --- | --- | --- |
| Hugging Face Papers | Community-discovered papers, abstracts, and provider-hosted thumbnails | Search is bounded; no public pagination parameter is invented. |
| arXiv | Preprints across supported research categories, ordered by original submission | Offset maintained server-side; a database lease serializes feed calls across workers with a cooldown. |
| OpenAlex | Broader research coverage and publication metadata | Provider cursor maintained server-side. |

Every adapter implements `search(SearchRequest) -> SearchPage` and `get(identifier) -> Paper | None`. These use Pydantic input/output models and raise sanitized `SourceError` failures. A future tool can validate arguments with `SearchRequest.model_validate`, call an adapter, and serialize via `model_dump(mode="json")`. Keep the arXiv deployment-wide lease and provider-query cache when exposing tool calls: `FeedService.source_page` currently supplies that layer. Do not expose arbitrary provider URLs or API keys to a model. The adapters are reusable; they are not yet registered in the chat agent's tool list.

All three sources normalize into a common paper model. Deduplication uses normalized DOI, arXiv ID without revision suffix, and OpenAlex ID, followed by an exact normalized long title plus the full author list. Merging preserves source provenance and enriches metadata. When a later record links two previously separate identities, stable snapshot slots prevent cursor offsets from shifting. Missing or inconsistent provider identifiers can still prevent a match; titles alone are not treated as a unique database key.

## Images and saved papers

Twenty local SVG illustrations in [`frontend/public/feed-illustrations`](../frontend/public/feed-illustrations) are tagged in [`feed-illustrations.ts`](../frontend/src/lib/feed-illustrations.ts). Local matching weights topics, title, and abstract; a stable paper-ID hash selects ties and leaves some cards text-only. These are decorative topic diagrams, explicitly captioned as such, not figures or findings from the papers.

An approved Hugging Face thumbnail is used when available, then a topic illustration if loading fails. Other providers do not trigger image extraction or paper downloads. Cards use natural content heights in the existing masonry layout.

Bookmark IDs stay in browser storage. “Saved in this feed” filters the currently loaded papers; bookmarks are not a separate server-side reading library.

## Validation

From `backend/`, run:

```sh
venv/bin/python -m unittest discover -s tests -p 'test_feed*.py'
```

Coverage includes provider normalization, malformed upstream data, cross-source identity merging, cache sharing, empty-first behavior, refresh preservation, repeatable pagination, late identity bridges, stale/foreign cursors, update exclusion, and HTTP request validation.

Frontend validation uses TypeScript and ESLint. Browser checks cover empty/create/load-more, repeated-response deduplication, bookmarks, restore, edit cancellation, failed refreshes, stale-cursor recovery, and mobile overflow. Live provider smoke tests exercise metadata retrieval separately from database access. The migration has been executed against an isolated PostgreSQL-compatible test database to check lease exclusion, owned writes, and anonymous-access restrictions; the shared Supabase schema must still be installed using the setup step above.
