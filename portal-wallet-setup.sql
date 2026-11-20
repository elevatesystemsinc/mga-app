-- The member portal, second pass (the owner, Nov 20, 2026: "every member should have a login to log into a member's portal where they
-- can add payment information, settle open balances, see each month's statement and their full balance owed, set up autopay… I should
-- also be able to masquerade as any member to view their portal"). Run after payments-setup.sql.
--
--   member_payment_methods   the member's WALLET: cards and bank accounts kept in Deluxe's vault (never the numbers — the processor's ids
--                            and a label), one of them the default that autopay and "charge the card on file" use. Written by the
--                            `payments` function; staff read it; the member gets it inside member_me().
--   member_me()              now carries `wallet`, `online` (pay_online) and `autopay_method`.
--   member_me_as(tenant, member)   the same document for ANY member, to the club's staff only — the hub's "View portal as member".

create table if not exists public.member_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null,
  member_id   text not null,
  provider    text not null default 'deluxe',
  customer_id text,
  method_id   text not null,                 -- the processor's payment method id (a vault id)
  kind        text not null default 'card',  -- card | ach
  label       text,                          -- "Visa ·4242"
  nickname    text,
  exp         text,                          -- MM/YY
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists member_payment_methods_member on public.member_payment_methods (tenant, member_id);
alter table public.member_payment_methods enable row level security;
drop policy if exists "staff read wallets" on public.member_payment_methods;
create policy "staff read wallets" on public.member_payment_methods for select to authenticated using (can_staff(tenant));
grant select, insert, update, delete on public.member_payment_methods to service_role;

-- the portal document for one member (shared by member_me and member_me_as)
create or replace function public.member_portal_doc(p_tenant text, m jsonb, club jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mid text; u member_users%rowtype;
begin
  mid := m ->> 'id';
  select * into u from member_users where tenant = p_tenant and member_id = mid;
  return jsonb_build_object(
    'member', jsonb_build_object('id', mid, 'first', m ->> 'first', 'last', m ->> 'last', 'memberNo', m ->> 'memberNo', 'email', m ->> 'email',
                                 'address1', m ->> 'address1', 'city', m ->> 'city', 'state', m ->> 'state', 'zip', m ->> 'zip', 'status', m ->> 'status'),
    'club', club ->> 'name', 'brand', club -> 'brand' ->> 'logo',
    'message', club -> 'billing' ->> 'message',
    'dueDays', coalesce((club -> 'billing' ->> 'dueDays')::int, 25),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.posted, i.created_at) from acct_items i where i.tenant = p_tenant and i.member_id = mid and i.void_at is null), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.period_end desc) from acct_statements s where s.tenant = p_tenant and s.member_id = mid), '[]'::jsonb),
    'facilities', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(club -> 'booking' -> 'facilities', '[]'::jsonb)) x where coalesce((x ->> 'members')::boolean, true)), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.date, b.time) from bookings b where b.tenant = p_tenant and b.member_id = mid and b.status in ('booked','checked_in') and b.date >= current_date), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x order by x ->> 'date', x ->> 'start') from jsonb_array_elements(coalesce(club -> 'events', '[]'::jsonb)) x
                        where coalesce((x ->> 'public')::boolean, true) and coalesce(x ->> 'end', x ->> 'date') >= current_date::text), '[]'::jsonb),
    'wallet', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'label', w.label, 'nickname', w.nickname, 'exp', w.exp, 'is_default', w.is_default, 'created_at', w.created_at) order by w.is_default desc, w.created_at)
                        from member_payment_methods w where w.tenant = p_tenant and w.member_id = mid and w.removed_at is null), '[]'::jsonb),
    'autopay', coalesce(u.autopay, false), 'pm_label', u.pm_label, 'autopay_method', u.pay_method,
    'online', pay_online(p_tenant));
end $$;
revoke all on function public.member_portal_doc(text, jsonb, jsonb) from public;

create or replace function public.member_me(p_tenant text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text; m jsonb; mid text; club jsonb;
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
  return member_portal_doc(p_tenant, m, club);
end $$;
revoke all on function public.member_me(text) from public;
grant execute on function public.member_me(text) to authenticated;

-- staff see any member's portal exactly as the member does (the page stays live: a payment or card change made from it lands on that member)
create or replace function public.member_me_as(p_tenant text, p_member text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m jsonb; club jsonb;
begin
  if not can_staff(p_tenant) then raise exception 'not allowed' using errcode = '42501'; end if;
  select h.data into club from mga_hub h where h.tenant = p_tenant and h.id = 'club';
  if club is null then return jsonb_build_object('member', null, 'reason', 'no club'); end if;
  select x into m from jsonb_array_elements(club -> 'members') x where x ->> 'id' = p_member limit 1;
  if m is null then return jsonb_build_object('member', null, 'reason', 'not a member', 'club', club ->> 'name'); end if;
  return member_portal_doc(p_tenant, m, club) || jsonb_build_object('staffView', true, 'signedIn', (select coalesce(u.last_seen::text, '') from member_users u where u.tenant = p_tenant and u.member_id = p_member));
end $$;
revoke all on function public.member_me_as(text, text) from public;
grant execute on function public.member_me_as(text, text) to authenticated;

-- turning autopay off keeps the wallet; only the autopay flag and its method go
create or replace function public.member_autopay_off(p_tenant text) returns boolean
language sql security definer set search_path = public as $$
  update member_users set autopay = false, stripe_pm = null, pay_method = null, pm_label = null
   where tenant = p_tenant and user_id = auth.uid() returning true;
$$;
