-- Flagstick — point of sale (module 'pos'): food & beverage and pro shop tickets charged to member accounts.
-- Run once in the Supabase SQL Editor after billing-setup.sql. Idempotent.
--
--   pos_tickets   one row per ticket: the lines, the money (subtotal, service charge, tax, tip, total), how it was paid
--                 (the member's account → an acct_items charge, or cash / card at the register), void with a reason.
--                 Outlets and products live in the club document (CLUB.pos); stock counts too.

create table if not exists public.pos_tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant       text not null default 'wccc' references public.tenants(slug),
  outlet       text not null,
  member_id    text,
  guest        text,
  lines        jsonb not null default '[]'::jsonb,
  subtotal     numeric(12,2) not null default 0,
  svc          numeric(12,2) not null default 0,
  tax          numeric(12,2) not null default 0,
  tip          numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  paid         text,                                             -- account | cash | card | other
  status       text not null default 'open',                     -- open | closed | void
  acct_item    uuid,                                             -- the acct_items charge when paid on account
  note         text,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  created_by   text,
  void_at      timestamptz,
  void_reason  text
);
create index if not exists pos_tickets_day on public.pos_tickets (tenant, created_at);
alter table public.pos_tickets enable row level security;
drop policy if exists "staff manage tickets" on public.pos_tickets;
create policy "staff manage tickets" on public.pos_tickets for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.pos_tickets to authenticated;
