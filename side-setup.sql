-- Flagstick — side games inside a group (the cart's own wolf). Run once in the Supabase SQL Editor. Idempotent.
--
-- On the scoring page a group sets up its own game on top of the event: who is who, the stakes, the tee order; then
-- each hole the wolf's pick. One row per group per event, written by anyone holding that group's ID, compare-and-swap
-- on v so two phones never trample each other. The hub reads the rows for the game page (read-only).
--
--   golf_side (event_id, group_id, tenant, data, v, updated_at)
--   golf_side_get(event, code)              anon: the row for the code's group (null when none)
--   golf_side_put(event, code, data, rev)   anon: write it (null data deletes); rev must match v, else 'conflict'

create table if not exists public.golf_side (
  event_id   text not null,
  group_id   text not null,
  tenant     text not null default 'wccc',
  data       jsonb,
  v          int  not null default 0,
  by         text,
  updated_at timestamptz not null default now(),
  primary key (event_id, group_id)
);
alter table public.golf_side enable row level security;
drop policy if exists "board reads side games" on public.golf_side;
create policy "board reads side games" on public.golf_side for select to authenticated using (true);
grant select on public.golf_side to authenticated;

create or replace function public.golf_side_get(p_event text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare gid text; r record;
begin
  select codes ->> upper(trim(p_code)) into gid from golf_events where id = p_event;
  if gid is null then raise exception 'Unknown group ID'; end if;
  select data, v, updated_at into r from golf_side where event_id = p_event and group_id = gid;
  if r.v is null then return jsonb_build_object('group', gid, 'data', null, 'v', 0); end if;
  return jsonb_build_object('group', gid, 'data', r.data, 'v', r.v, 'at', r.updated_at);
end $$;

create or replace function public.golf_side_put(p_event text, p_code text, p_data jsonb, p_rev int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid text; tn text; who text; cur int; nv int;
begin
  who := upper(trim(p_code));
  select codes ->> who, tenant into gid, tn from golf_events where id = p_event;
  if gid is null then raise exception 'Unknown group ID'; end if;
  if p_data is not null and pg_column_size(p_data) > 60000 then raise exception 'Too large'; end if;
  select v into cur from golf_side where event_id = p_event and group_id = gid for update;
  if coalesce(cur, 0) <> coalesce(p_rev, 0) then raise exception 'conflict'; end if;
  if p_data is null then
    delete from golf_side where event_id = p_event and group_id = gid;
    return jsonb_build_object('group', gid, 'data', null, 'v', 0);
  end if;
  nv := coalesce(cur, 0) + 1;
  insert into golf_side (event_id, group_id, tenant, data, v, by, updated_at) values (p_event, gid, coalesce(tn, 'wccc'), p_data, nv, who, now())
    on conflict (event_id, group_id) do update set data = excluded.data, v = excluded.v, by = excluded.by, updated_at = now();
  return jsonb_build_object('group', gid, 'data', p_data, 'v', nv);
end $$;

revoke all on function public.golf_side_get(text, text), public.golf_side_put(text, text, jsonb, int) from public;
grant execute on function public.golf_side_get(text, text), public.golf_side_put(text, text, jsonb, int) to anon, authenticated;

-- the other phones in the cart see a pick at once
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'golf_side') then
    alter publication supabase_realtime add table public.golf_side;
  end if;
end $$;
