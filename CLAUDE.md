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
> `wccc`; it is also reached at **app.wcccmga.org** (bare host = the club hub) and, once Render's hub.wcccmga.org site
> is switched from the `Hub` branch to `main`, at **hub.wcccmga.org** (bare host = the MGA hub: `HOST_ORG` in core.js;
> the club hub is then `/club` there).
> `Hub` is the old frozen MGA Hub code; it owned the `mga_hub` row `main`. While hub.wcccmga.org still serves the
> `Hub` branch, the MGA's row and `main` are kept in **two-way sync** (`hubSync()`, §3) — the only writes this branch
> makes to `main`, always a compare-and-swap merge. After the host switch, turn the sync off (Organizations → MGA)
> and treat `main` and the `Hub` branch as history.

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
  autoupdate.js        version.json polling + safe reload (__BUILD__ placeholder)                     [shared]
  cashier_src.html     cashier page   (markers /*CALCCORE*/ /*AUTOUPDATE*/)
  checkin_src.html     check-in page  (markers /*CKCORE*/  /*AUTOUPDATE*/)
  score_src.html       live scoring   (markers /*GOLFCORE*/ /*AUTOUPDATE*/)
  survey_src.html      public survey page (marker /*AUTOUPDATE*/ only)
build.sh               → index.html, cashier.html, checkin.html, score.html, survey.html, version.json (repo root)
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
`(tenant, id)`. **Modules:** Golf management (`golf`) is the package = everything built today (associations and small
groups included); `club`, `billing`, `pos` are the coming Club-management tier (`MODULE_CATALOG`, `hasModule()`).
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
- Organization kinds gate the nav (`ORG_NAV` in ui.js): club = directory, dues collection, organizations, game
  library, tournaments, golf, budget, treasury; association = everything the MGA has; group = dashboard, games,
  ledger, tournaments, golf, members.
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
    skin shows as pending until its validation hole is called **and** the verdict has been flashed: the hole comes
    first, then the button reads "Hole N — did it validate?", then the verdict full-screen (`sk-flash`: red "Didn't
    validate" / green "Validated", with what the player made on the validation hole), never the other way round (the
    owner, Oct 2026: "not spoil validation or not validated before"). A skin's dollar value (pot ÷ skins won) only shows
    once all 18 are called. The phone's `calloutStage` (Finish tab) runs the same sequence.
  - **Published copy stays current**: `publishIfChanged(ev)` (golf.js) runs on every render of a game page, a Golf
    event page and a tournament's Rounds tab — it republishes when `publicEvent(ev)` differs from what this session
    last sent (`PUB_SIG`), so a new build that changes derived data (competitions, handicaps, `matchBy`…) reaches the
    phones on the next 30 s refresh without anyone pressing Save. Without it the phones showed the old competition
    rules after the reverse-waltz change.
  - **Live leaderboard per competition**: each format competition has "Show on the live leaderboard"
    (`rules.live`, default on; skins use `rules.skins.live`, dots never show). `gameComps(ev)` → the live competitions
    as `{id,name,kind,players,teams,sitOut,engine…}`; `publicEvent` publishes them as `comps`, and the scoring page
    (score_src.html: `compChips`, `renderCompBoard`, `renderSkinsBoard`) shows one board per competition — a game opens on
    its first competition (the raw round board only appears for events without competitions), the chips are one
    scrolling row, the header drops the date the event name already carries, and a row's sub-line is gross · net
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
    low man. **Only true match play waits**: a by-holes match counts a hole once both sides have it (and stops at the
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
  - **Handicaps are 100% across the board** in a group's game (`g.hcp` 'full', the default; 'usga' switches the USGA
    table back on — designer, "Handicaps"): `syncGameEvent` sets `ev.allow={'*':100}`, `pctFor` honours `'*'` for every
    player format (never the per-player scramble tables), `compPub` keeps it, so stroke play, best ball, skins and the
    matches all play full handicaps on the hub and the phones.
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
| `mga_hub` (tenant, id, data jsonb) | one row per organization per tenant: `club`, `mga`, `lga`, `smga`, `<group id>` — plus `main`, the MGA Hub's row (two-way synced with `mga`), and `sync:<org>`, the sync base. `hub-setup.sql`, `hub-fix-permissions.sql` |
| `calcutta_share` (tid, token, name, doc, version) + RPC `calcutta_get(p_token)`, `calcutta_put(p_token,p_doc,p_version)` | token links for people without the board login: the **cashier** page (tid = tournament id) and the **registration/check-in** page (tid = tournament id + `:checkin`). `calcutta_put` is version-checked (conflict → retry). `calcutta-setup.sql` |
| `golf_events` (+ `wrap`), `golf_scores` + RPC `golf_event`, `golf_join`, `golf_submit`, `golf_wrap`, `hub_key_wrap` | public live scoring (`golf-setup.sql`) and the Finish tab's wrap-up (`wrap-setup.sql`). `public.org` names the owning organization. |
| `survey_share` (sid, tenant, org, token, status, doc), `survey_responses` (id, tenant, org, sid, answers, day) + RPC `survey_get(p_token)`, `survey_submit(p_token,p_answers)`, `hub_key_survey`, `hub_key_survey_results` | surveys (`survey-setup.sql`): the share row is what the public page shows; a response is answers + the **day** only — no user, e-mail, IP or device, ever. |
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
both devices and the server identical. Also covered there: first-run set-up from the `main` row and its re-run.
(Cashier-link writes add 1 per edit when a Calcutta link is live.)

### Two-way sync with the MGA Hub (`hubSync`, core.js)
The organization whose club record carries `hubRow:'main'` (the MGA; toggle in Organizations → edit → "Keep in
two-way sync") is kept in step with the Hub's row while any device has the club hub or the MGA hub open: every 30 s
from `startPoll`, 2.5 s after a local save (`hubSyncSoon` from `persist`), and from "Sync now" (sidebar line,
Organizations page). A pass runs only when both documents are open, loaded and fully saved (`docChanged` false, no
pending push — a server copy that lags a local save would read as a revert). It is a three-way merge per side:
base = row `sync:mga` `{base, persons, mainRev, at}` (the last merged copy), local = the saved MGA document
(`D.base`) + the saved directory entries of its members, remote = `hubToOrg(main)` + `hubPersons(main)`; the result
goes onto the live documents (`syncTo` with a three-way apply so unsaved edits survive, persons by id into
`CLUB.members`) and, when the Hub's row would change, to `main` via `casWrite` (CAS on `_rev`, `_w` = this client,
so Hub devices merge it like any other save) — `orgToHub` turns memberships + persons back into the Hub's
`members` shape. Nothing is written when nothing moved; the first pass (no base) is the union of both sides with the
Hub winning on org data and the directory winning on a person's details; `migrateFromHub` resets the base. The Hub's
`normalize()` keeps unknown keys, so new-site fields (`features`, `rounds`, `duesCharges`, pots…) round-trip.
`tests/test_sync.py` covers Hub→site, site→Hub, no-churn, membership removal and the pending-save guard.

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
- **Printed/PDF output must look as polished as the rest of the brand** — the user rejected a plain browser
  print view as "lazy". PDFs are generated files the user downloads (jsPDF), not print-preview windows.
- **Privacy on public-facing sheets:** no emails, GHIN numbers or handicap indexes on anything left on a table.
- **Club prices are all-in** (no tax & service line on menus).
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

- **Legacy app (retired):** the original Member-Member app used to live on `main` (its history is still in git);
  its `mm_tournament` table is still in Supabase as an archive, to be dropped when that system is deprecated. The
  hub's import / Verify / two-way sync / "Retire current app" code was removed in Oct 2026. Stored documents may still carry `db.legacy`, `t.source` (`kind:'mm-app'`) and
  `t.sync` from that era; nothing reads them and `normalize()` leaves them alone.
- 2026 Member-Member: Oct 2–4. 150 players / 75 teams (Team 84, Regina & Cagle, added late as Lot 75).
- **Built Oct 2026 (Hub sync):** `hubSync()` keeps the MGA's row and the Hub's `main` row in two-way sync (§3).
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
  set-up / re-import from the MGA Hub (`migrateFromHub()`: directory from the MGA list with the same ids; mga row =
  the Hub's document with members → memberships; re-running updates the directory and replaces the mga row).
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
