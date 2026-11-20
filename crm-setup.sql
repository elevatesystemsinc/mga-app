-- Companies (the CRM layer, src/crm.js) live on the club document beside the directory: CLUB.companies.
-- A scoped board login reads the club document through scoped_read(); this teaches it to hand the companies over too
-- (read-only there — the club keeps the list, exactly like the directory's people). Run after portal-setup.sql.
create or replace function public.scoped_read(p_tenant text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u tenant_users; d jsonb;
begin
  select * into u from tenant_users where user_id = auth.uid() and tenant = p_tenant;
  if u.user_id is null and not is_flagstick_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if can_org(p_tenant, p_id) then select data into d from mga_hub where tenant = p_tenant and id = p_id; return d; end if;
  if p_id = 'club' then
    select data into d from mga_hub where tenant = p_tenant and id = 'club';
    if d is null then return null; end if;
    return jsonb_build_object('id', 'club', 'kind', 'club', 'name', d -> 'name', 'short', d -> 'short',
      'members', coalesce(d -> 'members', '[]'::jsonb), 'games', coalesce(d -> 'games', '{}'::jsonb), '_rev', d -> '_rev',
      'companies', coalesce(d -> 'companies', '[]'::jsonb),
      'orgs', coalesce((select jsonb_agg(o) from jsonb_array_elements(coalesce(d -> 'orgs', '[]'::jsonb)) o where o ->> 'id' = any(u.orgs)), '[]'::jsonb));
  end if;
  raise exception 'not allowed' using errcode = '42501';
end $$;
