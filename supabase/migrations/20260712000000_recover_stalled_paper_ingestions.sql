-- Paper ingestion ownership is lease-based. A live worker periodically renews
-- its lease, while a new worker may reclaim only an absent or expired lease.

alter table public.paper_documents
  add column if not exists ingestion_lease_id uuid,
  add column if not exists ingestion_lease_expires_at timestamptz;

drop function if exists public.prepare_paper_ingestion(text, text, text, text, text, text, text, text, text, integer);

create function public.prepare_paper_ingestion(
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
  is_claimed boolean,
  lease_id uuid
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
    return query select document.id, document.ingestion_status, document.chunk_count, false, null::uuid;
    return;
  end if;

  if found
    and document.ingestion_status in ('fetching', 'parsing', 'embedding')
    and document.ingestion_lease_expires_at > pg_catalog.now() then
    return query select document.id, document.ingestion_status, document.chunk_count, false, null::uuid;
    return;
  end if;

  if found then
    delete from public.paper_chunks c where c.document_id = document.id;
    update public.paper_documents d
    set doi = p_doi,
        source_url = p_source_url,
        license = p_license,
        access_status = 'available',
        ingestion_status = 'fetching',
        ingestion_error = null,
        parser = p_parser,
        parser_version = p_parser_version,
        embedding_model = p_embedding_model,
        embedding_dimensions = p_embedding_dimensions,
        fetched_at = pg_catalog.now(),
        chunk_count = 0,
        ingestion_lease_id = gen_random_uuid(),
        ingestion_lease_expires_at = pg_catalog.now() + interval '5 minutes',
        updated_at = pg_catalog.now()
    where d.id = document.id
    returning d.* into document;
  else
    insert into public.paper_documents (
      openalex_id, doi, source_type, source_url, license, access_status,
      ingestion_status, checksum, parser, parser_version, embedding_model,
      embedding_dimensions, fetched_at, ingestion_lease_id, ingestion_lease_expires_at
    ) values (
      p_openalex_id, p_doi, p_source_type, p_source_url, p_license, 'available',
      'fetching', p_checksum, p_parser, p_parser_version, p_embedding_model,
      p_embedding_dimensions, pg_catalog.now(), gen_random_uuid(), pg_catalog.now() + interval '5 minutes'
    ) returning * into document;
  end if;

  return query select document.id, document.ingestion_status, document.chunk_count, true, document.ingestion_lease_id;
end;
$$;

create or replace function public.renew_paper_ingestion_lease(
  p_document_id uuid,
  p_lease_id uuid,
  p_status text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  renewed boolean;
begin
  if p_status not in ('fetching', 'parsing', 'embedding') then
    raise exception 'Invalid ingestion transition' using errcode = '22023';
  end if;

  update public.paper_documents d
  set ingestion_status = p_status,
      ingestion_error = null,
      ingestion_lease_expires_at = pg_catalog.now() + interval '5 minutes',
      updated_at = pg_catalog.now()
  where d.id = p_document_id
    and d.ingestion_lease_id = p_lease_id
    and d.ingestion_lease_expires_at > pg_catalog.now()
    and d.ingestion_status in ('fetching', 'parsing', 'embedding')
    and (
      (p_status = 'fetching' and d.ingestion_status = 'fetching')
      or (p_status = 'parsing' and d.ingestion_status in ('fetching', 'parsing'))
      or (p_status = 'embedding' and d.ingestion_status in ('parsing', 'embedding'))
    )
  returning true into renewed;

  return coalesce(renewed, false);
end;
$$;

create or replace function public.fail_paper_ingestion(
  p_document_id uuid,
  p_lease_id uuid,
  p_error_code text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  failed boolean;
begin
  update public.paper_documents d
  set ingestion_status = 'failed',
      ingestion_error = left(p_error_code, 100),
      ingestion_lease_id = null,
      ingestion_lease_expires_at = null,
      updated_at = pg_catalog.now()
  where d.id = p_document_id
    and d.ingestion_lease_id = p_lease_id
    and d.ingestion_lease_expires_at > pg_catalog.now()
    and d.ingestion_status in ('fetching', 'parsing', 'embedding')
  returning true into failed;

  return coalesce(failed, false);
end;
$$;

create or replace function public.complete_paper_ingestion(
  p_document_id uuid,
  p_lease_id uuid
)
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
      ingestion_lease_id = null,
      ingestion_lease_expires_at = null,
      updated_at = pg_catalog.now()
  where d.id = p_document_id
    and d.ingestion_lease_id = p_lease_id
    and d.ingestion_lease_expires_at > pg_catalog.now()
    and d.ingestion_status = 'embedding'
  returning d.id, d.chunk_count;

  if not found then
    raise exception 'Active paper ingestion lease is no longer owned' using errcode = 'P0001';
  end if;
end;
$$;

-- Old workers have no valid lease after this migration, so they are safe to
-- recover. Do not use updated_at: an active lease is the only ownership proof.
update public.paper_documents
set ingestion_status = 'failed',
    ingestion_error = 'stalled_ingestion',
    ingestion_lease_id = null,
    ingestion_lease_expires_at = null,
    updated_at = pg_catalog.now()
where ingestion_status in ('fetching', 'parsing', 'embedding')
  and (ingestion_lease_id is null or ingestion_lease_expires_at <= pg_catalog.now());

revoke all on function public.prepare_paper_ingestion(text, text, text, text, text, text, text, text, text, integer) from public;
revoke all on function public.renew_paper_ingestion_lease(uuid, uuid, text) from public;
revoke all on function public.fail_paper_ingestion(uuid, uuid, text) from public;
revoke all on function public.complete_paper_ingestion(uuid, uuid) from public;
revoke all on function public.set_paper_ingestion_status(uuid, text, text) from service_role;
grant execute on function public.prepare_paper_ingestion(text, text, text, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.renew_paper_ingestion_lease(uuid, uuid, text) to service_role;
grant execute on function public.fail_paper_ingestion(uuid, uuid, text) to service_role;
grant execute on function public.complete_paper_ingestion(uuid, uuid) to service_role;
