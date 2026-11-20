-- Flagstick — the auction cashier and the raffle record. Run once in the Supabase SQL Editor after fund-setup.sql. Idempotent.
--
-- The owner, Oct 2026: "lots… reserves… bidder numbers and paddle numbers and cashiers and the whole thing. It's not a Calcutta.
-- It's just strictly an auction." A cashier works from a phone or laptop without the hub login, like the Calcutta's cashier page:
--   fund_share.cashier_key   the secret in the cashier link (auction.html?k=TOKEN&c=KEY); null = no cashier link
--   fund_share.priv          what a cashier needs and the public never sees: guests and their paddles and tickets, the lots with
--                            reserves and sales, raffle tickets, donations, payments (fundPriv in fund.js)
--   fund_actions             what cashiers record: a live-auction sale, raffle tickets, a donation, a payment — one row each, never
--                            edited. The hub reads them and absorbs them into the event (absorbActions), then the event is the record.
--   fund_cashier_get(token, key)             the event as a cashier sees it, plus the high bids, the bidders and the actions
--   fund_cashier(token, key, kind, data)     record one action

alter table public.fund_share add column if not exists cashier_key text;
alter table public.fund_share add column if not exists priv jsonb not null default '{}'::jsonb;
create table if not exists public.fund_actions (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  fid        text not null,
  kind       text not null,                -- sale | raffle | donation | payment
  data       jsonb not null,
  by         text not null default '',
  at         timestamptz not null default now()
);
alter table public.fund_actions enable row level security;
drop policy if exists "staff manage fund_actions" on public.fund_actions;
create policy "staff manage fund_actions" on public.fund_actions for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.fund_actions to authenticated;

create or replace function public.fund_cashier_get(p_token text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s fund_share;
begin
  s := fund_share_of(p_token); if s.fid is null then raise exception 'This link is not valid'; end if;
  if s.cashier_key is null or length(coalesce(p_key, '')) < 16 or s.cashier_key <> p_key then raise exception 'Not a cashier link'; end if;
  return jsonb_build_object('fid', s.fid, 'status', s.status, 'doc', s.doc, 'priv', s.priv, 'highs', fund_highs(s.tenant, s.fid),
    'bidders', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'paddle', b.paddle, 'phone', b.phone, 'email', b.email) order by b.paddle) from fund_bidders b where b.tenant = s.tenant and b.fid = s.fid), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(to_jsonb(a) order by a.at) from fund_actions a where a.tenant = s.tenant and a.fid = s.fid), '[]'::jsonb));
end $$;

create or replace function public.fund_cashier(p_token text, p_key text, p_kind text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fund_share; a fund_actions;
begin
  s := fund_share_of(p_token); if s.fid is null then raise exception 'This link is not valid'; end if;
  if s.cashier_key is null or length(coalesce(p_key, '')) < 16 or s.cashier_key <> p_key then raise exception 'Not a cashier link'; end if;
  if p_kind not in ('sale','raffle','donation','payment') then raise exception 'Unknown action'; end if;
  if coalesce((p_data ->> 'paddle')::int, 0) <= 0 then raise exception 'Which paddle?'; end if;
  insert into fund_actions (tenant, fid, kind, data, by) values (s.tenant, s.fid, p_kind, p_data, left(coalesce(p_data ->> 'by', ''), 60)) returning * into a;
  return to_jsonb(a);
end $$;
revoke all on function public.fund_cashier_get(text, text), public.fund_cashier(text, text, text, jsonb) from public;
grant execute on function public.fund_cashier_get(text, text), public.fund_cashier(text, text, text, jsonb) to anon, authenticated;
