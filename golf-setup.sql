-- MGA Hub — live scoring. Run once in the Supabase SQL Editor (same project).
-- Board (signed-in) publishes events; scorers on the course use the public scoring page,
-- which can only (a) read an event's public info, (b) look up a group by its group ID,
-- (c) save strokes for players in that group while the event is open. Nothing else.

create table if not exists public.golf_events (
  id         text primary key,
  slug       text not null unique,
  public     jsonb not null,      -- name, courses, groups, players (no group IDs)
  codes      jsonb not null,      -- { "GROUPID": "<group uuid>" } — never exposed
  updated_at timestamptz not null default now()
);
create table if not exists public.golf_scores (
  event_id   text not null references public.golf_events(id) on delete cascade,
  player_id  text not null,
  hole       int  not null check (hole between 1 and 18),
  strokes    int  not null check (strokes between 1 and 20),
  group_id   text,
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id, hole)
);

alter table public.golf_events enable row level security;
alter table public.golf_scores enable row level security;

create policy "board manages golf events" on public.golf_events for all to authenticated using (true) with check (true);
create policy "board manages golf scores" on public.golf_scores for all to authenticated using (true) with check (true);
create policy "anyone can read scores"    on public.golf_scores for select to anon using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.golf_events to authenticated;
grant select, insert, update, delete on public.golf_scores to authenticated;
grant select on public.golf_scores to anon;

-- public event info by link (no group IDs)
create or replace function public.golf_event(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public || jsonb_build_object('id', id) from golf_events where lower(slug) = lower(trim(p_slug));
$$;

-- group ID → group (or null)
create or replace function public.golf_join(p_slug text, p_code text) returns text
language sql stable security definer set search_path = public as $$
  select codes ->> upper(trim(p_code)) from golf_events where lower(slug) = lower(trim(p_slug));
$$;

-- save (or clear, with null) one player's strokes on one hole
create or replace function public.golf_submit(p_event text, p_code text, p_player text, p_hole int, p_strokes int)
returns boolean language plpgsql security definer set search_path = public as $$
declare gid text; st text; ok boolean;
begin
  select codes ->> upper(trim(p_code)), public ->> 'status' into gid, st from golf_events where id = p_event;
  if gid is null then raise exception 'Unknown group ID'; end if;
  if st is distinct from 'live' then raise exception 'Scoring is closed for this event'; end if;
  select exists (
    select 1 from golf_events e, jsonb_array_elements(e.public -> 'groups') g, jsonb_array_elements(g -> 'players') p
    where e.id = p_event and g ->> 'id' = gid and p ->> 'id' = p_player) into ok;
  if not ok then raise exception 'That player is not in this group'; end if;
  if p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18'; end if;
  if p_strokes is null then
    delete from golf_scores where event_id = p_event and player_id = p_player and hole = p_hole;
  else
    if p_strokes < 1 or p_strokes > 20 then raise exception 'Score must be 1–20'; end if;
    insert into golf_scores (event_id, player_id, hole, strokes, group_id, updated_at)
    values (p_event, p_player, p_hole, p_strokes, gid, now())
    on conflict (event_id, player_id, hole) do update set strokes = excluded.strokes, group_id = excluded.group_id, updated_at = now();
  end if;
  return true;
end $$;

revoke all on function public.golf_event(text), public.golf_join(text, text), public.golf_submit(text, text, text, int, int) from public;
grant execute on function public.golf_event(text), public.golf_join(text, text), public.golf_submit(text, text, text, int, int) to anon, authenticated;

-- live leaderboards
alter publication supabase_realtime add table public.golf_scores;
