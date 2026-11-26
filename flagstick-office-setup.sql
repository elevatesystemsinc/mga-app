-- Flagstick — the back office in the client portal (app.flagstickhub.com): the sales pipeline, estimates, contracts
-- with automated billing, invoices and payments, the catalog of what Flagstick sells. Run once in the Supabase SQL
-- Editor after tenants-setup.sql and portal-setup.sql. Idempotent. Modelled on the Elevate PSA (leads → estimates →
-- contracts → recurring invoices → payments), cut down to what Flagstick bills: subscriptions per club.
--
--   fs_leads       the pipeline: a prospect club, its stage, the deal's recurring / one-time value, who owns it, notes
--   fs_catalog     what Flagstick sells: subscriptions (recurring, per month or year), set-up and services (one-time)
--   fs_estimates   a quote: items (recurring and one-time lines), sent / accepted / declined, converted to a contract
--   fs_contracts   the subscription: recurring items, billing day / frequency / timing / terms, the last period billed
--   fs_invoices    one per period (or one-off): items, totals, status draft | sent | partial | paid | void
--   fs_payments    money received against an invoice
--   fs_settings    key → jsonb: the remit-to block on every PDF, numbering floors, the billing mode
--   fs_counters    document numbers per kind (fs_next_number)
-- Every table is Flagstick's own: row level security = is_flagstick_admin(). `tenant` on a row names the client (the
-- tenants.slug) once there is one; a lead or an estimate may carry none until the club is set up.

create table if not exists public.fs_counters (kind text primary key, n integer not null);
create or replace function public.fs_next_number(p_kind text) returns integer
language plpgsql security definer set search_path = public as $$
declare base integer; v integer;
begin
  if not is_flagstick_admin() then raise exception 'Flagstick administrators only'; end if;
  base := case p_kind when 'lead' then 2000 when 'estimate' then 1000 when 'contract' then 7000 when 'invoice' then 9000 else 1 end;
  insert into fs_counters (kind, n) values (p_kind, base) on conflict (kind) do update set n = fs_counters.n + 1 returning n into v;
  return v;
end $$;
grant execute on function public.fs_next_number(text) to authenticated;

create table if not exists public.fs_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());

create table if not exists public.fs_catalog (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  descr       text not null default '',
  kind        text not null default 'subscription',     -- subscription | setup | service | addon
  recurring   boolean not null default true,
  every       text not null default 'month',            -- month | year (recurring lines)
  unit_price  numeric(12,2) not null default 0,
  unit        text not null default '',                 -- 'club', 'hour', 'course'…
  taxable     boolean not null default false,
  gl          text not null default '',
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.fs_leads (
  id             uuid primary key default gen_random_uuid(),
  number         integer,
  title          text not null default '',
  company        text not null,                          -- the club
  tenant         text references public.tenants(slug) on delete set null,   -- once it is a client
  kind           text not null default 'private',        -- CLIENT_KINDS id
  contact_name   text not null default '',
  contact_email  text not null default '',
  contact_phone  text not null default '',
  city           text not null default '',
  state          text not null default '',
  stage          text not null default 'new',            -- new | contacted | qualified | proposal | won | lost
  value_recurring numeric(12,2) not null default 0,      -- per month
  value_onetime  numeric(12,2) not null default 0,
  owner          text not null default '',               -- the Flagstick person's e-mail
  source         text not null default '',
  expected_close date,
  lost_reason    text not null default '',
  notes          text not null default '',
  log            jsonb not null default '[]'::jsonb,     -- [{id, at, by, text}]
  won_at         timestamptz,
  lost_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.fs_estimates (
  id             uuid primary key default gen_random_uuid(),
  number         integer,
  lead_id        uuid references public.fs_leads(id) on delete set null,
  tenant         text references public.tenants(slug) on delete set null,
  company        text not null default '',
  contact_name   text not null default '',
  contact_email  text not null default '',
  title          text not null default '',
  status         text not null default 'draft',          -- draft | sent | accepted | declined | expired | converted
  issued_on      date,
  expires_on     date,
  discount_pct   numeric(5,2) not null default 0,
  items          jsonb not null default '[]'::jsonb,     -- [{id, catalog_id, descr, detail, qty, unit_price, recurring, every, discount_pct}]
  terms          text not null default '',
  notes          text not null default '',
  sent_at        timestamptz,
  accepted_at    timestamptz,
  accepted_by    text not null default '',
  contract_id    uuid,
  invoice_id     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.fs_contracts (
  id             uuid primary key default gen_random_uuid(),
  number         integer,
  tenant         text not null references public.tenants(slug) on delete cascade,
  estimate_id    uuid references public.fs_estimates(id) on delete set null,
  title          text not null default '',
  status         text not null default 'draft',          -- draft | active | paused | ended
  start_on       date not null default current_date,
  end_on         date,
  billing_day    integer not null default 1,             -- 1..28
  frequency      text not null default 'monthly',        -- monthly | quarterly | semiannual | annual
  timing         text not null default 'advance',        -- advance | arrears
  lead_days      integer not null default 0,             -- generate this many days before the invoice date
  terms_days     integer not null default 30,            -- Net N (0 = due on receipt)
  auto_renew     boolean not null default true,
  escalator_pct  numeric(5,2) not null default 0,        -- raise every line by this much on each anniversary
  discount_pct   numeric(5,2) not null default 0,
  items          jsonb not null default '[]'::jsonb,     -- [{id, catalog_id, descr, detail, qty, unit_price, discount_pct}]
  last_period    text,                                   -- YYYY-MM of the last service period invoiced
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.fs_invoices (
  id             uuid primary key default gen_random_uuid(),
  number         integer,
  tenant         text references public.tenants(slug) on delete set null,
  company        text not null default '',
  contract_id    uuid references public.fs_contracts(id) on delete set null,
  estimate_id    uuid references public.fs_estimates(id) on delete set null,
  period         text,                                   -- YYYY-MM of the service period (recurring)
  period_start   date,
  period_end     date,
  status         text not null default 'draft',          -- draft | sent | partial | paid | void
  issued_on      date not null default current_date,
  due_on         date,
  terms_days     integer not null default 30,
  discount_pct   numeric(5,2) not null default 0,
  items          jsonb not null default '[]'::jsonb,     -- [{id, catalog_id, descr, detail, qty, unit_price, discount_pct}]
  subtotal       numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  tax            numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  paid           numeric(12,2) not null default 0,
  notes          text not null default '',
  sent_at        timestamptz,
  sent_to        text not null default '',
  paid_at        timestamptz,
  void_at        timestamptz,
  void_reason    text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fs_invoices_contract_period on public.fs_invoices (contract_id, period);

create table if not exists public.fs_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.fs_invoices(id) on delete cascade,
  tenant      text,
  amount      numeric(12,2) not null,
  method      text not null default 'check',             -- check | ach | card | cash | other
  reference   text not null default '',
  paid_on     date not null default current_date,
  note        text not null default '',
  by          text not null default '',
  created_at  timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['fs_settings','fs_catalog','fs_leads','fs_estimates','fs_contracts','fs_invoices','fs_payments','fs_counters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "flagstick admins" on public.%I', t);
    execute format('create policy "flagstick admins" on public.%I for all to authenticated using (is_flagstick_admin()) with check (is_flagstick_admin())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- the catalog Flagstick starts with (the three offerings; prices are placeholders the portal edits)
insert into public.fs_catalog (name, descr, kind, recurring, every, unit_price, unit, sort)
select * from (values
  ('Golf management', 'Tournaments, registration, live scoring, associations and member games', 'subscription', true, 'month', 299.00, 'club', 1),
  ('Point of sale', 'Registers, kitchen screens and tickets for a golf-only client', 'addon', true, 'month', 99.00, 'club', 2),
  ('Club management', 'The full club: member accounts and billing, point of sale, bookings, the member portal', 'subscription', true, 'month', 799.00, 'club', 3),
  ('Set-up and data migration', 'The roster, the course cards, the first season, staff training', 'setup', false, 'month', 1500.00, '', 4),
  ('On-site training day', 'A Flagstick person at the club for a day', 'service', false, 'month', 950.00, 'day', 5)
) as v(name, descr, kind, recurring, every, unit_price, unit, sort)
where not exists (select 1 from public.fs_catalog);

-- ---------------------------------------------------------------- the industry pass (Nov 26, 2026)
-- A lead is a club: what it runs today, its size, the modules it is after, when it wants to be live, and the sales
-- motion is ours — demo, a trial hub, then the subscription. A catalog item may be one of the product's modules
-- (`module` = golf | pos | club | events) so a contract built from it switches that module on for the club.
alter table public.fs_leads add column if not exists current_system text not null default '';   -- Golf Genius, Club Essentials, Jonas, paper…
alter table public.fs_leads add column if not exists holes          integer;                      -- 9 / 18 / 27 / 36
alter table public.fs_leads add column if not exists members_n      integer;                      -- members (or rounds a year for a muni)
alter table public.fs_leads add column if not exists modules        jsonb not null default '{}'::jsonb;   -- the modules they are after
alter table public.fs_leads add column if not exists contact_title  text not null default '';     -- head golf professional, GM, board…
alter table public.fs_leads add column if not exists live_by        date;                         -- wants to be live by (the season)
alter table public.fs_leads add column if not exists demo_at        timestamptz;                  -- the demo given
alter table public.fs_catalog add column if not exists module     text not null default '';       -- golf | pos | club | events | ''
alter table public.fs_catalog add column if not exists price_year numeric(12,2);                  -- the yearly price when billed annually
alter table public.fs_estimates add column if not exists billing text not null default 'month';   -- the subscription billed month | year
update public.fs_catalog set module = 'golf'   where module = '' and name = 'Golf management';
update public.fs_catalog set module = 'pos'    where module = '' and name = 'Point of sale';
update public.fs_catalog set module = 'club'   where module = '' and name = 'Club management';
insert into public.fs_catalog (name, descr, kind, recurring, every, unit_price, unit, sort, module)
select * from (values
  ('Fundraising events', 'For a nonprofit: galas with tickets and tables, sponsors, the silent and live auctions, raffles, checkout', 'subscription', true, 'month', 199.00, 'organization', 4, 'events'),
  ('Course card build', 'A course’s scorecard in the library: par, handicaps, every tee’s ratings and yardages, the hole lines for GameCast', 'setup', false, 'month', 150.00, 'course', 7, ''),
  ('Member data import', 'The roster from the club’s current system (Club Essentials, Jonas, a spreadsheet) with numbers, GHINs and classes', 'setup', false, 'month', 500.00, '', 8, '')
) as v(name, descr, kind, recurring, every, unit_price, unit, sort, module)
where not exists (select 1 from public.fs_catalog c where c.name = v.name);
update public.fs_catalog set descr = 'The roster, the course cards, the first season’s tournaments, staff training — moving off Golf Genius' where name = 'Set-up and data migration' and descr = 'The roster, the course cards, the first season, staff training';
