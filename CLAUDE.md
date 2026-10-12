# Club Hub — handoff for Claude Code

Management app for **Walnut Creek Country Club** and the organizations inside it. It started as the
**MGA Hub** (Men's Golf Association: tournaments, the Member-Member weekend, the Calcutta, treasury, golf
scoring, check-in, the 50/50 drawing) and is becoming the club-wide hub: a **club** tier (master member
directory, club-run tournaments, live scoring), **association** hubs (MGA, LGA, SMGA — each with its own
schedule, tournaments, budget/treasury, membership) and **small groups** (a roster, games with entry fees and
payouts, live scoring, a season money-game ledger). Long term it replaces Golf Genius here and at other clubs.
Owner: Zach Walls.

Read this file first. Then read `README.md` (user-facing feature guide) as needed.

> **Branches and hosts.** `main` (this branch) is the product — work here. It is deployed at **app.wcccmga.org**
> (bare host = the club hub) and, once Render's hub.wcccmga.org site is switched from the `Hub` branch to `main`, at
> **hub.wcccmga.org** too (bare host = the MGA hub: `HOST_ORG` in core.js; the club hub is then `/club` there).
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
python3 tests/test_score.py   # the public scoring page against the fake: mid-round changes reach open phones/boards
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
  - **Designer** (`designGame(g|null)` → `vGameDesign`, draft in `GD`): the day (name, date, course, pay timing,
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
    skin shows as pending until its validation hole is called; stepping onto that hole first flashes the verdict
    full-screen (`sk-flash`: red "Didn't validate" / green "Validated"), then shows the hole's result.
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
  - **Game sheet PDF** (`gameSheetPDF(g,{strokes,returnDoc})`): competitions and denominations, teams when known
    (an after-round draw says so), the groups as they play with each player's strokes.
- Arrays of objects carry stable `id`s — the merge (§3) matches by id. Keep it that way for anything new.
- `_rev` (revision), `_w` (writer/client id), `_at` are bookkeeping, excluded from comparisons.
- **Device-local, never in the shared doc:** cashier/check-in link status (`SHARE_ST`, `CKI_ST`), the cashier-link merge base (`localStorage mga_cbase_<tid>`), check-in base (`mga_ckibase_<tid>`).
  Putting status/timestamps in `db` causes background saves that ping every device — don't.

### Supabase objects
| object | purpose |
|---|---|
| `mga_hub` (id, data jsonb) | one row per organization: `club`, `mga`, `lga`, `smga`, `<group id>` — plus `main`, the MGA Hub's row (two-way synced with `mga`), and `sync:<org>`, the sync base. `hub-setup.sql`, `hub-fix-permissions.sql` |
| `calcutta_share` (tid, token, name, doc, version) + RPC `calcutta_get(p_token)`, `calcutta_put(p_token,p_doc,p_version)` | token links for people without the board login: the **cashier** page (tid = tournament id) and the **registration/check-in** page (tid = tournament id + `:checkin`). `calcutta_put` is version-checked (conflict → retry). `calcutta-setup.sql` |
| `golf_events`, `golf_scores` + RPC `golf_event`, `golf_join`, `golf_submit` | public live scoring (`golf-setup.sql`). `public.org` names the owning organization. |
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
- **Mobile matters** (phones at registration, cashier, auction). Check 390 px width; no horizontal overflow. Tables
  stack on phones automatically (≤640px, see head.html); give a table `keep` only when it has its own phone layout.
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
