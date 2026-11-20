-- Flagstick — white-labelled outgoing e-mail per organization (Settings → E-mail). Run once in the Supabase SQL Editor
-- after tenants-setup.sql. Idempotent.
--
--   mail_settings   one row per organization (the club is org 'club'): who the e-mail comes from and how it is sent —
--                   'resend' (Flagstick's mailer, the club's own verified domain or Flagstick's) or 'm365' (the club's or
--                   association's Microsoft 365 through an Azure app registration with Mail.Send; the client secret is
--                   write-only from the hub and only the `mail` Edge Function reads it)
create table if not exists public.mail_settings (
  tenant       text not null references public.tenants(slug),
  org          text not null,
  provider     text not null default 'resend',       -- resend | m365
  from_name    text,
  from_email   text,
  reply_to     text,
  mailbox      text,                                  -- m365: the mailbox that sends (statements@wcccmga.org)
  m365_tenant  text,
  m365_client  text,
  m365_secret  text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (tenant, org)
);
alter table public.mail_settings enable row level security;
drop policy if exists "org manages its mail" on public.mail_settings;
create policy "org manages its mail" on public.mail_settings for all to authenticated using (can_org(tenant, org)) with check (can_org(tenant, org));
grant select, insert, update, delete on public.mail_settings to authenticated;
