-- MGA Hub — permission fix. Safe to run more than once.
-- Newer Supabase projects don't always grant table access to signed-in users
-- for tables created in the SQL editor. This grants it, and re-creates the
-- policies only if they're missing.

grant usage on schema public to authenticated;
grant select, insert, update on table public.mga_hub to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='mga_hub' and policyname='board can read hub') then
    create policy "board can read hub" on public.mga_hub for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='mga_hub' and policyname='board can insert hub') then
    create policy "board can insert hub" on public.mga_hub for insert to authenticated with check (true); end if;
  if not exists (select 1 from pg_policies where tablename='mga_hub' and policyname='board can update hub') then
    create policy "board can update hub" on public.mga_hub for update to authenticated using (true) with check (true); end if;
end $$;

-- Check: should list the three policies above.
select policyname, cmd from pg_policies where tablename = 'mga_hub';
