-- Flagstick — staff across departments: one staff list for the club (CLUB.staff, with departments and PINs), time
-- clock kiosks, and the registers reading PINs from that list. Run once in the Supabase SQL Editor after
-- pos-stations-setup.sql. Idempotent.
--
--   pos_stations.dept               a station may belong to a department instead of an outlet (kind 'clock': a time clock
--                                   kiosk for golf / racket sports / aquatics / food & beverage / the club)
--   staff_clock                     one row per clock-in: who, which department, in / out, the station that took it
--   staff_clock(key, pin, action)   from a station link (a register or a clock kiosk): 'status' | 'in' | 'out'
--   pos_boot / pos_pin              now read CLUB.staff (falling back to the old CLUB.pos.staff); a register sees the people
--                                   of its outlet's department (food & beverage, or the shop's golf / racket sports)

alter table public.pos_stations alter column outlet drop not null;
alter table public.pos_stations add column if not exists dept text;

create table if not exists public.staff_clock (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  staff_id    text not null,
  name        text,
  dept        text,
  in_at       timestamptz not null default now(),
  out_at      timestamptz,
  station     uuid,
  note        text
);
create index if not exists staff_clock_day on public.staff_clock (tenant, in_at);
alter table public.staff_clock enable row level security;
drop policy if exists "staff manage clock" on public.staff_clock;
create policy "staff manage clock" on public.staff_clock for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.staff_clock to authenticated;

-- the club's staff list: CLUB.staff, or the old CLUB.pos.staff until the hub has moved it
create or replace function public.club_staff(p_club jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(p_club -> 'staff') = 'array' and jsonb_array_length(p_club -> 'staff') > 0 then p_club -> 'staff'
              else coalesce(p_club -> 'pos' -> 'staff', '[]'::jsonb) end;
$$;

-- the department a station serves: its own, else its outlet's (restaurants are 'fnb', a shop is golf or racket sports)
create or replace function public.station_dept(p_station pos_stations, p_club jsonb) returns text
language sql stable as $$
  select coalesce(p_station.dept,
    (select case when x ->> 'kind' = 'fnb' then 'fnb' else coalesce(x ->> 'dept', 'golf') end
       from jsonb_array_elements(coalesce(p_club -> 'pos' -> 'outlets', '[]'::jsonb)) x where x ->> 'id' = p_station.outlet));
$$;

-- may this person work this station? active, the outlet when they are limited to some, the department when they have one
create or replace function public.staff_fits(p_x jsonb, p_station pos_stations, p_dept text) returns boolean
language sql immutable as $$
  select coalesce((p_x ->> 'active')::boolean, true)
     and (p_station.outlet is null or jsonb_array_length(coalesce(p_x -> 'outlets', '[]'::jsonb)) = 0 or p_x -> 'outlets' ? p_station.outlet)
     and (p_dept is null or jsonb_array_length(coalesce(p_x -> 'depts', '[]'::jsonb)) = 0 or p_x -> 'depts' ? p_dept
          or (p_dept = 'racket' and p_x -> 'depts' ? 'tennis') or (p_dept = 'aquatics' and p_x -> 'depts' ? 'pool'));
$$;

create or replace function public.pos_boot(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; club jsonb; o jsonb; t tenants; d text;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  update pos_stations set last_seen = now() where id = s.id;
  select data into club from mga_hub where tenant = s.tenant and id = 'club';
  select x into o from jsonb_array_elements(coalesce(club -> 'pos' -> 'outlets', '[]'::jsonb)) x where x ->> 'id' = s.outlet;
  select * into t from tenants where slug = s.tenant;
  d := station_dept(s, club);
  return jsonb_build_object(
    'station', jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'expo', s.expo, 'outlet', s.outlet, 'dept', d),
    'club', club ->> 'name', 'brand', club -> 'brand' ->> 'logo', 'tenant', s.tenant,
    'outlet', o,
    'products', coalesce((select jsonb_agg(p) from jsonb_array_elements(coalesce(club -> 'pos' -> 'products', '[]'::jsonb)) p where p ->> 'outlet' = s.outlet and coalesce((p ->> 'active')::boolean, true)), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'role', x ->> 'role')) from jsonb_array_elements(club_staff(club)) x where staff_fits(x, s, d)), '[]'::jsonb),
    'rates', jsonb_build_object('tax', coalesce((club -> 'billing' -> 'tax' ->> 'rate')::numeric, 0), 'svc', coalesce((club -> 'billing' -> 'svc' ->> 'rate')::numeric, 0)),
    'item', (select x from jsonb_array_elements(coalesce(club -> 'billing' -> 'items', '[]'::jsonb)) x where x ->> 'id' = o ->> 'item'),
    'billing', coalesce((t.modules ->> 'billing')::boolean, false) or coalesce((t.modules ->> 'club')::boolean, false));
end $$;

create or replace function public.pos_pin(p_key text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; club jsonb; h text; x jsonb;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  if p_pin is null or length(p_pin) < 4 then return null; end if;
  select data into club from mga_hub where tenant = s.tenant and id = 'club';
  h := encode(sha256(convert_to(s.tenant || ':' || p_pin, 'UTF8')), 'hex');
  select y into x from jsonb_array_elements(club_staff(club)) y where y ->> 'pin' = h and staff_fits(y, s, station_dept(s, club)) limit 1;
  if x is null then return null; end if;
  return jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'role', coalesce(x ->> 'role', 'server'));
end $$;

-- the time clock: from a kiosk (kind 'clock') or a register's lock screen. 'status' → who and their open clock-in, if any;
-- 'in' opens one (or returns the open one); 'out' closes the open one. A PIN that fits no one at this station → null.
create or replace function public.staff_clock(p_key text, p_pin text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; club jsonb; h text; x jsonb; d text; r staff_clock%rowtype;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  if p_pin is null or length(p_pin) < 4 then return null; end if;
  select data into club from mga_hub where tenant = s.tenant and id = 'club';
  d := station_dept(s, club);
  h := encode(sha256(convert_to(s.tenant || ':' || p_pin, 'UTF8')), 'hex');
  select y into x from jsonb_array_elements(club_staff(club)) y where y ->> 'pin' = h and staff_fits(y, s, d) limit 1;
  if x is null then return null; end if;
  select * into r from staff_clock c where c.tenant = s.tenant and c.staff_id = x ->> 'id' and c.out_at is null order by c.in_at desc limit 1;
  if p_action = 'in' and r.id is null then
    insert into staff_clock (tenant, staff_id, name, dept, station) values (s.tenant, x ->> 'id', x ->> 'name', d, s.id) returning * into r;
  elsif p_action = 'out' and r.id is not null then
    update staff_clock c set out_at = now() where c.id = r.id returning * into r;
  end if;
  update pos_stations set last_seen = now() where id = s.id;
  return jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'role', coalesce(x ->> 'role', 'staff'), 'dept', d,
    'open', case when r.id is not null and r.out_at is null then jsonb_build_object('id', r.id, 'in_at', r.in_at) else null end,
    'last', case when r.id is not null and r.out_at is not null then jsonb_build_object('id', r.id, 'in_at', r.in_at, 'out_at', r.out_at) else null end);
end $$;
revoke all on function public.staff_clock(text, text, text) from public;
grant execute on function public.staff_clock(text, text, text) to anon, authenticated;
