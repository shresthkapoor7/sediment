# Personalized feeds

`/feeds` starts empty. A server-issued signed bearer credential owns the browser's saved interests and feed snapshot in Supabase. The server derives the UUID database key from its validated credential. Returning visits read that snapshot without querying paper providers. The credential is retained in localStorage with a stable in-memory fallback when storage is blocked. Clearing storage or losing that in-memory session creates a different identity. This is an authenticated anonymous session, not an account or cross-device sync. Legacy UUID-only feed rows remain untouched but cannot be auto-claimed securely by a new session.

## Setup

Apply the repository's earlier migrations, then [20260928000000_add_personal_feeds.sql](../supabase/migrations/20260928000000_add_personal_feeds.sql) through your normal Supabase migration process or SQL editor. The migration creates the feed tables and service-role-only RPCs. A service role API key cannot execute database migrations; application credentials alone do not install the schema.

The backend uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACTOR_KEY_SECRET`, and `OPENALEX_API_KEY` configuration. Keep `ACTOR_KEY_SECRET` consistent across workers and deployments: it signs feed session credentials and pagination cursors. Credentials expire after 180 days. No Hugging Face token, arXiv token, LLM key, or image generation service is used by feeds.

The frontend follows the existing `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_USE_API_PROXY` configuration. When proxying, configure `BACKEND_INTERNAL_URL` or `RAILWAY_API_URL` on the Next.js server. The feed proxy declares a 180-second maximum duration; the hosting plan and any reverse proxy must support the backend's 165-second update timeout. Direct API calls use the backend's existing CORS configuration.

## Requests and behavior

| Request | Behavior |
| --- | --- |
| `POST /api/feed-session` | Issue a new signed anonymous bearer credential; no client-chosen identity. |
| `GET /api/feeds` | Restore interests and the first balanced page (up to 10 papers per source); no external search. |
| `POST /api/feeds` with `action: "interests"`, `interests` | Validate up to three topics, search recent metadata, persist a new feed revision, return up to 10 papers per source. |
| `POST /api/feeds` with `action: "refresh"` | Search the saved interests and replace the revision, retaining earlier matches behind new discoveries. |
| `POST /api/feeds` with `action: "source"`, `source` | Select a domain source; return up to 10 matches, fetching that provider when needed. `all` returns a balanced page of up to 10 papers per source and fills missing source results. |
| `POST /api/feeds` with `action: "more"`, `cursor`, `source` | Continue the selected source view; return up to 10 additional papers for a source, or up to 10 per source for `all`. `source` defaults to `all`. |

All private feed reads and mutations require `Authorization: Bearer <credential>`. UUID selectors are rejected. The frontend explicitly omits cookies; the backend never uses cookies for feed authentication, and the Next.js feed proxy forwards only the explicit Authorization header. Cookie-only cross-site requests cannot authorize mutations. Credential and feed responses use `Cache-Control: no-store`.

Responses contain `interests`, `queries`, `papers`, `cursor`, `refreshedAt`, `warnings`, `revision`, and `source`. Cursors are opaque and signed for the server-derived actor, revision, and source. Source cursors cannot be used in other source views. A changed revision returns HTTP 409; reload before continuing. Each source has a stable ordered view within the snapshot, including papers whose source membership is discovered later. Existing snapshots gain these views on demand without a database migration. Switching tabs reads the current server snapshot so newly fetched papers appear in All papers. Repeating a cursor is safe. The client also merges repeated responses by paper ID.

Interest planning uses local tokenization and a few acronym expansions, not an LLM. Commas, semicolons, newlines, and “and” separate topics. Four or more topics are rejected rather than silently dropped. This is keyword matching, so broad plain-language interests can need refinement.

New searches cover the last 90 days by publication/submission date. Each update makes at most nine provider-page requests, with a time budget to leave room for persistence. Candidate pages contain up to 10 records each; **one frontend request can make several upstream requests**, while individual source tabs return at most 10 papers and All papers returns up to 10 papers per source. A feed snapshot is capped at 600 candidate slots. Sparse results or exhausted providers can return fewer than 12; use the cursor, not the result count, to determine whether more can be requested.

Candidates are sorted by date within each newly fetched batch. Earlier pages remain stable while loading more; this is not a globally date-sorted merge of every provider's entire catalogue. Refresh starts a new revision. Partial provider failures return available results with a warning. If every attempted provider fails, a new feed or refresh leaves the stored feed unchanged. Source selection and pagination keep cached matches visible with a warning, and failed streams remain retryable. A failed source is skipped for subsequent interests within the same update. There are no direct arXiv API calls or arXiv-specific request leases/cooldowns.

No cron, background ingestion, PDF downloads, or per-paper AI calls run. Identical provider queries share a 15-minute database cache across browsers. Repeated refreshes within 60 seconds reuse the current snapshot, and a refresh within the query-cache TTL may still reuse provider results. Manual refresh does not force cache invalidation. Expired query-cache rows are ignored, not automatically deleted; ordinary database maintenance can remove expired cache rows and unreferenced paper metadata as volume grows.

## Providers and future tools

The independent adapters live in [`backend/app/services/feed_sources`](../backend/app/services/feed_sources):

| Provider | Use | Continuation |
| --- | --- | --- |
| Hugging Face Papers | OpenAlex works filtered to primary source `S7407051994` and repository type | OpenAlex cursor pagination with field and date filters. |
| arXiv | OpenAlex works filtered by `primary_location.source.id:S4306400194`, with a verified arXiv identifier | OpenAlex cursor; canonical arXiv IDs and original arXiv links, with both arXiv and OpenAlex source labels. |
| OpenAlex | Broader research coverage and publication metadata | Provider cursor maintained server-side. |

Every adapter implements `search(SearchRequest) -> SearchPage` and `get(identifier) -> Paper | None`. These use Pydantic input/output models and raise sanitized `SourceError` failures. A future tool can validate arguments with `SearchRequest.model_validate`, call an adapter, and serialize via `model_dump(mode="json")`. Keep the provider-query cache when exposing tool calls: `FeedService.source_page` supplies that layer. The arXiv adapter uses OpenAlex for both search and identifier lookup; it never contacts the arXiv API. Do not expose arbitrary provider URLs or API keys to a model. The adapters are reusable; they are not yet registered in the chat agent's tool list.

The arXiv tab reflects OpenAlex’s index, so newly submitted papers can be delayed or absent and the displayed publication date is OpenAlex’s date, not necessarily the original submission date. Existing feed streams reset legacy arXiv offsets to OpenAlex cursors on their next update, preserving loaded papers, feed revisions, and client pagination. A separate cache namespace prevents reuse of legacy arXiv results. No schema migration is required.

All sources normalize into a common paper model. Deduplication uses normalized DOI, arXiv ID without revision suffix, and OpenAlex ID, followed by an exact normalized long title plus the full author list. Merging preserves source provenance and enriches metadata. When a later record links two previously separate identities, stable snapshot slots prevent cursor offsets from shifting. Missing or inconsistent provider identifiers can still prevent a match; titles alone are not treated as a unique database key.

## Images and saved papers

Fifty local SVG illustrations in [`frontend/public/feed-illustrations`](../frontend/public/feed-illustrations) are tagged in [`feed-illustrations.ts`](../frontend/src/lib/feed-illustrations.ts). Local matching weights topics, title, and abstract; a stable paper-ID hash selects among matching topic variants and leaves some cards text-only. These are decorative topic diagrams, identified as decorative in the feed footer, not figures or findings from the papers.

Previously cached Hugging Face thumbnails remain usable, with topic illustrations as fallback. New OpenAlex results use topic illustrations. Other providers do not trigger image extraction or paper downloads. Cards use measured masonry placement with variable heights and aligned column bottoms. Abstract previews use 3–9 lines and image areas adjust between 120–240px to balance the columns; titles remain complete and images use contain sizing. Layout is recalculated for resizing, loaded images, and additional papers, while DOM reading order stays in feed order.

Saved papers retain full metadata in browser localStorage (`sediment_feed_saved`), independently of feed topics, domains, and source tabs. Older ID-only bookmarks are restored from the cached paper-detail API; failed restorations retain their IDs and can be retried. Saves are browser-local, not synced across devices.

## Paper detail links

Feed cards open a centered dialog at a shareable root URL such as `/arxiv-2609.30258` or `/openalex-W7204949214`. The dialog shows the full stored abstract, authors, dates, topics, identifiers, available image, browser bookmark, and a link to the original paper. The browser tab title follows the paper title. Native history preserves the mounted feed and its scroll position when opening or closing; Back/Forward restores the overlay. Modified clicks can open the same link in a new tab.

Direct visits and reloads use a visible server-rendered page (not a hydration-dependent dialog) at the `[paperId]` route and `GET /api/feed-papers/{paper_id}`. This endpoint reads and merges public metadata from `feed_papers`; it does not read browser interests or call external paper providers or an LLM. Uncached papers return 404 from the API and use Next.js not-found handling on direct routes; storage failures show a retry state. Bookmark changes sync between cards and the overlay through the existing browser-local bookmark store. No new database migration is needed.

## Validation

From `backend/`, run:

```sh
venv/bin/python -m unittest discover -s tests -p 'test_feed*.py'
```

Coverage includes provider normalization, malformed upstream data, cross-source identity merging, cache sharing, empty-first behavior, refresh preservation, repeatable pagination, late identity bridges, stale/foreign cursors, update exclusion, and HTTP request validation.

Frontend validation uses TypeScript and ESLint. Browser checks cover empty/create/load-more, repeated-response deduplication, bookmarks, restore, edit cancellation, failed refreshes, stale-cursor recovery, and mobile overflow. Live provider smoke tests exercise metadata retrieval separately from database access. The migration has been executed against an isolated PostgreSQL-compatible test database to check lease exclusion, owned writes, and anonymous-access restrictions; the shared Supabase schema must still be installed using the setup step above.


### Research domains

The interests form saves `domain` with the browser's feed: `ai`, `biomed`,
`math_physics`, or `general` (the default for existing feeds). The API returns
`availableSources` to drive the source tabs. Domain changes rebuild the snapshot
and invalidate previous cursors; upstream caches include the domain.

- AI: arXiv, Hugging Face, Journals, OpenAlex; OpenAlex field 17.
- Biomed: bioRxiv, medRxiv, Journals, OpenAlex; fields 11, 13, 24, 27, 28, 30.
- Math/physics: arXiv, Journals, OpenAlex; fields 26 and 31.
- General: Repositories, Journals, OpenAlex; no field restriction.

OpenAlex requests combine `primary_topic.field.id` with the source filter.
Repository and journal views use `primary_location.source.type`. bioRxiv uses
`S4306402567`; medRxiv uses `S3005729997|S4306400573`, with repository type.
These IDs were checked against the OpenAlex Sources API. Papers retain OpenAlex
work IDs for existing detail links and deduplication. Hugging Face uses OpenAlex repository `S7407051994` and is included only in AI feeds.
Its adapter uses OpenAlex cursors and a separate cache namespace; existing native-API
streams restart on their next update while preserving loaded cards and bookmarks.

Reference: https://help.openalex.org/data/sources/

Live validation on 2026-10-03 found that the Hugging Face primary source contains
datasets, a conference abstract, and supplementary material, with no article,
preprint, or review records. The feed retains its paper-only type filter, so this
source currently returns no papers; it does not substitute datasets or call the
Hugging Face API as a fallback.


### All papers and the OpenAlex tab

All papers displays up to 10 papers per source (30 for three sources). Source
tabs page in groups of 10. The loaded snapshot retains the 600-paper safety cap. Initial discovery
and All-paper loading budget results per source so one prolific source cannot
satisfy the whole request on its own. Request/time limits still apply; unavailable
or exhausted sources need not contribute results.

OpenAlex is the remainder outside the domain's other visible source tabs. Queries
exclude those primary source IDs and journal/repository types, and stored records
are filtered by their memberships using the same domain rules. Provenance labels
still include OpenAlex when it supplied a record for another tab. A new OpenAlex
cache namespace and cursor version avoid continuing the previous unrestricted query.

All-paper cursors use a versioned, stable interleaved order. Per-source display
quotas also apply to old snapshots containing larger upstream batches. Load more
continues through those records without discarding overflow. Old unbalanced
cursors require a reload.
