-- Flagstick — the member portal and online payments (member.html). Run once in the Supabase SQL Editor, after
-- billing-setup.sql. Idempotent.
--
-- A member signs in on member.html with a one-time e-mail link (Supabase Auth, no password). member_me() matches the
-- signed-in e-mail to the club directory (the club document's members[]) and hands back that member's account: items,
-- statements, autopay state, and whether the club takes online payments. Payments go to the CLUB's own Stripe account
-- (Stripe Connect, Standard): tenants.stripe_account; Flagstick never holds the money.
--
--   member_users          one row per member who has signed in: their auth user, autopay flag and the card on file
--   tenants.stripe_account / stripe_status   the club's connected Stripe account and its last known status
--   member_me(tenant)     the signed-in member's account (security definer; nothing of anyone else)
--   member_autopay_off(tenant)   the member turns autopay off

create table if not exists public.member_users (
  tenant          text not null references public.tenants(slug),
  member_id       text not null,
  email           text not null,
  user_id         uuid,
  autopay         boolean not null default false,
  stripe_customer text,
  stripe_pm       text,
  pm_label        text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz,
  primary key (tenant, member_id)
);
alter table public.member_users enable row level security;
drop policy if exists "staff manage member users" on public.member_users;
create policy "staff manage member users" on public.member_users for all to authenticated using (can_staff(tenant)) with check (can_staff(tenant));
grant select, insert, update, delete on public.member_users to authenticated;

alter table public.tenants add column if not exists stripe_account text;
alter table public.tenants add column if not exists stripe_status jsonb;

-- the signed-in member's own account, by the e-mail on the club directory (re-run after booking-setup.sql: it reads bookings)
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
    'club', club ->> 'name',
    'message', club -> 'billing' ->> 'message',
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.posted, i.created_at) from acct_items i where i.tenant = p_tenant and i.member_id = mid and i.void_at is null), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.period_end desc) from acct_statements s where s.tenant = p_tenant and s.member_id = mid), '[]'::jsonb),
    'facilities', coalesce((select jsonb_agg(x) from jsonb_array_elements(club -> 'booking' -> 'facilities') x where coalesce((x ->> 'members')::boolean, true)), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.date, b.time) from bookings b where b.tenant = p_tenant and b.member_id = mid and b.status in ('booked','checked_in') and b.date >= current_date), '[]'::jsonb),
    'autopay', coalesce(u.autopay, false), 'pm_label', u.pm_label,
    'online', coalesce((select t.stripe_account is not null and coalesce((t.stripe_status ->> 'charges_enabled')::boolean, false) from tenants t where t.slug = p_tenant), false));
end $$;
revoke all on function public.member_me(text) from public;
grant execute on function public.member_me(text) to authenticated;

create or replace function public.member_autopay_off(p_tenant text) returns boolean
language sql security definer set search_path = public as $$
  update member_users set autopay = false, stripe_pm = null, pm_label = null where tenant = p_tenant and user_id = auth.uid() returning true;
$$;
revoke all on function public.member_autopay_off(text) from public;
grant execute on function public.member_autopay_off(text) to authenticated;

-- the club's white-label logo for the member portal header (Settings → Branding); re-run member_me after adding:
--   'brand', club -> 'brand' ->> 'logo',
