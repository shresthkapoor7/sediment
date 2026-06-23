-- Paper RAG storage, retrieval, and persistent chat foundation.

create table if not exists public.paper_documents (
  id uuid primary key default gen_random_uuid(),
  openalex_id text not null,
  doi text,
  source_type text not null,
  source_url text,
  license text,
  access_status text not null default 'unknown'
    check (access_status in ('unknown', 'available', 'unavailable', 'failed')),
  ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending', 'fetching', 'parsing', 'embedding', 'ready', 'failed')),
  checksum text,
  parser text,
  parser_version text,
  embedding_model text,
  embedding_dimensions integer
    check (embedding_dimensions is null or embedding_dimensions > 0),
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists paper_documents_source_checksum_key
  on public.paper_documents (openalex_id, source_type, checksum)
  where checksum is not null;

create index if not exists paper_documents_openalex_status_idx
  on public.paper_documents (openalex_id, ingestion_status, created_at desc);

alter table public.paper_documents enable row level security;

drop trigger if exists set_paper_documents_updated_at on public.paper_documents;
create trigger set_paper_documents_updated_at
before update on public.paper_documents
for each row execute function public.set_updated_at();

alter table public.paper_chunks
  add column if not exists document_id uuid references public.paper_documents(id) on delete cascade,
  add column if not exists section text,
  add column if not exists section_type text,
  add column if not exists page_start integer,
  add column if not exists page_end integer,
  add column if not exists token_count integer,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from public.paper_chunks
    where embedding is not null and vector_dims(embedding) <> 1024
  ) then
    raise exception 'Cannot migrate paper_chunks.embedding to vector(1024): incompatible embeddings exist';
  end if;
end
$$;

alter table public.paper_chunks
  alter column embedding type vector(1024) using embedding::vector(1024);

create unique index if not exists paper_chunks_document_chunk_key
  on public.paper_chunks (document_id, chunk_index)
  where document_id is not null;

create index if not exists paper_chunks_openalex_id_idx
  on public.paper_chunks (openalex_id);

create index if not exists paper_chunks_embedding_hnsw_idx
  on public.paper_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

alter table public.chat_sessions
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists scope text not null default 'paper',
  add column if not exists summary text,
  add column if not exists updated_at timestamptz not null default now();

update public.chat_sessions s
set user_id = g.user_id
from public.graphs g
where g.id = s.graph_id and s.user_id is null;

alter table public.chat_sessions
  alter column user_id set not null,
  alter column paper_openalex_id drop not null,
  drop constraint if exists chat_sessions_scope_check,
  add constraint chat_sessions_scope_check
    check (
      (scope = 'graph' and paper_openalex_id is null)
      or (scope = 'paper' and paper_openalex_id is not null)
    );

create unique index if not exists chat_sessions_graph_scope_key
  on public.chat_sessions (graph_id)
  where scope = 'graph';

create unique index if not exists chat_sessions_paper_scope_key
  on public.chat_sessions (graph_id, paper_openalex_id)
  where scope = 'paper';

create index if not exists chat_sessions_owner_idx
  on public.chat_sessions (user_id, graph_id);

drop trigger if exists set_chat_sessions_updated_at on public.chat_sessions;
create trigger set_chat_sessions_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at();

alter table public.chat_messages
  add column if not exists sequence_number bigint,
  add column if not exists citations jsonb;

with numbered as (
  select id, row_number() over (partition by session_id order by created_at, id) as sequence_number
  from public.chat_messages
  where sequence_number is null
)
update public.chat_messages m
set sequence_number = numbered.sequence_number
from numbered
where m.id = numbered.id;

alter table public.chat_messages
  alter column sequence_number set not null;

create unique index if not exists chat_messages_session_sequence_key
  on public.chat_messages (session_id, sequence_number);

create or replace function public.search_paper_chunks(
  p_query_embedding vector(1024),
  p_openalex_id text,
  p_match_count integer default 20,
  p_min_similarity real default 0,
  p_embedding_model text default 'voyage-4'
)
returns table (
  chunk_id uuid,
  document_id uuid,
  openalex_id text,
  chunk_index integer,
  content text,
  section text,
  section_type text,
  page_start integer,
  page_end integer,
  token_count integer,
  metadata jsonb,
  similarity double precision,
  source_type text,
  source_url text,
  license text
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    c.openalex_id,
    c.chunk_index,
    c.content,
    c.section,
    c.section_type,
    c.page_start,
    c.page_end,
    c.token_count,
    c.metadata,
    1 - (c.embedding operator(public.<=>) p_query_embedding) as similarity,
    d.source_type,
    d.source_url,
    d.license
  from public.paper_chunks c
  join public.paper_documents d on d.id = c.document_id
  where c.openalex_id = p_openalex_id
    and c.embedding is not null
    and d.ingestion_status = 'ready'
    and d.embedding_model = p_embedding_model
    and d.embedding_dimensions = 1024
    and 1 - (c.embedding operator(public.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding operator(public.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

create or replace function public.search_graph_paper_chunks(
  p_query_embedding vector(1024),
  p_openalex_ids text[],
  p_match_count integer default 20,
  p_min_similarity real default 0,
  p_embedding_model text default 'voyage-4'
)
returns table (
  chunk_id uuid,
  document_id uuid,
  openalex_id text,
  chunk_index integer,
  content text,
  section text,
  section_type text,
  page_start integer,
  page_end integer,
  token_count integer,
  metadata jsonb,
  similarity double precision,
  source_type text,
  source_url text,
  license text
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    c.openalex_id,
    c.chunk_index,
    c.content,
    c.section,
    c.section_type,
    c.page_start,
    c.page_end,
    c.token_count,
    c.metadata,
    1 - (c.embedding operator(public.<=>) p_query_embedding) as similarity,
    d.source_type,
    d.source_url,
    d.license
  from public.paper_chunks c
  join public.paper_documents d on d.id = c.document_id
  where c.openalex_id = any(p_openalex_ids)
    and c.embedding is not null
    and d.ingestion_status = 'ready'
    and d.embedding_model = p_embedding_model
    and d.embedding_dimensions = 1024
    and 1 - (c.embedding operator(public.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding operator(public.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

revoke all on function public.search_paper_chunks(vector, text, integer, real, text) from public;
revoke all on function public.search_graph_paper_chunks(vector, text[], integer, real, text) from public;
grant execute on function public.search_paper_chunks(vector, text, integer, real, text) to service_role;
grant execute on function public.search_graph_paper_chunks(vector, text[], integer, real, text) to service_role;
