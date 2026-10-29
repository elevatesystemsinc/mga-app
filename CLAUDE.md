# Club Hub — handoff for Claude Code

Management app for **Walnut Creek Country Club** and the organizations inside it. It started as the
**MGA Hub** (Men's Golf Association: tournaments, the Member-Member weekend, the Calcutta, treasury, golf
scoring, check-in, the 50/50 drawing) and is becoming the club-wide hub: a **club** tier (master member
directory, club-run tournaments, live scoring), **association** hubs (MGA, LGA, SMGA — each with its own
schedule, tournaments, budget/treasury, membership) and **small groups** (a roster, games with entry fees and
payouts, live scoring, a season money-game ledger). Long term it replaces Golf Genius here and at other clubs.
Owner: Zach Walls.

Read this file first. Then read `README.md` (user-facing feature guide) as needed.

> **Branches and hosts.** `main` (this branch) is the product — work here. The product is **Flagstick**
> (flagstickhub.com): one static site + one Supabase project serve many clubs (**tenants**, `docs/tenancy.md`):
> `<slug>.flagstickhub.com` is a client's hub, `app.flagstickhub.com` the Flagstick portal. Walnut Creek is tenant
> `wccc`; it is also reached at **app.wcccmga.org** (bare host = the club hub) and **hub.wcccmga.org** (bare host = the
> MGA hub: `HOST_ORG` in core.js; the club hub is `/club` there) once Render's hub.wcccmga.org site points at `main`.
> `Hub` is the old frozen MGA Hub code and `main` (the `mga_hub` row) its data; both are history — the two-way sync and
> the set-up / re-import from that row were removed in Oct 2026 at the owner's request ("kill the sync process").

---

## 1. How it's built and deployed

- **Plain static site.** No framework, no bundler, no npm runtime deps. Vanilla JS + HTML + CSS.
- **Hosting:** Render static sites serving the **repo root**: `main` → app.wcccmga.org, `Hub` → hub.wcccmga.org.
  Deploy = push. Render does **not** run a build — the built HTML files are committed.
- **Addresses:** the club hub is `/`; each organization is its own path — `/mga`, `/lga`, `/smga`, `/<group id>`
  (`ORG_ID` = first path segment; `?org=` is the fallback used by the file:// tests). This needs **one Render rule** on
  the app.wcccmga.org site: Redirects/Rewrites → source `/*`, destination `/index.html`, action **Rewrite** (existing
  files such as cashier.html still win). `head.html` writes `<base href="/">` on http so relative files load from the
  root; links to the cashier / check-in / scoring pages and to the Flagstick crest are built from `SITE_BASE`.
- **Backend:** Supabase (Postgres + RLS + Realtime). Connection in `config.js` (anon key; protected by RLS — the
  board signs in with one shared login, `boardEmail` in config).
- **External scripts (CDN, loaded on demand):** supabase-js 2.45.4 (jsDelivr), SheetJS (cdnjs, `loadXLSX()`),
  jsPDF 2.5.1 (cdnjs, `loadJsPDF()`), Google Fonts (Cormorant Garamond, Public Sans).

### Source → build
```
src/
  head.html            <head>, all CSS, the app shell markup (sidebar, drawer, toast)
  core.js              data model, normalize(), storage, cloud save/merge (see §3)
  ui.js                every screen + the single edit drawer (openDrawer), render(), TT (tournament tabs)
  treasury.js          season ledger, budget vs actual, bank import
  golfcore.js          courses (WCCC Oak/Pecan ratings), WHS math, format engine (FORMATS registry, team handicaps,
                       leaderboards, match play, skins), scorecard renderer — see docs/formats.md       [shared]
  golf.js              Golf page: events, field, flights, groups, live scoring, printed cards
  games.js             small groups: Games with pots (finish, skins, dots, side games, by hand), live scoring via golf events, Ledger
  rounds.js            tournament Rounds & results: rounds with formats → scoring events from the field, combined results,
                       finishes to the Calcutta                                                       [loads last]
  calccore.js          Calcutta pure logic                                                            [shared]
  pdffonts.js          PDF_FONTS: base64 TTFs for jsPDF (Public Sans 400/700/800, Cormorant 700 w/ lining digits)
  calcutta.js          Calcutta tab: lots, bidders, buyers & shares, money, setup, cashier link, bidder sheet PDF
  checklist.js         Checklist tab
  ckcore.js            check-in merge logic                                                            [shared]
  checkin.js           Check-in tab + registration link
  raffle.js            50/50 Drawing tab, drawing screen, official record PDF
  payouts.js           Calcutta payouts math (calcPayouts, ties) + Results / Payouts sub-tabs
  surveys.js           Surveys: anonymous member surveys (sections → questions, public link, results, CSV)
  billcore.js          the member statement PDF page (statementPage), shared by the hub and the member portal            [shared]
  billing.js           Member accounts & billing (module 'billing', club hub, staff only): classes, the monthly run, tax/service,
                       minimums, finance charges, aging, statements, GL export, Stripe Connect, the mail function
  pos.js               Point of sale (module 'pos'): outlets, products & stock, the register, tickets to accounts or cash / card
  poslib.js            the item libraries: the club F&B menu with modifiers (FNB_LIBRARY), the golf shop (SHOP_LIBRARY), the racket shop (RACKET_LIBRARY) → posLibraryDrawer
  bookings.js          Bookings (module 'club'): the tee sheet, courts, cabanas, pool, lessons — the sheet, check-in, fees, blocked times, the printed sheet
  staff.js             Staff across departments: the club's staff list with PINs and departments, the schedule builder, the time clock, timesheets
  calendar.js          The club calendar (every sheet, closure, event and shift, by department) and club events
  settings.js          Settings: white-label branding (the logo on every output), outgoing e-mail per organization (Resend / Microsoft 365), module setup (General · Food & beverage · Shops)
  poscore.js           checkTotals: the money on a check (service charge, tax, tip), shared by the hub and the station page   [shared]
  autoupdate.js        version.json polling + safe reload (__BUILD__ placeholder)                     [shared]
  cashier_src.html     cashier page   (markers /*CALCCORE*/ /*AUTOUPDATE*/)
  checkin_src.html     check-in page  (markers /*CKCORE*/  /*AUTOUPDATE*/)
  score_src.html       live scoring   (markers /*GOLFCORE*/ /*AUTOUPDATE*/)
  gamecast_src.html    GameCast: follow a game live, read-only, no group ID (markers /*GOLFCORE*/ /*AUTOUPDATE*/)
  survey_src.html      public survey page (marker /*AUTOUPDATE*/ only)
  member_src.html      the member portal: sign in by e-mail link, balance, statements, pay online, autopay (markers /*PDFFONTS*/ /*BILLCORE*/ /*AUTOUPDATE*/)
  pos_src.html         a register station on the floor: PIN lock, tables and tabs, the check, send to the kitchen, pay, receipt (markers /*PDFFONTS*/ /*BILLCORE*/ /*POSCORE*/ /*AUTOUPDATE*/)
  expo_src.html        a kitchen expo screen: the rail of fired courses for one prep station, bump / recall (marker /*AUTOUPDATE*/)
  clock_src.html       a time clock kiosk: PIN pad → clock in / out for one department (marker /*AUTOUPDATE*/)
build.sh               → index.html, cashier.html, checkin.html, score.html, gamecast.html, survey.html, member.html, pos.html, expo.html, clock.html, version.json (repo root)
```
`index.html` = `head.html` + one `<script>` of the modules **in the order listed in `build.sh`** + `boot();`.
Everything shares one global scope (no modules/imports) — later files may call earlier files' functions, and
several files extend shared arrays at load time (e.g. `TT.splice(...)` to add tournament tabs, `NAV` items).

**Always edit `src/`, then run `./build.sh`.** Never hand-edit the built root files — they're overwritten.
Commit both `src/` and the built files (Render serves the built ones).

`build.sh` stamps every page with the same build id and writes `version.json`; open devices notice the new build
within ~1 minute and reload at a safe moment (nothing unsaved, no drawer/modal open, not mid-typing). So **every
deploy must include `version.json`**, and all four pages must be rebuilt together (mismatched stamps = reload loops).

### Workflow
```
./build.sh                    # builds + syntax-checks every page (node --check)
python3 tests/smoke.py        # every page + every hub screen/tab renders with no script errors
python3 tests/test_payouts.py # Calcutta tie-splitting / owner payouts end to end
python3 tests/test_sync.py    # migration + two devices on a shared fake database (see §3)
python3 tests/test_score.py   # the public scoring page against the fake: mid-round changes reach open phones/boards
python3 tests/test_tenants.py # tenants, the portal, staff / board logins and scope, invite links — against the fake
python3 tests/test_survey.py  # a survey from the template → public link → anonymous answers → results, against the fake
python3 tests/test_finish.py  # a game wrapped up from the phones (close → skins → draw → payouts) and taken into the hub, against the fake
python3 tests/test_billing.py # the Club-management tier against the fake: accounts, the billing engine, statements + e-mail, the member portal, POS, bookings
git add -A && git commit && git push origin main  # Render deploys main to app.wcccmga.org
```
Tests need `pip install playwright && playwright install chromium` and `cd tests && npm i xlsx@0.18.5`.
smoke/payouts run the pages **in local mode** (stubbed `config.js`, no Supabase; `?org=mga` / `?org=club`).
`test_sync.py` runs them against `tests/fake_supabase.js` + `FakeDB` in `_harness.py` (shared in-memory rows,
compare-and-swap, 250 ms polling "realtime"). If you change `core.js` saving/merging or the member API, keep it green.

---

## 2. Data model

**Tenants first** (`tenants-setup.sql` + `portal-setup.sql`, `docs/tenancy.md`, `src/portal.js`, `src/logins.js`,
`tests/test_tenants.py`): a client is a row in `tenants` (`slug` = subdomain, `plan` preset, **`modules`** switchboard,
`status` prospect/trial/active/suspended/inactive, extra `hosts`, address/contact fields, `login_email`); every row in
`mga_hub` / `golf_events` / `golf_scores` / `calcutta_share` / `hub_keys` carries `tenant`, `mga_hub`'s key is
`(tenant, id)`. **Modules — three offerings** (`MODULE_CATALOG`, the owner, Oct 2026): **Golf management** (`golf`, the base = everything
built for associations and small groups), **Point of sale** (`pos`, an add-on for a golf-only client such as a municipal
course) and **Club management** (`club`: the full club — member accounts & billing, point of sale, bookings, the member
portal). The tenant row's `modules` switches are `golf` / `pos` / `club`; `hasModule('billing')` and `hasModule('pos')` are on
whenever `club` is (the portal also writes `billing` and `pos` explicitly when it saves a club-managed client). Code checks
`hasModule('billing')` for accounts, `'pos'` for the register, `'club'` for bookings.
**Logins** (`tenant_users`): role `staff` = the whole club, created by Flagstick in the portal; role `org` = only the
organizations in `orgs` (a board login), `manage` = a board administrator who invites its own board; staff invite boards
from the club hub's Logins page. RLS does the isolation: `can_org(tenant, org)` on every data table, `can_manage_login()`
on `tenant_users`; a board login gets the club document cut down through `scoped_read()` / `scoped_people()` (core.js:
`SCOPED`, `SCOPE_ORGS`, `GRANT`, `canManageLogins()`), exactly like key mode. core.js: `PORTAL`, `resolveTenant()` →
`tenant_lookup(host)` → `TENANT` / `TENANT_INFO`, `tq(q)` / `trow(o)` on every row query, `checkAccess()` → `my_access()`
after sign-in; `AUTH_HASH` + logins.js `authLanding()` handle invite / reset / one-click sign-in links. Until the
migrations have run the RPCs are missing and the app behaves as before. Privileged account actions go through the Edge
Function `supabase/functions/admin-users` (create with password, invite, set password, delete, `sso`); logins.js falls
back to a side-client sign-up and reset e-mails when it is not deployed. **New tables get a `tenant` column and a
`can_org` policy; new features belong to a module and check `hasModule()` at their entry points; switching a module off
never deletes data.** The portal (Flagstick admins only, `app.<domain>` or `?portal=1`; www and the bare domain are the
marketing website): Clients by status → client record (subscription + boxes, details, contacts, staff logins, the
club-managed board logins, activity), new client (+ empty club document + first staff login), Team, Activity.

**One JSONB document per organization**, all in `mga_hub`, each normalized by `normalize(doc, meta)` in core.js:
```
club row (CLUB)  = { v, id:'club', kind:'club', name, short, crest?,
                     members:[ Person ],              ← the master directory (first,last,email,phone,hcp,hcpAt,ghin,
                                                        memberNo,ggId,address…,status = club status)
                     orgs:[{id,kind:'association'|'group',name,short,crest?,archived?}],
                     activeSeason, seasons, board, tournaments, golf?, migratedAt?, _rev,_w,_at }   ← the club's own hub
org row (db)     = { v, id:'mga', kind, name, short, activeSeason,
                     memberships:[{id:<person id>, status, joined, notes}],   ← who belongs here + per-org fields
                     board, seasons:{[year]:{...}}, tournaments:[ Tournament ], golf?, ledger/treasury…, _rev,_w,_at }
Tournament = { id, name, season, days, startDate, field:[{id,memberId,team,paid,skins,answers,checkin?}],
               fieldQuestions:[...], sponsors, tiers, income, perPlayer, lines, dayItems, actuals, schedule,
               decisions, calcutta?, checklist?, raffle?, checkinShare? }
```
- `db` is the organization on screen; `CLUB` is the club document (`db===CLUB` in the club hub, `isClub()`). Code never
  touches `db.members`: use `members()` (read-only views = person + this org's status/joined/notes), `memberById(id)`,
  `persons()`/`personById(id)` (directory), and write through `upsertMember(id|null, data)` / `removeMember(id)`
  (which keep both documents right) — `memberSnapshot()`/`memberRestore()` for undo. A person is one record
  club-wide; removing someone from an association only ends the membership.
- **The rail is sectioned by department and the sections collapse** (ui.js `NAV_SECTIONS` per organization kind; the
  owner, Oct 2026: "Golf needs a subsection… Food & beverage… Membership", then "tennis and golf need to be separate, and
  same with pool… collapsible", then "rename… racket sports… aquatics"): club = Dashboard · **Golf** (Tournaments, Events &
  live scoring, Tee sheet, Game library, Pro shop, Staff & schedule) · **Racket sports** (Bookings, Pro shop, Staff &
  schedule) · **Aquatics** (Bookings, Staff & schedule) · **Food & beverage** (Register, Tickets, Menus & products, Staff &
  schedule) · **Membership** (Directory, Member accounts, Dues collection, Billing setup, Logins) · **Club** (Calendar,
  Events, All bookings, Staff, Reports, Organizations, Treasury, Budget, Surveys); association = Dashboard · Golf ·
  Membership (Members, Board) · Money (Treasury, Budget) · Surveys; group = Dashboard · Golf (Games, Ledger, Tournaments,
  Golf) · Members · Surveys. `ORG_NAV` still says which keys an organization kind may show and `NAV_GATE` adds the module
  / role checks (a department's Bookings / Pro shop only show when a facility / shop outlet belongs to it).
  **Departments** (`DEPTS` in bookings.js: golf · racket · aquatics · fnb · club; `DEPT_FIX` maps the old tennis / pool
  names): a facility carries `dept` (`facDept(f)`, default by kind: tee and lesson → golf, court → racket, pool and cabana
  → aquatics, room → club; "Run by" in the facility editor), a shop outlet carries `dept` golf | racket (`outletDept(o)`,
  restaurants are 'fnb'; "Shop run by"), a staff member carries `depts`, a shift and an event carry `dept`. Entries that are
  views of another page (`NAV_PAGE` + `NAV_DEPT`: teesheet / racketbook / aquabook → bookings filtered to that department,
  `BK.dept`; bookings = every facility; proshop / racketshop → pos with `POS.dept`; golfstaff / racketstaff / aquastaff /
  fnbstaff → staff with `ST.dept`; posmenu → possetup) light up through `navActive()` / `NAV_OWNS` and open through
  `navGo()`. Members book everything from the one Book card in the portal; the hub keeps a sheet per department. Section
  headers are `.navsec` buttons: a tap collapses the section (`toggleNavSec`, remembered per hub in localStorage
  `fs_navcol_<org>`); the section holding the page on screen never hides it. The rail scrolls; tablet widths 900–1100
  keep a 220 px rail; below 900 the rail is the drawer behind the top bar.
- **Every department books lessons; aquatics books cabanas** (`bookSettings()` seeds Golf lessons, Tennis & pickleball
  lessons, Cabanas (kind `cabana`, 4-hour slots), Swim lessons once — `b.v2`; a removed one stays removed).
- **Closed times on a sheet** (`blocks-setup.sql`, table `booking_blocks`: facility, date, `from_t` / `to_t` (HH:MM,
  to exclusive), `units` ([1,2] or null = all), reason; RLS `can_staff`): the sheet's **Block times** turns on select mode
  (`BK.selMode` / `BK.sel`; `wireSelect`: tap or drag across cells with pointer events, a finger works) → **Block N times**
  → `blockDrawer` (reason; bookings inside are counted and left alone) → `blockRows` compresses the picked cells into the
  fewest rows (consecutive slots per unit; a run shared by every unit is one row for all). **Close the course / Close it**
  (`closeFacilityDrawer`): a day or a range (≤ 62 days), all day or from–until, some units or all, a reason — one row per
  day. Blocked cells render hatched with the reason (`.bc.blk`); a note above the sheet lists the day's closures; tap one →
  `blockInfoDrawer` (what is inside; Remove the block). `BLK.rows` loads the last 60 days on; local mode in localStorage.
  `member_slots` now returns `blocked` (the portal greys those slots with the reason) and `member_book` refuses a blocked
  time ("not available — <reason>"). The calendar shows closures too.
- **Staff across departments** (`src/staff.js`, `staff-setup.sql`; the owner: "the pins are associated to the staff
  logins and as well as the departments"): one list, `CLUB.staff = [{id, name, role (STAFF_ROLES: server, bartender,
  manager, pro, attendant, lifeguard, staff), depts:[…] ([] = everywhere), outlets ([] = every register of the department),
  pin (sha256 of tenant:pin — the same PIN unlocks a register and clocks in), email (their hub login, optional), active}]`;
  `clubStaff()` folds the old `CLUB.pos.staff` in on first read (`posStaff()` is now an alias). `staffMemberDrawer(x,dept)`
  is the one editor (Settings → Food & beverage's Staff & PINs card and the Staff pages use it). SQL: `club_staff(club)`,
  `station_dept(station, club)`, `staff_fits(x, station, dept)`; `pos_boot` / `pos_pin` read the club list and a register
  sees the people of its outlet's department (fnb, or the shop's golf / racket). **Schedule builder**: `CLUB.shifts =
  [{id, staffId, dept, date, start, end, where, note}]`; the Staff page (`vStaff`, `ST.dept` from the rail: a department's
  people or everyone with a department seg) shows the week (Mon–Sun, ‹ › This week), tap a day cell → `shiftDrawer` (who,
  department, where — the department's outlets / facilities as hints —, start / end, note, repeat: same day for 4 weeks or
  Mon–Fri this week), **Copy last week**, hours per person, **Print the week** (`schedulePDF`, landscape, branded).
  **Time clock**: rows in `staff_clock` (tenant, staff_id, name, dept, in_at, out_at, station; RLS `can_staff`), written
  through `staff_clock(key, pin, action status|in|out)` from a **clock kiosk** (`clock_src.html` → `clock.html?k=TOKEN`:
  a `pos_stations` row of kind `clock` bound to a department — `pos_stations.dept`, `outlet` now nullable —, made from the
  Staff page's **Time clock link** → `clockLinkDrawer` → `newStation(null,'clock',name,null,dept)`; PIN pad → "Sam · on the
  clock since 9:02 / Clock in | Clock out", back to the pad after a few seconds; the token stays in localStorage `fs_clock`)
  or from a **register's lock screen** (pos_src.html: "Clock in / out" toggles `CLOCKMODE`, the PIN then runs `clockFlow`).
  The hub reads the last 45 days (`clockLoad`, `ST.clock`): who is on now, hours this week per person, an "out" link to
  close a forgotten clock-in (`clockFix`), **Timesheet CSV** (`timesheetCSV`). The fake emulates `staff_clock`.
- **The club calendar and events** (`src/calendar.js`): **Calendar** (`vCalendar`, `CAL`): a month grid with per-day chips
  (bookings per facility, events, closures, people on shift) and a day panel listing everything in time order
  (`dayItems(d, dept)`: bookings → `bookingDrawer`, closures → `blockInfoDrawer`, events → `eventDrawer`, shifts →
  `shiftDrawer`), filtered by department (Everything · Golf · Racket sports · Aquatics · Food & beverage · Club). **Events**
  (`vEvents`, `CLUB.events = [{id, name, dept ('club' | a department), date, end, start, finish, where, descr, public}]`,
  `eventDrawer`): the Boo Bash, movie night at the pool; public ones reach the member portal (`member_me` → `events`, the
  "What's on" card).
- **Table caches and the session** (STN stations, BK bookings, BLK blocks, ST clock, POS tickets, ACCT ledger, MAILS): every
  loader reads localStorage until `acctCloud()` is true, and `boot()` renders the remembered page **before** the session is
  established — so a hub restored onto Settings → Food & beverage used to cache an empty local list and never list the
  stations. Two rules in core.js: each module registers a reset in `CACHE_RESETS` and `startCloud` runs them once the cloud
  is up (the page then loads the real rows); and a loader called while its load is in flight returns `PENDING` (a promise
  that never settles) — a second `.then(render)` on an immediately-resolved early return re-rendered, called the loader
  again and spun a microtask loop that starved the fetch and froze the page. Keep both for any new loader.
- **The club runs on calendar years, not seasons** (the owner, Oct 2026: "turn the season functionality off on the club
  side… annual revenue, annual profits, as well as quarterly reports"; associations and groups keep their seasons).
  `Y()` for the club = `view.year` or the current year (a `db.seasons[y]` the club has not seen yet is created on the
  fly), the season box is hidden, the dashboard / Budget / Treasury carry a year bar (`yearBar()` / `wireYearBar()`: ‹ 2026
  ›) and read "2026", "Annual budget", "for 2026". **Reports** (billing.js `vReports`, module `billing`, staff only):
  year or quarter (`view.q`, `reportRange`, `clubReport`) — billed / net revenue / received / receivable at the period
  end, revenue by billing item with tax and service, receipts by method, the registers by outlet from the tickets
  (`shiftStats`), by month, the year's budget — CSV (`reportCSV`) and a branded PDF (`reportPDF`).
- **The club hub keeps every organization's document open** (`openOrgDocs()` in startCloud / `openLocal`, read with
  `orgDocs()` → [{meta, db}]). It reads them for the club calendar (`clubCalendar(y)`: the Tournaments page's second
  card and the dashboard's "Across the club") and for **Dues collection**; it writes to them only to mark a dues
  charge charged/collected. `persist()` saves whichever open documents changed, so those writes go to the right row.
- **Dues are billed by associations and collected by the club** (the club charges nothing of its own: `scalc()` gives
  the club no dues, its budget/treasury show no dues or 50/50 lines, and the raffle feature/tab is hidden in the club
  hub). Association season: `s.dues = {amount, installments, autoBill}`, `s.duesCharges = [{id, memberId, amount, desc,
  date, status:'open'|'charged'|'collected', chargedAt, collectedAt}]`, `s.duesPayments` (what the association has
  received, incl. `{method:'Club account', chargeId}` written by the club when it marks a charge collected).
  `billNewMember()` (from `upsertMember`, unless `{noBill:true}` — roster imports pass it) bills a new active member the
  full year; Members → **Bill dues** (`billDues()`) bills everyone who still owes and has nothing pending. The club's
  `vCollections` lists every association's charges for the season: put on account → collected (records the payment
  on the member in the association's document), cancel, CSV of open charges for the club's billing software.
- **Admin links** (`admin-links-setup.sql`, `hub_keys` table): the club hub → Organizations → an organization →
  *Admin links* creates `…/<org>#key=TOKEN` (`newAdminLink()`: random token, SHA-256 hash stored, the org row created
  if missing; shown once). Opening it without a board session puts the page in **key mode** (`HUBKEY` from the hash
  or localStorage `club_hub_key`, `KEYMODE=true`, `sessionOK=true`): `fetchRow`/`pushCloud` go through
  `hub_key_read` / `hub_key_write` (CAS by `_rev`) for that one organization, the club row arrives as a subset
  (directory, the org's own listing, game library — no tournaments/money/other orgs), writes to the club document only
  add people (`hub_key_people`; editMember locks existing people), golf publish/score/delete and cashier/check-in
  links use `hub_key_golf_event` / `hub_key_score` / `hub_key_golf_delete` / `hub_key_share` (`keyRPC(fn,args)`
  adds the key). No realtime in key mode — the 15 s poll carries updates. A revoked/unknown key → `keyRejected()`
  (sign-in card with a message, key forgotten). The link is for one organization: another path redirects to it.
- **Small groups** (`games.js`, group documents only): a game is players + any number of **competitions** ("pots"),
  all scored from one own-ball round. `db.games` = [{id, season, date, time, name, course, notes, status, **payWhen**
  'after'|'before', **settle** 'pot'|'net', golfEventId, players:[{id, memberId|name, paid, extraIn, gpid}],
  pots:[{id, kind:'format'|'skins'|'dots'|'manual', name, entry, inn:{[player id]:true}, rules:{game (catalog id),
  scoring, teamSize, count, teamsBy:'hand'|'before'|'after', places:[pcts], skins:{mode:'pot'|'hole', net,
  grossBeatsNet, validate:'none'|'par'|'netpar'|'bogey'|'netbogey', live; carry is derived = mode==='hole'},
  dots:{…}}, teams?:{[event player id]:'S1'…}, draw?:{at, method,
  size, log:[{at,reason}]}, sitOut?:[event player ids], tally?, payouts:[{id,pid,amount,note}]}]}] and `db.ledgerAdj`.
  `gamesData()` migrates older shapes (the old "finish" main pot becomes a `format` pot; skins `validate` 'gross'/'net'
  → 'par'/'netpar'). There is no distinguished main game. Money: a player's in = Σ entries of the pots they are in
  (+ extras), out = Σ payouts across pots (`gpIn`/`gpOut`); `settlement(g)` gives per-player in/out/net and
  `settleUp()` the fewest payments for net settlement; the Ledger's net = out − in + adjustments.
  - **Quick setup — New game on a phone** (`quickGame(again)` → `vQuick`, draft in `QG`, `view.gquick`; the owner, Oct 2026:
    "replace it is the way we want for the new game, and have the more options button"): **New game** is three steps —
    *Who's playing* (tap the names: the group's members, people who have played before, anyone at the club through a
    search, guests by name; last game's players come pre-ticked), *What are we playing* (**Same as last time** and up
    to three other past games with a different set of competitions, `pastSets()`; or build it from `STARTERS` in plain
    words — skins, stroke play, blind-draw partners, quota, team Nassau, dots — tap all that apply; the day's name,
    date, course and tee sit in one row behind Change), *Share* (`vQuickShare`: the scoring link, Send… / Copy, a QR
    through `loadQR`, the groups with their IDs, the sheet images, Open the game). Everything the full designer asks
    for is a default: today, last game's course / tee / rules / timing, after the round, pot settlement, full
    handicaps, the usual split. **More options** opens the designer with the same draft (`quickBuild()` →
    `GD`). **Same as last time** on the Games page (`quickGame(true)`) creates the game in one tap and lands on the
    share step. `draftFromLast(opt)` / `copyPots` / `commitGameDraft(d, existing)` are shared with the designer. The
    half-done setup survives a reload (`_qg` in `rememberView`) and blocks the auto-update like the designer.
  - **Designer** (`designGame(g|null)` → `vGameDesign`, draft in `GD`; reached from the game page's Design and from
    More options — no longer the New game button): the day (name, date, course, pay timing,
    settlement), competitions (`newPot(catalogId,g)` + per-kind rule panels), who's in (member picker, guests, the
    players × pots checkbox grid). A new game starts from the last one (players + competitions). One-ball games
    (scramble/foursomes/greensome) cannot share a round with own-ball competitions.
  - **Game page** (`vGame`): after-the-round games lead with competitions + settlement, before-the-round games with
    the who's-in grid; each competition card shows live standings (`potStandingsHTML` via `potPub(g,pot)` — the event
    cut down to the pot's players, format and teams; a team pot without teams shows individual standings), the
    teams button (Pick teams → `pickTeams`; Draw partners → `drawStage`), Pay out and Design.
  - **Scoring event**: `ensureGameEvent`/`syncGameEvent` keep one event per game; `gameEventEngine(g)` makes it
    own-ball stroke play unless a one-ball pot exists (then that format, teams from `pot.teams`). Partner draws
    never change the event — best ball is computed from the cards through `potPub`.
  - **The draw** (`runDraw(g,pot,{method,odd,reason})` → `drawStage`): `drawTeams` with `secureInt` (crypto) randomness;
    an odd player joins a team or sits out (`pot.sitOut`); the result is saved (`pot.teams`, `pot.draw`) **before** the
    staged reveal (full-screen, `rf-show` overlay + `dw-*` CSS, names cycling and landing team by team); a re-draw
    needs a reason, kept in `pot.draw.log`.
  - **Skins formats.** `mode:'pot'` (the group's game, default): one pot ÷ skins won; a tied hole is nobody's; a
    skin that fails validation is simply lost. **Never mention carry-overs in pot mode** — the owner has been firm.
    `mode:'hole'`: the pot split over 18, a tied hole's share carries, unwon holes at the end unpaid. `skinValue()`
    gives the worth of one skin / hole; `skinsRulesOf(pot)` normalises and derives `carry` from the mode.
  - **Quiet skins**: `rules.skins.live` (default off) keeps skins off the game page during the round; "Call out the
    skins" opens `skinsCallout(g,pot)` (full-screen, one hole per tap in play order) and sets `pot.calledOut`. A won
    skin reads "skin — needs net par or better on hole N to hold" (never "validates on", which read as a verdict) until
    hole N is called: stepping onto N first flashes the verdict full-screen (`sk-flash`: red "Didn't validate" / green
    "Validated", with what the player made on N), then "Show hole N" shows N's own result — the verdict is never skipped
    past, and the list never shows "held"/"lost" before the flash (the owner, Oct 2026). A skin's dollar value (pot ÷
    skins won) only shows once all 18 are called. The phone's `calloutStage` (Finish tab) runs the same sequence.
  - **Published copy stays current**: `publishIfChanged(ev)` (golf.js) runs on every render of a game page, a Golf
    event page and a tournament's Rounds tab — it republishes when `publicEvent(ev)` differs from what this session
    last sent (`PUB_SIG`), so a new build that changes derived data (competitions, handicaps, `matchBy`…) reaches the
    phones on the next 30 s refresh without anyone pressing Save. Without it the phones showed the old competition
    rules after the reverse-waltz change.
  - **Live leaderboard per competition**: each format competition has "Show on the live leaderboard"
    (`rules.live`, default on; skins use `rules.skins.live`, dots never show). `gameComps(ev)` → the live competitions
    as `{id,name,kind,players,teams,sitOut,engine…}`; `publicEvent` publishes them as `comps`, and the scoring page
    (score_src.html: `compChips`, `renderCompBoard`, `renderSkinsBoard`) shows one board per competition — a game opens on
    its first competition, and the round itself is always there as the last chip — **Individual** (everyone's own
    gross / net, whatever the games are; "The round" for a one-ball game), the owner, Oct 2026: "even if there isn't
    an individual game"; GameCast's board has the same tab — the chips are one scrolling row, the header drops the date the event name already carries, and a row's sub-line is gross · net
    (course only when the field is split across courses). `potPub(g,pot)`
    = `compPub(publicEvent(ev), potComp(g,pot))` (golfcore) is the same cut-down used by the game page's standings.
  - **Removing a player is total** (`removePlayer(g,p)`, the game page's ✕ or the designer's ✕ + Save): out of every
    competition, its payouts, teams and sit-outs, and out of the scoring event with their scores (`removeEventPlayer`
    + `dropPlayerScores` in golf.js: one delete on `golf_scores`, or `hub_key_score` per hole on an admin link), so the
    leaderboard and the phones drop them on their next refresh. `syncGameEvent` prunes anyone no longer in the game
    the same way (it used to keep players with scores); the designer only touches the event on Save. Tournament
    rounds do the same when someone leaves the field (`syncRoundEvent`), and the Golf group editor drops the scores of
    players taken out of a group.
  - **Deleting**: the designer's "Delete game" (`deleteGame`) removes the game and its scoring event. Deleting an
    event from Golf that belongs to a game or a tournament round removes that game / round too — otherwise
    `ensureGameEvent` / `ensureTournamentScoring` would rebuild it on the next render.
  - **The Finish tab — a game wrapped up from the course** (`wrap-setup.sql`, score_src.html `renderFinish`/`calloutStage`/
    `drawStage`, games.js `wrapSync`/`absorbWrap`/`wrapReset`): on the scoring page anyone joined with a group ID (the
    owner: "any group code is fine") steps through **Close scoring → the skins call-out → the draw → the winners → who's
    owed what**, in that order. Each step is one `golf_wrap(event, code, action, data, rev)` call, compare-and-swap on
    `golf_events.wrap.v` (a second phone gets 'conflict' and just shows the result); `close` also sets the public status
    final and `golf_submit` refuses from then on; the other steps need scoring closed. The phones record only — the
    computed result, never an edited one: `compPayouts(pub,comp,scores)` / `nassauPayouts` / `wrapMoney` / `drawFor` in
    **golfcore** are the shared math (the hub's drawers do the same sums with editable amounts), and `potComp` publishes
    `entry`, `total`, `places`, `nassau`, `teamsBy` and `live` per competition plus `game` (`gameInfo`: settle, extras,
    the hand-tallied pots) for it. `gameComps` now carries **every** format and skins pot; the scoring page keeps
    `live:false` ones off the board chips (`liveComps()`). The hub reads the wrap with `golf_event` on every game-page
    render (`wrapSync`, 8 s throttle) and `absorbWrap` takes anything newer than `g.wrapV` into the game once: event
    status final, `pot.teams`/`pot.draw`/`pot.sitOut`, `pot.calledOut`, `pot.payouts` (event player ids → game player
    ids), `g.wrap` for the "from the course by Group …" lines; then persist + republish. Reopen scoring (`openScoring`)
    clears the wrap (`wrapReset`: a column update, or `hub_key_wrap` on an admin link). Dots and by-hand pots stay in
    the hub. `tests/test_finish.py` runs the whole thing on two phones and the hub against the fake.
  - Paying: `payFormat` (finish from `potPub` standings via `payByFinish`; `pot.rules.places` are the default splits;
    ties share places, cent-exact; hand-entered positions when there are no scores), `paySkins` (`skinsCalc` →
    `skinsResult`, one pot ÷ skins won; rules on the pot), `payDots`, `payManual`.
  - **Team matches, group against group** (the mid-round challenge): catalog `waltz321` (match, Nassau, count
    pattern `321`: 3, 2, 1 balls by hole number, every ball on 9 and 18, **`matchBy:'strokes'`** — each of the three
    bets goes to the side with the lower total of its counted balls; the owner was clear this is total score, not
    holes won) and `teamnassau` (best ball, by holes). `matchBy` ('holes' default | 'strokes') is an engine field on
    events/comps (designer: "Each segment goes to"); `matchBoard` rows carry `segs:[{k:'F'|'B'|'18',v (the side's lead),
    rel (its own counted balls to par), done, started, txt}]` and `by`; by total score a side's figures are **its own
    to par** per segment — `status` "F −3 · B — · 18 −3" (the owner: "how many under par we are on the front, the back
    and total"), by holes "F 1 up · B AS · 18 1 up"; `nassauSegments`/`payNassau` settle from `segs[].v`. `matchByOf(pub)` falls back to 'strokes' for a Nassau with
    the 321 pattern (copies published before the field existed). Allowance: `allowKey` gives a team match that adds
    balls up (count pattern, count>1 or total score) **100%** ('match'), four-ball match play 90% ('match4') — a 90%
    waltz once mis-scored a live game by two strokes. A Nassau by total score plays **full handicaps** (`rel` = the
    player's PH, not PH − low man; the owner: "it should not be relative to the low"); by-holes matches stay off the
    low man. **A gross competition is gross everywhere**: `matchBoard` takes the balls as written when the competition's `scoring` is
    'gross' (`grossPlay`) — it used to net every ball whatever the pot said, so the Misfits' gross waltz showed and settled on nets
    (Oct 28, 2026). **Only true match play waits**: a by-holes match counts a hole once both sides have it (and stops at the **Three or more sides on total score are a field** (the Misfits' three carts of four, the same day): `matchPairs`
    returns one `{sides}` match instead of pairs, `fieldNassauRows` gives every side its own row (own to par per segment, `v` = its
    lead over the best of the others, `opp` 'the field'), `nassauSegments` carries the field with its winners per segment, and
    `nassauSettle` (shared by `nassauPayouts` on the phones and `payNassau` in the hub) pays the pool to the lowest total, tied sides
    sharing, everyone tied a push. Match play by holes with three sides still pairs (S1 v S2) — a three-way match has no meaning.
    **Every team game says how many teams** (the owner, Oct 28: "on all team games I should be able to set how many teams and the size per
    team… stop making the waltzes match play, make the option"): the designer's **Number of teams** (`pot.rules.teams`, '' = as many as
    the players make; `potTeamCount(g,pot)`) beside Players per team on every team pot; `pickTeams`, `runDraw` (`drawTeams(…, nTeams)`) and
    the phones' draw (`comp.nTeams` → `drawFor`) follow it. The waltzes and the team Nassau sit under **Team games** in the catalog; their
    **Played as** is Total score (any number of teams, each bet to the lowest total) or Match play (two teams, hole by hole) — choosing
    match play, or any by-holes match format, locks the count at two.
    first hole either side is missing); a Nassau by total score posts each side as its own holes come in (`nSide`,
    per-side `thru`, `startedA/B`), and a bet is settled once both sides have every hole of it (the owner: "I don't
    want any format to wait unless it is a true match play"). Each side's row carries **its
    own** `groupId` (its scorecard), not the match's first group. The phone board gives a match row the 18 in its value column and
    the front/back under the names (`.lb.m`). `matchPairs()`
    in golfcore pairs sides within a group as before, or — when teams span groups or no group holds two teams —
    pairs teams in code order (S1 v S2…) so two foursomes can play each other; a side's hole score sums its k best
    nets when the match has a count pattern. `pot.rules.nassau={front,back,total}` are the per-player stakes (the
    designer's stake fields; entry = their sum); `payNassau` settles segment by segment (losers' stakes to the
    winners, a halve is a push, an unfinished segment returns the stake). `pickTeams` has "Teams = the groups".
    A competition can be added to a game at any point from Design; standings pick up the scores already on the cards.
    **The waltz** (`waltz123`, pattern `123w`, Oct 2026): the reverse waltz the other way round — 1, 2, 3 balls by hole
    number, repeating; **`all918`** (engine field, `pot.rules.all918`, the designer's "Every ball counts on 9 and 18",
    default on for the waltz; in `COMP_KEYS` / `EV_GAME_KEYS`) makes 9 and 18 count every ball. **Stakes may be $0**:
    `newPot` gives the waltz `{front:0,back:0,total:20}` — one bet, the winning side takes the whole pot; the reverse
    waltz keeps 5/5/10 but either can be zeroed in the designer. A bet with $0 on it is neither shown nor scored:
    `compPub` carries `nassau` (stakes) so `matchBoard` filters the segments (`liveSeg`) out of `segs`, `status` and
    `pts`; `payNassau` / `nassauPayouts` skip it; `stakesText` reads "$20 on the 18 — winner takes the pot". The
    quick setup has a Waltz starter.
  - **Handicaps are 100% across the board** in a group's game (`g.hcp` 'full', the default; 'usga' switches the USGA
    table back on — designer, "Handicaps"): `syncGameEvent` sets `ev.allow={'*':100}`, `pctFor` honours `'*'` for every
    player format (never the per-player scramble tables), `compPub` keeps it, so stroke play, best ball, skins and the
    matches all play full handicaps on the hub and the phones.
  - **Small-group games never have flights** (the owner, Oct 2026): a game's event page has no Flights tab (Players ·
    Groups · Leaderboard), `syncGameEvent` leaves `flight` empty, and the boards / GameCast only speak of flights when
    an event carries them (tournament rounds, Golf events).
  - **Groups & handicaps** (`gameGroupsCard`/`wireGameGroups` on the game page): per group the course, starting hole
    and tee time; per player an index for the day (`p.index` on the event player, blank = the directory index), the
    tee, and CH / PH from `playerHcp`; a Group select moves a player (or starts a new group). **All of it works
    mid-round**: every change goes through `golfSave` (persist + `publishEvent`), and the scoring page re-reads the
    event every 30 s and on returning to the foreground (`loadEvent`/`refresh` in score_src.html — it used to load the
    event once), so corrected indexes reach every phone and board; a scorer with a field focused is not re-rendered,
    and a phone whose group was removed returns to the join screen. `syncGameEvent` no
    longer prunes empty groups, so a group made on purpose survives until someone lands in it.
  - **Games draw on the whole club directory** (`gamePool()`: directory persons, the group's members first, non-members
    tagged "Club"): the designer's picker and the game page's Add players both use it, and adding someone to a game does
    **not** make them a member of the group (the owner, Oct 2026: membership is what will gate sign-ups through a
    registration link when that is built; manual adds and game creation pull from the entire directory).
  - **Game sheet PDF** (`gameSheetPDF(g,{strokes,returnDoc})`): the band (date · course · tee · players · all in), THE GAME as a
    card — each competition with its rules in words (`potRulesText`) and its entry, the total as a navy strip — the **house
    rules** typed in the designer (`g.rules`, one per line, printed as bullets) and teams when known on **page 1**; the
    groups on **page 2**, always fitted to that one page (2 columns, then 3, rows shrinking to 9.2pt) as cards (number,
    code, tee time, each player's strokes / scratch / gives n / no index; an empty group reads "Open — tee time held for
    extras"). `sheetImage(g,pageNo)` renders a page to PNG through pdf.js (cdnjs, `loadPdfJs`) — the game page's
    "Rules image" / "Groups image" buttons, for BAND.
- Arrays of objects carry stable `id`s — the merge (§3) matches by id. Keep it that way for anything new.
- `_rev` (revision), `_w` (writer/client id), `_at` are bookkeeping, excluded from comparisons.
- **Device-local, never in the shared doc:** cashier/check-in link status (`SHARE_ST`, `CKI_ST`), the cashier-link merge base (`localStorage mga_cbase_<tid>`), check-in base (`mga_ckibase_<tid>`).
  Putting status/timestamps in `db` causes background saves that ping every device — don't.

### Supabase objects
| object | purpose |
|---|---|
| `tenants`, `tenant_users`, `flagstick_admins` + RPC `tenant_lookup(p_host)`, `my_access()` | clients, their board logins, Flagstick's admins (`tenants-setup.sql`); every table below has a `tenant` column |
| `mga_hub` (tenant, id, data jsonb) | one row per organization per tenant: `club`, `mga`, `lga`, `smga`, `<group id>`. The rows `main` (the old MGA Hub's) and `sync:mga` are history, no code reads them. `hub-setup.sql`, `hub-fix-permissions.sql` |
| `calcutta_share` (tid, token, name, doc, version) + RPC `calcutta_get(p_token)`, `calcutta_put(p_token,p_doc,p_version)` | token links for people without the board login: the **cashier** page (tid = tournament id) and the **registration/check-in** page (tid = tournament id + `:checkin`). `calcutta_put` is version-checked (conflict → retry). `calcutta-setup.sql` |
| `golf_events` (+ `wrap`), `golf_scores` + RPC `golf_event`, `golf_join`, `golf_submit`, `golf_wrap`, `hub_key_wrap` | public live scoring (`golf-setup.sql`) and the Finish tab's wrap-up (`wrap-setup.sql`). `public.org` names the owning organization. |
| `survey_share` (sid, tenant, org, token, status, doc), `survey_responses` (id, tenant, org, sid, answers, day) + RPC `survey_get(p_token)`, `survey_submit(p_token,p_answers)`, `hub_key_survey`, `hub_key_survey_results` | surveys (`survey-setup.sql`): the share row is what the public page shows; a response is answers + the **day** only — no user, e-mail, IP or device, ever. |
| `acct_items`, `acct_statements` + `can_staff(p_tenant)` | member accounts & billing (`billing-setup.sql`): the club's ledger, staff only. |
| `member_users`, `tenants.stripe_account/stripe_status` + RPC `member_me(p_tenant)`, `member_autopay_off(p_tenant)` | the member portal and online payments (`member-setup.sql`); Edge Functions `mail`, `stripe`, `stripe-webhook`. |
| `pos_tickets` | point of sale tickets (`pos-setup.sql`), staff only. |
| `mail_settings` (tenant, org) | each organization's outgoing e-mail sender and provider (`mail-setup.sql`); RLS `can_org`. |
| `pos_stations`, `pos_fires`, `pos_tickets` (+ station, table_no, server…) + RPC `pos_boot/pin/members/checks/check_put/fire/close/void/expo/bump` | registers and kitchen screens on the floor (`pos-stations-setup.sql`): token-keyed security-definer functions, like admin links. |
| `bookings` + RPC `member_id_of`, `member_slots`, `member_book`, `member_cancel` | bookings (`booking-setup.sql`): staff on the sheet, members through the security-definer functions that enforce the facility's rules. |
| `booking_blocks` | closed times on a sheet (`blocks-setup.sql`, which also teaches `member_slots` / `member_book` about them and `member_me` about events). |
| `staff_clock`, `pos_stations.dept` + RPC `staff_clock`, `club_staff`, `station_dept`, `staff_fits` | the time clock and the club-wide staff list behind the registers (`staff-setup.sql`). |
| `hub_keys` (org_id, key_hash, label, revoked_at) + RPC `hub_key_org/read/write/people/golf_event/golf_delete/score/share` | admin links (`admin-links-setup.sql`): security-definer functions that act for exactly one organization. |
| `mm_tournament` | the retired Member-Member app's row (`supabase-setup.sql`). Archive only — no hub code reads or writes it. |

---

## 3. Collaborative saving — the part not to break

Several board members edit at once, across two open documents (club + organization; `DOCS[id]` holds each one's
server copy, save state and realtime channel). `persist()` saves whichever open documents actually changed; the member
form can touch both (person → club row, membership/dues → org row). Per document, `core.js` implements:
- **Compare-and-swap on `_rev`:** `update ... where data->>_rev = <base rev>` returning rows. 0 rows → someone
  saved first → fetch theirs, **three-way merge** (`merge3(base, local, remote)`), retry (≤6).
- **merge3:** objects merge key by key; arrays of `{id}` objects merge element by element (adds/deletes from both
  sides survive); same scalar changed on both sides → local (later edit) wins; deleted-vs-edited keeps the edit.
- **In-place apply (`syncTo` / `syncArr`):** incoming changes mutate the *existing* objects so open drawers and
  closures keep pointing at live records. Replacing `db` objects wholesale was the original lost-edit bug.
- **Frozen send:** the payload is a deep copy taken at send time; `base` = that copy. If edits happened during the
  upload, push again.
- **No-op guard:** never write when `db` equals `base` (ignoring `_w/_at/_rev`; `stable()` ignores `undefined`).
- **Ignore stale copies:** apply a remote only if its `_rev` > `base._rev`.
- **Realtime + 15 s safety poll**; render keeps focus/cursor/scroll; status line says "updated 12:31", no pop-ups.

Invariants, checked by `tests/test_sync.py` (two browser contexts, one shared fake Postgres with atomic CAS and write
counts): browsing = **0 writes**; one tournament edit = 1 write to the org row and 0 to the club row; a person edit from
an association = 1 write to the club row only; 40 overlapping sponsor adds + 20 new people from two devices all kept,
both devices and the server identical. Also covered there: the first-run set-up card (an empty club row with the three associations).
(Cashier-link writes add 1 per edit when a Calcutta link is live.)

### The sidebar footer
Nothing is said while saving works — the status line ("This device only", "All changes saved · updated 12:31"), the
MGA Hub sync line and the Switch hub / Backup / Restore buttons were removed in Oct 2026 ("not needed"). What is left:
one red line when a cloud save fails (`paintSync('offline', err)`: the message, tap to retry through `pushAll` /
`startCloud`, plus a toast once per distinct error) and **Sign out** / **Leave this hub**. The picker (`vPicker`) is
only reached when no organization is open (a bad address); organizations are opened from the Organizations page.

The cashier and check-in pages use their own per-item merge (`calcMerge` / `ckMerge`): each item carries `u`
(updated-at); newest wins per item; deletes are tombstones; settings merge as a unit (`_su`). Stamping is
idempotent (`calcStamp`/`ckStamp` only stamp an item once per change).

---

## 4. Features (where to look)

**Member-Member is the main tournament.** Tournament tabs (TT): Overview · Meals & events · Field · Check-in ·
Rounds & results · Sponsors · Budget · Checklist · Calcutta · 50/50 Drawing. `t.features` switches the optional
tabs (meals, sponsors, budget, checklist, calcutta, raffle) per tournament (`TOURNEY_FEATURES`, `tournamentTabs()`);
Overview, Field, Check-in and Rounds & results are always on; tournaments from before the toggles keep every tab.

### Rounds & results (`rounds.js`)
`t.rounds` = one or more rounds per day, each with the full format fields (e.g. Saturday split scramble/shamble,
Sunday best ball). **Live scoring is never optional:** `ensureTournamentScoring(t)` runs on every render of a
tournament (vTournament) — it creates default rounds for a tournament that has none (unless it is already past),
builds the missing round events (`buildRoundEvent`, status `live`) and syncs the field into every event
(`syncRoundEvent`: new field players join the pool with their team code, codes follow the field, players who left
the field leave the event unless they have scores). Small-group games do the same through `ensureGameEvent(g)`
(games.js: created with the game, synced when players are added/removed, lazily on vGame). New Golf events start
`live` too. `liveEvents()` (nav links, dashboard leaderboard) = open events dated yesterday → tomorrow or undated
(`isLiveNow`). Teams → `T<n>`; later days copy the first day's flights; groups copy on request. `tournamentResults(t, basis)` totals the rounds per team
(or player) in the rounds' unit — strokes to par (gross/net basis), points, holes, match points — ranked overall and
per flight, marked Final when every event is closed. **Send finishes to Calcutta** writes each lot's `place` from the
flight positions (lots matched by member id or name). **Results sheet (PDF)** = branded jsPDF sheet per flight + overall.
- **Flights are per tournament** (`t.flights`, `setTournamentFlights`): units = field teams/players by combined
  Handicap Index (partner cap applied), whole groups per flight, lowest to Flight A; each flight has a course and a
  start (shotgun / tee times, first time, gap, off hole). `applyFlights(t, ev)` pushes them to every round's event
  (`createRoundEvents` does it automatically; the event's Flights tab shows a banner and a re-apply button).
- **Pairings:** day one → `buildGroupsFromFlights(ev)` (by combined handicap: shotgun holes 1, 2, 3… / tee times in
  order); later days → `pairByStandings(t, round)`: teams ordered by the standings over the earlier rounds within
  each flight, paired in order; tee-time flights send the leaders off last, shotgun flights put the leaders on hole 1.
  Groups stay editable on the event.
- **Partner handicap differential cap** (`t.hcpDiff`, 0/8/10/12, Tournament details): `effIndex(ev, p)` in golf.js
  pulls the higher partner's index down to the lowest partner's index + cap before the course handicap; the Field
  tab flags capped players (↓ from). Applies to every event of the tournament and to the tournament flights.

### Calcutta (`calccore.js`, `calcutta.js`, `payouts.js`)
Sub-tabs: Lots · Bidders · Buyers & shares · Money · Results · Payouts · Setup.
- **Lots** import from an auction-order or team sheet; re-import keeps recorded sales. Add field teams missing from
  the Calcutta (suggested flight from team index; lot number insert shifts later lots). Search everywhere
  (bare number = lot or paddle exactly).
- **Minimum bid ($250)** → teams under it go to **The Pool**, sold last as one lot; pool price split across flights
  by pooled-team count.
- **Team buy-in (per Calcutta, off by default):** each team owns 25% of itself for $300 ($150 per player, each
  player's payment tracked separately); **pre-buy** the rest for $900 ($450 per player) → owns 100%, skipped in the
  auction. Buy-ins and pre-buys go into the team's flight pot.
- **Captain** = lower Handicap Index (plus handicaps are lower; ties/missing flagged; manual override). The captain
  owns the team share (25%, or 100% if pre-bought) — with or without a paddle. Paddles are auction-only; a captain
  who takes a paddle gets their shares under that number automatically (`captainBidder`, `calcStakes`,
  `calcHoldings`).
- **Payments:** auction purchases (per bidder), buy-ins (per player), pre-buys (per player) tracked separately by
  method (Cash, Zelle, Credit card, Check); cash drawer reconciliation. Bidder rows show owed, expandable to lots.
- **Payouts:** net pot per flight × payout % (40/30/20/10). **No tie-breaker** — tied teams share the money for
  every place they cover (two tied for 1st split 1st+2nd). Cent-exact; odd cent to the lowest lot. Team money →
  owners (buyer 75 / captain 25; captain 100 if pre-bought; pool buyer 75 for pool teams). Payouts by person with a
  paid-out mark (`c.paidOut`, a synced setting). Payouts are **not** netted against what a buyer owes.
- **Cashier link** (`cashier.html?k=TOKEN`): sales, bidders, payments from phones/laptops without the board login.
- **Exports:** results workbook (Lots, Bidders, Buyers & shares, By flight, Expenses, Payments, Payouts…),
  auction order (Excel), **bidder sheet PDF** (always blank; built in-browser with jsPDF + `PDF_FONTS`). From the
  Payouts sub-tab (`payouts.js`): **payout spreadsheet** (`exportPayoutsXLSX`: by person, detail, by flight), the
  branded **Payouts PDF** (`payoutsPDF(t,{amounts:true})`: finishes and team payouts per flight, then every person
  with their total) and the **Winners PDF** (`{amounts:false}`: the same without a dollar figure anywhere — finishes,
  then "please see the cashier" by name and paddle; for posting). `tests/test_payouts.py` downloads all three and
  checks the winners PDF carries no money.

### 50/50 Drawing (`raffle.js`) — legitimacy matters
Tickets = tournament + ticket # (numbers restart per tournament); hand-sold tickets with no number are identified
by sheet row (`M<row>`). Players identified **by name** (email/phone were often the seller's). Look-alike names must
be ruled same/different before **locking** → SHA-256 fingerprint of the full list; draw refuses if it no longer
matches. `crypto.getRandomValues` with rejection sampling; the result is saved **before** the ~19 s staged reveal.
Winners' tickets leave the drum. Voids and resets require a reason and are logged on the **official record PDF**.
Don't weaken any of this (no `Math.random` for picks, no silent redraws, no editing a locked list).

### Check-in (`checkin.js`, `ckcore.js`, `checkin.html`)
Alphabetical, searchable (own name first; partner only if nobody matches; number = team). Registration link for
the two people at the table. The user wants this **simple** — don't add features to it unasked.

### Surveys (`surveys.js`, `survey_src.html` → `survey.html?k=TOKEN`, `survey-setup.sql`)
Any organization's hub (and the club) has **Surveys**: `db.surveys = [{id, title, intro, status:'draft'|'open'|'closed', token,
sections:[{id, title, intro, comments (an open box at the end), questions:[{id, type:'rating'|'slider'|'choice'|'multi'|'yesno'|'text',
text, help, options, left, right, comment (a comment box under the question)}]}]}]`. Opening a survey mints `token` and writes
`surveyPub(s)` (questions only) to `survey_share`; every later edit while open republishes (`pushSurvey`). Members answer on
`survey.html` without a sign-in; `survey_submit` stores answers + the day. **100% anonymous — the owner's requirement:** no
name/e-mail/sign-in asked, nothing about the sender or device stored, times cut to the day, the hub only ever shows aggregates
and the text answers; the one-response-per-phone mark is a localStorage flag the member can clear. Results tab: averages and
0–10 distributions, the trade-off slider's lean (left / either / right), option counts, comments, CSV export (`svExportCSV`).
`memberSurveyTemplate()` = the first survey (Thursday night golf · Weekend tournaments · Membership; food-vs-payouts slider in
both golf sections; comment boxes per section and on key questions). Answer keys: `qid`, `qid:c` (comment), `sec:<id>`.
`SV_R` (responses) is device-local. `tests/test_survey.py` covers template → link → answers → results → close → delete.

### GameCast (`gamecast_src.html` → `gamecast.html?e=<slug>`, `&view=tv` for the bar screen, `&follow=<player id>`)
A spectator page, **read-only**: it reads the same `golf_event` + `golf_scores` (+ realtime) the scoring page reads and never
writes — built so it cannot disturb a game in progress (the owner, Oct 2026: "don't build it where it messes with the live
scoring"). Shows **the course on an aerial map**: `COURSE_GEO` in golfcore (tee → green centerlines for all 36 holes, pulled from
OpenStreetMap's `golf=hole` ways — © OpenStreetMap contributors, ODbL — sorted into Oak / Pecan by the Oak polygon and
checked hole by hole against the card: every line is within a few yards of the Gold yardage, and runs tee → green), drawn
with **Leaflet 1.9.4** (unpkg, loaded on demand, `loadLeaflet`; the one map instance `MAP` survives every render by moving
its host div into the new card) over **Esri World Imagery** tiles (attribution shown; licence to confirm before Flagstick
sells it — Mapbox is the paid alternative). Gold hole lines with hole-number labels near the tee, green dots, every group as
a navy marker on the hole it is playing (`groupPos`: first hole in play order not scored by the whole group; finished
groups on 18's green), tap a line / label / bar number to fly to that hole, Whole course to zoom out; a slim 1–18 bar under
the map; the schematic SVG cards (`holeSVG`) remain the fallback for a course without geometry or when Leaflet fails to
load (`mapFailed`), a **hole panel** (par, hcp, yardage per tee, who is on it, everyone's score on it with a tally, a live skins
comp's state), the **Live feed** (`buildFeed`: scores replayed in `updated_at` order — birdies, eagles, aces, blow-ups, lead
changes on the chosen competition's board, skins taken/lost **only for skins comps marked live**), the **board** per live
competition, **Follow** a player (highlights, feed filtered, hole panel on their group). **Quiet competitions stay quiet**:
`liveComps()` filters `live===false` everywhere. Links: the hub's game page (Live scoring card), the Golf event page, the
quick setup's share step (`gamecastLink(ev)` in golf.js). `tests/test_score.py` opens it against the fake; smoke renders it.

### Member accounts & billing (`billing.js`, `billcore.js`, `billing-setup.sql`, `member-setup.sql`, module `billing`, `tests/test_billing.py`)
**Flagstick is the club's billing system (replacing Club Essentials); each club bills its own members, Flagstick bills the
club** (the owner, Oct 2026). The club's accounts receivable live in real tables, staff only: `acct_items` (one row per
**charge / payment / credit**: `member_id` = the directory person, `item` = the catalog item it was billed as, `source`, `gl`,
`amount` = the total with `tax` and `svc` (service charge) broken out, `ref` = the source record / idempotency key, `method` +
`reference` on payments, `posted`, `void_at`/`void_reason` — a void is never a delete), `acct_statements` (one row per member
per run: period, opening, charges, payments, closing, due, `run_id`, `sent_at`) and `member_users` (who has signed in to the
portal, autopay and the card on file). RLS = `can_staff(tenant)`; board logins, scoped logins and admin links never see any of
it (`acctOn()`). `ACCT` caches the ledger per visit (background reload after 20 s); local mode keeps the same shapes in
localStorage. `acctPost(o)` is the one way anything lands on an account.
- **Setup in `CLUB.billing`** (`acctSettings()`): `items` (the catalog: `DEFAULT_ITEMS` dues, cart, locker, trail, capital, F&B,
  unspent minimum, pro shop, guest, tee, facility, lesson, finance charge, late fee, other — each with `source`, `gl`,
  `taxable`, `svc`), `classes` (membership classes: `charges:[{itemId, amount, every month|quarter|year, month}]`,
  `minimum:{amount, every}`), `tax.rate`, `svc.rate`, `finance:{pct,min}`, `lateFee.amount`, `dueDays`, `message`, `gl`
  (AR, cash, tax payable, service charge, credits), `runs` (billing runs done), `online` (the Stripe snapshot). A person
  carries `p.billing = {class, status active|loa|suspended|resigned, since, until}` (`pBilling`; the Directory editor and
  the account page's Membership drawer).
- **Money math**: `chargeFor(itemId, base)` → `{amount, tax, svc, net}` (service charge on F&B, tax on net + service where
  taxable). **Run monthly billing** (`billingPlan(ym)` / `runBilling`): every class charge due in the month (`dueThisMonth`)
  to every billable member (`billable`: a class, not Inactive, not on leave, resigned only through `until`), prorated by days
  (`prorate`) for a mid-month join or resignation, plus **unspent F&B minimums** for periods that closed the month before
  (spend = net F&B charges; the minimum itself prorated by the member's share of the period); idempotent by `ref`
  (`run:<ym>:<charge id>:<member>`, `min:<period>:<member>`). **Aging** (`agingOf`): payments and credits settle the oldest
  charges first (FIFO), the rest bucketed current / 31–60 / 61–90 / 90+. **Run statements** first posts `lateCharges()` —
  a finance charge (`finance.pct` on what is still owed from the previous statement after its due date) and the late fee,
  dated the period end, refs `fc:`/`lf:<statement id>` — then one statement per member with a balance or activity
  (`buildStatement`), one PDF with a page per member (`statementsPDF` → `statementPage` in **billcore.js**, shared with
  the portal), optionally e-mails each (`mailStatements` → Edge Function **`mail`**, Resend; `sent_at`) and charges autopay
  cards (`autopayRun`). **GL export** (`glJournal` / `glExportCSV`): a month's journal — AR debit and item revenue / service
  charge / sales tax credits per charge, cash against AR per payment, credits as adjustments — with a summary by account.
- **The account page's ledger** (`vAccount`): every charge has **Receipt** (`chargeReceipt` → `receiptPDF`: the register's own ticket
  when the charge came from one, `ticketOfCharge` by the `pos:` ref — a split portion gets its own slip —, else a slip built from the
  charge itself) and a live charge has **Adjust** (`adjustDrawer`: "it should have been" + a reason → the difference posted as a credit
  or a further charge, ref `adj:<charge id>`, descr "Adjustment · <original> · <reason>"; the original row is never edited) besides Void.
- **Pages**: Member accounts (`vAccounts`: outstanding, past due by bucket, charged / received this month; Owing · Past due ·
  In credit · With activity · Everyone; search; Post charge (item picker with the tax / service preview), Record payment,
  Run monthly billing, Run statements, Export balances (with aging columns), GL export, Billing setup), the account
  (`vAccount`: aging on the balance, Membership, running ledger with tax / service detail, void with a reason, statements,
  e-mail the latest), **Billing setup** (`vBillSetup`: Online payments & the member portal card, classes, items, Rates &
  accounts, Statement rules).
- **Dues collection → the account**: *Put on account* posts the association's charge once (`acctPostDues`), *Collected* the
  matching payment once (`acctCollectDues`); the association is credited in its own books as before.
- **The member portal** (`member_src.html` → `member.html`, markers `/*PDFFONTS*/` `/*BILLCORE*/` `/*AUTOUPDATE*/`): a member
  signs in with a one-time e-mail link (Supabase Auth OTP, no password; the e-mail must be on the club directory);
  `member_me(tenant)` (security definer) returns only that member's account — balance, activity, statements (PDF built in
  the browser with `statementPage`), autopay state, and `online` (whether the club takes payments). **Online payments** go
  to the **club's own Stripe account** (Stripe Connect, Standard): Billing setup → *Connect with Stripe* (`stripeConnect`
  → Edge Function **`stripe`** `connect` → onboarding link; `status` refreshes `tenants.stripe_status` and the hub's
  `b.online`); the portal's Pay / Other amount / Set up autopay call `pay` / `setup` (Stripe Checkout, card or US bank
  account; `pay` with "save this card" sets `setup_future_usage`), `member_autopay_off` turns it off; the **`stripe-webhook`**
  function (no JWT, signature-checked, listens to connected-account events) posts each `payment_intent.succeeded` as a
  payment once (`ref` = `stripe:<pi>`), saves the card for autopay, posts refunds; `autopay_run` (staff, from Run
  statements) charges each autopay member's balance due off-session. Flagstick takes no application fee. Secrets:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `MAIL_FROM` (docs/tenancy.md §6). Without the keys the
  functions answer "not configured" and the hub / portal say so; the fake (`_harness.py`) emulates `member_me`,
  `member_autopay_off`, a `mail` that records what it sent and a `stripe` that is never configured.

### Point of sale (`pos.js`, `pos-setup.sql`, module `pos`) and Bookings (`bookings.js`, `booking-setup.sql`, module `club`)
- **POS** (`posOn()`, staff only): `CLUB.pos = {outlets:[{id,name,kind fnb|proshop,item (the billing item it charges as)}],
  products:[{id,outlet,cat,name,price (before tax),sku,taxable|null,svc|null (null = as the outlet's item),track,stock,active}]}`
  (`posSettings()`, defaults Grill + Pro shop); tickets are rows in `pos_tickets` (`POS.tickets`, local mode in localStorage).
  The register (`vPos`): outlet seg, product grid by category with search and **Open item**, the ticket (member picker or a
  walk-in, qty ±, tip for F&B), `ticketTotals` (service charge on lines marked for it, tax on taxable lines + their service
  charge, tip on top), **Charge to account** (`closeTicket('account')` → one `acctPost` charge with `tax`/`svc`, `ref pos:<id>`,
  `descr` "Grill · 2× Club sandwich"; refused for a suspended member or when billing is off), Cash / Card (recorded, no
  account), Hold / On hold; stock moves on close. Tickets (`vPosTickets`: a day's tickets, KPIs, void with a reason →
  `voidTicket` voids the account charge and restores stock, CSV); Setup (`vPosSetup`: outlets, products, CSV import
  `importProducts`). F&B minimums read the net F&B charges these post.
- **Bookings** (`bookOn()`, staff on the hub; members in the portal): `CLUB.booking.facilities = [{id,name,kind
  tee|court|pool|lesson|room, units, unitNames, open, close, slot (min), cap (per slot; players per tee time), lead (days
  members may book ahead), members (bookable in the portal), onePerDay, fee:{item,amount,per booking|player}|null}]`
  (`bookSettings()`, defaults: Tee sheet Oak/Pecan every 10 min ×4, Tennis ×4 courts, Pickleball ×4, Pool, Lessons
  office-only); rows in `bookings` (`BK.rows`). The sheet (`vBookings`): facility seg, day nav, a time × unit grid
  (`.sheet`: names, player count, checked-in green, portal bookings with a gold edge), tap a slot → `bookingDrawer`
  (booked by, players / guests up to cap, note; Check in, Cancel booking; a facility fee → `acctPost` ref `bk:<id>`,
  voided on cancel), **Print the sheet** (`sheetPDF`, branded, a page set per day), Facilities (`vBookSetup` /
  `facilityDrawer`). Members: `member_me` returns `facilities` (members:true) and upcoming `bookings`; the portal's Book
  card (`bookCard` / `loadSlots` / `bookSheet` in member_src.html) shows the next `lead` days, taken / open / yours per slot,
  books through `member_book(tenant, facility, date, time, unit, players, note)` — the database enforces the rules
  (hours, slot grid, lead days, capacity, one a day, office-only, suspended members, the fee posted to acct_items) — and
  cancels through `member_cancel` (voids the fee). `member_slots` gives a day's taken slots without names.

### Settings — white label and module setup (`settings.js`, `mail-setup.sql`)
Every hub has **Settings** (last entry on the rail; not in key mode). **Branding:** `db.brand = {logo (PNG data URL ≤ 600 px,
from `logoFromFile`), w, h, at}` on the club or the organization; `brandOf()` / `brandLogo()` = the organization's own logo,
else the club's, else nothing — and `crestPNG()` (calcutta.js) / `crestSrc()` (golf.js) prefer it, so every PDF band
(`drawCrest(doc, src, x, y, h)` in billcore fits any logo shape and returns the width; the band text starts after it),
the printed scorecards, the draw / call-out overlays, the game sheet, receipts, e-mails and the member portal header
(`member_me` → `brand`) carry the club's or the association's own mark; the app chrome stays Flagstick. **Outgoing
e-mail** (the owner, Oct 2026: the MGA's domain is wcccmga.org, the club's walnutcreekcountryclub.com): one row per
organization in `mail_settings` (RLS `can_org`): `provider` resend | m365, `from_name`, `from_email`, `reply_to`,
`mailbox`, `m365_tenant`, `m365_client`, `m365_secret` (write-only in the hub — `mailDrawer` never shows it). `sendMail(msg)`
is the one way out (adds `tenant` + `org`); the Edge Function `mail` resolves the organization's row (falling back to the
club's, then Flagstick's `MAIL_FROM`), sends through Resend with that from / reply-to, or through **Microsoft 365**
(client-credentials token from login.microsoftonline.com → Graph `users/{mailbox}/sendMail` with attachments; the Azure
app needs the application permission Mail.Send with admin consent). `mailHTML({title, paragraphs, cta, footer})` is the
branded HTML body (logo + organization name, no Flagstick mark); statements and receipts use it. **Module setup** (club
only): restaurants and the golf shop are POS outlets (`outletDrawer(null,'fnb'|'proshop')`), plus links to Billing setup,
Facilities, the Game library, Organizations and Logins. **Receipts** (`receiptPDF(t)`, pos.js): a narrow branded slip —
logo, outlet, lines, service / tax / tip, total, how it was paid — from the tickets page, the register's "Last ticket" bar,
and by e-mail to the member (`emailReceipt`).

### Restaurants on the floor — stations, kitchen screens, servers (`pos-stations-setup.sql`, `pos_src.html` → `pos.html`, `expo_src.html` → `expo.html`, `poscore.js`)
The owner, Oct 2026: a club has several restaurants (Creekside Grill, Nines Bistro, the men's locker room…), each with
more than one register; bartenders never see the hub; a salad fires to one expo station and a steak to another; drinks
rung at the bar fire nowhere; servers sign in with a PIN and see their own tables; a manager PIN leaves the station. Set up
in **Settings → Food & beverage** (and **Golf shop** for the shop's registers): per outlet (`CLUB.pos.outlets[]`, `outletSetup`)
**prep stations** `expos:[{id,name}]`, **tables** (`parseTables`: "1-12, Patio 1-6, Bar"), **menus** `[{id,name,active}]`; each
product carries `route` (the expo id it fires to, null = nowhere) and `menus` ([] = every menu); **staff** `CLUB.pos.staff =
[{id,name,role server|bartender|manager, outlets ([] = all), pin (sha256 of `<tenant>:<pin>`, `pinHash`), active}]`. A
**station** is a row in `pos_stations` (`kind` register | expo, `expo` = the prep station an expo screen follows, `key_hash`
of a token — `newStation` / `stationLinkModal`, QR included; the token itself is kept in `pos_stations.token` (staff-only
table, `pos-reopen-setup.sql`) so the card's **Link** button (`stationLink`) shows it again — a station from before that
gets a fresh token from Link; `revokeStation`); the device opens
`pos.html?s=TOKEN` / `expo.html?k=TOKEN` once and keeps the token in localStorage (`fs_station` / `fs_expo`). Everything a
station does goes through security-definer functions keyed by the token: `pos_boot` (outlet, products, staff names, rates,
the brand, whether billing is on), `pos_pin` (→ {id,name,role} or null), `pos_members` (name, number, suspended — never
e-mail or balance), `pos_checks` / `pos_check_put` (open checks = `pos_tickets` rows with `status open`, `table_no`, `server`,
`server_id`, `guests`, `station`; every station of the outlet sees them), `pos_fire` (one `pos_fires` row per expo for the
unfired routed lines, lines marked `fired`), `pos_close` (paid account | cash | card; account → the acct_items charge with
tax / svc, suspended members refused), `pos_void`, **`pos_reopen`** (`pos-reopen-setup.sql`: a closed or voided check back to open — its payments cleared, the
account charges it posted voided "Check reopened at the station", lines kept), `pos_expo` / `pos_bump` (the kitchen screen; `pos_fires` has an anon
select policy and is in the realtime publication so screens update at once). **The station page**: lock screen with a PIN
pad (wrong PIN shakes; 6 digits auto-submit; 4-minute idle lock; "Leave this station" needs a manager PIN and forgets the
token), the floor (My checks / All open, the table grid — yours green, others gold — and tabs by name; a check on a table that is
not on the outlet's list shows as a tab "Table X", so the count and the tiles always agree; a manager's **Closed today**
(`closedSheet`, `pos_shift` for any day through a date box) lists the closed checks with **Reopen**), the check (lines
with sent ✓, qty ± / note / remove on a selected line, menus and categories, products with their expo, Open item, **Send**,
Receipt, **Pay**: tip presets, member search → charge to the account, Cash / Card, a manager may void; the menu has a **search box** (`Q`, `renderGrid` redraws only the grid — name, category and modifier words; Enter rings the first hit; Clear) and the product grid **scrolls inside its own box** (`.menu .pg`, the check card sticky beside it on a tablet, 60vh on a phone) so a long menu never scrolls the check away), the receipt slip
(brand logo). `checkTotals(lines, tip, rates)` in poscore is the one money function (the hub's `ticketTotals` wraps it).
The hub's Tickets page shows station checks (table, server) alongside its own, and every closed or voided ticket has **Reopen**
(`reopenTicket`: voids the account charges by id / `pos:<id>` ref, restores tracked stock, clears the payments) — the owner, Oct
2026: closed tabs for the day from the station, older ones from the hub. The fake emulates every `pos_*` function;
`tests/test_billing.py` runs setup → station → kitchen → account → hub → revoke end to end.
- **The item libraries** (`src/poslib.js`, the owner, Oct 2026: "an F&B item library with modifiers and a pro shop library"): `FNB_LIBRARY`
  (14 categories, ~170 items: starters, salads, sandwiches & burgers, entrées, sides, kids, desserts, breakfast, the turn, beer,
  wine, cocktails, spirits, non-alcoholic — each `[name, price, modsDSL?]` under a category that carries `route` kitchen |
  grill | bar and `course`), `SHOP_LIBRARY` (9 categories, ~100 items: balls, gloves and apparel with sizes, shoes, accessories,
  bags, green fees & carts and lessons as non-taxable, club repair with grip / shaft choices) and `RACKET_LIBRARY` (balls and
  rackets, stringing with string and tension, rentals and court fees, lessons, apparel). `posLibraryFor(o)` picks by outlet
  kind and department; **Add from the library** (Menus & products, and the Library button on each outlet in Settings) opens
  `posLibraryDrawer(outletId)`: categories with their items (expand, untick), items already in the outlet disabled, for a
  restaurant the route → prep-station mapping (`libRouteGuess` by station name, or "Create Kitchen, Grill and Bar" when it has
  none; bar items fire nowhere). Everything lands as an ordinary product (category, price, `parseMods`, course, route).
- **The next layer** (`pos-split-setup.sql`, Oct 2026): **modifiers** — a product's `mods:[{name,required,multi,options:[{name,price}]}]`
  typed as one group per line (`parseMods` / `modsText` in poscore: "Temperature*: Rare, Medium, Well", "Add-ons+: Bacon +2");
  tapping such a product opens the sheet (station `modsSheet`, hub `modsDrawer`); a line carries `mods:[{name,price}]` and
  `lineUnit` / `lineTotal` add the deltas, the kitchen sees them. **Courses** — `product.course` 0 with the order | 1 starters |
  2 mains | 3 dessert (`COURSES`), a line's course cycles from its actions; **Send** fires course 0 + the lowest unfired course
  and reads "Fire mains" afterwards (`pos_fire(key, ticket, course)`; held lines say so; More → Fire everything now); a
  fire row of course ≥ 2 carries `note` "Course n" and the expo shows it. **Seats** — `line.seat` from the seat chips on the
  check. **Split payments** — `pos_pay(key, ticket, {method, amount (incl. tip), tip, member_id, label, totals, lines})`
  appends to `pos_tickets.payments` and closes the check once the payments cover subtotal + service + tax (`paid` =
  'split' when more than one); the pay sheet offers Whole check · Split evenly (2–6 ways) · By seat · Pick items, each
  portion with its own tip (presets on the portion's subtotal, `portion()` / `portionTotals` / `balanceDue` / `paidSoFar`)
  and its own method; an account portion is its own `acct_items` charge (`ref pos:<ticket>:<payment>`, tax and service in
  proportion). `pos_void` voids every charge of the check. **Transfer** — More → Transfer to… (the check's server or a
  manager) rewrites `server` / `server_id`. **Shift** — `shiftStats(tickets)` (poscore): net sales, service, tax, tips, by
  payment type, per server, voids, items; the hub's Tickets page shows it per outlet with a branded PDF (`shiftPDF`); a
  manager at the station reads today's through `pos_shift` (More → Shift numbers).

### Other
Checklist (95-task 2026 template, assignees from members/board, notes, print). Golf (courses, WHS, flights,
groups, printed scorecards — the printed cards include a live-scoring QR that isn't being used). Treasury.

---

## 5. Conventions

- **Product mark: Flagstick — the only logo in the app** (the owner's call, Oct 2026: "our logo will be present
  throughout"; identity deck and SVG/PNG masters were delivered in chat). The crest carries a two-tone trim: on navy a
  white outer line with a gold inner rule, white stick and cup, gold pennant (`flagstick-crest-light.svg` / `.png`); on
  light grounds navy and gold (`flagstick-crest.svg` / `.png`). The word is live text in Public Sans 800, tracked, with
  "GOLF SOFTWARE" in gold caps beneath (`.fs` in head.html; `.fs.light` on white). Where it appears: the sidebar lockup
  on every hub (the `.org` line beneath names the club or organization in words only), the mobile top bar, the picker
  and the login card (club name as text), every organization card and row (`crestHTML()` always returns the navy crest;
  `o.crest` in stored documents is ignored and the editor no longer offers it), the draw / skins call-out / 50-50
  overlays, the printed scorecards and every PDF band (`crestSrc()` in golf.js = the light PNG as a data URL, loaded
  once at start-up; `crestPNG()` in calcutta.js for jsPDF, ratio 850/1024), the scoring/cashier/check-in headers,
  `favicon.png`, `apple-touch-icon.png`, `icon-192/512.png`, `flagstick-icon.svg`. The old club and MGA artwork
  (`club-logo*.png`, `club-mark.png`, `mga-crest.png`, `crest.png`) is gone from the tree (in git history if ever
  needed). Trademark search on FLAGSTICK (Classes 9 and 41) still to be done before print.
- **Brand colours:** navy `#0F2A38`, gold `#C7A13A` / light gold `#D8B75F` / dark gold `#7E5F1A`, ivory `#FBFAF5`,
  line `#E1D9C6`. Cormorant Garamond for display, Public Sans for UI. **Always lining numerals** (`font-variant-numeric: lining-nums`) — Cormorant's default old-style
  "1" reads as "I"; the PDF font in `pdffonts.js` has lining digits baked in.
- **UI pattern:** screens are read-only; edits happen in the drawer (`openDrawer({title, body, wire, save, del})`),
  `save` returns `false` to keep it open. After mutating `db`: `persist(); render();`.
- **Mobile matters** (phones at registration, cashier, auction). Check 390 px width; no horizontal overflow. Tables
  stack on phones automatically (≤640px, see head.html); give a table `keep` only when it has its own phone layout.
- **Check numbers, signed slips and the daily close-out** (`pos-closeout-setup.sql`, applied; pos.js from `CO=` down; the owner, Oct
  2026: paper slips stay, the scans tie them to the digital tickets, the day closes and locks). Every check gets **`check_no`**
  `MMDD-NNNC` (`pos_check_no`: a counter per outlet per day in `pos_counters`, a check digit — `checkDigit` / `checkNoFor` /
  `checkNoValid` in poscore match `pos_check_digit`) and **`day`** (the club's local date, sent by the client: the server is UTC);
  `pos_check_put` assigns both on a new check, the hub's register asks `pos_next_check`. The slip prints **CHECK 1027-0143** large
  (people and OCR) and a **QR** `fs:<ticket>:<payment>` per slip block (`drawQR` / `loadQRLib` in billcore). **Daily close-out**
  (`vCloseout`, rail: Food & beverage → Daily close-out; `CO`): outlet + day; drop the scanner's PDF or photos → `fileToCanvases`
  (pdf.js pages, images downscaled) → `readSlipImage` (jsQR, else tesseract.js; tests inject `CO.reader`) → the QR, else
  `matchSlipText(text, the day's numbers)` (poscore: OCR look-alikes mapped to digits, exact or one-character-off against the
  list only) → `attachSlip` (bucket **`slips`**, private, `<tenant>/<ticket>/<payment>.jpg`; the path on `payments[].slip` and on
  the charge's **`acct_items.slip`**); anything unread, or a ticket with more than one payment, waits in the **tray** for a tap.
  The page shows slips scanned / expected (`slipPays`: account + card payments; a hub-register ticket from before split payments
  counts one implied payment), what is still open or out for a tip, tips to enter from the scans (`settleTicket(t,tips,{partial})`),
  tips by server with the ones over the limit (`CLUB.pos.tipFlag` {pct 30, amount 50}, Settings → F&B → Service charge & tips),
  the cash drawer against the count, voids, notes, **Close-out PDF** (`closeoutPDF`, letter, branded) and e-mail (`CLUB.pos.closeoutTo`),
  **Close the day** (`closeDay` → a `pos_days` row; refused with a check open or a slip out; missing scans only ask) and **Reopen the
  day** (`reopenDay`, a manager's PIN: `managerPIN` checks `clubStaff` managers' PIN hashes in the hub). A closed day is locked:
  `pos_reopen` / `pos_void` refuse at the station (`pos_day_closed`), the hub's `reopenTicket` / `voidTicket` / `settleTicket` go through
  `dayLockOK` (manager PIN). The account page and the member portal show **Signed slip** on a charge that has one (`showSlip` /
  `slipURL` → a signed URL; storage policies: staff by tenant path, a member only the slips behind their own charges).
- **Receipts and slips print on 80 mm Epson-style thermal printers** (the owner, Oct 2026): `RECEIPT` in billcore = 227 pt wide, 14 pt
  margins (inside the 72 mm printable width), **black only** — no greys, no gold, no colour (they dither), rules 0.75–1 pt, type
  ≥ 8.5 pt — and the logo cut to one bit through `monoLogo(src)` (canvas threshold, cached). `receipt` (station) and `receiptPDF`
  (hub) are the two slips; keep anything new on paper to the same rules. Statements and reports stay full-colour letter pages.
- **Printed/PDF output must look as polished as the rest of the brand** — the user rejected a plain browser
  print view as "lazy". PDFs are generated files the user downloads (jsPDF), not print-preview windows.
- **Privacy on public-facing sheets:** no emails, GHIN numbers or handicap indexes on anything left on a table.
- **Club prices are all-in** (no tax & service line on menus). **The service charge is mandatory on every F&B check** (`b.svc.rate`,
  18% by default — Settings → Food & beverage's Service charge card, `svcCard` / `svcDrawer` in pos.js) and **no tip is asked for
  in the app**: a check paid on account or by card becomes a **slip** (`pos_tickets.status 'slip'`, `pos-tips-setup.sql`): the
  printed slip carries Additional tip / Total / Signature per such payment (`receipt` on the station, `receiptPDF` in the hub),
  the floor lists it under **Slips out**, and the server closes it out with the written tip (`settleSheet` → `pos_settle`; the hub's
  Tickets page: Close out → `settleDrawer` / `settleTicket`): the tip goes on the payment (`payments[].tip`, null while pending), an
  account tip onto the member's `acct_items` charge (amount + **`tip`** column + "· tip" in descr — `netOf()` leaves it out, so it is
  never F&B spend toward a minimum and the GL export credits it to `gl.tips` Tips payable, not revenue), and the ticket closes. A tip
  over $20 that is more than the payment itself asks "is that what is written on the slip?" before it posts. `shiftStats` counts a slip as a sale.
  Tips by server (`payments[].tip` × `server_id`) are what a payroll feature will read — the owner: "we can build that later".
- No payout or handicap-allowance details on player handouts.

## 6. Status / history

- **Built Oct 2026 (the Finish tab):** `wrap-setup.sql` (applied to the project) + the scoring page's Finish tab + the hub's
  `wrapSync`: the players close scoring, call out the skins, draw and record the payouts from their phones (§2, small groups).
  Then the **phone-first game setup** (quick setup, §2): New game = three steps, Same as last time = one tap, the full
  designer behind More options.
- **Built Oct 2026 (surveys):** `src/surveys.js` + `survey.html` + `survey-setup.sql` (applied to the project); the MGA's first
  survey comes from `memberSurveyTemplate()`.
- **Built Oct 2026 (tenants, portal, logins):** `tenants-setup.sql` + `portal-setup.sql`, `src/portal.js` (the client
  portal: clients by status, client records, staff logins, team, activity), `src/logins.js` (staff / board logins and
  scope in the hub, invite and reset links), the Edge Function `supabase/functions/admin-users`; the owner's go-live
  steps are in `docs/tenancy.md` §6. Roadmap there: Club management (billing, POS) as modules, finer roles, Flagstick's
  own subscriptions.

- **Built Oct 2026 (client types, the nonprofit feature set):** `client-kinds-setup.sql` (`tenants.kind`, `tenant_lookup` returns it;
  `CLIENT_KINDS` in core.js: private country club · country club · semi-private golf club · municipal course · nonprofit · other, each
  with the plan and modules it starts with — the portal's New client asks the type first and sets the boxes; `clientKind()` /
  `isNonprofit()` in the hub) and the **Fundraising events** module (`events`; `src/fund.js`, `fund-setup.sql`, `auction_src.html` →
  `auction.html?k=TOKEN`, `tests/test_fund.py`). A nonprofit's rail: **Fundraising** (first section) · Golf (Tournaments = the golf
  tournament, with its sponsors, check-in, rounds and the 50/50) · Membership (Directory reads **Donors & guests**) · Club. One event
  (`CLUB.fund.events[]`, `normFundEvent`): tickets (price, fair market value, qty) and tables, guests (from the directory or by name;
  each holds a **paddle** 101 up; RSVPs from the page land as `fund_rsvps` and are accepted onto the list), sponsors and levels, the
  **silent auction** (items with opening bid / buy now / value, `minRaise`, `closesAt`, `closed`; bids are `fund_bids` placed on the
  page through `fund_bid`, which refuses under the minimum, after close, or on a bought item; the hub reads the high bid per item,
  `fundLoad` → `FB.bids`, polled every 10 s on the tabs that show money), the **live auction** (lots sold by paddle), **paddle raise**
  donations, **raffles** (tickets numbered in order of sale by paddle, a draw with `secureInt` over every ticket in the drum, the
  winner recorded before the reveal, a log line per draw), **checkout** (`paddles(e)` = guests + page bidders 500 up; `paddleTotals`
  = tickets + silent wins + lots + raffle tickets + donations − payments; record a payment by method; the **acknowledgement PDF**
  `fundReceiptPDF`: what they paid, the fair market value received, the amount that may be deductible, the tax ID and thank-you line
  from Fundraising → Settings; e-mail through `sendMail`), **money** (streams, expenses, net, CSV). `fundPub(e)` → `fund_share` is what
  the page shows (`pushFund` on every edit that matters); the page (`auction.html`) has The evening · Tickets (RSVP, pay at the door) ·
  Silent auction (join with name + phone → `fund_join` → a paddle; bid; buy now) · My bids (leading / outbid / won), re-read every 6 s.
  No money moves online yet: tickets, bids and raffle tickets are settled at checkout (card / cash / check / Zelle recorded); Stripe
  for tickets and bids is the next layer. The golf tournament is the existing Tournaments page.
  **The package, second pass** (the owner, Oct 29: "a nonprofit is going to have its own set of features… point of sale, obviously…
  not the restaurant… raffle drawings… a live auction and a silent auction with cashier… it's not a Calcutta… reserves… paddle numbers…
  annual budgeting… budgeting for each event"): a nonprofit's modules are golf + events + **pos** (never club); its rail is
  Fundraising · Golf (Tournaments, Events & live scoring, Game library) · **Point of sale** (Register, Tickets, Daily close-out,
  Products) · **Donors** (Donors & guests, Logins) · **Organization** (Calendar, Events, Treasury, Annual budget, Surveys,
  Organizations) · Settings (`NAV_SECTIONS.nonprofit`, `navHTML`); `posSettings()` seeds one outlet **Event sales** (kind proshop,
  dept club) instead of Grill + Pro shop, Settings has General · Point of sale (no Food & beverage). **Reserves**: silent items and
  live lots carry `reserve` (bidders never see it; a high bid under it is not a sale — `silentWins`; the Sold drawer and the
  cashier warn under it). **The cashier** (`fund-cashier-setup.sql`): `e.cashierKey` → `auction.html?k=TOKEN&c=KEY` (`cashierDrawer`,
  Overview and Live auction tabs); `fund_share.priv` = `fundPriv(e)` (guests with paddles and tickets, items and lots with reserves,
  raffle tickets, gifts, payments, `absorbed`) is pushed with every `pushFund`; the page's **Cashier** tab (`cashierHTML` /
  `wireCashier`) lists every paddle with what it owes (`cashState` applies the actions the hub has not absorbed yet), takes a
  payment, records a live-auction sale, raffle tickets and a gift through `fund_cashier(token, key, kind, data)` → one `fund_actions`
  row each; `fundLoad` reads them and `absorbActions(e)` takes each into the event once (by action id, `e.absorbed`), then the event
  is the record. **Raffle legitimacy, as the 50/50**: Lock the list (`raffleLock`: a SHA-256 fingerprint of every ticket, `raffleCanon`)
  before a draw; selling stops while locked; the draw refuses a list that changed; a void (`raffleVoid`) or an unlock needs a reason
  and is logged; **Record** prints `raffleRecordPDF` (tickets, buyers, the fingerprint, every draw, the log). **Budgets**: the event's
  **Budget** tab (`e.budget = {streams:{tickets,sponsors,silent,live,raffles,donations}, expenses:[]}`, `ftBudget`, `fundPlan`) sets the
  plan per stream and the planned expenses against the actual; the **Annual budget** page carries a Fundraising events card
  (`fundBudgetCard(y)`: planned in / net against raised / net per event); the Fundraising page shows the year's planned and actual net.
  **A fundraiser with a golf tournament, and per-event thermometers** (Battle of the Nines, Oct 29: "a fundraising event can also be a golf
  tournament… keep track of how much money has been raised for that entire tournament and the evening event after… a big status bar";
  then "it's not really a year goal. It's a per event goal… multiple goals and thermometers"): `e.tournamentId` links an event to a
  tournament (`fundTournament(e)`); the event drawer's *Includes a golf tournament* box (new events) and the Overview's golf card
  (`golfCardHTML` / `linkGolfDrawer`: create one of the same name, `tournamentForFund`, or pick an existing one; Open, Prizes, Unlink)
  make the link, and ui.js's New tournament calls `fundForTournament(t)` on a nonprofit so every tournament gets its event; a charity
  tournament starts with `NONPROFIT_FEATURES` (sponsors, budget, 50/50 on; meals, checklist, Calcutta off). `golfMoney(t)` reads
  `tcalc`: actual revenue (entries received, sponsor payments, the 50/50, income lines) and expenses (actual once played, budget until
  then); `fundTotals` carries `golf` / `golfExp` / `golfB` / `golfExpB`, `raised` and `net` include them, `FUND_STREAMS` has a read-only
  `golf` row on the Budget tab (its plan is the tournament's own budget, `fundPlan`), and the Money tab lists it. **Places get donated
  gifts, never payouts** (the owner: "payouts on the golf side of things for charity events aren't really all that important"): the
  golf card's Prizes box (`e.golfPrizes`, free text) is the only prize tooling on a fundraiser. **Goals are per event** (`e.goal`; no
  year goal): `fundThermoHTML(e,{small,click,always,actions})` is the one bar (event Overview with *Goal & progress page* →
  `progressDrawer`; the Fundraising page shows every event of the year with a goal; `fundDashThermos()` puts up to four on the club
  dashboard, next ones first); `fundPub(e).progress = fundProgress(e)` ({goal, raised, pct, streams by name — the tournament under its
  own name —, golf, at}) rides the event's own `fund_share` row, the event page shows the bar on The evening, and `auction.html?k=TOKEN&p=1`
  (`PROG`, `renderProgress`) is the **public progress page**: the goal, raised, "to go", where it came from, a link to the event page —
  never a name. Turning the event page off turns it off. `tests/test_fund.py` covers the golf box, the dashboard's auto-created event,
  the thermometers, the goal drawer and the public page.
- **Legacy app (retired):** the original Member-Member app used to live on `main` (its history is still in git);
  its `mm_tournament` table is still in Supabase as an archive, to be dropped when that system is deprecated. The
  hub's import / Verify / two-way sync / "Retire current app" code was removed in Oct 2026. Stored documents may still carry `db.legacy`, `t.source` (`kind:'mm-app'`) and
  `t.sync` from that era; nothing reads them and `normalize()` leaves them alone.
- 2026 Member-Member: Oct 2–4. 150 players / 75 teams (Team 84, Regina & Cagle, added late as Lot 75).
- **Removed Oct 2026 (Hub sync, migration, sidebar status):** `hubSync()`, `migrateFromHub()`, the Hub-shape converters, the
  `hubRow` flag, the sidebar status line and the Switch hub / Backup / Restore buttons — the owner: "kill the sync process…
  remove the sync status… the switch hub buttons and all that kind of stuff". `tests/test_sync.py` seeds the club and
  MGA rows directly (`seed_from_main` in `_harness.py`) and covers the empty set-up card instead.
- **Built Oct 2026 (always-on live scoring, phone layout):** every tournament round and every game has an open scoring
  event from creation (see Rounds & results); `head.html` ≤640px rules stack every `.t` table (name block on top, cells
  wrap, header row = legend) except `.t.keep` / `.t.bt`, and shrink titles, KPIs and buttons.
- **Built Oct 2026 (admin links, dues collection, club calendar):** `admin-links-setup.sql` + key mode in core.js
  (see §2); associations bill dues (`duesCharges`) and the club's **Dues collection** page charges/collects them; the
  club hub opens every organization's document and shows their tournaments (calendar + fields, never their money);
  the club has no dues and no 50/50 of its own. Tests: `test_sync.py` scenario 3 (admin link end to end against the
  fake, incl. revoke), smoke checks for billing/collection and the club calendar.
- **Built Oct 2026 (pots):** games hold any number of pots (finish, skins, dots, side games scored as another game,
  by hand); small groups get Tournaments and the feature toggles; `tests/smoke.py` small-group scenario covers a
  four-pot game end to end.
- **Built Oct 2026 (game library):** `GAME_CATALOG` / `gameCatalog()` / `enabledGames()` / `catalogOf(pub)` in golfcore;
  the club hub's **Game library** page stores switches in `CLUB.games.disabled`; `gameOptions()` + `engineFrom(C,…)`
  (golf.js) drive the pickers in editEvent, editRound and editGame; events carry `game` (catalog id) plus the engine
  fields (`quotaBase`, `cap`, `matchScoring` nassau/hilo, `matchForm` foursomes, `countPattern` 123/123rot/par345/yellow).
  Teams may span groups (`eventTeams`) so post-round partner draws score. `drawPartners(ev)`: random / ABCD / snake.
- **Built Oct 2026 (formats):** `docs/formats.md` is the reference. Event fields: `format` (stroke, stableford, modstable,
  quota, parbogey, match, bestball, aggregate, scramble, shamble, foursomes, greensome, teamstable, split), `teamSize`
  1–6, `count` (balls that count), `countPattern` ('123'), `scoring`, `allow` (overrides by `allowKey`; defaults in
  `USGA_ALLOW` + `defaultAllow`). `unitOf(pub)` = strokes | points | holes | match drives every leaderboard column.
  Skins (`skinsResult`): gross/net, carry, gross-beats-net, validation by par / net par on the next hole in play order.
  **No pops on par 3s** (`noPar3` on Golf events and tournament rounds; in a small group's game it is **per competition**,
  `pot.rules.noPar3`, carried by `potComp` → `COMP_KEYS` → `compPub`; the same checkbox in editEvent, editRound and on each
  competition card in the game designer): `strokesAt(pub,c,set,h,ph)` in golfcore is the one place per-hole strokes come
  from (boards, skins, matches, team nets, printed cards, the phones). With the switch a par 3 never gives or takes a
  stroke — the stroke is **lost**, not moved (the owner: "they lose them is the proper way"); every other hole keeps
  its classic 18-hole allocation (`strokesOn`). Plus handicaps the same way: a stroke given back on a par 3 is not given back. Index
  inputs take a leading + everywhere (`parseIndex`); the two in-table index boxes use the full keyboard for it.
  **Points per score are adjustable** (`points:{[fmt]:{'-3'..'2'}}` on events, rounds and `pot.rules.points`; `PTS` holds the
  standard tables, `pointsTable(pub,fmt)` the one in force, `pointsEditor`/`readPoints` in golf.js draw and read the six
  boxes; only a table that differs from the standard is stored; `COMP_KEYS` carries it to the phones).
- **Built Oct 2026 (step 3, small groups):** Games, payouts by finish and skins, live scoring through golf events,
  season/quarter Ledger with settle-ups, a group dashboard; the Members page without dues for groups.
- **Built Oct 2026 (step 1):** per-organization rows, the club directory + memberships, path routing, the picker,
  the Organizations page (create associations / small groups, archive), the club-side roster import (member number →
  Golf Genius ID → GHIN → email → name; name-only matches that disagree on an identifier are decided by hand), and the
- **Decided for the club hub (Oct 2026):** the club owns the master roster, seeded from the MGA list, then grown by
  importing the club software's export (merge duplicates by member number → GHIN → email → name, create the rest).
  Sign-in stays the single shared board login for now (it is master access to every tier); **admin links** give a
  small group's organizer their own hub without it; individual sign-in (Microsoft 365 / SSO / email) and per-tier
  visibility rules come later. The club charges no dues and runs no 50/50 of its own; associations' dues are
  collected by the club on their behalf (Dues collection) and credited to the association. Associations keep their own treasury; what
  the club may see of association finances is decided when access levels exist. One club for now; the club becomes
  a tenant in a master system later — don't hardcode WCCC where a setting will do. Small groups get a season ledger
  of money games (who is up or down, by how much).
- Not built / ideas: individual sign-in; Golf Genius replacement features (registration, pairings/tee sheets,
  scoring formats, GHIN posting); real bank-statement format test for Treasury.

### Git
- Repo: `github.com/elevatesystemsinc/mga-app`. Work on **`main`**; confirm with `git branch --show-current` before
  committing. Always push explicitly: `git push origin main`. Touch `Hub` only for a season bug fix, and port the
  same fix here. Commit messages: say what changed ("Calcutta: split Results and Payouts tabs"), not "update".

## 7. Working with the owner

Zach is technical and direct. Build, test, then report briefly what changed and how it was verified. Be honest
about uncertainty and limitations; don't re-suggest approaches he has rejected. When a request is ambiguous and the
answer changes what you'd build, ask one question first (he has said "let's talk it through before you make a
change" for bigger shifts). Ask before adding scope. Don't over-explain basics.
