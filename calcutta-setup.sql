-- MGA Hub — Calcutta cashier link. Run once in the Supabase SQL Editor (same project).
-- The board shares a tournament's Calcutta with a private link. Cashiers open it without the
-- board password; the link's token is the only key, and it can do exactly two things:
-- read that one Calcutta, and save it (only if nobody else saved in between).
-- Turning the link off in the hub clears the token, and the link stops working immediately.

create table if not exists public.calcutta_share (
  tid        text primary key,              -- the tournament
  token      text unique,                   -- the secret in the cashier link (null = link off)
  name       text,                          -- tournament name, shown on the cashier page
  doc        jsonb not null,                -- lots, bidders, expenses, settings
  version    int  not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.calcutta_share enable row level security;
create policy "board manages calcutta shares" on public.calcutta_share for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.calcutta_share to authenticated;

create or replace function public.calcutta_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('doc', doc, 'version', version, 'name', name)
  from calcutta_share where token is not null and token = p_token;
$$;

create or replace function public.calcutta_put(p_token text, p_doc jsonb, p_version int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Invalid link'; end if;
  if pg_column_size(p_doc) > 2000000 then raise exception 'Too large'; end if;
  update calcutta_share set doc = p_doc, version = version + 1, updated_at = now()
   where token = p_token and version = p_version
  returning version into v;
  if v is null then
    if exists (select 1 from calcutta_share where token = p_token) then raise exception 'conflict'; end if;
    raise exception 'Invalid link';
  end if;
  return v;
end $$;

revoke all on function public.calcutta_get(text), public.calcutta_put(text, jsonb, int) from public;
grant execute on function public.calcutta_get(text), public.calcutta_put(text, jsonb, int) to anon, authenticated;
