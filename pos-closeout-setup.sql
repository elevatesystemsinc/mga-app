-- Flagstick — check numbers, signed slips and the daily close-out. Run once in the Supabase SQL Editor after
-- pos-tips-setup.sql. Idempotent.
--
-- The owner, Oct 2026: paper slips stay; at the end of the day the signed slips are scanned, the software reads the check
-- number off each image, ties the scan to the digital ticket and the member's charge, and the day is closed out and locked.
--
--   pos_tickets.check_no   MMDD-NNNC: the day, a counter per outlet per day, a check digit (poscore checkDigit) — printed large on
--                          the slip for people and for OCR, carried everywhere the ticket is shown
--   pos_tickets.day        the club's local date the check was opened (the client sends it; the server's clock is UTC)
--   pos_counters           the counter behind check numbers
--   acct_items.slip        the storage path of the signed slip behind a charge (bucket 'slips', private)
--   pos_days               a closed day per outlet: nothing on it can be reopened, voided or re-tipped from a station; the hub needs
--                          a manager's PIN. Cash sales against the drawer count, the notes, who closed it.
--   pos_check_put          assigns check_no and day on a new check
--   pos_next_check         the same counter for the hub's own register (staff)
--   pos_reopen / pos_void  refuse on a closed day
--   pos_shift              by the ticket's day

alter table public.pos_tickets add column if not exists check_no text;
alter table public.pos_tickets add column if not exists day date;
alter table public.acct_items add column if not exists slip text;
create index if not exists pos_tickets_day on public.pos_tickets (tenant, outlet, day);

create table if not exists public.pos_counters (
  tenant text not null, outlet text not null, day date not null, n int not null default 0, primary key (tenant, outlet, day));
alter table public.pos_counters enable row level security;

create or replace function public.pos_check_digit(p_body text) returns text
language sql immutable as $$
  select ((10 - (sum((substr(p_body, i, 1))::int * (array[7,3,1])[((i - 1) % 3) + 1]) % 10)) % 10)::text
    from generate_series(1, length(p_body)) i;
$$;

create or replace function public.pos_check_no(p_tenant text, p_outlet text, p_day date) returns text
language plpgsql security definer set search_path = public as $$
declare k int; body text;
begin
  insert into pos_counters (tenant, outlet, day, n) values (p_tenant, p_outlet, p_day, 1)
    on conflict (tenant, outlet, day) do update set n = pos_counters.n + 1 returning n into k;
  body := to_char(p_day, 'MMDD') || lpad(k::text, 3, '0');
  return to_char(p_day, 'MMDD') || '-' || lpad(k::text, 3, '0') || pos_check_digit(body);
end $$;

create or replace function public.pos_next_check(p_tenant text, p_outlet text, p_day date) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not can_staff(p_tenant) then raise exception 'Staff only' using errcode = '42501'; end if;
  return pos_check_no(p_tenant, p_outlet, coalesce(p_day, current_date));
end $$;
grant execute on function public.pos_next_check(text, text, date) to authenticated;

create or replace function public.pos_check_put(p_key text, p_check jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets; tid uuid; d date;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  tid := coalesce((p_check ->> 'id')::uuid, gen_random_uuid());
  select * into r from pos_tickets where id = tid and tenant = s.tenant for update;
  if r.id is not null then
    if r.outlet <> s.outlet or r.status <> 'open' then return to_jsonb(r); end if;   -- as before: a closed check or another outlet's is left alone
    update pos_tickets set table_no = p_check ->> 'table_no', server = coalesce(p_check ->> 'server', server), server_id = coalesce(p_check ->> 'server_id', server_id), guests = coalesce((p_check ->> 'guests')::int, guests),
      member_id = p_check ->> 'member_id', guest = coalesce(p_check ->> 'guest', guest), lines = coalesce(p_check -> 'lines', lines), note = coalesce(p_check ->> 'note', note),
      subtotal = coalesce((p_check ->> 'subtotal')::numeric, subtotal), svc = coalesce((p_check ->> 'svc')::numeric, svc), tax = coalesce((p_check ->> 'tax')::numeric, tax), tip = coalesce((p_check ->> 'tip')::numeric, tip), total = coalesce((p_check ->> 'total')::numeric, total),
      station = s.id, updated_at = now() where id = tid returning * into r;
    return to_jsonb(r);
  end if;
  d := coalesce((p_check ->> 'day')::date, current_date);
  insert into pos_tickets (id, tenant, outlet, station, table_no, server, server_id, guests, member_id, guest, lines, note, subtotal, svc, tax, tip, total, status, created_at, created_by, updated_at, check_no, day)
    values (tid, s.tenant, s.outlet, s.id, p_check ->> 'table_no', p_check ->> 'server', p_check ->> 'server_id', coalesce((p_check ->> 'guests')::int, 0), p_check ->> 'member_id', p_check ->> 'guest',
            coalesce(p_check -> 'lines', '[]'::jsonb), p_check ->> 'note', coalesce((p_check ->> 'subtotal')::numeric, 0), coalesce((p_check ->> 'svc')::numeric, 0), coalesce((p_check ->> 'tax')::numeric, 0), coalesce((p_check ->> 'tip')::numeric, 0), coalesce((p_check ->> 'total')::numeric, 0),
            'open', now(), coalesce(p_check ->> 'server', 'station'), now(), pos_check_no(s.tenant, s.outlet, d), d)
    returning * into r;
  return to_jsonb(r);
end $$;

create table if not exists public.pos_days (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  outlet      text not null,
  day         date not null,
  closed_at   timestamptz not null default now(),
  closed_by   text,
  cash_sales  numeric(12,2) not null default 0,
  cash_counted numeric(12,2),
  notes       text,
  totals      jsonb not null default '{}'::jsonb,
  unique (tenant, outlet, day)
);
alter table public.pos_days enable row level security;
drop policy if exists "staff manage days" on public.pos_days;
create policy "staff manage days" on public.pos_days for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.pos_days to authenticated;

create or replace function public.pos_day_closed(p_tenant text, p_outlet text, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pos_days d where d.tenant = p_tenant and d.outlet = p_outlet and d.day = p_day);
$$;

create or replace function public.pos_reopen(p_key text, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet for update;
  if r.id is null then raise exception 'Unknown check'; end if;
  if r.status = 'open' then return to_jsonb(r); end if;
  if pos_day_closed(s.tenant, s.outlet, coalesce(r.day, (coalesce(r.closed_at, r.created_at) at time zone 'UTC')::date)) then raise exception 'That day is closed — a manager reopens it from the hub''s close-out page'; end if;
  update acct_items set void_at = now(), void_reason = 'Check reopened at the station' where tenant = s.tenant and void_at is null and (id = r.acct_item or ref like 'pos:' || r.id::text || '%');
  update pos_tickets set status = 'open', closed_at = null, paid = null, payments = '[]'::jsonb, acct_item = null, void_at = null, void_reason = null, tip = 0,
    lines = (select coalesce(jsonb_agg(l - 'fired' - 'fired_at' || jsonb_build_object('fired', coalesce((l ->> 'fired')::boolean, false))), '[]'::jsonb) from jsonb_array_elements(r.lines) l),
    updated_at = now() where id = r.id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.pos_void(p_key text, p_ticket uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet for update;
  if r.id is null then raise exception 'Unknown check'; end if;
  if pos_day_closed(s.tenant, s.outlet, coalesce(r.day, (coalesce(r.closed_at, r.created_at) at time zone 'UTC')::date)) then raise exception 'That day is closed — a manager reopens it from the hub''s close-out page'; end if;
  update pos_tickets set status = 'void', void_at = now(), void_reason = left(coalesce(p_reason, ''), 200), updated_at = now() where id = r.id;
  update acct_items set void_at = now(), void_reason = 'Check voided at the station: ' || left(coalesce(p_reason, ''), 150) where tenant = s.tenant and void_at is null and (id = r.acct_item or ref like 'pos:' || r.id::text || '%');
  return true;
end $$;

create or replace function public.pos_shift(p_key text, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.closed_at), '[]'::jsonb) from pos_station(p_key) s, pos_tickets t
   where t.tenant = s.tenant and t.outlet = s.outlet and t.status in ('closed','void')
     and coalesce(t.day, (coalesce(t.closed_at, t.void_at) at time zone 'UTC')::date) = coalesce(p_date, current_date);
$$;

-- the signed slips: a private bucket, one file per payment at <tenant>/<ticket id>/<payment id>.jpg
insert into storage.buckets (id, name, public) values ('slips', 'slips', false) on conflict (id) do nothing;
drop policy if exists "staff slips" on storage.objects;
create policy "staff slips" on storage.objects for all to authenticated
  using (bucket_id = 'slips' and can_staff(split_part(name, '/', 1))) with check (bucket_id = 'slips' and can_staff(split_part(name, '/', 1)));
drop policy if exists "member reads own slips" on storage.objects;
create policy "member reads own slips" on storage.objects for select to authenticated
  using (bucket_id = 'slips' and exists (
    select 1 from acct_items i join member_users u on u.tenant = i.tenant and u.member_id = i.member_id
     where i.slip = storage.objects.name and i.tenant = split_part(storage.objects.name, '/', 1) and u.user_id = auth.uid()));
