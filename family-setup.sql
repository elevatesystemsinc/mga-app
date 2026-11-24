-- Family accounts (the owner, Nov 24, 2026: "main account holders and sub-account holders… my children… and my wife"). Run after
-- portal-wallet-setup.sql and pos-stations-setup.sql.
--
-- A person in the club document with `account = {of:<holder id>, rel, pay}` is a sub-account holder. Everything they charge posts to the
-- holder's account: the hub maps it before it posts (acctPost), and this trigger maps every other path — a register station
-- (pos_close / pos_pay), a booking fee (member_book), the payments function — so no caller has to know. The charge keeps the family
-- member's id in `by_member` and their name in front of the description. In the portal a sub-account signs in to the holder's account
-- (member_me), paying only when `pay` is on.

alter table public.acct_items add column if not exists by_member text;

-- the holder of a member's account: the member's own id unless they are a sub-account of a real person in the document
create or replace function public.account_holder(club jsonb, mid text) returns text
language sql immutable as $$
  select coalesce((select x -> 'account' ->> 'of' from jsonb_array_elements(coalesce(club -> 'members', '[]'::jsonb)) x
                    where x ->> 'id' = mid and coalesce(x -> 'account' ->> 'of', '') not in ('', mid)
                      and exists (select 1 from jsonb_array_elements(club -> 'members') y where y ->> 'id' = x -> 'account' ->> 'of')), mid);
$$;

create or replace function public.acct_items_family() returns trigger
language plpgsql as $$
declare club jsonb; h text; nm text;
begin
  if new.member_id is null then return new; end if;
  select data into club from mga_hub where tenant = new.tenant and id = 'club';
  if club is null then return new; end if;
  h := account_holder(club, new.member_id);
  if h <> new.member_id then
    select trim(coalesce(x ->> 'first', '') || ' ' || coalesce(x ->> 'last', '')) into nm from jsonb_array_elements(club -> 'members') x where x ->> 'id' = new.member_id;
    new.by_member := new.member_id; new.member_id := h;
    if nm <> '' and coalesce(new.descr, '') not like nm || ' · %' then new.descr := left(nm || ' · ' || coalesce(new.descr, ''), 180); end if;
  end if;
  return new;
end $$;
create or replace trigger acct_items_family before insert on public.acct_items for each row execute function public.acct_items_family();

-- the register's member search: family members show their holder, and carry the holder's suspension
create or replace function public.pos_members(p_key text, p_q text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m ->> 'id', 'name', trim(coalesce(m ->> 'first', '') || ' ' || coalesce(m ->> 'last', '')), 'memberNo', m ->> 'memberNo',
           'suspended', (coalesce(hm, m) -> 'billing' ->> 'status') = 'suspended',
           'family', case when hm is null then null else trim(coalesce(hm ->> 'first', '') || ' ' || coalesce(hm ->> 'last', '')) end)), '[]'::jsonb)
  from (select m, (select h from jsonb_array_elements(club -> 'members') h where h ->> 'id' = account_holder(club, m ->> 'id') and h ->> 'id' <> m ->> 'id') hm
        from (select h.data club, m from pos_station(p_key) s, mga_hub h, jsonb_array_elements(h.data -> 'members') m
               where h.tenant = s.tenant and h.id = 'club' and coalesce(m ->> 'status', 'Active') <> 'Inactive' and length(coalesce(p_q, '')) >= 2
                 and (lower(coalesce(m ->> 'first', '') || ' ' || coalesce(m ->> 'last', '')) like '%' || lower(p_q) || '%' or lower(coalesce(m ->> 'last', '')) like lower(p_q) || '%' or coalesce(m ->> 'memberNo', '') = p_q)
               order by m ->> 'last', m ->> 'first' limit 8) q) q2;
$$;

-- the portal: a sub-account signs in to the holder's account
create or replace function public.member_family(club jsonb, m jsonb) returns jsonb
language plpgsql immutable as $$
declare hid text; h jsonb; fam jsonb;
begin
  hid := account_holder(club, m ->> 'id');
  if hid = m ->> 'id' then h := m; else select x into h from jsonb_array_elements(club -> 'members') x where x ->> 'id' = hid; end if;
  select coalesce(jsonb_agg(trim(coalesce(x ->> 'first', '') || ' ' || coalesce(x ->> 'last', ''))), '[]'::jsonb) into fam
    from jsonb_array_elements(club -> 'members') x where x ->> 'id' <> hid and account_holder(club, x ->> 'id') = hid and coalesce(x ->> 'status', 'Active') <> 'Inactive';
  return jsonb_build_object('holder', h,
    'extra', jsonb_build_object('family', fam, 'holderName', trim(coalesce(h ->> 'first', '') || ' ' || coalesce(h ->> 'last', '')),
      'sub', case when hid = m ->> 'id' then null else jsonb_build_object('id', m ->> 'id', 'first', m ->> 'first', 'last', m ->> 'last', 'rel', m -> 'account' ->> 'rel') end,
      'canPay', case when hid = m ->> 'id' then true else coalesce((m -> 'account' ->> 'pay')::boolean, false) end));
end $$;

create or replace function public.member_me(p_tenant text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text; m jsonb; mid text; club jsonb; f jsonb;
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
  f := member_family(club, m);
  return member_portal_doc(p_tenant, f -> 'holder', club) || (f -> 'extra');
end $$;

create or replace function public.member_me_as(p_tenant text, p_member text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m jsonb; club jsonb; f jsonb;
begin
  if not can_staff(p_tenant) then raise exception 'not allowed' using errcode = '42501'; end if;
  select h.data into club from mga_hub h where h.tenant = p_tenant and h.id = 'club';
  if club is null then return jsonb_build_object('member', null, 'reason', 'no club'); end if;
  select x into m from jsonb_array_elements(club -> 'members') x where x ->> 'id' = p_member limit 1;
  if m is null then return jsonb_build_object('member', null, 'reason', 'not a member', 'club', club ->> 'name'); end if;
  f := member_family(club, m);
  return member_portal_doc(p_tenant, f -> 'holder', club) || (f -> 'extra') || jsonb_build_object('staffView', true, 'signedIn', (select coalesce(u.last_seen::text, '') from member_users u where u.tenant = p_tenant and u.member_id = p_member));
end $$;
