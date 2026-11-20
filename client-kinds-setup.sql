-- Flagstick — the type of client. Run once in the Supabase SQL Editor after portal-setup.sql. Idempotent.
--
-- The owner, Oct 2026: "when I create a client… it needs to ask me the type — nonprofit, country club, private country
-- club, semi-private golf club, municipal course — and then have feature sets consistent with those types."
--   tenants.kind     private | country | semi | muni | nonprofit | other (CLIENT_KINDS in core.js carries the presets)
--   tenant_lookup    now returns kind, so the hub knows what it is running for (a nonprofit's rail, labels, modules)

alter table public.tenants add column if not exists kind text not null default 'private';

create or replace function public.tenant_lookup(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'name', name, 'short', short, 'plan', plan, 'modules', modules,
                            'status', status, 'login_email', login_email, 'kind', kind)
  from tenants
  where lower(split_part(coalesce(p_host, ''), ':', 1)) in (slug, slug || '.flagstickhub.com')
     or hosts ? lower(split_part(coalesce(p_host, ''), ':', 1))
  limit 1;
$$;
