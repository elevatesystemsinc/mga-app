-- Flagstick — the wrap-up from the course. Run once in the Supabase SQL Editor (after tenants-setup.sql). Idempotent.
--
-- A small group's game is finished by the players themselves on the public scoring page (the Finish tab): anyone
-- who has joined with a group ID can CLOSE scoring, CALL OUT the skins, DRAW the partners and RECORD the payouts.
-- Everything lands in golf_events.wrap, which golf_event() now returns, and the hub takes it into the game the next
-- time the game page is open. The players record only — the computed result, never an edited one — and nothing but
-- Close scoring is possible while scores can still change.
--
--   golf_events.wrap   { v, closedAt, closedBy, draws:{<comp>:{teams,sitOut,method,size,at,by}},
--                        callouts:{<comp>:{at,by}}, payouts:{comps:{<comp>:{rows:[{pid,amount,note}],total}}, at, by} }
--   golf_wrap(event, code, action, data, rev)   anon: one step, compare-and-swap on wrap.v (a second phone that
--                                               tries the same step gets 'conflict' and simply shows the result)
--   hub_key_wrap(key, event, wrap)              an admin-link hub resets the wrap (Reopen scoring)

alter table public.golf_events add column if not exists wrap jsonb;

create or replace function public.golf_event(p_slug text, p_tenant text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select public || jsonb_build_object('id', id, 'tenant', tenant, 'wrap', wrap) from golf_events
   where lower(slug) = lower(trim(p_slug)) and (p_tenant is null or tenant = p_tenant)
   order by updated_at desc limit 1;
$$;

-- scores stop the moment the players close scoring from the course, whatever the hub republishes afterwards
create or replace function public.golf_submit(p_event text, p_code text, p_player text, p_hole int, p_strokes int)
returns boolean language plpgsql security definer set search_path = public as $$
declare gid text; st text; tn text; closed boolean; ok boolean;
begin
  select codes ->> upper(trim(p_code)), public ->> 'status', tenant, coalesce(wrap ? 'closedAt', false) into gid, st, tn, closed from golf_events where id = p_event;
  if gid is null then raise exception 'Unknown group ID'; end if;
  if st is distinct from 'live' or closed then raise exception 'Scoring is closed for this event'; end if;
  select exists (
    select 1 from golf_events e, jsonb_array_elements(e.public -> 'groups') g, jsonb_array_elements(g -> 'players') p
    where e.id = p_event and g ->> 'id' = gid and p ->> 'id' = p_player) into ok;
  if not ok then raise exception 'That player is not in this group'; end if;
  if p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18'; end if;
  if p_strokes is null then
    delete from golf_scores where event_id = p_event and player_id = p_player and hole = p_hole;
  else
    if p_strokes < 1 or p_strokes > 20 then raise exception 'Score must be 1–20'; end if;
    insert into golf_scores (event_id, player_id, hole, strokes, group_id, tenant, updated_at)
    values (p_event, p_player, p_hole, p_strokes, gid, tn, now())
    on conflict (event_id, player_id, hole) do update set strokes = excluded.strokes, group_id = excluded.group_id, tenant = excluded.tenant, updated_at = now();
  end if;
  return true;
end $$;

-- one step of the wrap-up, by anyone holding a group ID of the event
create or replace function public.golf_wrap(p_event text, p_code text, p_action text, p_data jsonb, p_rev int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; gid text; w jsonb; cur int; closed boolean; k text; who text;
begin
  select id, codes, public, wrap into e from golf_events where id = p_event for update;
  if e.id is null then raise exception 'Unknown event'; end if;
  who := upper(trim(p_code)); gid := e.codes ->> who;
  if gid is null then raise exception 'Unknown group ID'; end if;
  w := coalesce(e.wrap, '{}'::jsonb); cur := coalesce((w ->> 'v')::int, 0);
  if cur <> coalesce(p_rev, -1) then raise exception 'conflict'; end if;
  if p_data is not null and pg_column_size(p_data) > 120000 then raise exception 'Too large'; end if;
  closed := (w ? 'closedAt') or (e.public ->> 'status') = 'final';
  if p_action = 'close' then
    if w ? 'closedAt' then raise exception 'conflict'; end if;
    w := w || jsonb_build_object('closedAt', now(), 'closedBy', who);
    update golf_events set public = public || '{"status":"final"}'::jsonb where id = p_event;
  elsif p_action in ('draw', 'callout') then
    if not closed then raise exception 'Close scoring first'; end if;
    k := p_data ->> 'comp'; if k is null or k = '' then raise exception 'Which competition?'; end if;
    if p_action = 'draw' then
      w := jsonb_set(w, '{draws}', coalesce(w -> 'draws', '{}'::jsonb) || jsonb_build_object(k, (p_data - 'comp') || jsonb_build_object('at', now(), 'by', who)));
    else
      w := jsonb_set(w, '{callouts}', coalesce(w -> 'callouts', '{}'::jsonb) || jsonb_build_object(k, jsonb_build_object('at', now(), 'by', who)));
    end if;
  elsif p_action = 'payouts' then
    if not closed then raise exception 'Close scoring first'; end if;
    if w ? 'payouts' then raise exception 'conflict'; end if;
    if p_data is null or jsonb_typeof(p_data -> 'comps') <> 'object' then raise exception 'Nothing to record'; end if;
    w := w || jsonb_build_object('payouts', p_data || jsonb_build_object('at', now(), 'by', who));
  else
    raise exception 'Unknown action';
  end if;
  w := w || jsonb_build_object('v', cur + 1);
  update golf_events set wrap = w, updated_at = now() where id = p_event;
  return w;
end $$;

revoke all on function public.golf_wrap(text, text, text, jsonb, int) from public;
grant execute on function public.golf_wrap(text, text, text, jsonb, int) to anon, authenticated;

-- an admin-link hub (key mode) resets the wrap when it reopens scoring; a board session updates the column directly
do $$
begin
  if exists (select 1 from pg_proc where proname = 'hub_key_org' and pronamespace = 'public'::regnamespace) then
    execute $f$
      create or replace function public.hub_key_wrap(p_key text, p_event text, p_wrap jsonb) returns boolean
      language plpgsql security definer set search_path = public as $b$
      declare org text;
      begin
        org := hub_key_org(p_key);
        if org is null or not exists (select 1 from golf_events where id = p_event and public ->> 'org' = org) then raise exception 'not allowed' using errcode = '42501'; end if;
        update golf_events set wrap = p_wrap, updated_at = now() where id = p_event;
        return true;
      end $b$;
      revoke all on function public.hub_key_wrap(text, text, jsonb) from public;
      grant execute on function public.hub_key_wrap(text, text, jsonb) to anon, authenticated;
    $f$;
  end if;
end $$;
