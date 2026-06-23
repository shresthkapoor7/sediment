-- Retry-safe, idempotent document ingestion helpers.

alter table public.paper_documents
  add column if not exists chunk_count integer not null default 0
    check (chunk_count >= 0),
  add column if not exists ingestion_error text;

create or replace function public.prepare_paper_ingestion(
  p_openalex_id text,
  p_doi text,
  p_source_type text,
  p_source_url text,
  p_license text,
  p_checksum text,
  p_parser text,
  p_parser_version text,
  p_embedding_model text,
  p_embedding_dimensions integer
)
returns table (
  document_id uuid,
  ingestion_status text,
  chunk_count integer,
  is_claimed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  document public.paper_documents;
begin
  if p_checksum is null or length(p_checksum) <> 64 then
    raise exception 'Invalid document checksum' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_openalex_id || ':' || p_source_type || ':' || p_checksum, 0)
  );

  select d.* into document
  from public.paper_documents d
  where d.openalex_id = p_openalex_id
    and d.source_type = p_source_type
    and d.checksum = p_checksum;

  if found and document.ingestion_status = 'ready' then
    return query select document.id, document.ingestion_status, document.chunk_count, false;
    return;
  end if;

  if found
    and document.ingestion_status in ('fetching', 'parsing', 'embedding')
    and document.updated_at > pg_catalog.now() - interval '10 minutes' then
    return query select document.id, document.ingestion_status, document.chunk_count, false;
    return;
  end if;

  if found then
    delete from public.paper_chunks c where c.document_id = document.id;
    update public.paper_documents d
    set doi = p_doi,
        source_url = p_source_url,
        license = p_license,
        access_status = 'available',
        ingestion_status = 'parsing',
        ingestion_error = null,
        parser = p_parser,
        parser_version = p_parser_version,
        embedding_model = p_embedding_model,
        embedding_dimensions = p_embedding_dimensions,
        fetched_at = pg_catalog.now(),
        chunk_count = 0,
        updated_at = pg_catalog.now()
    where d.id = document.id
    returning d.* into document;
  else
    insert into public.paper_documents (
      openalex_id, doi, source_type, source_url, license, access_status,
      ingestion_status, checksum, parser, parser_version, embedding_model,
      embedding_dimensions, fetched_at
    ) values (
      p_openalex_id, p_doi, p_source_type, p_source_url, p_license, 'available',
      'parsing', p_checksum, p_parser, p_parser_version, p_embedding_model,
      p_embedding_dimensions, pg_catalog.now()
    ) returning * into document;
  end if;

  return query select document.id, document.ingestion_status, document.chunk_count, true;
end;
$$;

create or replace function public.set_paper_ingestion_status(
  p_document_id uuid,
  p_status text,
  p_error_code text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_status not in ('parsing', 'embedding', 'failed') then
    raise exception 'Invalid ingestion transition' using errcode = '22023';
  end if;

  update public.paper_documents d
  set ingestion_status = p_status,
      ingestion_error = case when p_status = 'failed' then left(p_error_code, 100) else null end,
      updated_at = pg_catalog.now()
  where d.id = p_document_id;
end;
$$;

create or replace function public.complete_paper_ingestion(p_document_id uuid)
returns table (document_id uuid, chunk_count integer)
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.paper_chunks c
    where c.document_id = p_document_id and c.embedding is not null
  ) then
    raise exception 'Cannot complete an ingestion without embedded chunks' using errcode = '23514';
  end if;

  return query
  update public.paper_documents d
  set ingestion_status = 'ready',
      ingestion_error = null,
      chunk_count = (select count(*)::integer from public.paper_chunks c where c.document_id = d.id),
      updated_at = pg_catalog.now()
  where d.id = p_document_id
  returning d.id, d.chunk_count;
end;
$$;

revoke all on function public.prepare_paper_ingestion(text, text, text, text, text, text, text, text, text, integer) from public;
revoke all on function public.set_paper_ingestion_status(uuid, text, text) from public;
revoke all on function public.complete_paper_ingestion(uuid) from public;
grant execute on function public.prepare_paper_ingestion(text, text, text, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.set_paper_ingestion_status(uuid, text, text) to service_role;
grant execute on function public.complete_paper_ingestion(uuid) to service_role;
