-- Online payments through the DELUXE PAYMENTS PLATFORM on the club's own merchant account (the merchant is onboarded by
-- Trinity Merchant Group; Deluxe e-mails the credentials). Provider-neutral shapes: the Edge Functions `payments` and
-- `payments-webhook` are the only code that talks to the processor; the hub, the portal, the registers and the fund
-- checkout talk to `payments`. Run after member-setup.sql and pos-stations-setup.sql.
--
--   payment_accounts   one row per club: the merchant's credentials (client id / secret, partner token, the Hosted Payment
--                      Form token, the webhook secret) and the last connection check. NO policies: only the service role
--                      (the functions) reads or writes it — staff see a redacted copy through the function's `status`.
--   payments           the log of every processor transaction (sale, refund, void): what it paid for (`ref`), the member,
--                      the processor's id and response. Staff read it; the functions write it.
--   member_users       + pay_provider / pay_customer / pay_method: the card on file for autopay at the processor.
--   tenants.pay_status the last check ({ok, env, at, message}); pay_online() tells the portal whether to offer payments.

create table if not exists public.payment_accounts (
  tenant         text primary key references public.tenants(slug) on delete cascade,
  provider       text not null default 'deluxe',
  env            text not null default 'sandbox',          -- sandbox | production
  client_id      text,
  client_secret  text,
  partner_token  text,
  hpf_token      text,                                      -- the Hosted Payment Form access token (public to the form)
  webhook_secret text,
  status         jsonb,                                     -- {ok, at, message, merchant?}
  updated_at     timestamptz not null default now(),
  updated_by     text
);
alter table public.payment_accounts enable row level security;   -- no policies on purpose

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null,
  provider    text not null default 'deluxe',
  env         text,
  kind        text not null,                                -- sale | refund | void
  payment_id  text,                                         -- the processor's id
  parent_id   text,                                         -- a refund's or void's sale
  amount      numeric(12,2) not null,
  currency    text not null default 'USD',
  status      text,                                         -- approved | declined | error | returned
  method      text,                                         -- card | ach
  label       text,                                         -- "Visa ·4242"
  member_id   text,
  ref         text,                                         -- acct | pos:<ticket> | fund:<event>:<paddle> | autopay
  descr       text,
  acct_item   uuid,                                         -- the acct_items row it posted
  response    jsonb,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists payments_tenant_at on public.payments (tenant, created_at desc);
create unique index if not exists payments_provider_id on public.payments (provider, kind, payment_id) where payment_id is not null;
alter table public.payments enable row level security;
drop policy if exists "staff read payments" on public.payments;
create policy "staff read payments" on public.payments for select to authenticated using (can_staff(tenant));

alter table public.member_users add column if not exists pay_provider text;
alter table public.member_users add column if not exists pay_customer text;
alter table public.member_users add column if not exists pay_method   text;
alter table public.tenants add column if not exists pay_status jsonb;

-- does this club take payments online? (Deluxe checked ok; the retired Stripe path still counts while it is connected)
create or replace function public.pay_online(p_tenant text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((t.pay_status ->> 'ok')::boolean, false)
      or (t.stripe_account is not null and coalesce((t.stripe_status ->> 'charges_enabled')::boolean, false))
  from tenants t where t.slug = p_tenant;
$$;
revoke all on function public.pay_online(text) from public;
grant execute on function public.pay_online(text) to anon, authenticated;

-- turning autopay off forgets the card at the processor's vault too
create or replace function public.member_autopay_off(p_tenant text) returns boolean
language sql security definer set search_path = public as $$
  update member_users set autopay = false, stripe_pm = null, pay_method = null, pm_label = null
   where tenant = p_tenant and user_id = auth.uid() returning true;
$$;
revoke all on function public.member_autopay_off(text) from public;
grant execute on function public.member_autopay_off(text) to authenticated;
