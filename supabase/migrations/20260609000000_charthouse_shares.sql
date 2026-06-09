-- Short-share storage for the Charthouse "Share" button.
-- The Go /api/share function reads + writes this table via PostgREST.

create table if not exists public.charthouse_shares (
  id          text        primary key,
  payload     jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists charthouse_shares_created_at_idx
  on public.charthouse_shares (created_at);

-- The Go function authenticates with the service_role key and bypasses RLS,
-- but RLS is enabled so anon/authenticated keys cannot reach the table.
alter table public.charthouse_shares enable row level security;
