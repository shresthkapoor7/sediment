-- Phase B: canvas edits as operations.
-- `graphs.version` counts every change to a canvas's data. Operations commit with compare-and-swap on it, and the
-- trigger keeps the old whole-canvas PATCH bumping it too, so the two paths never overwrite each other silently.

alter table public.graphs add column if not exists version integer not null default 0;

create or replace function public.bump_graph_version() returns trigger
language plpgsql as $$
begin
  if new.data is distinct from old.data and new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists graphs_bump_version on public.graphs;
create trigger graphs_bump_version before update on public.graphs
for each row execute function public.bump_graph_version();

-- Who did what: one row per operation, in the order it was applied.
create table if not exists public.canvas_operations (
  id bigint generated always as identity primary key,
  graph_id uuid not null references public.graphs(id) on delete cascade,
  version integer not null,          -- the canvas version this operation produced (ops of one commit share it)
  actor_kind text not null check (actor_kind in ('account', 'browser')),
  actor_id text not null,
  via text not null default 'ui' check (via in ('ui', 'agent', 'mcp')),
  op jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists canvas_operations_graph_idx on public.canvas_operations (graph_id, id);
alter table public.canvas_operations enable row level security;

-- Applies one batch of operations the caller already ran through the canvas reducer: stores the new data only if
-- the canvas is still at `p_base_version`, then logs the operations. Returns the new version, or null on conflict.
create or replace function public.commit_canvas_ops(
  p_graph_id uuid, p_user_id uuid, p_base_version integer, p_data jsonb, p_ops jsonb,
  p_actor_kind text, p_actor_id text, p_via text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  new_version integer;
begin
  update graphs set data = p_data, version = p_base_version + 1, updated_at = now()
  where id = p_graph_id and user_id = p_user_id and version = p_base_version and deleted_at is null
  returning version into new_version;
  if new_version is null then
    return null;
  end if;
  insert into canvas_operations (graph_id, version, actor_kind, actor_id, via, op)
  select p_graph_id, new_version, p_actor_kind, p_actor_id, p_via, value from jsonb_array_elements(p_ops);
  return new_version;
end;
$$;

revoke all on function public.commit_canvas_ops(uuid, uuid, integer, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.commit_canvas_ops(uuid, uuid, integer, jsonb, jsonb, text, text, text) to service_role;
