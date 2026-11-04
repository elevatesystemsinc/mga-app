-- Flagstick — the next layer on the restaurant floor: courses (hold and fire), split payments, transfers, shift numbers.
-- Run once after pos-stations-setup.sql. Idempotent.
alter table public.pos_tickets add column if not exists payments jsonb not null default '[]'::jsonb;   -- [{id, method, amount (incl. tip), tip, member_id, lines, at, by}]

-- fire the unfired routed lines of a course (p_course null = every course); one pos_fires row per expo
create or replace function public.pos_fire(p_key text, p_ticket uuid, p_course int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; e text; n int := 0; new_lines jsonb;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'open' for update;
  if r.id is null then raise exception 'Check not open'; end if;
  for e in select distinct l ->> 'route' from jsonb_array_elements(r.lines) l where coalesce(l ->> 'route', '') <> '' and not coalesce((l ->> 'fired')::boolean, false) and (p_course is null or coalesce((l ->> 'course')::int, 0) in (0, p_course)) loop
    insert into pos_fires (tenant, outlet, expo, station, ticket, table_no, server, lines, note)
      select s.tenant, s.outlet, e, s.id, r.id, r.table_no, r.server, jsonb_agg(l), case when p_course is null or p_course <= 1 then null else 'Course ' || p_course end
        from jsonb_array_elements(r.lines) l where l ->> 'route' = e and not coalesce((l ->> 'fired')::boolean, false) and (p_course is null or coalesce((l ->> 'course')::int, 0) in (0, p_course));
    n := n + 1;
  end loop;
  select coalesce(jsonb_agg(case when coalesce(l ->> 'route', '') <> '' and not coalesce((l ->> 'fired')::boolean, false) and (p_course is null or coalesce((l ->> 'course')::int, 0) in (0, p_course)) then l || jsonb_build_object('fired', true, 'fired_at', now()) else l end), '[]'::jsonb) into new_lines from jsonb_array_elements(r.lines) l;
  update pos_tickets set lines = new_lines, updated_at = now() where id = r.id;
  return jsonb_build_object('fired', n, 'lines', new_lines);
end $$;

-- one payment on a check (a whole check, a seat, picked items, or an even share): on the account → an acct_items charge for
-- that amount (tax and service charge in proportion); when the payments cover the check it closes
create or replace function public.pos_pay(p_key text, p_ticket uuid, p_pay jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; club jsonb; o jsonb; it jsonb; m jsonb; method text; amt numeric; tip numeric; net numeric; share numeric; aid uuid; pays jsonb; paid numeric; descr text; pay jsonb; mid text;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'open' for update;
  if r.id is null then raise exception 'Check not open'; end if;
  if p_pay ? 'totals' then update pos_tickets set subtotal = (p_pay -> 'totals' ->> 'subtotal')::numeric, svc = (p_pay -> 'totals' ->> 'svc')::numeric, tax = (p_pay -> 'totals' ->> 'tax')::numeric, lines = coalesce(p_pay -> 'lines', lines) where id = r.id returning * into r; end if;
  method := coalesce(p_pay ->> 'method', 'cash'); amt := round(coalesce((p_pay ->> 'amount')::numeric, 0), 2); tip := round(coalesce((p_pay ->> 'tip')::numeric, 0), 2); net := amt - tip; mid := p_pay ->> 'member_id';
  if net <= 0 then raise exception 'Nothing to pay'; end if;
  paid := coalesce((select sum((p ->> 'amount')::numeric - coalesce((p ->> 'tip')::numeric, 0)) from jsonb_array_elements(r.payments) p), 0);
  if net > r.subtotal + r.svc + r.tax - paid + 0.01 then raise exception 'That is more than what is owed'; end if;
  pay := jsonb_build_object('id', gen_random_uuid(), 'method', method, 'amount', amt, 'tip', tip, 'member_id', mid, 'label', p_pay ->> 'label', 'at', now(), 'by', r.server);
  if method = 'account' then
    if mid is null then raise exception 'Pick the member first'; end if;
    select data into club from mga_hub where tenant = s.tenant and id = 'club';
    select x into m from jsonb_array_elements(club -> 'members') x where x ->> 'id' = mid;
    if m is null then raise exception 'Unknown member'; end if;
    if (m -> 'billing' ->> 'status') = 'suspended' then raise exception 'This member is suspended — no charges to the account'; end if;
    select x into o from jsonb_array_elements(club -> 'pos' -> 'outlets') x where x ->> 'id' = s.outlet;
    select x into it from jsonb_array_elements(coalesce(club -> 'billing' -> 'items', '[]'::jsonb)) x where x ->> 'id' = coalesce(o ->> 'item', 'fnb');
    share := case when (r.subtotal + r.svc + r.tax) > 0 then net / (r.subtotal + r.svc + r.tax) else 1 end;
    descr := left(coalesce(o ->> 'name', s.outlet) || ' · ' || coalesce(p_pay ->> 'label', coalesce((select string_agg(case when (l ->> 'qty')::numeric > 1 then (l ->> 'qty') || '× ' else '' end || (l ->> 'name'), ', ') from jsonb_array_elements(r.lines) l), '')) || case when tip > 0 then ' · tip ' || tip::text else '' end, 180);
    insert into acct_items (tenant, member_id, kind, source, item, gl, ref, descr, amount, tax, svc, posted, created_by)
      values (s.tenant, mid, 'charge', coalesce(it ->> 'source', case when o ->> 'kind' = 'proshop' then 'proshop' else 'fnb' end), coalesce(it ->> 'id', coalesce(o ->> 'item', 'fnb')), it ->> 'gl', 'pos:' || r.id::text || ':' || (pay ->> 'id'), descr, amt, round(r.tax * share, 2), round(r.svc * share, 2), current_date, coalesce(r.server, 'station'))
      returning acct_items.id into aid;
    pay := pay || jsonb_build_object('acct_item', aid);
  end if;
  pays := r.payments || jsonb_build_array(pay); paid := paid + net;
  if paid >= r.subtotal + r.svc + r.tax - 0.005 then
    update pos_tickets set payments = pays, tip = coalesce((select sum(coalesce((p ->> 'tip')::numeric, 0)) from jsonb_array_elements(pays) p), 0), total = round(r.subtotal + r.svc + r.tax + coalesce((select sum(coalesce((p ->> 'tip')::numeric, 0)) from jsonb_array_elements(pays) p), 0), 2),
      paid = case when jsonb_array_length(pays) > 1 then 'split' else method end, member_id = coalesce(mid, member_id), acct_item = coalesce(aid, acct_item), status = 'closed', closed_at = now(), updated_at = now() where id = r.id returning * into r;
  else
    update pos_tickets set payments = pays, member_id = coalesce(mid, member_id), updated_at = now() where id = r.id returning * into r;
  end if;
  return to_jsonb(r);
end $$;

-- voiding a check with payments on it voids every account charge it made
create or replace function public.pos_void(p_key text, p_ticket uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet for update;
  if r.id is null then raise exception 'Unknown check'; end if;
  update pos_tickets set status = 'void', void_at = now(), void_reason = left(coalesce(p_reason, ''), 200), updated_at = now() where id = r.id;
  update acct_items set void_at = now(), void_reason = 'Check voided at the station: ' || left(coalesce(p_reason, ''), 150) where tenant = s.tenant and void_at is null and (id = r.acct_item or ref like 'pos:' || r.id::text || '%');
  return true;
end $$;

-- a manager's shift numbers at the station: the outlet's tickets of a day
create or replace function public.pos_shift(p_key text, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.closed_at), '[]'::jsonb) from pos_station(p_key) s, pos_tickets t
   where t.tenant = s.tenant and t.outlet = s.outlet and t.status in ('closed','void') and (coalesce(t.closed_at, t.void_at) at time zone 'UTC')::date = coalesce(p_date, current_date);
$$;
grant execute on function public.pos_fire(text, uuid, int), public.pos_pay(text, uuid, jsonb), public.pos_shift(text, date) to anon, authenticated;
