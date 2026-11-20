-- Flagstick — invitations to a hub. Run AFTER portal-setup.sql in the Supabase SQL Editor (or as a migration); safe to run again.
--
-- An invitation is a row here plus an e-mail the Edge Function admin-users sends through the club's own mailer (the
-- `mail` function's sender: the organization's row in mail_settings, else the club's, else Flagstick's MAIL_FROM).
-- The link in the e-mail is <hub>/#invite=TOKEN; only the SHA-256 of the token is stored. On arrival the hub hands the
-- token back to admin-users ('accept', no sign-in needed), which turns it into a one-time sign-in for that login and
-- marks the row used. Seven days, one use. Nothing but the service role (the function) reads or writes this table —
-- no policies on purpose.
create table if not exists public.login_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant      text references public.tenants(slug) on delete cascade,   -- null = an invitation to the Flagstick team
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  token_hash  text not null unique,
  role        text not null default 'staff',                            -- staff | org | admin (the Flagstick team)
  orgs        text[] not null default '{}',
  by_email    text not null default '',
  redirect    text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz
);
alter table public.login_invites enable row level security;
revoke all on public.login_invites from anon, authenticated;
grant select, insert, update, delete on public.login_invites to service_role;
create index if not exists login_invites_user on public.login_invites (user_id);

-- The function needs to find a login by e-mail before it decides whether to create one (auth.users is not reachable
-- over the REST API, even for the service role). Service role only.
create or replace function public.auth_user_by_email(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'email', email, 'confirmed', email_confirmed_at is not null,
                            'last_sign_in_at', last_sign_in_at, 'created_at', created_at, 'name', raw_user_meta_data ->> 'name')
    from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;

-- Check
select count(*) as invites, count(used_at) as used from public.login_invites;
