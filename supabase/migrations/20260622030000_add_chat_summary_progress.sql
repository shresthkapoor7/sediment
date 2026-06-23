-- Track the exact prefix represented by each rolling chat summary.

alter table public.chat_sessions
  add column if not exists summary_through_sequence bigint not null default 0
    check (summary_through_sequence >= 0);

create or replace function public.update_chat_session_summary(
  p_session_id uuid,
  p_user_id uuid,
  p_summary text,
  p_through_sequence bigint
)
returns public.chat_sessions
language plpgsql
set search_path = ''
as $$
declare
  result public.chat_sessions;
begin
  if p_through_sequence < 0 or length(p_summary) > 12000 then
    raise exception 'Invalid chat summary' using errcode = '22023';
  end if;

  update public.chat_sessions s
  set summary = p_summary,
      summary_through_sequence = p_through_sequence,
      updated_at = pg_catalog.now()
  where s.id = p_session_id
    and s.user_id = p_user_id
    and p_through_sequence >= s.summary_through_sequence
    and exists (
      select 1 from public.graphs g
      where g.id = s.graph_id
        and g.user_id = p_user_id
        and g.deleted_at is null
    )
  returning s.* into result;

  if not found then
    raise exception 'Chat session not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

revoke all on function public.update_chat_session_summary(uuid, uuid, text, bigint) from public;
grant execute on function public.update_chat_session_summary(uuid, uuid, text, bigint) to service_role;
