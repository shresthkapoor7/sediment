-- Anonymous feeds use the existing unguessable browser UUID as their owner key.
-- Only the backend service role can access these tables or RPCs.
create table public.research_feeds (
  user_id uuid primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.feed_papers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.feed_query_cache (
  key text primary key,
  paper_ids text[] not null,
  next_cursor text,
  expires_at timestamptz not null
);
create index feed_query_cache_expiry on public.feed_query_cache(expires_at);
create table public.feed_leases (
  key text primary key,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.research_feeds enable row level security;
alter table public.feed_papers enable row level security;
alter table public.feed_query_cache enable row level security;
alter table public.feed_leases enable row level security;
revoke all on public.research_feeds, public.feed_papers, public.feed_query_cache, public.feed_leases from anon, authenticated;
grant all on public.research_feeds, public.feed_papers, public.feed_query_cache, public.feed_leases to service_role;

create function public.claim_feed_lease(p_key text, p_token uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed integer;
begin
  insert into feed_leases(key,token,expires_at) values(p_key,p_token,now()+make_interval(secs=>least(p_seconds,240)))
  on conflict(key) do update set token=excluded.token, expires_at=excluded.expires_at
  where feed_leases.expires_at < now();
  get diagnostics claimed = row_count;
  return claimed = 1;
end; $$;
create function public.release_feed_lease(p_key text, p_token uuid, p_cooldown integer default 0)
returns void language sql security definer set search_path = public as $$
  update feed_leases set expires_at=now()+make_interval(secs=>least(p_cooldown,60))
  where key=p_key and token=p_token;
$$;
-- State writes require the live lease token, preventing an expired worker from
-- overwriting a newer refresh or interests edit.
create function public.save_research_feed(p_user_id uuid, p_token uuid, p_state jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from feed_leases where key='feed:'||p_user_id::text and token=p_token and expires_at>now() for update;
  if not found then return false; end if;
  insert into research_feeds(user_id,state) values(p_user_id,p_state)
  on conflict(user_id) do update set state=excluded.state, updated_at=now();
  return true;
end; $$;
revoke all on function public.claim_feed_lease(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_feed_lease(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.save_research_feed(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_feed_lease(text,uuid,integer) to service_role;
grant execute on function public.release_feed_lease(text,uuid,integer) to service_role;
grant execute on function public.save_research_feed(uuid,uuid,jsonb) to service_role;
