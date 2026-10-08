# Club Hub — handoff for Claude Code

Management app for **Walnut Creek Country Club** and the organizations inside it. It started as the
**MGA Hub** (Men's Golf Association: tournaments, the Member-Member weekend, the Calcutta, treasury, golf
scoring, check-in, the 50/50 drawing) and is becoming the club-wide hub: a **club** tier (master member
directory, club-run tournaments, live scoring), **association** hubs (MGA, LGA, SMGA — each with its own
schedule, tournaments, budget/treasury, membership) and **small groups** (a roster, games with entry fees and
payouts, live scoring, a season money-game ledger). Long term it replaces Golf Genius here and at other clubs.
Owner: Zach Walls.

Read this file first. Then read `README.md` (user-facing feature guide) as needed.

> **Branches.** `main` (this branch, deployed at **app.wcccmga.org**) is the product going forward — work here.
> `Hub` is the frozen MGA Hub the board is using for the 2026 season at **hub.wcccmga.org**; it gets bug fixes
> only, and any fix made there is cherry-picked to `main`. Both branches share one Supabase project and the
> `mga_hub` table: `Hub` owns the row with id `main`; this branch owns the rows `club`, `mga`, `lga`, `smga`
> and one per small group, and **never writes the `main` row** (the migration only reads it). When the club hub
> is live and the MGA has moved over, `Hub` is deprecated.

---

## 1. How it's built and deployed

- **Plain static site.** No framework, no bundler, no npm runtime deps. Vanilla JS + HTML + CSS.
- **Hosting:** Render static sites serving the **repo root**: `main` → app.wcccmga.org, `Hub` → hub.wcccmga.org.
  Deploy = push. Render does **not** run a build — the built HTML files are committed.
- **Addresses:** the club hub is `/`; each organization is its own path — `/mga`, `/lga`, `/smga`, `/<group id>`
  (`ORG_ID` = first path segment; `?org=` is the fallback used by the file:// tests). This needs **one Render rule** on
  the app.wcccmga.org site: Redirects/Rewrites → source `/*`, destination `/index.html`, action **Rewrite** (existing
  files such as cashier.html still win). `head.html` writes `<base href="/">` on http so relative files load from the
  root; links to the cashier / check-in / scoring pages and to crest.png are built from `SITE_BASE`.
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
  golfcore.js          courses (WCCC Oak/Pecan ratings), WHS math, scoring engine, scorecard renderer  [shared]
  golf.js              Golf page: events, field, flights, groups, live scoring, printed cards
  games.js             small groups: Games (entry money, payouts by finish / skins, live scoring via golf events), Ledger
  calccore.js          Calcutta pure logic                                                            [shared]
  pdffonts.js          PDF_FONTS: base64 TTFs for jsPDF (Public Sans 400/700/800, Cormorant 700 w/ lining digits)
  calcutta.js          Calcutta tab: lots, bidders, buyers & shares, money, setup, cashier link, bidder sheet PDF
  checklist.js         Checklist tab
  ckcore.js            check-in merge logic                                                            [shared]
  checkin.js           Check-in tab + registration link
  raffle.js            50/50 Drawing tab, drawing screen, official record PDF
  payouts.js           Calcutta payouts math (calcPayouts, ties) + Results / Payouts sub-tabs
  autoupdate.js        version.json polling + safe reload (__BUILD__ placeholder)                     [shared]
  cashier_src.html     cashier page   (markers /*CALCCORE*/ /*AUTOUPDATE*/)
  checkin_src.html     check-in page  (markers /*CKCORE*/  /*AUTOUPDATE*/)
  score_src.html       live scoring   (markers /*GOLFCORE*/ /*AUTOUPDATE*/)
build.sh               → index.html, cashier.html, checkin.html, score.html, version.json (repo root)
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
git add -A && git commit && git push origin main  # Render deploys main to app.wcccmga.org
```
Tests need `pip install playwright && playwright install chromium` and `cd tests && npm i xlsx@0.18.5`.
smoke/payouts run the pages **in local mode** (stubbed `config.js`, no Supabase; `?org=mga` / `?org=club`).
`test_sync.py` runs them against `tests/fake_supabase.js` + `FakeDB` in `_harness.py` (shared in-memory rows,
compare-and-swap, 250 ms polling "realtime"). If you change `core.js` saving/merging or the member API, keep it green.

---

## 2. Data model

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
- Organization kinds gate the nav (`ORG_NAV` in ui.js): club = directory, organizations, tournaments, golf, budget,
  treasury; association = everything the MGA has; group = dashboard, games, ledger, golf, members.
- **Small groups** (`games.js`, group documents only): `db.games` = [{id, season, date, time, name, course, entry,
  skinsEntry, net, status, players:[{id, memberId|name, paid, inSkins, extraIn, gpid}], payouts:[{kind:'places'|
  'skins'|'manual', pid, amount, note}], golfEventId}] and `db.ledgerAdj` (side bets / settle-ups). Money is a record
  of what changed hands: a player's in = entry (+ skins entry if in, + extras), out = Σ payouts; the Ledger's net =
  out − in + adjustments, per season or quarter. `openScoring(g)` creates a golf event for the game (players in groups
  of four, `gpid` links game player → event player) and `syncGameEvent` keeps it in step; payouts by finish use the
  event leaderboard (ties share places, cent-exact) or hand-entered positions; skins come from the hole scores
  (lowest outright wins; ties carry over, optional; carried skins unpaid at the end).
- Arrays of objects carry stable `id`s — the merge (§3) matches by id. Keep it that way for anything new.
- `_rev` (revision), `_w` (writer/client id), `_at` are bookkeeping, excluded from comparisons.
- **Device-local, never in the shared doc:** cashier/check-in link status (`SHARE_ST`, `CKI_ST`), the cashier-link merge base (`localStorage mga_cbase_<tid>`), check-in base (`mga_ckibase_<tid>`).
  Putting status/timestamps in `db` causes background saves that ping every device — don't.

### Supabase objects
| object | purpose |
|---|---|
| `mga_hub` (id, data jsonb) | one row per organization: `club`, `mga`, `lga`, `smga`, `<group id>` — and `main`, the frozen MGA Hub's row (read by the migration only). `hub-setup.sql`, `hub-fix-permissions.sql` |
| `calcutta_share` (tid, token, name, doc, version) + RPC `calcutta_get(p_token)`, `calcutta_put(p_token,p_doc,p_version)` | token links for people without the board login: the **cashier** page (tid = tournament id) and the **registration/check-in** page (tid = tournament id + `:checkin`). `calcutta_put` is version-checked (conflict → retry). `calcutta-setup.sql` |
| `golf_events`, `golf_scores` + RPC `golf_event`, `golf_join`, `golf_submit` | public live scoring (`golf-setup.sql`). Built but **not used** this season — don't advertise it. |
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

The cashier and check-in pages use their own per-item merge (`calcMerge` / `ckMerge`): each item carries `u`
(updated-at); newest wins per item; deletes are tombstones; settings merge as a unit (`_su`). Stamping is
idempotent (`calcStamp`/`ckStamp` only stamp an item once per change).

---

## 4. Features (where to look)

**Member-Member is the main tournament.** Tournament tabs (TT): Overview · Meals & events · Field · Check-in ·
Sponsors · Budget · Checklist · Calcutta · 50/50 Drawing.

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
  auction order (Excel), **bidder sheet PDF** (always blank; built in-browser with jsPDF + `PDF_FONTS`).

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

### Other
Checklist (95-task 2026 template, assignees from members/board, notes, print). Golf (courses, WHS, flights,
groups, printed scorecards — the printed cards include a live-scoring QR that isn't being used). Treasury.

---

## 5. Conventions

- **Brand:** navy `#0F2A38`, gold `#C7A13A` / light gold `#D8B75F` / dark gold `#7E5F1A`, ivory `#FBFAF5`,
  line `#E1D9C6`. Cormorant Garamond for display, Public Sans for UI. Crest: `crest.png` (Member-Member) /
  `mga-crest.png`. **Club logo** (derived from the club's artwork — tree gold `#D69929`, text teal `#254C5B`):
  `club-logo.png` (color, for white surfaces: login card, picker), `club-logo-light.png` (light gold tree + white
  script, for the navy sidebar — the club hub and the picker wear it instead of crest + name), `club-mark.png`
  (tree only, square: the club's `crest` in cards, rows and the top bar), `favicon.png`. **Always lining numerals** (`font-variant-numeric: lining-nums`) — Cormorant's default old-style
  "1" reads as "I"; the PDF font in `pdffonts.js` has lining digits baked in.
- **UI pattern:** screens are read-only; edits happen in the drawer (`openDrawer({title, body, wire, save, del})`),
  `save` returns `false` to keep it open. After mutating `db`: `persist(); render();`.
- **Mobile matters** (phones at registration, cashier, auction). Check 390 px width; no horizontal overflow.
- **Printed/PDF output must look as polished as the rest of the brand** — the user rejected a plain browser
  print view as "lazy". PDFs are generated files the user downloads (jsPDF), not print-preview windows.
- **Privacy on public-facing sheets:** no emails, GHIN numbers or handicap indexes on anything left on a table.
- **Club prices are all-in** (no tax & service line on menus).
- No payout or handicap-allowance details on player handouts.

## 6. Status / history

- **Legacy app (retired):** the original Member-Member app used to live on `main` (its history is still in git);
  its `mm_tournament` table is still in Supabase as an archive, to be dropped when that system is deprecated. The
  hub's import / Verify / two-way sync / "Retire current app" code was removed in Oct 2026. Stored documents may still carry `db.legacy`, `t.source` (`kind:'mm-app'`) and
  `t.sync` from that era; nothing reads them and `normalize()` leaves them alone.
- 2026 Member-Member: Oct 2–4. 150 players / 75 teams (Team 84, Regina & Cagle, added late as Lot 75).
- **Built Oct 2026 (step 3, small groups):** Games, payouts by finish and skins, live scoring through golf events,
  season/quarter Ledger with settle-ups, a group dashboard; the Members page without dues for groups.
- **Built Oct 2026 (step 1):** per-organization rows, the club directory + memberships, path routing, the picker,
  the Organizations page (create associations / small groups, archive), the club-side roster import (member number →
  Golf Genius ID → GHIN → email → name; name-only matches that disagree on an identifier are decided by hand), and the
  set-up / re-import from the MGA Hub (`migrateFromHub()`: directory from the MGA list with the same ids; mga row =
  the Hub's document with members → memberships; re-running updates the directory and replaces the mga row).
- **Decided for the club hub (Oct 2026):** the club owns the master roster, seeded from the MGA list, then grown by
  importing the club software's export (merge duplicates by member number → GHIN → email → name, create the rest).
  Sign-in stays the single shared board login for now (it is master access to every tier); individual sign-in
  (Microsoft 365 / SSO / email) and per-tier visibility rules come later. Associations keep their own treasury; what
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
