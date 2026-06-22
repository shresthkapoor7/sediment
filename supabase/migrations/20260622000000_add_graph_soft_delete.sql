alter table public.graphs
add column if not exists deleted_at timestamptz null;

create index if not exists graphs_user_id_deleted_at_updated_at_idx
on public.graphs (user_id, deleted_at, updated_at desc);
