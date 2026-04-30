alter table public.api_request_events
    drop column if exists ip;

drop function if exists public.claim_api_request_slot(text, text, text, bigint, integer, integer);

create or replace function public.claim_api_request_slot(
    p_actor_key text,
    p_endpoint text,
    p_daily_limit_microusd bigint,
    p_burst_limit integer,
    p_window_seconds integer
)
returns table (
    spent_microusd bigint,
    llm_call_count integer,
    recent_request_count integer,
    remaining_microusd bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_spent bigint := 0;
    v_llm_calls integer := 0;
    v_recent integer := 0;
    v_usage_date date := ((current_timestamp at time zone 'UTC')::date);
    v_lock_key bigint := hashtextextended(p_actor_key, 0);
begin
    perform pg_advisory_xact_lock(v_lock_key);

    select
        coalesce((
            select d.spent_microusd
            from public.api_usage_daily as d
            where d.actor_key = p_actor_key
              and d.usage_date = v_usage_date
        ), 0),
        coalesce((
            select d.llm_call_count
            from public.api_usage_daily as d
            where d.actor_key = p_actor_key
              and d.usage_date = v_usage_date
        ), 0)
    into
        v_spent,
        v_llm_calls;

    if v_spent >= p_daily_limit_microusd then
        raise exception 'DAILY_LIMIT_EXCEEDED';
    end if;

    select count(*)::integer
    into v_recent
    from public.api_request_events as e
    where e.actor_key = p_actor_key
      and e.created_at >= timezone('utc', now()) - (interval '1 second' * greatest(p_window_seconds, 1));

    if v_recent >= p_burst_limit then
        raise exception 'BURST_LIMIT_EXCEEDED';
    end if;

    insert into public.api_request_events (actor_key, endpoint)
    values (p_actor_key, p_endpoint);

    return query
    select
        v_spent,
        v_llm_calls,
        v_recent + 1,
        greatest(p_daily_limit_microusd - v_spent, 0);
end;
$$;

revoke execute on function public.claim_api_request_slot(text, text, bigint, integer, integer) from public;
revoke execute on function public.claim_api_request_slot(text, text, bigint, integer, integer) from anon, authenticated;
