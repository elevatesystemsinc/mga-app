-- Flagstick — the service role's rights on the public tables (applied Nov 19, 2026).
-- The Edge Functions (admin-users, mail, stripe, stripe-webhook, courses-import) run as the service role. It had lost
-- select / insert / update / delete on every public table (only REFERENCES, TRIGGER and TRUNCATE were left), so
-- admin-users could not read flagstick_admins and answered "Your login may not manage these logins" to a Flagstick
-- admin. This gives the rights back and keeps them for tables created later. Safe to run again.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select, update on sequences to service_role;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to service_role;
