-- A canvas can hold several agent chats, each shown as a tab. Until now a canvas had exactly one.

drop index if exists public.chat_sessions_graph_scope_key;

alter table public.chat_sessions
  add column if not exists title text;

create index if not exists chat_sessions_graph_scope_idx
  on public.chat_sessions (graph_id, created_at)
  where scope = 'graph';
