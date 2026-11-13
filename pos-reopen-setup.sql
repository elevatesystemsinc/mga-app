-- Flagstick — station links that can be shown again, and closed checks that can be reopened. Run once in the
-- Supabase SQL Editor after pos-split-setup.sql. Idempotent.
--
--   pos_stations.token            the station's link token, kept in clear for staff (the table is staff-only under RLS;
--                                 the hash still does the lookup) so a lost tablet's link can be copied again
--   pos_reopen(key, ticket)       a closed (or voided) check back to open: payments cleared, its account charges voided
--                                 with a reason, closed_at / paid cleared — so it can be edited and paid again

alter table public.pos_stations add column if not exists token text;

create or replace function public.pos_reopen(p_key text, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pos_stations; r pos_tickets;
begin
  s := pos_station(p_key); if s.id is null then raise exception 'This station link is not valid' using errcode = '42501'; end if;
  select * into r from pos_tickets where id = p_ticket and tenant = s.tenant and outlet = s.outlet for update;
  if r.id is null then raise exception 'Unknown check'; end if;
  if r.status = 'open' then return to_jsonb(r); end if;
  update acct_items set void_at = now(), void_reason = 'Check reopened at the station' where tenant = s.tenant and void_at is null and (id = r.acct_item or ref like 'pos:' || r.id::text || '%');
  update pos_tickets set status = 'open', closed_at = null, paid = null, payments = '[]'::jsonb, acct_item = null, void_at = null, void_reason = null, tip = 0,
    lines = (select coalesce(jsonb_agg(l - 'fired' - 'fired_at' || jsonb_build_object('fired', coalesce((l ->> 'fired')::boolean, false))), '[]'::jsonb) from jsonb_array_elements(r.lines) l),
    updated_at = now() where id = r.id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.pos_reopen(text, uuid) from public;
grant execute on function public.pos_reopen(text, uuid) to anon, authenticated;
