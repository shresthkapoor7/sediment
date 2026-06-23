-- Atomic chat persistence helpers. Both functions require graph ownership even
-- though the backend connects with the service role.

create or replace function public.get_or_create_chat_session(
  p_graph_id uuid,
  p_user_id uuid,
  p_scope text,
  p_paper_openalex_id text default null
)
returns public.chat_sessions
language plpgsql
set search_path = ''
as $$
declare
  result public.chat_sessions;
begin
  if p_scope not in ('paper', 'graph')
    or (p_scope = 'paper' and p_paper_openalex_id is null)
    or (p_scope = 'graph' and p_paper_openalex_id is not null) then
    raise exception 'Invalid chat scope' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.graphs g
    where g.id = p_graph_id
      and g.user_id = p_user_id
      and g.deleted_at is null
  ) then
    raise exception 'Graph not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_graph_id::text || ':' || p_scope || ':' || coalesce(p_paper_openalex_id, ''),
      0
    )
  );

  select s.* into result
  from public.chat_sessions s
  where s.graph_id = p_graph_id
    and s.user_id = p_user_id
    and s.scope = p_scope
    and s.paper_openalex_id is not distinct from p_paper_openalex_id;

  if found then
    return result;
  end if;

  insert into public.chat_sessions (graph_id, user_id, scope, paper_openalex_id)
  values (p_graph_id, p_user_id, p_scope, p_paper_openalex_id)
  returning * into result;

  return result;
end;
$$;

create or replace function public.append_chat_message(
  p_session_id uuid,
  p_user_id uuid,
  p_role text,
  p_content text,
  p_tool_uses jsonb default null,
  p_citations jsonb default null
)
returns public.chat_messages
language plpgsql
set search_path = ''
as $$
declare
  next_sequence bigint;
  result public.chat_messages;
begin
  if p_role not in ('user', 'assistant') then
    raise exception 'Invalid chat role' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.chat_sessions s
    join public.graphs g on g.id = s.graph_id
    where s.id = p_session_id
      and s.user_id = p_user_id
      and g.user_id = p_user_id
      and g.deleted_at is null
  ) then
    raise exception 'Chat session not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_id::text, 0)
  );

  select coalesce(max(m.sequence_number), 0) + 1 into next_sequence
  from public.chat_messages m
  where m.session_id = p_session_id;

  insert into public.chat_messages (
    session_id,
    role,
    content,
    tool_uses,
    citations,
    sequence_number
  ) values (
    p_session_id,
    p_role,
    p_content,
    p_tool_uses,
    p_citations,
    next_sequence
  )
  returning * into result;

  update public.chat_sessions
  set updated_at = now()
  where id = p_session_id;

  return result;
end;
$$;

revoke all on function public.get_or_create_chat_session(uuid, uuid, text, text) from public;
revoke all on function public.append_chat_message(uuid, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.get_or_create_chat_session(uuid, uuid, text, text) to service_role;
grant execute on function public.append_chat_message(uuid, uuid, text, text, jsonb, jsonb) to service_role;
