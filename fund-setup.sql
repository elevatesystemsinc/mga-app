-- Flagstick — Fundraising events for a nonprofit: galas, the event page, silent-auction bidding, RSVPs. Run once in the
-- Supabase SQL Editor after client-kinds-setup.sql. Idempotent.
--
-- The event itself (tickets, tables, guests, sponsors, items, lots, raffles, payments) lives in the organization's document
-- (CLUB.fund.events[]). What the public touches lives here:
--   fund_share    one row per event with a public page: the token in the link and what the page shows (fundPub)
--   fund_bidders  who joined the page to bid: name, phone, e-mail, a paddle number (500 up — the hub's guests hold 101 up)
--   fund_bids     every bid placed on the page (never edited; the high bid is the latest largest)
--   fund_rsvps    tickets asked for on the page ("pay at the door"); staff accept them into the guest list
--   fund_get(token)                       anon: the page — the event, its items with their high bids, raffles, tickets
--   fund_join(token, name, phone, email)  anon: a bidder (the same phone → the same paddle)
--   fund_bid(token, bidder, item, amount) anon: a bid — refused once bidding is closed, under the minimum, or not a step up
--   fund_my(token, bidder)                anon: the bidder's own bids and whether each still leads
--   fund_rsvp(token, data)                anon: a ticket request
-- Staff read and manage all four tables through can_staff(tenant).

create table if not exists public.fund_share (
  fid        text primary key,                 -- the event id in the document
  tenant     text not null default 'wccc' references public.tenants(slug),
  token      text unique,
  status     text not null default 'open',     -- open | closed
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.fund_bidders (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  fid        text not null,
  name       text not null,
  phone      text not null default '',
  email      text not null default '',
  paddle     int  not null,
  created_at timestamptz not null default now()
);
create table if not exists public.fund_bids (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  fid        text not null,
  item       text not null,
  bidder     uuid not null,
  amount     numeric(12,2) not null,
  at         timestamptz not null default now()
);
create index if not exists fund_bids_item on public.fund_bids (tenant, fid, item, amount desc, at);
create table if not exists public.fund_rsvps (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  fid        text not null,
  name       text not null,
  email      text not null default '',
  phone      text not null default '',
  ticket     text,
  qty        int not null default 1,
  note       text not null default '',
  status     text not null default 'pending',  -- pending | accepted | declined
  at         timestamptz not null default now()
);
alter table public.fund_share   enable row level security;
alter table public.fund_bidders enable row level security;
alter table public.fund_bids    enable row level security;
alter table public.fund_rsvps   enable row level security;
do $$ declare t text; begin
  foreach t in array array['fund_share','fund_bidders','fund_bids','fund_rsvps'] loop
    execute format('drop policy if exists "staff manage %1$s" on public.%1$s', t);
    execute format('create policy "staff manage %1$s" on public.%1$s for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop; end $$;

create or replace function public.fund_share_of(p_token text) returns fund_share
language sql stable security definer set search_path = public as $$
  select * from fund_share where token is not null and token = p_token and length(p_token) >= 16 limit 1;
$$;

-- the high bid on every item of an event: amount, paddle, bidder id
create or replace function public.fund_highs(p_tenant text, p_fid text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(h.item, jsonb_build_object('amount', h.amount, 'bidder', h.bidder, 'paddle', d.paddle, 'n', h.n)), '{}'::jsonb)
  from (select distinct on (item) item, amount, bidder, count(*) over (partition by item) as n
          from fund_bids where tenant = p_tenant and fid = p_fid order by item, amount desc, at asc) h
  join fund_bidders d on d.id = h.bidder;
$$;

create or replace function public.fund_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s fund_share;
begin
  s := fund_share_of(p_token); if s.fid is null then return null; end if;
  return jsonb_build_object('fid', s.fid, 'status', s.status, 'doc', s.doc, 'highs', fund_highs(s.tenant, s.fid),
    'bidders', (select count(*) from fund_bidders b where b.tenant = s.tenant and b.fid = s.fid), 'now', now());
end $$;

create or replace function public.fund_join(p_token text, p_name text, p_phone text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fund_share; b fund_bidders; ph text; n int;
begin
  s := fund_share_of(p_token); if s.fid is null then raise exception 'This link is not valid'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Your name, please'; end if;
  ph := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if ph <> '' then select * into b from fund_bidders where tenant = s.tenant and fid = s.fid and regexp_replace(phone, '\D', '', 'g') = ph limit 1; end if;
  if b.id is null and coalesce(trim(p_email), '') <> '' then select * into b from fund_bidders where tenant = s.tenant and fid = s.fid and lower(email) = lower(trim(p_email)) limit 1; end if;
  if b.id is not null then return jsonb_build_object('id', b.id, 'paddle', b.paddle, 'name', b.name); end if;
  select coalesce(max(paddle), 499) + 1 into n from fund_bidders where tenant = s.tenant and fid = s.fid;
  insert into fund_bidders (tenant, fid, name, phone, email, paddle) values (s.tenant, s.fid, left(trim(p_name), 80), left(coalesce(p_phone, ''), 30), left(coalesce(p_email, ''), 120), n) returning * into b;
  return jsonb_build_object('id', b.id, 'paddle', b.paddle, 'name', b.name);
end $$;

create or replace function public.fund_bid(p_token text, p_bidder uuid, p_item text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fund_share; it jsonb; hi numeric; minb numeric; step numeric; closes timestamptz; bn int;
begin
  s := fund_share_of(p_token); if s.fid is null then raise exception 'This link is not valid'; end if;
  if not exists (select 1 from fund_bidders where id = p_bidder and tenant = s.tenant and fid = s.fid) then raise exception 'Join the auction first'; end if;
  if s.status <> 'open' or coalesce((s.doc -> 'silent' ->> 'closed')::boolean, false) then raise exception 'Bidding is closed'; end if;
  closes := nullif(s.doc -> 'silent' ->> 'closesAt', '')::timestamptz; if closes is not null and now() > closes then raise exception 'Bidding is closed'; end if;
  select x into it from jsonb_array_elements(s.doc -> 'silent' -> 'items') x where x ->> 'id' = p_item;
  if it is null then raise exception 'Unknown item'; end if;
  perform pg_advisory_xact_lock(hashtext(s.fid || ':' || p_item));
  select amount into hi from fund_bids where tenant = s.tenant and fid = s.fid and item = p_item order by amount desc, at asc limit 1;
  step := greatest(1, coalesce((s.doc -> 'silent' ->> 'minRaise')::numeric, 10));
  minb := case when hi is null then greatest(1, coalesce((it ->> 'start')::numeric, 1)) else hi + step end;
  if p_amount < minb then raise exception 'The bid must be at least $%', minb; end if;
  if coalesce((it ->> 'buyNow')::numeric, 0) > 0 and hi is not null and hi >= (it ->> 'buyNow')::numeric then raise exception 'This item has been bought'; end if;
  insert into fund_bids (tenant, fid, item, bidder, amount) values (s.tenant, s.fid, p_item, p_bidder, round(p_amount, 2));
  select paddle into bn from fund_bidders where id = p_bidder;
  return jsonb_build_object('ok', true, 'amount', round(p_amount, 2), 'paddle', bn, 'bought', coalesce((it ->> 'buyNow')::numeric, 0) > 0 and p_amount >= (it ->> 'buyNow')::numeric);
end $$;

create or replace function public.fund_my(p_token text, p_bidder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s fund_share;
begin
  s := fund_share_of(p_token); if s.fid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item', m.item, 'mine', m.mine, 'high', h.amount, 'leading', h.bidder = p_bidder))
    from (select item, max(amount) as mine from fund_bids where tenant = s.tenant and fid = s.fid and bidder = p_bidder group by item) m
    join lateral (select amount, bidder from fund_bids b where b.tenant = s.tenant and b.fid = s.fid and b.item = m.item order by amount desc, at asc limit 1) h on true), '[]'::jsonb);
end $$;

create or replace function public.fund_rsvp(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fund_share; r fund_rsvps;
begin
  s := fund_share_of(p_token); if s.fid is null then raise exception 'This link is not valid'; end if;
  if s.status <> 'open' then raise exception 'Registration is closed'; end if;
  if coalesce(trim(p_data ->> 'name'), '') = '' then raise exception 'Your name, please'; end if;
  insert into fund_rsvps (tenant, fid, name, email, phone, ticket, qty, note)
    values (s.tenant, s.fid, left(trim(p_data ->> 'name'), 80), left(coalesce(p_data ->> 'email', ''), 120), left(coalesce(p_data ->> 'phone', ''), 30), p_data ->> 'ticket', greatest(1, least(20, coalesce((p_data ->> 'qty')::int, 1))), left(coalesce(p_data ->> 'note', ''), 300))
    returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;
revoke all on function public.fund_get(text), public.fund_join(text, text, text, text), public.fund_bid(text, uuid, text, numeric), public.fund_my(text, uuid), public.fund_rsvp(text, jsonb) from public;
grant execute on function public.fund_get(text), public.fund_join(text, text, text, text), public.fund_bid(text, uuid, text, numeric), public.fund_my(text, uuid), public.fund_rsvp(text, jsonb) to anon, authenticated;
