-- Flagstick — tenants (multi-club). Run once in the Supabase SQL Editor; safe to run again.
--
-- One Supabase project serves every club. Every row carries `tenant` (the club's slug, which is also its
-- subdomain: wccc.flagstickhub.com). Everything that exists today becomes tenant 'wccc'.
--   tenants          one row per client: name, plan, the module switchboard, status, extra hosts, the board login
--   tenant_users     which signed-in users may open which tenant (the board logins)
--   flagstick_admins Flagstick's own people: the portal at app.flagstickhub.com, and support access everywhere
-- Row Level Security: a signed-in user reaches only the rows of tenants they belong to; a Flagstick admin reaches all.
-- The public pages (scoring, cashier, check-in) keep working through their token / slug functions.
--
-- BEFORE RUNNING: replace the two e-mail addresses marked >>> below.

-- ---------------------------------------------------------------- 1. tenants, users, admins
create table if not exists public.tenants (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name        text not null,
  short       text not null default '',
  plan        text not null default 'golf',                    -- 'golf' (the package) | 'club' (a preset; the switches below decide)
  modules     jsonb not null default '{"golf":true}'::jsonb,   -- {"golf":true,"club":false,"billing":false,"pos":false}
  status      text not null default 'active' check (status in ('active','trial','suspended')),
  hosts       jsonb not null default '[]'::jsonb,              -- extra host names that open this tenant, e.g. ["app.wcccmga.org"]
  login_email text,                                            -- the board login shown on the sign-in card
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.tenant_users (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant     text not null references public.tenants(slug) on delete cascade,
  role       text not null default 'board',
  email      text,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant)
);
create table if not exists public.flagstick_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.flagstick_admins enable row level security;

-- who am I (security definer so RLS policies can call them without recursion)
create or replace function public.is_flagstick_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from flagstick_admins where user_id = auth.uid());
$$;
create or replace function public.my_tenants() returns setof text
language sql stable security definer set search_path = public as $$
  select tenant from tenant_users where user_id = auth.uid();
$$;
create or replace function public.can_tenant(p_tenant text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_flagstick_admin() or exists (select 1 from tenant_users where user_id = auth.uid() and tenant = p_tenant);
$$;

-- ---------------------------------------------------------------- 2. tenant column everywhere; today's rows → 'wccc'
insert into public.tenants (slug, name, short, plan, modules, status, hosts, login_email)
values ('wccc', 'Walnut Creek Country Club', 'WCCC', 'golf',
        '{"golf":true}'::jsonb, 'active',
        '["app.wcccmga.org","hub.wcccmga.org"]'::jsonb, 'vicepresident@wcccmga.org')
on conflict (slug) do nothing;

alter table public.mga_hub add column if not exists tenant text not null default 'wccc' references public.tenants(slug);
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'mga_hub_pkey' and conrelid = 'public.mga_hub'::regclass
             and array_length(conkey, 1) = 1) then
    alter table public.mga_hub drop constraint mga_hub_pkey;
    alter table public.mga_hub add primary key (tenant, id);
  end if;
end $$;

alter table public.golf_events add column if not exists tenant text not null default 'wccc' references public.tenants(slug);
alter table public.golf_events drop constraint if exists golf_events_slug_key;
create unique index if not exists golf_events_tenant_slug on public.golf_events (tenant, lower(slug));
alter table public.golf_scores add column if not exists tenant text not null default 'wccc';
update public.golf_scores s set tenant = e.tenant from public.golf_events e where e.id = s.event_id and s.tenant is distinct from e.tenant;

alter table public.calcutta_share add column if not exists tenant text not null default 'wccc' references public.tenants(slug);
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'calcutta_share_pkey' and conrelid = 'public.calcutta_share'::regclass
             and array_length(conkey, 1) = 1) then
    alter table public.calcutta_share drop constraint calcutta_share_pkey;
    alter table public.calcutta_share add primary key (tenant, tid);
  end if;
end $$;

alter table public.hub_keys add column if not exists tenant text not null default 'wccc' references public.tenants(slug);

-- ---------------------------------------------------------------- 3. row level security by tenant
drop policy if exists "board can read hub"   on public.mga_hub;
drop policy if exists "board can insert hub" on public.mga_hub;
drop policy if exists "board can update hub" on public.mga_hub;
drop policy if exists "tenant board reads hub"   on public.mga_hub;
drop policy if exists "tenant board inserts hub" on public.mga_hub;
drop policy if exists "tenant board updates hub" on public.mga_hub;
create policy "tenant board reads hub"   on public.mga_hub for select to authenticated using (can_tenant(tenant));
create policy "tenant board inserts hub" on public.mga_hub for insert to authenticated with check (can_tenant(tenant));
create policy "tenant board updates hub" on public.mga_hub for update to authenticated using (can_tenant(tenant)) with check (can_tenant(tenant));
-- still no delete policy on purpose

drop policy if exists "board manages golf events" on public.golf_events;
drop policy if exists "tenant board manages golf events" on public.golf_events;
create policy "tenant board manages golf events" on public.golf_events for all to authenticated using (can_tenant(tenant)) with check (can_tenant(tenant));
drop policy if exists "board manages golf scores" on public.golf_scores;
drop policy if exists "tenant board manages golf scores" on public.golf_scores;
create policy "tenant board manages golf scores" on public.golf_scores for all to authenticated using (can_tenant(tenant)) with check (can_tenant(tenant));
-- "anyone can read scores" (anon select) stays: the public leaderboards need it

drop policy if exists "board manages calcutta shares" on public.calcutta_share;
drop policy if exists "tenant board manages calcutta shares" on public.calcutta_share;
create policy "tenant board manages calcutta shares" on public.calcutta_share for all to authenticated using (can_tenant(tenant)) with check (can_tenant(tenant));

drop policy if exists "board manages admin links" on public.hub_keys;
drop policy if exists "tenant board manages admin links" on public.hub_keys;
create policy "tenant board manages admin links" on public.hub_keys for all to authenticated using (can_tenant(tenant)) with check (can_tenant(tenant));

drop policy if exists "tenants: own or admin" on public.tenants;
drop policy if exists "tenants: admin writes" on public.tenants;
create policy "tenants: own or admin" on public.tenants for select to authenticated using (can_tenant(slug));
create policy "tenants: admin writes" on public.tenants for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin());
drop policy if exists "tenant_users: own or admin" on public.tenant_users;
drop policy if exists "tenant_users: admin writes" on public.tenant_users;
create policy "tenant_users: own or admin" on public.tenant_users for select to authenticated using (user_id = auth.uid() or is_flagstick_admin());
create policy "tenant_users: admin writes" on public.tenant_users for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin());
drop policy if exists "flagstick_admins: admins" on public.flagstick_admins;
create policy "flagstick_admins: admins" on public.flagstick_admins for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tenants, public.tenant_users, public.flagstick_admins to authenticated;

-- ---------------------------------------------------------------- 4. the public look-ups the pages make before anyone signs in
-- which tenant a host name opens: <slug>.flagstickhub.com, one of the tenant's extra hosts, or the bare slug (dev)
create or replace function public.tenant_lookup(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'name', name, 'short', short, 'plan', plan, 'modules', modules,
                            'status', status, 'login_email', login_email)
  from tenants
  where lower(split_part(coalesce(p_host, ''), ':', 1)) in (slug, slug || '.flagstickhub.com')
     or hosts ? lower(split_part(coalesce(p_host, ''), ':', 1))
  limit 1;
$$;
-- what the signed-in user may open
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', is_flagstick_admin(), 'tenants', coalesce((select jsonb_agg(t) from my_tenants() t), '[]'::jsonb),
                            'email', (select email from auth.users where id = auth.uid()));
$$;
revoke all on function public.tenant_lookup(text), public.my_access() from public;
grant execute on function public.tenant_lookup(text) to anon, authenticated;
grant execute on function public.my_access() to authenticated;

-- ---------------------------------------------------------------- 5. public scoring functions, tenant-aware
-- (the slug is unique per tenant now; the scoring page passes the tenant it runs under, older pages pass nothing)
drop function if exists public.golf_event(text);
create or replace function public.golf_event(p_slug text, p_tenant text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select public || jsonb_build_object('id', id, 'tenant', tenant) from golf_events
   where lower(slug) = lower(trim(p_slug)) and (p_tenant is null or tenant = p_tenant)
   order by updated_at desc limit 1;
$$;
drop function if exists public.golf_join(text, text);
create or replace function public.golf_join(p_slug text, p_code text, p_tenant text default null) returns text
language sql stable security definer set search_path = public as $$
  select codes ->> upper(trim(p_code)) from golf_events
   where lower(slug) = lower(trim(p_slug)) and (p_tenant is null or tenant = p_tenant)
   order by updated_at desc limit 1;
$$;
create or replace function public.golf_submit(p_event text, p_code text, p_player text, p_hole int, p_strokes int)
returns boolean language plpgsql security definer set search_path = public as $$
declare gid text; st text; tn text; ok boolean;
begin
  select codes ->> upper(trim(p_code)), public ->> 'status', tenant into gid, st, tn from golf_events where id = p_event;
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
    insert into golf_scores (event_id, player_id, hole, strokes, group_id, tenant, updated_at)
    values (p_event, p_player, p_hole, p_strokes, gid, tn, now())
    on conflict (event_id, player_id, hole) do update set strokes = excluded.strokes, group_id = excluded.group_id, tenant = excluded.tenant, updated_at = now();
  end if;
  return true;
end $$;
revoke all on function public.golf_event(text, text), public.golf_join(text, text, text), public.golf_submit(text, text, text, int, int) from public;
grant execute on function public.golf_event(text, text), public.golf_join(text, text, text), public.golf_submit(text, text, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------- 6. admin-link functions, tenant-aware
-- (same contract as admin-links-setup.sql; every row they touch is the key's own tenant)
create or replace function public.hub_key_tenant(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select tenant from hub_keys
   where p_key is not null and length(p_key) >= 16
     and key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null
   limit 1;
$$;
create or replace function public.hub_key_org(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select org_id from hub_keys
   where p_key is not null and length(p_key) >= 16
     and key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null
   limit 1;
$$;
create or replace function public.hub_key_read(p_key text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org text; tn text; d jsonb;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null then raise exception 'invalid key' using errcode = '42501'; end if;
  if p_id = org then select data into d from mga_hub where tenant = tn and id = p_id; return d; end if;
  if p_id = 'club' then
    select data into d from mga_hub where tenant = tn and id = 'club';
    if d is null then return null; end if;
    return jsonb_build_object('id', 'club', 'kind', 'club', 'name', d -> 'name', 'short', d -> 'short', 'crest', d -> 'crest',
      'members', coalesce(d -> 'members', '[]'::jsonb), 'games', coalesce(d -> 'games', '{}'::jsonb), '_rev', d -> '_rev',
      'orgs', coalesce((select jsonb_agg(o) from jsonb_array_elements(coalesce(d -> 'orgs', '[]'::jsonb)) o where o ->> 'id' = org), '[]'::jsonb));
  end if;
  raise exception 'not allowed' using errcode = '42501';
end $$;
create or replace function public.hub_key_write(p_key text, p_id text, p_data jsonb, p_rev int) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text; n int;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null or p_id is distinct from org then raise exception 'not allowed' using errcode = '42501'; end if;
  if pg_column_size(p_data) > 8000000 then raise exception 'Too large'; end if;
  if p_rev is null then
    update mga_hub set data = p_data, updated_at = now() where tenant = tn and id = p_id and data ->> '_rev' is null;
  else
    update mga_hub set data = p_data, updated_at = now() where tenant = tn and id = p_id and data ->> '_rev' = p_rev::text;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;
create or replace function public.hub_key_people(p_key text, p_people jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text; cur jsonb; add jsonb;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_people) <> 'array' or pg_column_size(p_people) > 1000000 then raise exception 'Bad request'; end if;
  select data into cur from mga_hub where tenant = tn and id = 'club' for update;
  if cur is null then return false; end if;
  select coalesce(jsonb_agg(p), '[]'::jsonb) into add from jsonb_array_elements(p_people) p
   where jsonb_typeof(p) = 'object' and p ->> 'id' is not null
     and not exists (select 1 from jsonb_array_elements(coalesce(cur -> 'members', '[]'::jsonb)) m where m ->> 'id' = p ->> 'id');
  if jsonb_array_length(add) = 0 then return true; end if;
  update mga_hub set data = jsonb_set(jsonb_set(cur, '{members}', coalesce(cur -> 'members', '[]'::jsonb) || add),
                                      '{_rev}', to_jsonb(coalesce((cur ->> '_rev')::int, 0) + 1)), updated_at = now()
   where tenant = tn and id = 'club';
  return true;
end $$;
create or replace function public.hub_key_golf_event(p_key text, p_id text, p_slug text, p_public jsonb, p_codes jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text; owner text; otn text;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null or p_public ->> 'org' is distinct from org then raise exception 'not allowed' using errcode = '42501'; end if;
  select public ->> 'org', tenant into owner, otn from golf_events where id = p_id;
  if found and (owner is distinct from org or otn is distinct from tn) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into golf_events (id, slug, public, codes, tenant, updated_at) values (p_id, lower(p_slug), p_public, p_codes, tn, now())
  on conflict (id) do update set slug = excluded.slug, public = excluded.public, codes = excluded.codes, updated_at = now();
  return true;
end $$;
create or replace function public.hub_key_golf_delete(p_key text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from golf_events where id = p_id and tenant = tn and public ->> 'org' = org;
  return true;
end $$;
create or replace function public.hub_key_score(p_key text, p_event text, p_player text, p_hole int, p_strokes int) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  if org is null or not exists (select 1 from golf_events where id = p_event and tenant = tn and public ->> 'org' = org) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18'; end if;
  if p_strokes is null then
    delete from golf_scores where event_id = p_event and player_id = p_player and hole = p_hole;
  else
    if p_strokes < 1 or p_strokes > 20 then raise exception 'Score must be 1–20'; end if;
    insert into golf_scores (event_id, player_id, hole, strokes, tenant, updated_at) values (p_event, p_player, p_hole, p_strokes, tn, now())
    on conflict (event_id, player_id, hole) do update set strokes = excluded.strokes, updated_at = now();
  end if;
  return true;
end $$;
create or replace function public.hub_key_share(p_key text, p_tid text, p_token text, p_name text, p_doc jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare org text; tn text; t_id text;
begin
  org := hub_key_org(p_key); tn := hub_key_tenant(p_key);
  t_id := split_part(p_tid, ':', 1);
  if org is null or not exists (select 1 from mga_hub m, jsonb_array_elements(coalesce(m.data -> 'tournaments', '[]'::jsonb)) t where m.tenant = tn and m.id = org and t ->> 'id' = t_id)
    then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_token is null then update calcutta_share set token = null, updated_at = now() where tenant = tn and tid = p_tid; return true; end if;
  insert into calcutta_share (tenant, tid, token, name, doc, version, updated_at) values (tn, p_tid, p_token, p_name, coalesce(p_doc, '{}'::jsonb), 1, now())
  on conflict (tenant, tid) do update set token = excluded.token, name = excluded.name, doc = excluded.doc, version = 1, updated_at = now();
  return true;
end $$;
revoke all on function public.hub_key_tenant(text) from public;

-- ---------------------------------------------------------------- 7. people
-- >>> the existing board login keeps Walnut Creek:
insert into public.tenant_users (user_id, tenant, role, email)
select id, 'wccc', 'staff', email from auth.users where lower(email) = lower('vicepresident@wcccmga.org')
on conflict do nothing;
-- >>> you, as Flagstick (create the user first under Authentication → Users if it does not exist yet):
insert into public.flagstick_admins (user_id, email)
select id, email from auth.users where lower(email) = lower('YOUR-FLAGSTICK-EMAIL@example.com')
on conflict do nothing;

-- Check: one tenant, the board linked to it, and you as admin.
select slug, plan, modules, status, hosts from public.tenants;
select tenant, email, role from public.tenant_users;
select email from public.flagstick_admins;
