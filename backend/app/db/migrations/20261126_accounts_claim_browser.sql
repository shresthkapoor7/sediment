-- Phase A5: move an anonymous browser's work onto a signed-in account.
--
-- One row per claimed browser ID, so a browser can be claimed by exactly one account. Re-running the claim for
-- the same account is safe and also picks up anything the browser created since (e.g. while sign-in finished).

create table if not exists public.account_claims (
  browser_id uuid primary key,
  account_id uuid not null,
  claimed_at timestamptz not null default now(),
  graphs_moved integer not null default 0
);
alter table public.account_claims enable row level security;

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

  -- Serialise claims of the same browser.
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
  -- One feed per owner: the account keeps its own if it already has one.
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
