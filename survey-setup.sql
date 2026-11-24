-- Flagstick — Surveys. Run once in the Supabase SQL Editor (same project). Idempotent.
--
-- A board writes a survey in its hub and opens it with a private link (survey.html?k=TOKEN). Members answer on
-- their phones without any sign-in. Responses are ANONYMOUS by design: a response row holds the answers, the
-- survey it belongs to and the day it arrived — no user, no e-mail, no IP, no device id, and the time is cut
-- down to the day so nobody can line a response up with a message in a group chat.
--
--   survey_share      one row per survey while it has a link: the questions the public page shows
--   survey_responses  one row per submitted response
--   survey_get(token)              anon: the survey behind a link (only while it is open)
--   survey_submit(token, answers)  anon: file a response (only while the survey is open)
--   hub_key_survey / hub_key_survey_results   the same two hub-side operations for an admin link (key mode)

create table if not exists public.survey_share (
  sid        text primary key,              -- the survey id (from the organization's document)
  tenant     text not null default 'wccc',
  org        text not null,                 -- the organization that owns it (RLS)
  token      text unique,                   -- the secret in the link (null = link off)
  status     text not null default 'draft', -- draft | open | closed
  doc        jsonb not null,                -- title, intro, sections → questions
  updated_at timestamptz not null default now()
);
create table if not exists public.survey_responses (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  org        text not null,
  sid        text not null,
  answers    jsonb not null,
  day        date not null default current_date   -- the day only, on purpose
);
create index if not exists survey_responses_sid on public.survey_responses (tenant, sid);

alter table public.survey_share     enable row level security;
alter table public.survey_responses enable row level security;

-- The board reads / manages its own organizations' surveys and reads their responses. With portal-setup.sql in
-- place that is `can_org(tenant, org)` (staff = the club, a board login = its organizations); before it, any
-- signed-in board member.
do $$
declare has_can_org boolean := exists (select 1 from pg_proc where proname = 'can_org' and pronamespace = 'public'::regnamespace);
begin
  execute 'drop policy if exists "board manages surveys" on public.survey_share';
  execute 'drop policy if exists "board reads responses" on public.survey_responses';
  execute 'drop policy if exists "board clears responses" on public.survey_responses';
  if has_can_org then
    execute 'create policy "board manages surveys" on public.survey_share for all to authenticated using (can_org(tenant, org)) with check (can_org(tenant, org))';
    execute 'create policy "board reads responses" on public.survey_responses for select to authenticated using (can_org(tenant, org))';
    execute 'create policy "board clears responses" on public.survey_responses for delete to authenticated using (can_org(tenant, org))';
  else
    execute 'create policy "board manages surveys" on public.survey_share for all to authenticated using (true) with check (true)';
    execute 'create policy "board reads responses" on public.survey_responses for select to authenticated using (true)';
    execute 'create policy "board clears responses" on public.survey_responses for delete to authenticated using (true)';
  end if;
end $$;
grant select, insert, update, delete on public.survey_share to authenticated;
grant select, delete on public.survey_responses to authenticated;   -- responses are only ever inserted through survey_submit

-- The public page: read the survey behind a link.
create or replace function public.survey_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('sid', sid, 'status', status, 'doc', doc)
  from survey_share where token is not null and token = p_token;
$$;

-- The public page: file one anonymous response. Nothing about the caller is stored.
create or replace function public.survey_submit(p_token text, p_answers jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Invalid link'; end if;
  select sid, tenant, org, status into s from survey_share where token = p_token;
  if s.sid is null then raise exception 'Invalid link'; end if;
  if s.status <> 'open' then raise exception 'closed'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or p_answers = '{}'::jsonb then raise exception 'Nothing to send'; end if;
  if pg_column_size(p_answers) > 60000 then raise exception 'Too large'; end if;
  insert into survey_responses (tenant, org, sid, answers) values (s.tenant, s.org, s.sid, p_answers);
  return true;
end $$;

revoke all on function public.survey_get(text), public.survey_submit(text, jsonb) from public;
grant execute on function public.survey_get(text), public.survey_submit(text, jsonb) to anon, authenticated;

-- Admin links (key mode, admin-links-setup.sql): the same for exactly the key's organization.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'hub_key_org' and pronamespace = 'public'::regnamespace) then
    execute $f$
      create or replace function public.hub_key_survey(p_key text, p_sid text, p_token text, p_status text, p_doc jsonb) returns boolean
      language plpgsql security definer set search_path = public as $b$
      declare v_org text; v_tn text;
      begin
        v_org := hub_key_org(p_key);
        if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
        select coalesce(k.tenant, 'wccc') into v_tn from hub_keys k where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and k.revoked_at is null limit 1;
        if p_doc is null then
          delete from survey_responses r where r.sid = p_sid and r.org = v_org;
          delete from survey_share s where s.sid = p_sid and s.org = v_org;
          return true;
        end if;
        insert into survey_share (sid, tenant, org, token, status, doc, updated_at) values (p_sid, coalesce(v_tn, 'wccc'), v_org, p_token, coalesce(p_status, 'draft'), p_doc, now())
        on conflict (sid) do update set token = excluded.token, status = excluded.status, doc = excluded.doc, updated_at = now() where survey_share.org = excluded.org;
        return true;
      end $b$;
      create or replace function public.hub_key_survey_results(p_key text, p_sid text) returns jsonb
      language sql stable security definer set search_path = public as $b$
        select coalesce(jsonb_agg(jsonb_build_object('answers', r.answers, 'day', r.day)), '[]'::jsonb)
        from survey_responses r where r.sid = p_sid and r.org = hub_key_org(p_key);
      $b$;
      revoke all on function public.hub_key_survey(text, text, text, text, jsonb), public.hub_key_survey_results(text, text) from public;
      grant execute on function public.hub_key_survey(text, text, text, text, jsonb), public.hub_key_survey_results(text, text) to anon, authenticated;
    $f$;
  end if;
end $$;
