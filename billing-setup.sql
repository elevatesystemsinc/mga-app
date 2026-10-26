-- Flagstick — Member accounts & billing (module 'billing'). Run once in the Supabase SQL Editor, after
-- tenants-setup.sql and portal-setup.sql. Idempotent.
--
-- Each club bills its own members; Flagstick only bills the club. So this is the club's ledger: every member has an
-- account, every source of money (dues, food & beverage, the pro shop, tee times, facilities, lessons, fees) posts a
-- CHARGE to it, the club records PAYMENTS and CREDITS as they come in, and statements close a period. No payment
-- processor sits in the middle — the club collects the way it always has (card on file in its own terminal, check,
-- ACH, cash) and records it here. High-volume rows, many staff writing at once: real tables with row-level security,
-- not the organization JSON documents.
--
--   acct_items        one row per charge / payment / credit on a member's account
--   acct_statements   one row per member per statement run (period, opening, charges, payments, closing, due)
--   can_staff(tenant) the club's staff logins (and Flagstick) — board logins never see the club's money

create table if not exists public.acct_items (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'wccc' references public.tenants(slug),
  member_id   text not null,                                   -- the person in the club directory (mga_hub club.members[].id)
  kind        text not null check (kind in ('charge','payment','credit')),
  source      text not null default 'manual',                  -- dues | fnb | proshop | tee | facility | lesson | fee | manual
  ref         text,                                            -- the source record: a dues charge id, a POS ticket, a booking
  descr       text not null default '',
  amount      numeric(12,2) not null check (amount >= 0),      -- always positive; kind gives the sign on the account
  method      text,                                            -- payments: cash | check | ach | card | other
  reference   text,                                            -- check number, last four, confirmation
  posted      date not null default current_date,
  void_at     timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists acct_items_member on public.acct_items (tenant, member_id, posted);
create index if not exists acct_items_ref on public.acct_items (tenant, ref) where ref is not null;

create table if not exists public.acct_statements (
  id            uuid primary key default gen_random_uuid(),
  tenant        text not null default 'wccc' references public.tenants(slug),
  member_id     text not null,
  period_start  date not null,
  period_end    date not null,
  opening       numeric(12,2) not null default 0,
  charges       numeric(12,2) not null default 0,
  payments      numeric(12,2) not null default 0,
  closing       numeric(12,2) not null default 0,
  due           date,
  run_id        text,                                          -- every statement of one run shares it
  issued_at     timestamptz not null default now(),
  created_by    text
);
create index if not exists acct_statements_member on public.acct_statements (tenant, member_id, period_end);

alter table public.acct_items enable row level security;
alter table public.acct_statements enable row level security;

-- the club's staff (role 'staff' in tenant_users) and Flagstick's admins; never a board login
create or replace function public.can_staff(p_tenant text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select true from flagstick_admins a where a.user_id = auth.uid()), false)
      or exists (select 1 from tenant_users u where u.user_id = auth.uid() and u.tenant = p_tenant and u.role = 'staff');
$$;

drop policy if exists "staff manage accounts" on public.acct_items;
create policy "staff manage accounts" on public.acct_items for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
drop policy if exists "staff manage statements" on public.acct_statements;
create policy "staff manage statements" on public.acct_statements for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.acct_items, public.acct_statements to authenticated;
