-- Remove the superseded IVFFlat index and lock the shared trigger function's
-- name resolution. HNSW is the only vector index used by paper retrieval.

drop index if exists public.paper_chunks_embedding_idx;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
