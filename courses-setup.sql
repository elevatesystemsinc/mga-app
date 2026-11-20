-- Flagstick — the course library. Run once in the Supabase SQL Editor after client-kinds-setup.sql. Idempotent.
--
-- The owner, Nov 2026: "in our main management portal, we need to have a nav rail item called Courses. This is where
-- we're going to put our library of courses, the tee boxes on those courses… scorecards, the whole thing. And then each
-- one of our tenants will have a default course or courses… Walnut Creek will have clients be able to pick from either
-- Oak or Pecan, or the library of any other course… Data Center Open… have their tournaments at different courses."
--
--   courses            one row per course. tenant null = Flagstick's library (every client reads it, Flagstick writes it);
--                      tenant set = a club's own course (its staff write it; it never shows to other clients).
--                      data = {par:{M,W}, hcp:{M,W}, tees:[{name, rating:{M:{cr,slope},W:{cr,slope}}, yards:[18]|null, total?}]}
--                      — the same shape golfcore's WCCC_COURSES carries, so the hub copies a row straight into a document.
--                      geo  = {"1":[[lat,lng],…],…} hole centerlines for GameCast's map (OpenStreetMap, ODbL), optional.
--   tenants.courses    the client's default course ids (shown first everywhere a course is picked; a new club document
--                      starts with them). tenant_lookup returns it.

create table if not exists public.courses (
  id          text primary key,                       -- a slug: 'wccc-oak', 'tx-dallas-brookhaven-masters'
  tenant      text references public.tenants(slug) on delete cascade,   -- null = the Flagstick library
  name        text not null,                          -- 'Oak Course'
  club        text,                                   -- 'Walnut Creek Country Club'
  city        text, state text, country text default 'US',
  holes       int not null default 18,
  data        jsonb not null default '{}'::jsonb,
  geo         jsonb,
  source      text,                                   -- 'scorecard' | 'osm' | 'golfcourseapi' | 'club' …
  verified    boolean not null default false,         -- checked against the printed card
  status      text not null default 'live',           -- live | draft | retired
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists courses_tenant_idx on public.courses (tenant);
create index if not exists courses_place_idx on public.courses (country, state, city);

grant select, insert, update, delete on public.courses to authenticated;   -- RLS below decides who may; without the grant PostgREST refuses everyone
grant select on public.courses to anon;
grant all on public.courses to service_role;
alter table public.courses enable row level security;
drop policy if exists "courses: read" on public.courses;
create policy "courses: read" on public.courses for select to authenticated
  using (tenant is null or can_tenant(tenant));
drop policy if exists "courses: admin writes library" on public.courses;
create policy "courses: admin writes library" on public.courses for all to authenticated
  using (is_flagstick_admin()) with check (is_flagstick_admin());
drop policy if exists "courses: staff write own" on public.courses;
create policy "courses: staff write own" on public.courses for all to authenticated
  using (tenant is not null and can_staff(tenant)) with check (tenant is not null and can_staff(tenant));

alter table public.tenants add column if not exists courses jsonb not null default '[]'::jsonb;

create or replace function public.tenant_lookup(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'name', name, 'short', short, 'plan', plan, 'modules', modules,
                            'status', status, 'login_email', login_email, 'kind', kind, 'courses', coalesce(courses, '[]'::jsonb))
  from tenants
  where lower(split_part(coalesce(p_host, ''), ':', 1)) in (slug, slug || '.flagstickhub.com')
     or hosts ? lower(split_part(coalesce(p_host, ''), ':', 1))
  limit 1;
$$;
grant execute on function public.tenant_lookup(text) to anon, authenticated;

-- the public pages never read this table: an event publishes the course data it uses inside golf_events.public.
