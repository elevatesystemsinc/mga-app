-- Flagstick — Player registration for a tournament. Run once in the Supabase SQL Editor (same project). Idempotent.
--
-- The board opens registration from the tournament's Field tab and shares a link (register.html?k=TOKEN). A member
-- finds their own name, adds their partners — or ticks "need help finding a partner" for an open spot — and enters.
-- Each entry is one row the hub takes into the field. The page shows names only: never an e-mail, a GHIN number or an
-- index, and nothing about the sender is stored beyond the entry itself.
--
--   signup_share     one row per tournament while registration is on: what the page shows (details, rules, the pool of
--                    eligible names, who is already entered)
--   signup_entries   one row per entry from the page, until the hub has taken it into the field
--   signup_get(token)                                       anon: the registration behind a link
--   signup_submit(token, players, need, answers, note)      anon: file an entry (only while registration is open)
--   hub_key_signup / hub_key_signup_entries                 the hub-side operations for an admin link (key mode)

create table if not exists public.signup_share (
  tid        text primary key,              -- the tournament id (from the organization's document)
  tenant     text not null default 'wccc',
  org        text not null,                 -- the organization that owns it (RLS)
  token      text unique,                   -- the secret in the link (null = link off)
  status     text not null default 'open',  -- open | closed
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.signup_entries (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default 'wccc',
  org        text not null,
  tid        text not null,
  players    jsonb not null,                -- [{memberId, name}]
  need       int  not null default 0,       -- open spots the golf shop should fill
  answers    jsonb not null default '{}'::jsonb,   -- {memberId: {questionKey: 'Yes'|'No'}}
  note       text not null default '',
  at         timestamptz not null default now()
);
create index if not exists signup_entries_tid on public.signup_entries (tenant, tid);

alter table public.signup_share   enable row level security;
alter table public.signup_entries enable row level security;

do $$
declare has_can_org boolean := exists (select 1 from pg_proc where proname = 'can_org' and pronamespace = 'public'::regnamespace);
begin
  execute 'drop policy if exists "board manages signups" on public.signup_share';
  execute 'drop policy if exists "board reads entries" on public.signup_entries';
  execute 'drop policy if exists "board clears entries" on public.signup_entries';
  if has_can_org then
    execute 'create policy "board manages signups" on public.signup_share for all to authenticated using (can_org(tenant, org)) with check (can_org(tenant, org))';
    execute 'create policy "board reads entries" on public.signup_entries for select to authenticated using (can_org(tenant, org))';
    execute 'create policy "board clears entries" on public.signup_entries for delete to authenticated using (can_org(tenant, org))';
  else
    execute 'create policy "board manages signups" on public.signup_share for all to authenticated using (true) with check (true)';
    execute 'create policy "board reads entries" on public.signup_entries for select to authenticated using (true)';
    execute 'create policy "board clears entries" on public.signup_entries for delete to authenticated using (true)';
  end if;
end $$;
grant select, insert, update, delete on public.signup_share to authenticated;
grant select, delete on public.signup_entries to authenticated;   -- entries are only ever inserted through signup_submit

-- The public page: the registration behind a link, plus the entries the hub has not taken in yet (names only).
create or replace function public.signup_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tid', s.tid, 'status', s.status, 'doc', s.doc,
    'entries', coalesce((select jsonb_agg(jsonb_build_object('players', e.players, 'need', e.need) order by e.at)
                         from signup_entries e where e.tid = s.tid and e.tenant = s.tenant), '[]'::jsonb))
  from signup_share s where s.token is not null and s.token = p_token;
$$;

-- The public page: file one entry. Every spot is a person from the pool or an open spot the shop will fill;
-- nobody can be entered twice, and nothing about the caller is stored.
create or replace function public.signup_submit(p_token text, p_players jsonb, p_need int, p_answers jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_size int; v_n int; v_id uuid; p jsonb; v_mid text; v_seen text[] := '{}';
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Invalid link'; end if;
  select tid, tenant, org, status, doc into s from signup_share where token = p_token;
  if s.tid is null then raise exception 'Invalid link'; end if;
  if s.status <> 'open' then raise exception 'closed'; end if;
  v_size := greatest(1, coalesce((s.doc->>'teamSize')::int, 1));
  if p_players is null or jsonb_typeof(p_players) <> 'array' then raise exception 'Nothing to send'; end if;
  v_n := jsonb_array_length(p_players);
  if v_n < 1 or v_n > v_size then raise exception 'A team is % players', v_size; end if;
  if coalesce(p_need, 0) <> v_size - v_n then raise exception 'Every spot needs a player or a request for one'; end if;
  if pg_column_size(p_players) + pg_column_size(coalesce(p_answers, '{}'::jsonb)) + length(coalesce(p_note, '')) > 20000 then raise exception 'Too large'; end if;
  for p in select * from jsonb_array_elements(p_players) loop
    v_mid := p->>'memberId';
    if v_mid is null or not exists (select 1 from jsonb_array_elements(coalesce(s.doc->'pool', '[]'::jsonb)) q where q->>'id' = v_mid) then raise exception 'not eligible'; end if;
    if v_mid = any(v_seen) then raise exception 'Same player twice'; end if;
    v_seen := v_seen || v_mid;
    if exists (select 1 from jsonb_array_elements_text(coalesce(s.doc->'taken', '[]'::jsonb)) x where x = v_mid)
       or exists (select 1 from signup_entries e, jsonb_array_elements(e.players) ep where e.tid = s.tid and e.tenant = s.tenant and ep->>'memberId' = v_mid)
    then raise exception 'already entered: %', coalesce(p->>'name', v_mid); end if;
  end loop;
  insert into signup_entries (tenant, org, tid, players, need, answers, note)
    values (s.tenant, s.org, s.tid, p_players, coalesce(p_need, 0), coalesce(p_answers, '{}'::jsonb), left(coalesce(p_note, ''), 400))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.signup_get(text), public.signup_submit(text, jsonb, int, jsonb, text) from public;
grant execute on function public.signup_get(text), public.signup_submit(text, jsonb, int, jsonb, text) to anon, authenticated;

-- Admin links (key mode, admin-links-setup.sql): the same for exactly the key's organization.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'hub_key_org' and pronamespace = 'public'::regnamespace) then
    execute $f$
      create or replace function public.hub_key_signup(p_key text, p_tid text, p_token text, p_status text, p_doc jsonb) returns boolean
      language plpgsql security definer set search_path = public as $b$
      declare v_org text; v_tn text;
      begin
        v_org := hub_key_org(p_key);
        if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
        select coalesce(k.tenant, 'wccc') into v_tn from hub_keys k where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and k.revoked_at is null limit 1;
        if p_doc is null then
          delete from signup_entries r where r.tid = p_tid and r.org = v_org;
          delete from signup_share s where s.tid = p_tid and s.org = v_org;
          return true;
        end if;
        insert into signup_share (tid, tenant, org, token, status, doc, updated_at) values (p_tid, coalesce(v_tn, 'wccc'), v_org, p_token, coalesce(p_status, 'open'), p_doc, now())
        on conflict (tid) do update set token = excluded.token, status = excluded.status, doc = excluded.doc, updated_at = now() where signup_share.org = excluded.org;
        return true;
      end $b$;
      create or replace function public.hub_key_signup_entries(p_key text, p_tid text, p_clear uuid[]) returns jsonb
      language plpgsql security definer set search_path = public as $b$
      declare v_org text;
      begin
        v_org := hub_key_org(p_key);
        if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
        if p_clear is not null and array_length(p_clear, 1) > 0 then delete from signup_entries e where e.tid = p_tid and e.org = v_org and e.id = any(p_clear); end if;
        return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'players', e.players, 'need', e.need, 'answers', e.answers, 'note', e.note, 'at', e.at) order by e.at)
                         from signup_entries e where e.tid = p_tid and e.org = v_org), '[]'::jsonb);
      end $b$;
      revoke all on function public.hub_key_signup(text, text, text, text, jsonb), public.hub_key_signup_entries(text, text, uuid[]) from public;
      grant execute on function public.hub_key_signup(text, text, text, text, jsonb), public.hub_key_signup_entries(text, text, uuid[]) to anon, authenticated;
    $f$;
  end if;
end $$;
