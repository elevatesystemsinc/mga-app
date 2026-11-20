-- Flagstick — tips on the signed slip. Run once in the Supabase SQL Editor after pos-split-setup.sql. Idempotent.
--
-- The owner, Oct 2026: a mandatory service charge on every food & beverage check (18% by default, Settings → Food &
-- beverage), and no tip asked in the app — the printed slip carries "Additional tip / Total / Signature"; the server
-- closes the check out afterwards with what was written. A tip charged to the account goes on the member's charge.
--
--   pos_tickets.status 'slip'      paid on account or by card, waiting for the written tip (closed_at = when it was paid)
--   pos_pay                        a payment of method account | card carries tip null (pending); cash tips are 0;
--                                  when the check is fully paid it goes to 'slip' if any tip is pending, else 'closed'
--   pos_settle(key, ticket, tips)  [{id: payment id, tip}] → the tips go on the payments, an account tip onto the
--                                  acct_items charge (amount + descr), the ticket closes
--   pos_checks                     now returns open and slip checks (the floor shows "Slips out")

-- a tip charged to the account is its own figure on the acct_items row: never revenue, never F&B spend toward a minimum
alter table public.acct_items add column if not exists tip numeric(12,2) not null default 0;

create or replace function public.pos_checks(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) from pos_station(p_key) s, pos_tickets t
   where t.tenant = s.tenant and t.outlet = s.outlet and t.status in ('open','slip');
$$;

create or replace function public.pos_pay(p_key text, p_ticket uuid, p_pay jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; club jsonb; o jsonb; it jsonb; m jsonb; method text; amt numeric; tip numeric; net numeric; share numeric; aid uuid; pays jsonb; paid numeric; descr text; pay jsonb; mid text; pending boolean;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'open' for update;
  if r.id is null then raise exception 'Check not open'; end if;
  if p_pay ? 'totals' then update pos_tickets set subtotal = (p_pay -> 'totals' ->> 'subtotal')::numeric, svc = (p_pay -> 'totals' ->> 'svc')::numeric, tax = (p_pay -> 'totals' ->> 'tax')::numeric, lines = coalesce(p_pay -> 'lines', lines) where id = r.id returning * into r; end if;
  method := coalesce(p_pay ->> 'method', 'cash'); amt := round(coalesce((p_pay ->> 'amount')::numeric, 0), 2); mid := p_pay ->> 'member_id';
  tip := case when (p_pay ->> 'tip') is null then null else round((p_pay ->> 'tip')::numeric, 2) end;
  if tip is null and method not in ('account','card') then tip := 0; end if;      -- only a slip carries a tip to be written
  net := amt - coalesce(tip, 0);
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
    descr := left(coalesce(o ->> 'name', s.outlet) || ' · ' || coalesce(p_pay ->> 'label', coalesce((select string_agg(case when (l ->> 'qty')::numeric > 1 then (l ->> 'qty') || '× ' else '' end || (l ->> 'name'), ', ') from jsonb_array_elements(r.lines) l), '')) || case when coalesce(tip, 0) > 0 then ' · tip ' || tip::text else '' end, 180);
    insert into acct_items (tenant, member_id, kind, source, item, gl, ref, descr, amount, tax, svc, posted, created_by)
      values (s.tenant, mid, 'charge', coalesce(it ->> 'source', case when o ->> 'kind' = 'proshop' then 'proshop' else 'fnb' end), coalesce(it ->> 'id', coalesce(o ->> 'item', 'fnb')), it ->> 'gl', 'pos:' || r.id::text || ':' || (pay ->> 'id'), descr, amt, round(r.tax * share, 2), round(r.svc * share, 2), current_date, coalesce(r.server, 'station'))
      returning acct_items.id into aid;
    pay := pay || jsonb_build_object('acct_item', aid);
  end if;
  pays := r.payments || jsonb_build_array(pay); paid := paid + net;
  if paid >= r.subtotal + r.svc + r.tax - 0.005 then
    pending := exists (select 1 from jsonb_array_elements(pays) p where p ->> 'method' in ('account','card') and (p ->> 'tip') is null);
    update pos_tickets set payments = pays, tip = coalesce((select sum(coalesce((p ->> 'tip')::numeric, 0)) from jsonb_array_elements(pays) p), 0), total = round(r.subtotal + r.svc + r.tax + coalesce((select sum(coalesce((p ->> 'tip')::numeric, 0)) from jsonb_array_elements(pays) p), 0), 2),
      paid = case when jsonb_array_length(pays) > 1 then 'split' else method end, member_id = coalesce(mid, member_id), acct_item = coalesce(aid, acct_item), status = case when pending then 'slip' else 'closed' end, closed_at = now(), updated_at = now() where id = r.id returning * into r;
  else
    update pos_tickets set payments = pays, member_id = coalesce(mid, member_id), updated_at = now() where id = r.id returning * into r;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.pos_settle(p_key text, p_ticket uuid, p_tips jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; pays jsonb := '[]'::jsonb; p jsonb; e jsonb; t numeric; tips numeric := 0;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet and status = 'slip' for update;
  if r.id is null then raise exception 'Nothing to close out'; end if;
  for p in select x from jsonb_array_elements(r.payments) x loop
    select x into e from jsonb_array_elements(coalesce(p_tips, '[]'::jsonb)) x where x ->> 'id' = p ->> 'id';
    if (p ->> 'tip') is null or e is not null then
      t := greatest(0, round(coalesce((e ->> 'tip')::numeric, 0), 2));
      p := p || jsonb_build_object('tip', t, 'amount', round((p ->> 'amount')::numeric - coalesce((p ->> 'tip')::numeric, 0) + t, 2));
      if p ->> 'method' = 'account' and t > 0 and (p ->> 'acct_item') is not null then
        update acct_items set amount = amount + t, tip = coalesce(tip, 0) + t, descr = left(descr || ' · tip ' || t::text, 180) where id = (p ->> 'acct_item')::uuid and tenant = s.tenant and void_at is null;
      end if;
    end if;
    tips := tips + coalesce((p ->> 'tip')::numeric, 0); pays := pays || jsonb_build_array(p);
  end loop;
  update pos_tickets set payments = pays, tip = round(tips, 2), total = round(r.subtotal + r.svc + r.tax + tips, 2), status = 'closed', updated_at = now() where id = r.id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.pos_settle(text, uuid, jsonb) from public;
grant execute on function public.pos_settle(text, uuid, jsonb) to anon, authenticated;
