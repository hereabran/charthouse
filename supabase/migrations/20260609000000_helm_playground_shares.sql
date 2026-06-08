-- Short-share storage for the helm-playground "Share" button.
-- The Go /api/share function reads + writes this table via PostgREST.

create table if not exists public.helm_playground_shares (
  id          text        primary key,
  payload     jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists helm_playground_shares_created_at_idx
  on public.helm_playground_shares (created_at);

-- The Go function authenticates with the service_role key and bypasses RLS,
-- but RLS is enabled so anon/authenticated keys cannot reach the table.
alter table public.helm_playground_shares enable row level security;
