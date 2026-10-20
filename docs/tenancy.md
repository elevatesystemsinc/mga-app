# Flagstick — tenants, modules and the portal

How one Flagstick installation serves many clubs, how a subscription turns modules on and off per club, and what
has to happen outside the code to bring flagstickhub.com live. Built Oct 2026; `tenants-setup.sql` is the migration,
`src/portal.js` the back office, `tests/test_tenants.py` the proof.

## 1. The shape

```
flagstickhub.com, www., app., portal.   →  the Flagstick portal (Flagstick admins only): clients, modules, logins
<slug>.flagstickhub.com                 →  one client's hubs: /  the club hub, /mga /lga /<group> its organizations,
                                           score.html / cashier.html / checkin.html its public pages
app.wcccmga.org, hub.wcccmga.org        →  extra host names on the wccc tenant (kept working until DNS moves)
```

One static site on Render serves every host (a wildcard custom domain). One Supabase project holds every client.
A **tenant** is a client: a row in `tenants` with a `slug` (its subdomain), a `plan` preset, a `modules` switchboard,
a `status`, extra `hosts` and the board `login_email` shown on its sign-in card. Every row the client owns carries
`tenant`:

| table | key | tenant column |
|---|---|---|
| `mga_hub` (one JSONB document per organization) | `(tenant, id)` — ids such as `club`, `mga`, `misfits` repeat per tenant | yes |
| `golf_events` | `id` (unique per event); slug unique per `(tenant, lower(slug))` | yes |
| `golf_scores` | `(event_id, player_id, hole)` | yes (copied from the event) |
| `calcutta_share` (cashier / check-in links) | `(tenant, tid)`; token unique | yes |
| `hub_keys` (admin links) | `id`; key hash unique | yes |
| `tenant_users` | `(user_id, tenant)` — which logins open which tenant | — |
| `flagstick_admins` | `user_id` — Flagstick's own people | — |

**Row level security** does the isolation, not the client code: a signed-in user reads and writes only rows whose
`tenant` is in their `tenant_users`; a Flagstick admin reaches everything (`can_tenant()`, `is_flagstick_admin()`).
The public pages keep working through their token / slug functions (`golf_event`, `golf_join`, `golf_submit`,
`calcutta_get/put`, `hub_key_*`), all rewritten to stay inside the owning tenant.

## 2. How the app finds its tenant

`core.js`, before anything loads:

1. `PORTAL` — the host is the bare domain or `app.` / `portal.` / `www.` (or `?portal=1`): the portal, no tenant.
2. Otherwise `tenant_lookup(host)` (an anonymous RPC): matches `<slug>.flagstickhub.com`, one of the tenant's extra
   hosts, or the bare slug (`?tenant=wccc` when developing). It returns the public part of the tenant row: slug, name,
   short, plan, modules, status, login_email → `TENANT`, `TENANT_INFO`; `CLUB_META.name` takes the tenant's name.
3. No match → the "No club at this address" screen. `status:'suspended'` → the paused notice (admins still get in).
4. The RPC does not exist (the migration has not run) → `TENANCY=false`: no tenant filter, every module on, exactly
   the old single-club behaviour. That is why the code could be deployed before the SQL.

Every `mga_hub` / `golf_events` / `golf_scores` / `calcutta_share` / `hub_keys` query goes through `tq(q)` (adds
`.eq('tenant', TENANT)`) and every insert through `trow(o)` (adds the column); realtime handlers ignore another
tenant's row of the same id. `localStorage` is per origin, so tenants on different subdomains never share a cache.

**Sign-in.** The card shows the tenant's `login_email` (editable, so a Flagstick admin can sign in anywhere) and a
password. After Supabase accepts, `my_access()` says whether this login may open this tenant (or the portal); if
not, the session is dropped with a message. Sign-in stays one shared board login per club for now; individual
sign-in later only adds rows to `tenant_users`.

## 3. Modules — the switchboard

`MODULE_CATALOG` in core.js is the list; `tenants.modules` is `{id:true}` per tenant; `hasModule(id)` is the one
question the UI asks. Presets (`PLAN_PRESETS`) fill the boxes; the boxes are what count.

| module | what it opens today | where the gate is |
|---|---|---|
| `golf` (base, always on) | the club hub: directory, tournaments, golf, game library, organizations | — |
| `associations` | association hubs (MGA, LGA, SMGA…) | `renderInner` → `vLocked`; picker; Organizations page buttons |
| `groups` | small-group hubs, admin links | same |
| `club` | the club tier: Dues collection, the club's Treasury and Season budget | `navItems` (`CLUB_TIER_NAV`) |
| `billing` (not built) | member accounts, charges, statements, payments | box exists so plans can be set up ahead |
| `pos` (not built) | F&B / pro shop charges to member accounts | same |

Rules for new work: every new table gets a `tenant` column and a `can_tenant(tenant)` policy from day one; every
new feature belongs to a module and checks `hasModule()` at its entry points (nav item, page, the create button),
not deep inside; data is never deleted when a module is switched off — the hub closes, the rows stay.

## 4. The portal (`src/portal.js`)

Flagstick's back office, on the same static site. Only `flagstick_admins` get past the sign-in (`my_access().admin`),
and RLS enforces the same thing on the tables.

- **Clients**: every tenant with its address, plan, module chips, status.
- **New client**: name, short name, slug (becomes the subdomain, cannot change), plan preset, the module boxes, the
  first board login e-mail. Creates the `tenants` row, the client's empty club document (`mga_hub` `(slug,'club')`),
  and the board login — a second supabase-js client with no persisted session signs the user up with a generated
  password (shown once), then `tenant_users` links them. No server function needed; Supabase → Authentication →
  Providers → Email → **Confirm email must be off** or the login waits for a confirmation mail.
- **Edit client**: modules, status (active / trial / suspended), extra host names, notes, the primary login e-mail,
  more board logins.
- Password resets and deleting logins: Supabase dashboard → Authentication → Users (no service key in the browser).

## 5. Going live on flagstickhub.com — the steps outside the code

1. **Supabase → SQL editor**: open `tenants-setup.sql`, replace the two `>>>` e-mail addresses (the WCCC board login
   is already right; put your own Flagstick e-mail on the `flagstick_admins` line), run it. If your Flagstick user does
   not exist yet, create it first under Authentication → Users → Add user (e-mail + password, auto-confirm). Re-run
   the last three `select`s: one tenant `wccc` with hosts `app.wcccmga.org` / `hub.wcccmga.org`, the board linked, you
   as admin. Everything that exists is now tenant `wccc`; app.wcccmga.org keeps working.
2. **Supabase → Authentication → Providers → Email**: turn **Confirm email off** (the portal creates board logins by
   sign-up). Leave everything else.
3. **DNS for flagstickhub.com** (at the registrar): `CNAME *` → your Render site's `*.onrender.com` host;
   `CNAME www` → the same; the apex (`@`) → Render's apex record (an `ALIAS`/`ANAME` to the onrender host where the
   DNS provider supports it, otherwise the A record Render shows under the custom-domain dialog).
4. **Render → the app site → Settings → Custom Domains**: add `flagstickhub.com`, `www.flagstickhub.com` and the
   wildcard `*.flagstickhub.com`; wait for "Verified" and the certificates. The existing `/*` → `/index.html` rewrite
   rule already covers every tenant path. Keep `app.wcccmga.org` on the site until the club has moved.
5. **Open `https://app.flagstickhub.com`** → sign in with your Flagstick e-mail → the Clients page lists Walnut Creek.
   Open `https://wccc.flagstickhub.com` → the club hub, same data as app.wcccmga.org.
6. **Move Walnut Creek**: tell the board the new address; when ready, set a redirect on the old site
   (Render → Redirects: `app.wcccmga.org/*` → `https://wccc.flagstickhub.com/*`, 301) or just leave the extra host in
   place. Also set `hub.wcccmga.org` the same way once PR #2 is merged and the two-way sync is off.
7. **Create the next client** from the portal: name, slug, plan, the first board login; hand over the address and the
   one-time password. Their hub is live immediately at `<slug>.flagstickhub.com`.

Optional: `config.js` → `baseDomain` if the product domain ever changes (defaults to `flagstickhub.com`).

## 6. What comes next, in this frame

- **Member billing / POS** as modules: new tables (`member_accounts`, `charges`, `statements`, `payments`,
  `pos_tickets`…) each with `tenant`, each behind `can_tenant()`, each opened by its box; the club hub gains the pages.
- **Per-user sign-in**: `tenant_users.role` already exists; individual logins for a club are more rows, and visibility
  rules inside a tenant become policies on role.
- **Billing Flagstick itself** (subscriptions, invoices per tenant): a `subscriptions` table keyed by tenant, and the
  portal's status/plan driven from it.
- **Custom domains per client** (`golf.theirclub.com`): already supported through `hosts`; each one is a CNAME on
  their side and a custom domain on Render.
