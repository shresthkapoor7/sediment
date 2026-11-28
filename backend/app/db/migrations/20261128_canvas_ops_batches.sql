-- Canvas commits carry a batch id so a retried batch (response lost, request resent) is applied at most once,
-- and keep metadata.nodeCount in step with the canvas data.
alter table public.canvas_operations add column if not exists batch_id uuid;
create index if not exists canvas_operations_batch_idx on public.canvas_operations (graph_id, batch_id) where batch_id is not null;

drop function if exists public.commit_canvas_ops(uuid, uuid, integer, jsonb, jsonb, text, text, text);

-- Returns {"version": n, "duplicate": bool}, or null when the canvas is no longer at p_base_version.
create or replace function public.commit_canvas_ops(
  p_graph_id uuid, p_user_id uuid, p_base_version integer, p_data jsonb, p_ops jsonb,
  p_actor_kind text, p_actor_id text, p_via text, p_batch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  new_version integer;
  done_version integer;
begin
  if p_batch_id is not null then
    select o.version into done_version from canvas_operations o
    join graphs g on g.id = o.graph_id and g.user_id = p_user_id
    where o.graph_id = p_graph_id and o.batch_id = p_batch_id limit 1;
    if done_version is not null then
      return jsonb_build_object('version', done_version, 'duplicate', true);
    end if;
  end if;
  update graphs set
    data = p_data,
    version = p_base_version + 1,
    updated_at = now(),
    metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{nodeCount}',
      to_jsonb((select count(*) from jsonb_object_keys(coalesce(p_data->'nodes', '{}'::jsonb)))))
  where id = p_graph_id and user_id = p_user_id and version = p_base_version and deleted_at is null
  returning version into new_version;
  if new_version is null then
    return null;
  end if;
  insert into canvas_operations (graph_id, version, actor_kind, actor_id, via, op, batch_id)
  select p_graph_id, new_version, p_actor_kind, p_actor_id, p_via, value, p_batch_id from jsonb_array_elements(p_ops);
  return jsonb_build_object('version', new_version, 'duplicate', false);
end;
$$;

revoke all on function public.commit_canvas_ops(uuid, uuid, integer, jsonb, jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.commit_canvas_ops(uuid, uuid, integer, jsonb, jsonb, text, text, text, uuid) to service_role;
