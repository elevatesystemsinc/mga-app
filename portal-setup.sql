-- Flagstick — the client portal and per-login scope. Run AFTER tenants-setup.sql in the Supabase SQL Editor;
-- safe to run again.
--
--   tenants          gains the client record: address, phone, website, billing e-mail, dates, statuses incl. inactive
--   tenant_contacts  points of contact per client
--   tenant_users     gains name + ROLE/SCOPE: role 'staff' = the club's staff (the whole club; created by Flagstick),
--                    'org' = a board login that sees only the organizations in `orgs` (an MGA board member sees the
--                    MGA and nothing else); `manage` on an org login = a board administrator who may invite and
--                    remove that board's logins. Staff manage every board login of their club.
--   tenant_events    the activity log the portal writes
-- Scope is enforced by row level security: can_org(tenant, org) replaces can_tenant(tenant) on every data table.
-- A scoped login never reads the club document directly; scoped_read() hands it the same cut-down copy an admin
-- link gets (directory, its own organizations, the game library) and scoped_people() lets it add people.
-- Privileged account actions (create a login with a password, set a password, invite, delete, one-click sign-in
-- for Flagstick admins) run in the Edge Function supabase/functions/admin-users; the read-only look-ups below
-- (admin_users_info, admin_user_by_email) need no function.

-- ---------------------------------------------------------------- 1. the client record
alter table public.tenants add column if not exists address       jsonb not null default '{}'::jsonb;   -- {line1,line2,city,state,zip,country}
alter table public.tenants add column if not exists phone         text  not null default '';
alter table public.tenants add column if not exists website       text  not null default '';
alter table public.tenants add column if not exists timezone      text  not null default '';
alter table public.tenants add column if not exists billing_email text  not null default '';
alter table public.tenants add column if not exists started_on    date;
alter table public.tenants add column if not exists renews_on     date;
alter table public.tenants add column if not exists ended_on      date;
alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants add constraint tenants_status_check check (status in ('prospect','trial','active','suspended','inactive'));
-- Golf management is the package (everything built so far); the old associations / groups / club boxes fold into it
update public.tenants set plan = 'golf', modules = (modules - 'associations' - 'groups' - 'club') || '{"golf":true}'::jsonb
 where modules ? 'associations' or modules ? 'groups';

create table if not exists public.tenant_contacts (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null references public.tenants(slug) on delete cascade,
  name       text not null,
  title      text not null default '',
  email      text not null default '',
  phone      text not null default '',
  is_primary boolean not null default false,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_contacts enable row level security;
drop policy if exists "contacts: own or admin" on public.tenant_contacts;
drop policy if exists "contacts: admin writes" on public.tenant_contacts;
create policy "contacts: own or admin" on public.tenant_contacts for select to authenticated using (can_tenant(tenant));
create policy "contacts: admin writes" on public.tenant_contacts for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin());

create table if not exists public.tenant_events (
  id         uuid primary key default gen_random_uuid(),
  tenant     text references public.tenants(slug) on delete cascade,   -- null = Flagstick-level (team changes)
  at         timestamptz not null default now(),
  actor      text not null default '',
  kind       text not null default '',
  text       text not null default ''
);
alter table public.tenant_events enable row level security;
drop policy if exists "events: admin" on public.tenant_events;
create policy "events: admin" on public.tenant_events for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin());
grant select, insert, update, delete on public.tenant_contacts, public.tenant_events to authenticated;

-- ---------------------------------------------------------------- 2. logins: name, role, scope
alter table public.tenant_users add column if not exists name       text not null default '';
alter table public.tenant_users add column if not exists orgs       text[] not null default '{}';
alter table public.tenant_users add column if not exists invited_at timestamptz;
alter table public.tenant_users add column if not exists manage boolean not null default false;
-- role: 'staff' = the whole club (the club hub and every organization); 'org' = only `orgs`
update public.tenant_users set role = 'staff' where role in ('admin', 'board');

create or replace function public.can_org(p_tenant text, p_org text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_flagstick_admin() or exists (
    select 1 from tenant_users u where u.user_id = auth.uid() and u.tenant = p_tenant
      and (u.role = 'staff' or p_org = any(u.orgs)));
$$;
-- who may see / create / change / remove a login row: Flagstick, the club's staff, or a board administrator for
-- board logins inside their own organizations (never staff rows, never organizations they don't have)
create or replace function public.can_manage_login(p_tenant text, p_role text, p_orgs text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_flagstick_admin() or exists (
    select 1 from tenant_users u where u.user_id = auth.uid() and u.tenant = p_tenant
      and (u.role = 'staff' or (u.role = 'org' and u.manage and p_role = 'org' and coalesce(p_orgs, '{}') <@ u.orgs)));
$$;
drop policy if exists "tenant_users: own or admin" on public.tenant_users;
drop policy if exists "tenant_users: admin writes" on public.tenant_users;
drop policy if exists "tenant_users: see" on public.tenant_users;
drop policy if exists "tenant_users: manage" on public.tenant_users;
create policy "tenant_users: see"    on public.tenant_users for select to authenticated using (user_id = auth.uid() or can_manage_login(tenant, role, orgs));
create policy "tenant_users: manage" on public.tenant_users for all to authenticated using (can_manage_login(tenant, role, orgs)) with check (can_manage_login(tenant, role, orgs));
-- the organization that owns a cashier / check-in link (tid = tournament id, or tournament id + ':checkin')
alter table public.calcutta_share add column if not exists org text;
update public.calcutta_share s set org = x.org
  from (select m.tenant, m.id as org, t ->> 'id' as tid from mga_hub m, jsonb_array_elements(coalesce(m.data -> 'tournaments', '[]'::jsonb)) t) x
 where s.org is null and s.tenant = x.tenant and split_part(s.tid, ':', 1) = x.tid;

-- what the signed-in user may open: admin flag, the tenants, and the grant per tenant
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', is_flagstick_admin(),
    'tenants', coalesce((select jsonb_agg(t) from my_tenants() t), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('tenant', tenant, 'role', role, 'orgs', to_jsonb(orgs), 'manage', manage, 'name', name)) from tenant_users where user_id = auth.uid()), '[]'::jsonb),
    'user_id', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()));
$$;

-- ---------------------------------------------------------------- 3. row level security by organization
drop policy if exists "tenant board reads hub"   on public.mga_hub;
drop policy if exists "tenant board inserts hub" on public.mga_hub;
drop policy if exists "tenant board updates hub" on public.mga_hub;
create policy "tenant board reads hub"   on public.mga_hub for select to authenticated using (can_org(tenant, id));
create policy "tenant board inserts hub" on public.mga_hub for insert to authenticated with check (can_org(tenant, id));
create policy "tenant board updates hub" on public.mga_hub for update to authenticated using (can_org(tenant, id)) with check (can_org(tenant, id));

drop policy if exists "tenant board manages golf events" on public.golf_events;
create policy "tenant board manages golf events" on public.golf_events for all to authenticated
  using (can_org(tenant, public ->> 'org')) with check (can_org(tenant, public ->> 'org'));
drop policy if exists "tenant board manages golf scores" on public.golf_scores;
create policy "tenant board manages golf scores" on public.golf_scores for all to authenticated
  using (exists (select 1 from golf_events e where e.id = event_id and can_org(e.tenant, e.public ->> 'org')))
  with check (exists (select 1 from golf_events e where e.id = event_id and can_org(e.tenant, e.public ->> 'org')));
drop policy if exists "tenant board manages calcutta shares" on public.calcutta_share;
create policy "tenant board manages calcutta shares" on public.calcutta_share for all to authenticated
  using (can_org(tenant, coalesce(org, ''))) with check (can_org(tenant, coalesce(org, '')));
drop policy if exists "tenant board manages admin links" on public.hub_keys;
create policy "tenant board manages admin links" on public.hub_keys for all to authenticated
  using (can_org(tenant, org_id)) with check (can_org(tenant, org_id));

-- ---------------------------------------------------------------- 4. what a scoped login gets of the club document
create or replace function public.scoped_read(p_tenant text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u tenant_users; d jsonb;
begin
  select * into u from tenant_users where user_id = auth.uid() and tenant = p_tenant;
  if u.user_id is null and not is_flagstick_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if can_org(p_tenant, p_id) then select data into d from mga_hub where tenant = p_tenant and id = p_id; return d; end if;
  if p_id = 'club' then
    select data into d from mga_hub where tenant = p_tenant and id = 'club';
    if d is null then return null; end if;
    return jsonb_build_object('id', 'club', 'kind', 'club', 'name', d -> 'name', 'short', d -> 'short',
      'members', coalesce(d -> 'members', '[]'::jsonb), 'games', coalesce(d -> 'games', '{}'::jsonb), '_rev', d -> '_rev',
      'orgs', coalesce((select jsonb_agg(o) from jsonb_array_elements(coalesce(d -> 'orgs', '[]'::jsonb)) o where o ->> 'id' = any(u.orgs)), '[]'::jsonb));
  end if;
  raise exception 'not allowed' using errcode = '42501';
end $$;
create or replace function public.scoped_people(p_tenant text, p_people jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur jsonb; add jsonb;
begin
  if not exists (select 1 from tenant_users where user_id = auth.uid() and tenant = p_tenant) and not is_flagstick_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_people) <> 'array' or pg_column_size(p_people) > 1000000 then raise exception 'Bad request'; end if;
  select data into cur from mga_hub where tenant = p_tenant and id = 'club' for update;
  if cur is null then return false; end if;
  select coalesce(jsonb_agg(p), '[]'::jsonb) into add from jsonb_array_elements(p_people) p
   where jsonb_typeof(p) = 'object' and p ->> 'id' is not null
     and not exists (select 1 from jsonb_array_elements(coalesce(cur -> 'members', '[]'::jsonb)) m where m ->> 'id' = p ->> 'id');
  if jsonb_array_length(add) = 0 then return true; end if;
  update mga_hub set data = jsonb_set(jsonb_set(cur, '{members}', coalesce(cur -> 'members', '[]'::jsonb) || add),
                                      '{_rev}', to_jsonb(coalesce((cur ->> '_rev')::int, 0) + 1)), updated_at = now()
   where tenant = p_tenant and id = 'club';
  return true;
end $$;
revoke all on function public.scoped_read(text, text), public.scoped_people(text, jsonb) from public;
grant execute on function public.scoped_read(text, text), public.scoped_people(text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 5. the portal's read-only look-ups into auth.users (Flagstick admins only)
create or replace function public.admin_users_info(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_flagstick_admin() or exists (select 1 from tenant_users where user_id = auth.uid() and (role = 'staff' or manage)) then
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at,
                                                  'confirmed', email_confirmed_at is not null, 'name', raw_user_meta_data ->> 'name'))
              from auth.users where id = any(p_ids)), '[]'::jsonb)
  else null end;
$$;
create or replace function public.admin_user_by_email(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_flagstick_admin() or exists (select 1 from tenant_users where user_id = auth.uid() and (role = 'staff' or manage)) then
    (select jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at, 'confirmed', email_confirmed_at is not null)
       from auth.users where lower(email) = lower(trim(p_email)) limit 1)
  else null end;
$$;
revoke all on function public.admin_users_info(uuid[]), public.admin_user_by_email(text) from public;
grant execute on function public.admin_users_info(uuid[]), public.admin_user_by_email(text) to authenticated;

-- Check
select slug, status, plan from public.tenants;
select tenant, email, role, orgs, manage from public.tenant_users;
