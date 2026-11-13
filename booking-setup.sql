-- Flagstick — bookings (module 'club'): the tee sheet, courts, pools and lessons, booked by staff on the sheet and by
-- members in the portal. Run once in the Supabase SQL Editor after member-setup.sql. Idempotent.
--
--   bookings                       one row per booking: facility, date, time, unit (course / court / lane / instructor),
--                                  the member, the players, status (booked | checked_in | cancelled | noshow), a fee posted
--   member_slots(tenant, facility, date)   a member: what is taken that day (no names) and their own bookings
--   member_book(tenant, facility, date, time, unit, players, note)   a member books inside the facility's rules
--   member_cancel(tenant, id)      a member cancels their own future booking
-- Facilities and their rules live in the club document (CLUB.booking.facilities).

create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  tenant        text not null default 'wccc' references public.tenants(slug),
  facility      text not null,
  date          date not null,
  time          text not null,                      -- 'HH:MM'
  unit          int not null default 1,
  member_id     text,
  name          text,                               -- the booking's name when it is not a member's
  players       jsonb not null default '[]'::jsonb, -- [{member_id?, name}]
  note          text,
  status        text not null default 'booked',
  source        text not null default 'staff',      -- staff | member
  acct_item     uuid,
  created_by    text,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz
);
create index if not exists bookings_day on public.bookings (tenant, facility, date);
alter table public.bookings enable row level security;
drop policy if exists "staff manage bookings" on public.bookings;
create policy "staff manage bookings" on public.bookings for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.bookings to authenticated;

-- the member behind the session: the directory person whose e-mail is the signed-in e-mail
create or replace function public.member_id_of(p_tenant text) returns text
language sql stable security definer set search_path = public as $$
  select x ->> 'id' from mga_hub h, jsonb_array_elements(h.data -> 'members') x
   where h.tenant = p_tenant and h.id = 'club' and lower(x ->> 'email') = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by (x ->> 'status') = 'Active' desc limit 1;
$$;

create or replace function public.member_slots(p_tenant text, p_facility text, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'taken', coalesce((select jsonb_agg(jsonb_build_object('time', b.time, 'unit', b.unit, 'n', greatest(1, jsonb_array_length(b.players)), 'mine', b.member_id = member_id_of(p_tenant)))
                       from bookings b where b.tenant = p_tenant and b.facility = p_facility and b.date = p_date and b.status in ('booked','checked_in')), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(to_jsonb(b) order by b.date, b.time) from bookings b
                      where b.tenant = p_tenant and b.member_id = member_id_of(p_tenant) and b.status in ('booked','checked_in') and b.date >= current_date), '[]'::jsonb));
$$;

create or replace function public.member_book(p_tenant text, p_facility text, p_date date, p_time text, p_unit int, p_players jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mid text; club jsonb; f jsonb; n int; cap int; lead int; used int; bid uuid; aid uuid; fee numeric; item jsonb; per text; m jsonb; nm text;
begin
  mid := member_id_of(p_tenant); if mid is null then raise exception 'Your e-mail is not on the club directory'; end if;
  select h.data into club from mga_hub h where h.tenant = p_tenant and h.id = 'club';
  select x into f from jsonb_array_elements(club -> 'booking' -> 'facilities') x where x ->> 'id' = p_facility;
  if f is null then raise exception 'Unknown facility'; end if;
  if coalesce((f ->> 'members')::boolean, true) = false then raise exception 'This facility is booked by the club office'; end if;
  select x into m from jsonb_array_elements(club -> 'members') x where x ->> 'id' = mid;
  if (m -> 'billing' ->> 'status') = 'suspended' then raise exception 'Your account is suspended — please see the club office'; end if;
  lead := coalesce((f ->> 'lead')::int, 7);
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_date > current_date + lead then raise exception 'Members may book up to % days ahead', lead; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'Bad time'; end if;
  if p_time < coalesce(f ->> 'open', '00:00') or p_time >= coalesce(f ->> 'close', '24:00') then raise exception 'Outside the hours'; end if;
  if ((extract(hour from p_time::time) * 60 + extract(minute from p_time::time))::int - (extract(hour from (f ->> 'open')::time) * 60 + extract(minute from (f ->> 'open')::time))::int) % greatest(1, coalesce((f ->> 'slot')::int, 60)) <> 0 then raise exception 'Not a bookable time'; end if;
  if p_unit < 1 or p_unit > greatest(1, coalesce((f ->> 'units')::int, 1)) then raise exception 'Bad unit'; end if;
  n := greatest(1, coalesce(jsonb_array_length(p_players), 1)); cap := greatest(1, coalesce((f ->> 'cap')::int, 1));
  if n > cap then raise exception 'At most % per booking', cap; end if;
  select coalesce(sum(greatest(1, jsonb_array_length(b.players))), 0) into used from bookings b where b.tenant = p_tenant and b.facility = p_facility and b.date = p_date and b.time = p_time and b.unit = p_unit and b.status in ('booked','checked_in');
  if (f ->> 'kind') = 'tee' then
    if used + n > cap then raise exception 'That tee time is full'; end if;
  elsif used > 0 then raise exception 'That time is taken'; end if;
  if exists (select 1 from bookings b where b.tenant = p_tenant and b.facility = p_facility and b.date = p_date and b.member_id = mid and b.status in ('booked','checked_in')) and coalesce((f ->> 'onePerDay')::boolean, true) then raise exception 'You already have a booking here that day'; end if;
  nm := trim(coalesce(m ->> 'first', '') || ' ' || coalesce(m ->> 'last', ''));
  insert into bookings (tenant, facility, date, time, unit, member_id, name, players, note, status, source, created_by)
    values (p_tenant, p_facility, p_date, p_time, p_unit, mid, nm, coalesce(p_players, '[]'::jsonb), left(coalesce(p_note, ''), 300), 'booked', 'member', 'member') returning bookings.id into bid;
  -- a facility fee lands on the member's account at booking time
  fee := coalesce((f -> 'fee' ->> 'amount')::numeric, 0); per := coalesce(f -> 'fee' ->> 'per', 'booking');
  if fee > 0 then
    select x into item from jsonb_array_elements(club -> 'billing' -> 'items') x where x ->> 'id' = coalesce(f -> 'fee' ->> 'item', 'facility');
    insert into acct_items (tenant, member_id, kind, source, item, gl, ref, descr, amount, posted, created_by)
      values (p_tenant, mid, 'charge', coalesce(item ->> 'source', 'facility'), coalesce(item ->> 'id', 'facility'), item ->> 'gl', 'bk:' || bid::text,
              (f ->> 'name') || ' · ' || to_char(p_date, 'Mon DD') || ' ' || p_time || case when per = 'player' then ' · ' || n || ' players' else '' end,
              case when per = 'player' then fee * n else fee end, current_date, 'member')
      returning acct_items.id into aid;
    update bookings set acct_item = aid where bookings.id = bid;
  end if;
  return jsonb_build_object('ok', true, 'id', bid);
end $$;

create or replace function public.member_cancel(p_tenant text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype;
begin
  select * into b from bookings where id = p_id and tenant = p_tenant and member_id = member_id_of(p_tenant);
  if b.id is null then raise exception 'Not your booking'; end if;
  if b.status not in ('booked') then raise exception 'This booking can no longer be cancelled'; end if;
  if b.date < current_date then raise exception 'That day has passed'; end if;
  update bookings set status = 'cancelled', cancelled_at = now() where id = p_id;
  if b.acct_item is not null then update acct_items set void_at = now(), void_reason = 'Booking cancelled by the member' where id = b.acct_item and void_at is null; end if;
  return true;
end $$;
revoke all on function public.member_slots(text, text, date) from public;
revoke all on function public.member_book(text, text, date, text, int, jsonb, text) from public;
revoke all on function public.member_cancel(text, uuid) from public;
grant execute on function public.member_slots(text, text, date) to authenticated;
grant execute on function public.member_book(text, text, date, text, int, jsonb, text) to authenticated;
grant execute on function public.member_cancel(text, uuid) to authenticated;
