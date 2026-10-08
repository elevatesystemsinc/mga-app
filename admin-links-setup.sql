-- Club Hub — admin links for small groups and associations. Run once in the Supabase SQL Editor (same project).
-- The club hub creates a link such as app.wcccmga.org/misfits#key=… and hands it to the group's organizer.
-- Whoever opens it is not signed in as the board: the page calls the hub_key_* functions below with the key, and
-- those can only (a) read and save that one organization's row, (b) read the club directory and add people to it,
-- (c) publish that organization's scoring events, scores, cashier and check-in links. Nothing else.
-- Only a SHA-256 hash of the key is stored; revoking a link in the club hub stops it immediately.

create extension if not exists pgcrypto;

create table if not exists public.hub_keys (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  key_hash   text not null unique,
  label      text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.hub_keys enable row level security;
create policy "board manages admin links" on public.hub_keys for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.hub_keys to authenticated;

-- which organization a key opens (null when unknown or revoked)
create or replace function public.hub_key_org(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select org_id from hub_keys
   where p_key is not null and length(p_key) >= 16
     and key_hash = encode(digest(p_key, 'sha256'), 'hex') and revoked_at is null
   limit 1;
$$;

-- the organization's own row, or the club row cut down to what a group needs (directory, its own listing, the
-- game library) — never the club's tournaments, money or the other organizations
create or replace function public.hub_key_read(p_key text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org text; d jsonb;
begin
  org := hub_key_org(p_key);
  if org is null then raise exception 'invalid key' using errcode = '42501'; end if;
  if p_id = org then select data into d from mga_hub where id = p_id; return d; end if;
  if p_id = 'club' then
    select data into d from mga_hub where id = 'club';
    if d is null then return null; end if;
    return jsonb_build_object('id', 'club', 'kind', 'club', 'name', d -> 'name', 'short', d -> 'short', 'crest', d -> 'crest',
      'members', coalesce(d -> 'members', '[]'::jsonb), 'games', coalesce(d -> 'games', '{}'::jsonb), '_rev', d -> '_rev',
      'orgs', coalesce((select jsonb_agg(o) from jsonb_array_elements(coalesce(d -> 'orgs', '[]'::jsonb)) o where o ->> 'id' = org), '[]'::jsonb));
  end if;
  raise exception 'not allowed' using errcode = '42501';
end $$;

-- compare-and-swap save of the organization's row (p_rev = the _rev last seen; null when the row is new)
create or replace function public.hub_key_write(p_key text, p_id text, p_data jsonb, p_rev int) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; n int;
begin
  org := hub_key_org(p_key);
  if org is null or p_id is distinct from org then raise exception 'not allowed' using errcode = '42501'; end if;
  if pg_column_size(p_data) > 8000000 then raise exception 'Too large'; end if;
  if p_rev is null then
    update mga_hub set data = p_data, updated_at = now() where id = p_id and data ->> '_rev' is null;
  else
    update mga_hub set data = p_data, updated_at = now() where id = p_id and data ->> '_rev' = p_rev::text;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- add people to the club directory (ids that already exist are left exactly as they are)
create or replace function public.hub_key_people(p_key text, p_people jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; cur jsonb; add jsonb;
begin
  org := hub_key_org(p_key);
  if org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_people) <> 'array' or pg_column_size(p_people) > 1000000 then raise exception 'Bad request'; end if;
  select data into cur from mga_hub where id = 'club' for update;
  if cur is null then return false; end if;
  select coalesce(jsonb_agg(p), '[]'::jsonb) into add from jsonb_array_elements(p_people) p
   where jsonb_typeof(p) = 'object' and p ->> 'id' is not null
     and not exists (select 1 from jsonb_array_elements(coalesce(cur -> 'members', '[]'::jsonb)) m where m ->> 'id' = p ->> 'id');
  if jsonb_array_length(add) = 0 then return true; end if;
  update mga_hub set data = jsonb_set(jsonb_set(cur, '{members}', coalesce(cur -> 'members', '[]'::jsonb) || add),
                                      '{_rev}', to_jsonb(coalesce((cur ->> '_rev')::int, 0) + 1)), updated_at = now()
   where id = 'club';
  return true;
end $$;

-- live scoring for the organization's own events (public -> 'org' names the owner)
create or replace function public.hub_key_golf_event(p_key text, p_id text, p_slug text, p_public jsonb, p_codes jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; owner text;
begin
  org := hub_key_org(p_key);
  if org is null or p_public ->> 'org' is distinct from org then raise exception 'not allowed' using errcode = '42501'; end if;
  select public ->> 'org' into owner from golf_events where id = p_id;
  if found and owner is distinct from org then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into golf_events (id, slug, public, codes, updated_at) values (p_id, lower(p_slug), p_public, p_codes, now())
  on conflict (id) do update set slug = excluded.slug, public = excluded.public, codes = excluded.codes, updated_at = now();
  return true;
end $$;

create or replace function public.hub_key_golf_delete(p_key text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text;
begin
  org := hub_key_org(p_key);
  if org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from golf_events where id = p_id and public ->> 'org' = org;
  return true;
end $$;

-- the organizer's own score entry (the course-side scoring page keeps using golf_submit)
create or replace function public.hub_key_score(p_key text, p_event text, p_player text, p_hole int, p_strokes int) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text;
begin
  org := hub_key_org(p_key);
  if org is null or not exists (select 1 from golf_events where id = p_event and public ->> 'org' = org) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18'; end if;
  if p_strokes is null then
    delete from golf_scores where event_id = p_event and player_id = p_player and hole = p_hole;
  else
    if p_strokes < 1 or p_strokes > 20 then raise exception 'Score must be 1–20'; end if;
    insert into golf_scores (event_id, player_id, hole, strokes, updated_at) values (p_event, p_player, p_hole, p_strokes, now())
    on conflict (event_id, player_id, hole) do update set strokes = excluded.strokes, updated_at = now();
  end if;
  return true;
end $$;

-- cashier / check-in links for the organization's own tournaments (p_token null turns a link off)
create or replace function public.hub_key_share(p_key text, p_tid text, p_token text, p_name text, p_doc jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tid text;
begin
  org := hub_key_org(p_key);
  tid := split_part(p_tid, ':', 1);
  if org is null or not exists (select 1 from mga_hub m, jsonb_array_elements(coalesce(m.data -> 'tournaments', '[]'::jsonb)) t where m.id = org and t ->> 'id' = tid)
    then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_token is null then update calcutta_share set token = null, updated_at = now() where tid = p_tid; return true; end if;
  insert into calcutta_share (tid, token, name, doc, version, updated_at) values (p_tid, p_token, p_name, coalesce(p_doc, '{}'::jsonb), 1, now())
  on conflict (tid) do update set token = excluded.token, name = excluded.name, doc = excluded.doc, version = 1, updated_at = now();
  return true;
end $$;

revoke all on function public.hub_key_org(text), public.hub_key_read(text, text), public.hub_key_write(text, text, jsonb, int),
  public.hub_key_people(text, jsonb), public.hub_key_golf_event(text, text, text, jsonb, jsonb), public.hub_key_golf_delete(text, text),
  public.hub_key_score(text, text, text, int, int), public.hub_key_share(text, text, text, text, jsonb) from public;
grant execute on function public.hub_key_org(text), public.hub_key_read(text, text), public.hub_key_write(text, text, jsonb, int),
  public.hub_key_people(text, jsonb), public.hub_key_golf_event(text, text, text, jsonb, jsonb), public.hub_key_golf_delete(text, text),
  public.hub_key_score(text, text, text, int, int), public.hub_key_share(text, text, text, text, jsonb) to anon, authenticated;
