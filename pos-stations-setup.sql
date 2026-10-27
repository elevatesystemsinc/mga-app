-- Flagstick — point-of-sale stations: registers in each restaurant / the golf shop, kitchen expo screens, server PINs.
-- Run once in the Supabase SQL Editor after pos-setup.sql and billing-setup.sql. Idempotent.
--
-- A station is a device (a tablet at the bar, the PC in the shop) that opened its own link once (pos.html?s=TOKEN or
-- expo.html?k=TOKEN) and stays signed in — no hub login on the floor. Everything it does goes through the pos_* functions
-- below, keyed by the token (hash stored, like admin links); servers unlock it with their PIN (sha256 of tenant:pin,
-- kept in the club document, checked here), a manager PIN lets someone leave the station. Open checks live in
-- pos_tickets (status open, with table, server, guests); a fired course is a row in pos_fires per expo station.

create table if not exists public.pos_stations (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  outlet      text not null,
  kind        text not null default 'register',          -- register | expo
  expo        text,                                        -- expo stations: the prep station id in CLUB.pos (outlet.expos[].id)
  name        text not null,
  key_hash    text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  last_seen   timestamptz
);
create index if not exists pos_stations_hash on public.pos_stations (key_hash);
alter table public.pos_stations enable row level security;
drop policy if exists "staff manage stations" on public.pos_stations;
create policy "staff manage stations" on public.pos_stations for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.pos_stations to authenticated;

alter table public.pos_tickets add column if not exists station uuid;
alter table public.pos_tickets add column if not exists table_no text;
alter table public.pos_tickets add column if not exists server text;
alter table public.pos_tickets add column if not exists server_id text;
alter table public.pos_tickets add column if not exists guests int not null default 0;
alter table public.pos_tickets add column if not exists updated_at timestamptz not null default now();

create table if not exists public.pos_fires (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  outlet      text not null,
  expo        text not null,
  station     uuid,
  ticket      uuid,
  table_no    text,
  server      text,
  lines       jsonb not null default '[]'::jsonb,
  note        text,
  fired_at    timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists pos_fires_expo on public.pos_fires (tenant, expo, fired_at);
alter table public.pos_fires enable row level security;
drop policy if exists "staff manage fires" on public.pos_fires;
create policy "staff manage fires" on public.pos_fires for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
drop policy if exists "expo screens read fires" on public.pos_fires;
create policy "expo screens read fires" on public.pos_fires for select to anon using (true);   -- a kitchen screen follows its expo id in realtime; the rows hold table, items and a first name
grant select, insert, update, delete on public.pos_fires to authenticated;
grant select on public.pos_fires to anon;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pos_fires') then
    alter publication supabase_realtime add table public.pos_fires;
  end if;
end $$;

-- the station behind a token
create or replace function public.pos_station(p_key text) returns pos_stations
language sql stable security definer set search_path = public as $$
  select * from pos_stations where p_key is not null and length(p_key) >= 16 and key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null limit 1;
$$;

-- what a register needs to run: the outlet, its menus and products, tables, expos, who may sign in (names only), rates, the brand
create or replace function public.pos_boot(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; club jsonb; o jsonb; t tenants;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  update pos_stations set last_seen = now() where id = s.id;
  select data into club from mga_hub where tenant = s.tenant and id = 'club';
  select x into o from jsonb_array_elements(club -> 'pos' -> 'outlets') x where x ->> 'id' = s.outlet;
  select * into t from tenants where slug = s.tenant;
  return jsonb_build_object(
    'station', jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'expo', s.expo, 'outlet', s.outlet),
    'club', club ->> 'name', 'brand', club -> 'brand' ->> 'logo', 'tenant', s.tenant,
    'outlet', o,
    'products', coalesce((select jsonb_agg(p) from jsonb_array_elements(club -> 'pos' -> 'products') p where p ->> 'outlet' = s.outlet and coalesce((p ->> 'active')::boolean, true)), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'role', x ->> 'role')) from jsonb_array_elements(coalesce(club -> 'pos' -> 'staff', '[]'::jsonb)) x
                        where coalesce((x ->> 'active')::boolean, true) and (jsonb_array_length(coalesce(x -> 'outlets', '[]'::jsonb)) = 0 or x -> 'outlets' ? s.outlet)), '[]'::jsonb),
    'rates', jsonb_build_object('tax', coalesce((club -> 'billing' -> 'tax' ->> 'rate')::numeric, 0), 'svc', coalesce((club -> 'billing' -> 'svc' ->> 'rate')::numeric, 0)),
    'item', (select x from jsonb_array_elements(coalesce(club -> 'billing' -> 'items', '[]'::jsonb)) x where x ->> 'id' = o ->> 'item'),
    'billing', coalesce((t.modules ->> 'billing')::boolean, false) or coalesce((t.modules ->> 'club')::boolean, false));
end $$;

-- a PIN unlocks a server, bartender or manager at this station; the hash in the club document is sha256('<tenant>:<pin>')
create or replace function public.pos_pin(p_key text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; club jsonb; h text; x jsonb;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  if p_pin is null or length(p_pin) < 4 then return null; end if;
  select data into club from mga_hub where tenant = s.tenant and id = 'club';
  h := encode(sha256(convert_to(s.tenant || ':' || p_pin, 'UTF8')), 'hex');
  select y into x from jsonb_array_elements(coalesce(club -> 'pos' -> 'staff', '[]'::jsonb)) y
   where y ->> 'pin' = h and coalesce((y ->> 'active')::boolean, true) and (jsonb_array_length(coalesce(y -> 'outlets', '[]'::jsonb)) = 0 or y -> 'outlets' ? s.outlet) limit 1;
  if x is null then return null; end if;
  return jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'role', coalesce(x ->> 'role', 'server'));
end $$;

-- members for charging to an account: name, number, status — never e-mail or balance
create or replace function public.pos_members(p_key text, p_q text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m ->> 'id', 'name', trim(coalesce(m ->> 'first', '') || ' ' || coalesce(m ->> 'last', '')), 'memberNo', m ->> 'memberNo', 'suspended', (m -> 'billing' ->> 'status') = 'suspended')), '[]'::jsonb)
  from (select m from pos_station(p_key) s, mga_hub h, jsonb_array_elements(h.data -> 'members') m
         where h.tenant = s.tenant and h.id = 'club' and coalesce(m ->> 'status', 'Active') <> 'Inactive' and length(coalesce(p_q, '')) >= 2
           and (lower(coalesce(m ->> 'first', '') || ' ' || coalesce(m ->> 'last', '')) like '%' || lower(p_q) || '%' or lower(coalesce(m ->> 'last', '')) like lower(p_q) || '%' or coalesce(m ->> 'memberNo', '') = p_q)
         order by m ->> 'last', m ->> 'first' limit 8) q;
$$;

-- the outlet's open checks (every station of the outlet sees them: a server moves between terminals)
create or replace function public.pos_checks(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) from pos_station(p_key) s, pos_tickets t
   where t.tenant = s.tenant and t.outlet = s.outlet and t.status = 'open';
$$;

-- save an open check (new or changed): lines, table, server, guests, note, who it is for
create or replace function public.pos_check_put(p_key text, p_check jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; tid uuid; r pos_tickets;   -- not `id`: a variable named id makes `on conflict (id)` ambiguous
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  tid := coalesce((p_check ->> 'id')::uuid, gen_random_uuid());
  insert into pos_tickets (id, tenant, outlet, station, table_no, server, server_id, guests, member_id, guest, lines, note, subtotal, svc, tax, tip, total, status, created_at, created_by, updated_at)
    values (tid, s.tenant, s.outlet, s.id, p_check ->> 'table_no', p_check ->> 'server', p_check ->> 'server_id', coalesce((p_check ->> 'guests')::int, 0), p_check ->> 'member_id', p_check ->> 'guest',
            coalesce(p_check -> 'lines', '[]'::jsonb), p_check ->> 'note', coalesce((p_check ->> 'subtotal')::numeric, 0), coalesce((p_check ->> 'svc')::numeric, 0), coalesce((p_check ->> 'tax')::numeric, 0), coalesce((p_check ->> 'tip')::numeric, 0), coalesce((p_check ->> 'total')::numeric, 0),
            'open', now(), coalesce(p_check ->> 'server', 'station'), now())
    on conflict (id) do update set table_no = excluded.table_no, server = excluded.server, server_id = excluded.server_id, guests = excluded.guests, member_id = excluded.member_id, guest = excluded.guest,
            lines = excluded.lines, note = excluded.note, subtotal = excluded.subtotal, svc = excluded.svc, tax = excluded.tax, tip = excluded.tip, total = excluded.total, updated_at = now()
    where pos_tickets.status = 'open' and pos_tickets.tenant = s.tenant and pos_tickets.outlet = s.outlet;
  select * into r from pos_tickets where pos_tickets.id = tid;
  return to_jsonb(r);
end $$;

-- fire what has not been sent: one row per expo station, the lines marked fired on the check
create or replace function public.pos_fire(p_key text, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; e text; n int := 0; new_lines jsonb;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'open' for update;
  if r.id is null then raise exception 'Check not open'; end if;
  for e in select distinct l ->> 'route' from jsonb_array_elements(r.lines) l where coalesce(l ->> 'route', '') <> '' and not coalesce((l ->> 'fired')::boolean, false) loop
    insert into pos_fires (tenant, outlet, expo, station, ticket, table_no, server, lines)
      select s.tenant, s.outlet, e, s.id, r.id, r.table_no, r.server, jsonb_agg(l) from jsonb_array_elements(r.lines) l where l ->> 'route' = e and not coalesce((l ->> 'fired')::boolean, false);
    n := n + 1;
  end loop;
  select coalesce(jsonb_agg(case when coalesce(l ->> 'route', '') <> '' and not coalesce((l ->> 'fired')::boolean, false) then l || jsonb_build_object('fired', true, 'fired_at', now()) else l end), '[]'::jsonb) into new_lines from jsonb_array_elements(r.lines) l;
  update pos_tickets set lines = new_lines, updated_at = now() where id = r.id;
  return jsonb_build_object('fired', n, 'lines', new_lines);
end $$;

-- close a check: paid on the member's account (one acct_items charge with tax and service charge), or cash / card at the station
create or replace function public.pos_close(p_key text, p_ticket uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; club jsonb; o jsonb; it jsonb; m jsonb; paid text; aid uuid; descr text;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'open' for update;
  if r.id is null then raise exception 'Check not open'; end if;
  paid := coalesce(p_data ->> 'paid', 'cash');
  update pos_tickets set lines = coalesce(p_data -> 'lines', lines), tip = coalesce((p_data ->> 'tip')::numeric, tip), subtotal = coalesce((p_data ->> 'subtotal')::numeric, subtotal), svc = coalesce((p_data ->> 'svc')::numeric, svc), tax = coalesce((p_data ->> 'tax')::numeric, tax), total = coalesce((p_data ->> 'total')::numeric, total),
      member_id = coalesce(p_data ->> 'member_id', member_id), guest = coalesce(p_data ->> 'guest', guest), paid = paid, status = 'closed', closed_at = now(), updated_at = now() where id = r.id returning * into r;
  if paid = 'account' then
    if r.member_id is null then raise exception 'Pick the member first'; end if;
    select data into club from mga_hub where tenant = s.tenant and id = 'club';
    select x into m from jsonb_array_elements(club -> 'members') x where x ->> 'id' = r.member_id;
    if m is null then raise exception 'Unknown member'; end if;
    if (m -> 'billing' ->> 'status') = 'suspended' then raise exception 'This member is suspended — no charges to the account'; end if;
    select x into o from jsonb_array_elements(club -> 'pos' -> 'outlets') x where x ->> 'id' = s.outlet;
    select x into it from jsonb_array_elements(coalesce(club -> 'billing' -> 'items', '[]'::jsonb)) x where x ->> 'id' = coalesce(o ->> 'item', 'fnb');
    descr := left(coalesce(o ->> 'name', s.outlet) || ' · ' || coalesce((select string_agg(case when (l ->> 'qty')::numeric > 1 then (l ->> 'qty') || '× ' else '' end || (l ->> 'name'), ', ') from jsonb_array_elements(r.lines) l), ''), 180);
    insert into acct_items (tenant, member_id, kind, source, item, gl, ref, descr, amount, tax, svc, posted, created_by)
      values (s.tenant, r.member_id, 'charge', coalesce(it ->> 'source', case when o ->> 'kind' = 'proshop' then 'proshop' else 'fnb' end), coalesce(it ->> 'id', coalesce(o ->> 'item', 'fnb')), it ->> 'gl', 'pos:' || r.id::text, descr, r.total, r.tax, r.svc, current_date, coalesce(r.server, 'station'))
      returning acct_items.id into aid;
    update pos_tickets set acct_item = aid where id = r.id;
  end if;
  select * into r from pos_tickets where id = r.id;
  return to_jsonb(r);
end $$;

create or replace function public.pos_void(p_key text, p_ticket uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet for update;
  if r.id is null then raise exception 'Unknown check'; end if;
  update pos_tickets set status = 'void', void_at = now(), void_reason = left(coalesce(p_reason, ''), 200), updated_at = now() where id = r.id;
  if r.acct_item is not null then update acct_items set void_at = now(), void_reason = 'Check voided at the station: ' || left(coalesce(p_reason, ''), 150) where id = r.acct_item and void_at is null; end if;
  return true;
end $$;

-- the expo screen: what is on the rail for this station, and the last few bumped
create or replace function public.pos_expo(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('station', jsonb_build_object('id', s.id, 'name', s.name, 'outlet', s.outlet, 'expo', s.expo),
    'open', coalesce((select jsonb_agg(to_jsonb(f) order by f.fired_at) from pos_fires f where f.tenant = s.tenant and f.expo = s.expo and f.done_at is null), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(to_jsonb(f) order by f.done_at desc) from (select * from pos_fires f where f.tenant = s.tenant and f.expo = s.expo and f.done_at is not null order by f.done_at desc limit 12) f), '[]'::jsonb))
  from pos_station(p_key) s where s.kind = 'expo';
$$;
create or replace function public.pos_bump(p_key text, p_fire uuid, p_undo boolean default false) returns boolean
language sql security definer set search_path = public as $$
  update pos_fires f set done_at = case when p_undo then null else now() end from pos_station(p_key) s where f.id = p_fire and f.tenant = s.tenant and f.expo = s.expo returning true;
$$;

revoke all on function public.pos_station(text) from public;
grant execute on function public.pos_boot(text), public.pos_pin(text, text), public.pos_members(text, text), public.pos_checks(text), public.pos_check_put(text, jsonb), public.pos_fire(text, uuid), public.pos_close(text, uuid, jsonb), public.pos_void(text, uuid, text), public.pos_expo(text), public.pos_bump(text, uuid, boolean) to anon, authenticated;
