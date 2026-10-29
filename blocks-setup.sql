-- Flagstick — blocked times on the sheets, and club events in the member portal. Run once in the Supabase SQL Editor
-- after booking-setup.sql. Idempotent.
--
--   booking_blocks                  a closed stretch of a facility's day: from / to, some units or all of them, a reason
--                                   (a blocked tee time, a maintenance morning, the course closed for an outing)
--   member_slots                    now also returns 'blocked' for the day so the portal greys those times out
--   member_book                     refuses a blocked time
--   member_me                       now also returns 'events': the club's public events from today on (CLUB.events)

create table if not exists public.booking_blocks (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  facility    text not null,
  date        date not null,
  from_t      text not null,                       -- 'HH:MM' inclusive
  to_t        text not null,                       -- 'HH:MM' exclusive
  units       jsonb,                               -- [1,2] or null = every unit
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists booking_blocks_day on public.booking_blocks (tenant, facility, date);
alter table public.booking_blocks enable row level security;
drop policy if exists "staff manage blocks" on public.booking_blocks;
create policy "staff manage blocks" on public.booking_blocks for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.booking_blocks to authenticated;

create or replace function public.member_slots(p_tenant text, p_facility text, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'taken', coalesce((select jsonb_agg(jsonb_build_object('time', b.time, 'unit', b.unit, 'n', greatest(1, jsonb_array_length(b.players)), 'mine', b.member_id = member_id_of(p_tenant)))
                       from bookings b where b.tenant = p_tenant and b.facility = p_facility and b.date = p_date and b.status in ('booked','checked_in')), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('from', k.from_t, 'to', k.to_t, 'units', k.units, 'reason', k.reason))
                         from booking_blocks k where k.tenant = p_tenant and k.facility = p_facility and k.date = p_date), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(to_jsonb(b) order by b.date, b.time) from bookings b
                      where b.tenant = p_tenant and b.member_id = member_id_of(p_tenant) and b.status in ('booked','checked_in') and b.date >= current_date), '[]'::jsonb));
$$;

create or replace function public.member_book(p_tenant text, p_facility text, p_date date, p_time text, p_unit int, p_players jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mid text; club jsonb; f jsonb; n int; cap int; lead int; used int; bid uuid; aid uuid; fee numeric; item jsonb; per text; m jsonb; nm text; why text;
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
  select coalesce(k.reason, 'closed') into why from booking_blocks k where k.tenant = p_tenant and k.facility = p_facility and k.date = p_date and p_time >= k.from_t and p_time < k.to_t and (k.units is null or k.units @> to_jsonb(p_unit)) limit 1;
  if why is not null then raise exception 'That time is not available — %', why; end if;
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

create or replace function public.member_me(p_tenant text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text; m jsonb; mid text; u member_users%rowtype; club jsonb;
begin
  em := lower(coalesce(auth.jwt() ->> 'email', ''));
  if em = '' then return jsonb_build_object('member', null, 'reason', 'not signed in'); end if;
  select h.data into club from mga_hub h where h.tenant = p_tenant and h.id = 'club';
  if club is null then return jsonb_build_object('member', null, 'reason', 'no club'); end if;
  select x into m from jsonb_array_elements(club -> 'members') x where lower(x ->> 'email') = em order by (x ->> 'status') = 'Active' desc limit 1;
  if m is null then return jsonb_build_object('member', null, 'reason', 'not a member', 'club', club ->> 'name'); end if;
  mid := m ->> 'id';
  insert into member_users (tenant, member_id, email, user_id, last_seen) values (p_tenant, mid, em, auth.uid(), now())
    on conflict (tenant, member_id) do update set user_id = excluded.user_id, email = excluded.email, last_seen = now();
  select * into u from member_users where tenant = p_tenant and member_id = mid;
  return jsonb_build_object(
    'member', jsonb_build_object('id', mid, 'first', m ->> 'first', 'last', m ->> 'last', 'memberNo', m ->> 'memberNo', 'email', m ->> 'email',
                                 'address1', m ->> 'address1', 'city', m ->> 'city', 'state', m ->> 'state', 'zip', m ->> 'zip', 'status', m ->> 'status'),
    'club', club ->> 'name', 'brand', club -> 'brand' ->> 'logo',
    'message', club -> 'billing' ->> 'message',
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.posted, i.created_at) from acct_items i where i.tenant = p_tenant and i.member_id = mid and i.void_at is null), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.period_end desc) from acct_statements s where s.tenant = p_tenant and s.member_id = mid), '[]'::jsonb),
    'facilities', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(club -> 'booking' -> 'facilities', '[]'::jsonb)) x where coalesce((x ->> 'members')::boolean, true)), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.date, b.time) from bookings b where b.tenant = p_tenant and b.member_id = mid and b.status in ('booked','checked_in') and b.date >= current_date), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x order by x ->> 'date', x ->> 'start') from jsonb_array_elements(coalesce(club -> 'events', '[]'::jsonb)) x
                        where coalesce((x ->> 'public')::boolean, true) and coalesce(x ->> 'end', x ->> 'date') >= current_date::text), '[]'::jsonb),
    'autopay', coalesce(u.autopay, false), 'pm_label', u.pm_label,
    'online', coalesce((select t.stripe_account is not null and coalesce((t.stripe_status ->> 'charges_enabled')::boolean, false) from tenants t where t.slug = p_tenant), false));
end $$;
