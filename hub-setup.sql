-- MGA Hub — run once in the Supabase SQL Editor (same project as the Member-Member app).
-- Creates the hub's own table. It does NOT touch public.mm_tournament.

create table if not exists public.mga_hub (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.mga_hub enable row level security;

create policy "board can read hub"   on public.mga_hub for select to authenticated using (true);
create policy "board can insert hub" on public.mga_hub for insert to authenticated with check (true);
create policy "board can update hub" on public.mga_hub for update to authenticated using (true) with check (true);
-- no delete policy on purpose

alter publication supabase_realtime add table public.mga_hub;
