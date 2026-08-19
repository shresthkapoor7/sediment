-- Private, user-owned files attached to canvas special notes. The service-role
-- backend is the only caller; RLS prevents direct PostgREST access.

create table if not exists public.special_note_files (
  id uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.graphs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  media_type text not null,
  file_kind text not null check (file_kind in ('pdf', 'image', 'spreadsheet')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_at timestamptz not null default now()
);

create index if not exists special_note_files_user_created_idx
  on public.special_note_files (user_id, created_at);

create index if not exists special_note_files_graph_created_idx
  on public.special_note_files (graph_id, created_at);

alter table public.special_note_files enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'special-notes',
  'special-notes',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.reserve_special_note_file(
  p_graph_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_media_type text,
  p_file_kind text,
  p_size_bytes bigint
)
returns public.special_note_files
language plpgsql
set search_path = ''
as $$
declare
  used_bytes bigint;
  result public.special_note_files;
begin
  if p_size_bytes <= 0 or p_size_bytes > 20971520 then
    raise exception 'Invalid special note file size' using errcode = '22023';
  end if;

  if p_file_kind not in ('pdf', 'image', 'spreadsheet') then
    raise exception 'Invalid special note file type' using errcode = '22023';
  end if;

  if char_length(p_original_filename) not between 1 and 255
    or char_length(p_storage_path) not between 1 and 1024
    or char_length(p_media_type) not between 1 and 255 then
    raise exception 'Invalid special note file metadata' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.graphs g
    where g.id = p_graph_id
      and g.user_id = p_user_id
      and g.deleted_at is null
  ) then
    raise exception 'Graph not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select coalesce(sum(f.size_bytes), 0) into used_bytes
  from public.special_note_files f
  where f.user_id = p_user_id;

  if used_bytes + p_size_bytes > 20971520 then
    raise exception 'Special note storage quota exceeded' using errcode = '22023';
  end if;

  insert into public.special_note_files (
    graph_id,
    user_id,
    storage_path,
    original_filename,
    media_type,
    file_kind,
    size_bytes
  ) values (
    p_graph_id,
    p_user_id,
    p_storage_path,
    p_original_filename,
    p_media_type,
    p_file_kind,
    p_size_bytes
  ) returning * into result;

  return result;
end;
$$;

create or replace function public.get_special_note_storage_usage(p_user_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(f.size_bytes), 0)::bigint
  from public.special_note_files f
  where f.user_id = p_user_id;
$$;

revoke all on function public.reserve_special_note_file(uuid, uuid, text, text, text, text, bigint) from public;
revoke all on function public.get_special_note_storage_usage(uuid) from public;
grant execute on function public.reserve_special_note_file(uuid, uuid, text, text, text, text, bigint) to service_role;
grant execute on function public.get_special_note_storage_usage(uuid) to service_role;
