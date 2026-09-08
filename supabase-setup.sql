-- MM Tournament HQ — run this once in Supabase SQL Editor
-- One row of JSONB state, readable/writable only by signed-in users (the shared board login).

create table public.mm_tournament (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.mm_tournament enable row level security;

create policy "board can read"
  on public.mm_tournament for select
  to authenticated using (true);

create policy "board can insert"
  on public.mm_tournament for insert
  to authenticated with check (true);

create policy "board can update"
  on public.mm_tournament for update
  to authenticated using (true) with check (true);

-- no delete policy on purpose: nobody can drop the state row, even signed in

-- realtime so open devices see each other's changes live
alter publication supabase_realtime add table public.mm_tournament;

-- Keep-alive target: a zero-sensitivity table the GitHub Action pings every
-- 3 days so the free project never pauses for inactivity. Safe to expose to anon.
create table public.keepalive (
  id        int primary key default 1,
  pinged_at timestamptz not null default now()
);
insert into public.keepalive (id) values (1) on conflict do nothing;
alter table public.keepalive enable row level security;
create policy "keepalive is public read"
  on public.keepalive for select
  to anon, authenticated using (true);
