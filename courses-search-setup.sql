-- Flagstick — the course library is searched on the server (Nov 2026, after the catalogue import put 20,000+ rows in it).
-- The hub and the portal page a filtered query (name / club / city, country, region, owner, verified) and read the counts by
-- country and region from course_regions(); nothing downloads the whole table any more. Run after courses-setup.sql.
create index if not exists courses_country_state_idx on public.courses (country, state) where status='live';
create index if not exists courses_name_idx on public.courses (lower(name));

create or replace function public.course_regions()
returns table (country text, state text, n bigint, own bigint, ver bigint)
language sql stable security invoker as $$
  select coalesce(c.country,'US'), coalesce(c.state,''), count(*), count(*) filter (where c.tenant is not null), count(*) filter (where c.verified)
  from public.courses c where c.status='live' group by 1,2
$$;
grant execute on function public.course_regions() to authenticated;

-- tidy the catalogue: region codes in one case, the case variants folded together
update public.courses set state=upper(state) where tenant is null and length(state)<=3 and state<>upper(state);
update public.courses set state=upper(state) where tenant is null and state in ('Vic','Gauteng');
update public.courses set state='GT' where tenant is null and country='ZA' and state='GAUTENG';
