-- Review fixes for Phase A: an account ID must never be usable as an anonymous browser ID.

-- Whether an ID belongs to a signed-in account. Used by the API to refuse browser requests that name one.
create or replace function public.is_account_id(p_id uuid) returns boolean
language sql security definer set search_path = public, auth stable as $$
  select exists (select 1 from auth.users where id = p_id);
$$;
revoke all on function public.is_account_id(uuid) from public, anon, authenticated;
grant execute on function public.is_account_id(uuid) to service_role;

-- Claims only move work from a browser ID, never from another account.
create or replace function public.claim_browser_work(p_browser_id uuid, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  moved_graphs integer := 0;
  moved_sessions integer := 0;
  moved_files integer := 0;
begin
  if p_browser_id = p_account_id then
    return jsonb_build_object('status', 'same');
  end if;
  if exists (select 1 from auth.users where id = p_browser_id) then
    return jsonb_build_object('status', 'taken');
  end if;
  perform pg_advisory_xact_lock(hashtext('claim:' || p_browser_id::text));
  select account_id into existing from account_claims where browser_id = p_browser_id;
  if existing is not null and existing <> p_account_id then
    return jsonb_build_object('status', 'taken');
  end if;
  insert into users (id, last_seen) values (p_account_id, now())
  on conflict (id) do update set last_seen = excluded.last_seen;
  update graphs set user_id = p_account_id where user_id = p_browser_id;
  get diagnostics moved_graphs = row_count;
  update chat_sessions set user_id = p_account_id where user_id = p_browser_id;
  get diagnostics moved_sessions = row_count;
  update special_note_files set user_id = p_account_id where user_id = p_browser_id;
  get diagnostics moved_files = row_count;
  update research_feeds set user_id = p_account_id
  where user_id = p_browser_id and not exists (select 1 from research_feeds where user_id = p_account_id);
  insert into account_claims (browser_id, account_id, graphs_moved)
  values (p_browser_id, p_account_id, moved_graphs)
  on conflict (browser_id) do update set graphs_moved = account_claims.graphs_moved + excluded.graphs_moved;
  return jsonb_build_object('status', 'claimed', 'graphs', moved_graphs, 'sessions', moved_sessions, 'files', moved_files);
end;
$$;
revoke all on function public.claim_browser_work(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_browser_work(uuid, uuid) to service_role;
