# Flagstick — tenants, modules and the portal

How one Flagstick installation serves many clubs, how a subscription turns modules on and off per club, and what
has to happen outside the code to bring flagstickhub.com live. Built Oct 2026; `tenants-setup.sql` is the migration,
`src/portal.js` the back office, `tests/test_tenants.py` the proof.

## 1. The shape

```
app.flagstickhub.com                    →  the Flagstick portal (Flagstick admins only): clients, modules, logins
flagstickhub.com, www.                  →  the marketing website (not this app; hosted wherever the site lives)
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

1. `PORTAL` — the host is `app.<domain>` (or `?portal=1`): the portal, no tenant. `www` and the bare domain are the
   website, not this app; if they ever reach it they show "No club at this address".
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
question the UI asks. **Golf management is the package** and it is everything built so far: the directory,
tournaments, rounds and results, live scoring and formats, the game library, associations, small groups, dues
collection, the club's treasury and budget. **Club management** is the coming tier for running the whole club
through Flagstick, with its own toggles; the boxes exist today so a plan can be set up ahead of the features.

| module | what it opens | status |
|---|---|---|
| `golf` (base, every client) | all of the above | built |
| `club` | run the whole club: membership, member numbers, statements, operations | coming |
| `billing` | member accounts, charges, statements, payment collection | coming |
| `pos` | F&B / pro-shop charges to member accounts | coming |

Presets (`PLAN_PRESETS`): Golf management = golf; Club management = golf + club + billing + pos. The boxes are what
count and can be changed any time from the client record. Rules for new work: every new table gets a `tenant`
column and a `can_org()` policy from day one; every new feature belongs to a module and checks `hasModule()` at its
entry points (nav item, page, the create button); switching a module off never deletes data.

## 4. Logins and who sees what

`tenant_users` is the list of logins per client (`portal-setup.sql`):

| role | sees | who manages them |
|---|---|---|
| `staff` | the whole club: the club hub, every organization, the Logins page | **Flagstick**, from the portal |
| `org` | only the organizations in `orgs` (an MGA board member sees the MGA and nothing else) | the club's staff (club hub → Logins), and any board login with `manage` (a **board administrator**, from its association's Board page) |

Enforcement is in the database, not the screens: `can_org(tenant, org)` replaces `can_tenant()` on every data table,
so an org login cannot read another organization's row even with the API; the club document reaches it through
`scoped_read()` as the same cut-down copy an admin link gets (directory, its own organizations, the game library) and
`scoped_people()` lets it add people. `can_manage_login()` guards `tenant_users` itself: staff may write any board
login of their club, a board administrator only `org` rows inside its own organizations, nobody can promote
themselves. In the hub: a board login lands on its own hub (`SCOPED`, `SCOPE_ORGS` in core.js), the picker offers only
its organizations, the Logins page is staff-only, the Board page carries the board's logins for administrators.

**Account actions** (logins.js → the Edge Function `supabase/functions/admin-users`, called with the caller's own
session): create a login with a password the caller sets, invite by e-mail (they choose a password on arrival),
set or reset a password, delete, and `sso` — a one-time link that signs a Flagstick admin straight into a client's
hub ("Open hub" in the portal). The function checks the caller's scope the same way the policies do. Without the
function the browser falls back to a side-client sign-up and reset e-mails and says so on screen (passwords can't be
set for an existing login, one-click sign-in becomes a normal sign-in). Arriving by an invite or reset link shows
"choose your password" before anything else (`authLanding()`, `setPasswordScreen()`).

## 5. The portal (`src/portal.js`)

Flagstick's back office at app.flagstickhub.com. Only `flagstick_admins` get past the sign-in (`my_access().admin`),
and RLS enforces the same on the tables.

- **Clients**: every tenant by status (prospect, trial, active, suspended, inactive) with search; a row opens the
  **client record**: subscription (plan, status, dates, billing e-mail, the module boxes), club details (address,
  phone, website, time zone, other hosts, notes), points of contact, **staff logins** (create with a password or
  invite, set a password later, reset e-mail, remove, delete), the board logins the club manages itself (read-only),
  and the activity log. "Open hub" signs you into that client's hub in one click.
- **New client**: name, slug (= subdomain, fixed), plan preset and boxes, status, address and contacts, the first
  staff login. It creates the tenant row, an empty club document and the login.
- **Team**: Flagstick's own administrators (new login with a password, invite, or link an existing login).
- **Activity**: everything the portal did, newest first (`tenant_events`).

## 6. Going live on flagstickhub.com — the steps outside the code

1. **Supabase → SQL editor**: open `tenants-setup.sql`, replace the two `>>>` e-mail addresses (the WCCC board login
   is already right; put your own Flagstick e-mail on the `flagstick_admins` line), run it. If your Flagstick user does
   not exist yet, create it first under Authentication → Users → Add user (e-mail + password, auto-confirm). Then run
   **`portal-setup.sql`** (the client record, contacts, roles and scope, the activity log). Both are safe to re-run.
   Everything that exists is now tenant `wccc` and its board login is `staff`; app.wcccmga.org keeps working.
2. **Supabase → Edge Functions → Deploy new function**, name `admin-users`, paste `supabase/functions/admin-users/index.ts`
   (or `supabase functions deploy admin-users` with the CLI). It uses the project's service role key from the
   environment; nothing to configure. Without it the portal still works with the fallbacks described in §4.
2b. **Supabase → Authentication**: Providers → Email → **Confirm email off** (sign-up fallback and invites); URL
   configuration → Site URL `https://app.flagstickhub.com`, Redirect URLs `https://*.flagstickhub.com/**` and
   `https://app.wcccmga.org/**` (invite and reset links land on the club's own address).
3. **DNS for flagstickhub.com**: `@` and `www` → the marketing website's host (not this app). For the app, either
   (a) `CNAME *` → the Render site's `*.onrender.com` host plus the two `_acme-challenge` / `_cf-custom-hostname`
   CNAMEs Render shows when the wildcard is added — Render requires the root domain to point at Render for a
   wildcard, so this works when the website is also a Render static site; or (b) no wildcard: one `CNAME` per host
   (`app`, `wccc`, and each new client's slug) → the Render host. Remove AAAA records.
4. **Render → the app site → Settings → Custom Domains**: add `*.flagstickhub.com` (option a) or `app.flagstickhub.com`
   + `wccc.flagstickhub.com` (option b; each later client gets its own entry, two minutes); wait for "Verified" and
   the certificates. The existing `/*` → `/index.html` rewrite rule already covers every tenant path. Keep
   `app.wcccmga.org` on the site until the club has moved.
5. **Open `https://app.flagstickhub.com`** → sign in with your Flagstick e-mail → the Clients page lists Walnut Creek.
   Open `https://wccc.flagstickhub.com` → the club hub, same data as app.wcccmga.org.
6. **Move Walnut Creek**: tell the board the new address; when ready, set a redirect on the old site
   (Render → Redirects: `app.wcccmga.org/*` → `https://wccc.flagstickhub.com/*`, 301) or just leave the extra host in
   place. Also set `hub.wcccmga.org` the same way once PR #2 is merged and the two-way sync is off.
7. **Create the next client** from the portal: name, slug, plan, the first staff login; hand over the address and the
   one-time password (or let the invite e-mail do it). Their staff then invite their boards from the hub. Their hub is live immediately at `<slug>.flagstickhub.com` (with option b, add that host name
   on Render and a CNAME first).

8. **Billing, the member portal and online payments** (module `billing`), **Point of sale** (`pos`) and **Bookings** (`club`): run
   `billing-setup.sql`, `member-setup.sql`, `pos-setup.sql`, `booking-setup.sql` (all applied to the project, Oct 2026) and switch the module on for the client in the portal. Edge Functions (deployed
   from the Supabase MCP / dashboard): `mail`, `stripe`, `stripe-webhook` (the webhook with **verify JWT off**). Secrets
   (Edge Functions → Secrets): `RESEND_API_KEY` (+ `MAIL_FROM`, a verified sending domain in Resend) for statements by
   e-mail; `STRIPE_SECRET_KEY` (Flagstick's platform key — the Connect platform must be enabled in the Stripe dashboard,
   Standard accounts) and `STRIPE_WEBHOOK_SECRET` from a webhook endpoint at
   `https://<project>.supabase.co/functions/v1/stripe-webhook` that listens to **events on connected accounts**:
   `payment_intent.succeeded`, `checkout.session.completed`, `charge.refunded`. Authentication → Providers → Email: keep
   the **magic link** template (members sign in to `member.html` with it) and add `https://<slug>.flagstickhub.com/member.html`
   style redirects (the wildcard already covers it). Each club then connects its own Stripe account from Billing setup;
   until a key is set the hub and the portal say online payments aren't switched on.
9. **Restaurant stations** (`pos-stations-setup.sql` and `pos-split-setup.sql`, applied): nothing to configure on Flagstick's side — the club makes
   its station links in Settings → Food & beverage. Kitchen screens use realtime on `pos_fires` (added to the publication).
10. **White-label e-mail** (`mail-setup.sql`, applied): a club or association sets its sender in Settings → Outgoing e-mail.
   Through Flagstick's mailer the club's domain must be verified in Resend (add the domain there, give the club the DNS
   records); through Microsoft 365 the club's IT registers an Azure app (Graph → Application → Mail.Send, admin consent,
   a client secret) and types the tenant id, client id, secret and the sending mailbox into Settings — nothing to do on
   Flagstick's side.

Optional: `config.js` → `baseDomain` if the product domain ever changes (defaults to `flagstickhub.com`).

## 7. What comes next, in this frame

- **Member billing / POS** as modules: new tables (`member_accounts`, `charges`, `statements`, `payments`,
  `pos_tickets`…) each with `tenant`, each behind `can_tenant()`, each opened by its box; the club hub gains the pages.
- **Finer roles**: `tenant_users` already carries role, organizations and `manage`; per-page rights inside a hub
  (treasurer vs. handicap chair) are more columns and policies, not a new model.
- **Billing Flagstick itself** (subscriptions, invoices per tenant): a `subscriptions` table keyed by tenant, and the
  portal's status/plan driven from it.
- **Custom domains per client** (`golf.theirclub.com`): already supported through `hosts`; each one is a CNAME on
  their side and a custom domain on Render.

11. **Staff and blocked times** (Oct 2026): run `staff-setup.sql` (the club-wide staff list behind the registers, `pos_stations.dept`, the `staff_clock` table and function) and `blocks-setup.sql` (`booking_blocks`, `member_slots` / `member_book` with closed times, `member_me` with events) in the SQL Editor. Both are idempotent.
