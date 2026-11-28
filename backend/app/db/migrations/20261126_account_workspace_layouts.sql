-- Workspaces categories for signed-in accounts (anonymous browsers keep theirs in localStorage).
create table if not exists public.workspace_layouts (
  user_id uuid primary key references public.users(id) on delete cascade,
  categories jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.workspace_layouts enable row level security;
