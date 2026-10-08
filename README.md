# MGA Hub (side branch)

The season-wide hub for the Walnut Creek CC MGA: members, board, every tournament
(1–3 days, meals, events, field, sponsors, budget) and the season budget.
Same stack as the Member-Member app: one static `index.html`, Supabase, Render.

**It runs alongside the current Member-Member app and never changes it.**
The hub keeps its own table (`mga_hub`). It only *reads* `mm_tournament`, to import
Member-Member and to cross-check the numbers.

## Set up the branch (once)

1. In the repo: `git checkout -b hub`
2. Replace `index.html` and `README.md` with the ones from this zip, add `crest.png`
   and `hub-setup.sql`. Leave `config.js` handling exactly as it is on `main`.
3. `git add -A && git commit -m "MGA Hub" && git push -u origin hub`

## Supabase (same project)

SQL Editor → run `hub-setup.sql`. It creates `public.mga_hub` with RLS and realtime.
It does not touch `mm_tournament`. The hub signs in with the same shared board login.

## Render (a second static site)

Render → **New → Static Site** → same repo, branch **`hub`**, publish directory `.`.
Copy the current site's build command and environment variables
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BOARD_EMAIL`) if it generates `config.js`.
Optional: give it its own subdomain (e.g. `hub.wcccmga.org`). The current site on
`main` keeps serving `app.wcccmga.org` untouched.

## Load and cross-verify Member-Member

1. Sign in → Dashboard → **Import Member-Member** (or Tournaments → Import).
2. Pick 2026 → Import. The hub reads the live Member-Member row and builds the
   tournament: sponsors + payments, all three days of F&B with the Saturday dinner
   menu, income, per-player pro shop credit, flight prizes, misc, actuals, schedule
   and open decisions.
3. The **Verify** tab lists every budget and actual total, recomputed exactly the
   way the current app calculates it, next to the hub's number. All should say Match.
4. **Compare with the live app now** re-checks against the current app at any time.
   **Re-import** replaces the hub copy with a fresh one (use it while the board keeps
   working in the current app this week).

**Staying in sync:** imported tournaments sync both ways automatically. Hub edits reach the current
app a couple of seconds later; edits made there appear in the hub live (or when the tab comes back into
view, and every minute). Hub-only data — the field, flights, ledger links, extra lines — stays in the
hub. If both sides change before a sync, the tournament shows **Conflict** and nothing is overwritten
until you pick a version. The chip in the tournament header shows the state; click it to turn sync off
for that tournament.

**Push back to the current app:** on an imported tournament, **Push to current app** (header or
Verify tab) sends the hub's edits to the Member-Member app so the board can keep using it. It shows
every total before and after, checks the result matches the hub, downloads a backup of the current
app's data first, and only replaces that year (other years, outreach and event info stay). If someone
edited that year in the current app since the hub's copy was taken, it warns and names the changes —
re-import first to keep both. The current app holds one catered menu and three income lines, so
anything beyond that is listed in the preview before you push.

No Supabase access? Download a backup from the current app (⋯ → Backup all data)
and choose it when the import asks.

## Retiring the current app

**Retire current app** (tournament header, or the sync panel) moves the board to the hub for good: a last
sync from app.wcccmga.org, an archive download of its data, then the hub stops all contact with it — the
sync chip, Push, Verify tab and import buttons disappear on every device. The old app's `mm_tournament`
table in Supabase is left untouched. Put the forwarding page on the old site so bookmarks land in the hub.

## Staying up to date

`version.json` is written by every build. The hub, cashier and scoring pages check it about once a minute
and reload themselves when a newer build is live — only at a safe moment (nothing unsaved, no editor or
sale panel open, not mid-typing; the scoring page waits for its offline queue to empty). Upload
`version.json` along with the pages each time.

## Working together

Several board members can use the hub at the same time. Every save is checked against the latest
server copy (a revision number inside the record); if someone else saved in between, the hub fetches
their version, merges it with yours item by item — tournaments, lots, bidders, members, ledger lines are
matched by id — and saves the combined result. Changes to different things never collide; if two people
change the very same field, the later edit wins. Incoming changes merge into the records on your screen in place
— even with an editor open — so you see others' work live, your typing and scroll position are kept, and
nothing you're editing is lost. Edits made while a save is still uploading go up right after. Only real edits are saved: browsing, opening
records and the background sync checks never write anything, so nobody else's screen updates unless
something actually changed. No setup needed.

## 50/50 Drawing

Each tournament has a **50/50 Drawing** tab. **Upload** the "All tickets sold" export (CSV or Excel): tickets are
tournament + ticket number (numbers restart each tournament); tickets sold by hand without a number are included
and identified by their sheet row. Players are identified by name — email and phone are ignored because they were
often the seller's. **Look-alike names** (e.g. "Nate Huneycutt" / "Nate Honeycutt") must be ruled same or different
before **locking**, which records a SHA-256 **fingerprint** of every ticket; the list can't change after. **Open the
drawing screen** for the projector: each draw uses the browser's cryptographic random generator (every eligible
ticket equally likely) and is saved the instant it's drawn; a winner's tickets all leave the drum before the next
drawing. Voids need a written reason and stay in the log. **Official record (PDF)**: ticket list, fingerprint,
method, each drawing (random value, eligible count, winning ticket and sheet row), witness lines, tickets by player.

## Check-in

Each tournament has a **Check-in** tab (next to Field) listing every player in the field, alphabetical by last
name with letter dividers. Search a name (own name first; partners only if no one matches) or a team number;
filter Not yet / Checked in / Par 3. **Check in** marks the time; tap again to undo. Counts show checked in,
still to arrive and teams complete. **Create registration link** gives the registration table a private page
(`checkin.html`, no board password) with the same list and big buttons — several devices can check players in
at once, it keeps working through a dropped connection, and **Turn off** ends access. Uses the same Supabase
setup as the cashier link (`calcutta-setup.sql`).

## Checklist

Each tournament has a **Checklist** tab. **Start a checklist** from the 2026 Member-Member weekend checklist
(95 tasks across Pre-event, Thursday set-up and each tournament day, with the NEW / FIX marks), by copying
another tournament's checklist (tasks come over open and unassigned), or blank. Click any task to edit it,
**assign** it (type a name — board members come first, with their roles), add **notes**, or mark it done;
checkboxes work right in the list. Filter by person, Open / Done / Unassigned, or search. **Print** the whole
checklist or one person's tasks, with names in the Assigned-to column. Add days, sections and tasks anywhere.

## Calcutta (players auction)

Each tournament has a **Calcutta** tab, split into sub-tabs — **Lots**, **Bidders**, **Buyers & shares**,
**Money** (by flight, payments, expenses, cash drawer) and **Setup** (cashier link, minimum bid, buy-in,
team sheet) — with the totals and Run the auction / Export results always at the top. Lots, Bidders and Buyers & shares
each have a search box: names, paddle numbers (101 or #101), lot numbers, flights; it combines with the filters.

- **Upload team sheet:** the auction-order spreadsheet (Lot, Team, Flight, Team index…) or the team
  sheet (Player 1, Player 2, Flight…). Buyers and prices already filled in come across. Re-uploading
  keeps every recorded sale (teams are matched by their players).
- **Payouts** (Payouts sub-tab): give each team its finish in its flight; tied teams get the same number. No
  tie-breaker — tied teams share the money for every place they cover (two tied for 1st split 1st + 2nd; three tied
  for 4th with four places paid split 4th money), to the cent, with any odd cent going to the lowest lot. Each team's
  money is split to its owners (buyer 75% / captain 25%, or captain 100% if pre-bought; the pool's buyer for pool
  teams). **Payouts by person** lists everyone to pay — paddle or not — expandable to the teams behind it, with a
  paid-out mark (cash, check, Zelle, Venmo). The export adds Payouts by flight and Payouts by person sheets.
- **Teams added to the field later:** the Lots sub-tab shows a notice when the field has teams the Calcutta
  doesn't; **Add to the Calcutta** (also on Setup) adds them with a suggested flight (from the team index) and
  the next lot number — or a lot number of your choice, moving later lots down one. The pool renumbers itself.
- **What each buyer owes:** every bidder row shows lots bought and the total owed; click (or tap, on the
  cashier page) to expand the lots — lot, team, flight, price, the pool and its teams — with a total and paid
  status. Filters: All / Buyers / Unpaid; Expand all in the hub.
- **Bidders:** add one at a time (member or guest) or **Number the players** to give everyone in the
  field a bidder number (last-name order, choose the starting number). Each bidder shows what they
  bought, what they owe, and paid / paid-by.
- **Run the auction:** a live screen for the night — type the bidder number, Enter, the price, Enter,
  and it moves to the next lot. Back and Skip are there; any lot can be edited from the Lots list.
  A bidder number that doesn't exist yet is added on the spot.
- **Minimum bid** (default $250, editable): a team that doesn't reach it — a lower bid, **No sale →
  pool**, or no price — goes into **the pool**, auctioned together as one extra lot numbered after the
  last team (Lot 75 for 74 teams). It comes up on the live screen after the last team and sells to one
  bidder for one price. That price is shared by the flights in proportion to their teams in the pool.
  Teams can be taken back out of the pool (the Pool button or the Lots list).
- **Team buy-in & pre-buy** (off unless turned on for that Calcutta — **Turn on buy-in**): each team owns
  a share of itself before the auction (default 25% for $300, $150 a player) — the auction buyer gets the
  rest. A team can **pre-buy** the remainder at registration (default $900 more, $1,200 in all): it then
  owns 100% and is **skipped in the auction**. Buy-ins go into each team's flight pot. Three payments are kept
  separate, each with its own paid status and method: the **auction purchase** (paid by the buyer, marked on
  the bidder), each player's share of the team **buy-in** (e.g. $150 each) and of the **pre-buy** (e.g. $450 each). Payments totals show every method split by kind.
- **Captains and buyers:** every team's captain is the player with the lower Handicap Index (plus handicaps
  count as lower; ties or missing indexes are flagged; switch it by hand on any lot). The captain is the
  buyer of the team's own share — 100% of a pre-bought team, the buy-in share (25%) of an auctioned team —
  and is paid it, with or without a paddle. Each player's $150 buy-in is tracked separately but is a team
  payment only. Bidder numbers are for the auction: when a captain takes a paddle (picked by name), their
  shares join that number automatically. **Buyers & shares** lists everyone to pay out and what they own;
  the export has the same sheet.
- **Expenses** (e.g. the auction dinner) come out of the pot **evenly across every flight**.
- **By flight:** teams sold, gross, expense share, net pot, and the payout by place from each
  flight's net (40/30/20/10 by default, editable, any number of places).
- **Download order (Excel)** and **Bidder sheet (PDF)** (Lots sub-tab): the auction order as a spreadsheet,
  and a blank, downloadable PDF for bettors — the full auction order, then a page per flight with room to write
  the buyer and price for every team and a flight total. Built in the browser; no print dialog.
- **Export results:** a workbook with Lots, Bidders (what each owes), By flight and Expenses.
- **Payments:** totals by Cash, Zelle, Credit card and Check, what's still owed, and a **cash drawer**
  check — starting cash + cash payments = what should be in the drawer; enter the count to see over/short.
- **Cashier link** (one-time setup: run `calcutta-setup.sql`, and upload `cashier.html` with `index.html`):
  **Create cashier link** gives a private address for the cashiers' laptops — no board password. They can
  record sales and pool decisions, add and edit bidders (players in the field come up as they type), mark
  bidders paid by method, and count the cash drawer. Several cashiers can work at once; each change saves
  on its own and appears everywhere within a few seconds (the hub included). Edits to different teams or
  bidders never overwrite each other; on the same one, the latest wins. A laptop that drops offline keeps
  its changes and saves them when it reconnects. **Turn off** locks the link immediately; the data stays.
- The Calcutta lives in the hub only; syncing with the current Member-Member app never touches it.

## Live scoring (Golf)

One-time: Supabase → SQL Editor → run `golf-setup.sql`. Upload `score.html` alongside
`index.html` on the `hub` branch.

- **Golf → Courses:** Oak and Pecan scorecards (par, men's/women's handicap, every tee).
- **Golf → New scoring event:** name, date, default tee, a **custom link**, and optionally the
  tournament it belongs to. Add groups by hand, or **Build groups from the field** (keeps
  teams together; all Oak, all Pecan, or split; shotgun or off hole 1).
- **Groups:** each has its own **Group ID** (random by default — change it to a cart number or
  tee time), course, starting hole, and players (members, field players, or guests), each with
  a tee and men's/women's par.
- **Open scoring**, then share the link: `…/score.html?e=<your-link>`. Players enter their
  Group ID and score hole by hole. Scores save as they tap, queue up in dead zones, and send
  when signal returns. `…&view=board` is a big-screen leaderboard for the clubhouse TV.
- **Leaderboard:** gross stroke play, to par for holes played, both courses combined. It's in the
  event page, on the Dashboard, and a live link sits in the sidebar while scoring is open.
  Click any player to correct a group's scores from the hub.
- **Formats per nine:** Round type can be Stroke play, Best ball, Scramble, Shamble, or "Front & back
  differ" (e.g. Member-Member Saturday: scramble front, shamble back). Scramble holes take one team
  score (the phone shows one entry per team); best ball and shamble holes take every player's score
  and the best net ball counts. Cards, leaderboards and the phone follow each hole's format.
- **Handicap allowances** default to the USGA (WHS Appendix C) recommendations: individual stroke play
  95%, four-ball 85%, 2-player scramble 35/15%, 4-player scramble 25/20/15/10%. Shamble isn't in the
  USGA table — it defaults to 85% (it plays as four-ball after the drive). All editable per event,
  with "Reset to USGA". Scramble team handicap = course handicaps low→high × those percentages.
- **Course & start by flight** (Flights tab): each flight picks its course and Shotgun or Tee times —
  first tee time, gap in minutes, and hole 1 or 10 — all editable. Tee-time groups go off in order of
  combined handicap; a warning shows if one course has both a shotgun and tee times.
- **Round type:** Stroke play or **Best ball**. Best ball: every player scores their own ball; the
  team's score on each hole is its best score (gross, or net after each player's strokes — 90%
  allowance is the usual four-ball setting). Teams come from the linked tournament (Member-Member
  partners) or are set per group. Leaderboards switch between Teams and Players; the phone shows
  each team's best on the current hole. Flights keep best-ball teams together.
- **Handicaps:** each player's Handicap Index comes from their member profile (the Golf Genius
  import); override it in the group for guests. Course handicap = Index × Slope ÷ 113 + (Course
  Rating − Par), using the player's course, tee and men's/women's set, at the event's allowance %.
  Ratings come from the club's printed rating card (all tees, men and women, incl. Blue/White and
  White/Red) and can be edited on Golf → Courses.
- **Flights:** event → Flights → enter how many. Filled evenly by course handicap (or Index),
  lowest in A, sizes differ by at most one. For team events linked to a tournament, teams stay
  together on combined handicap. Ties at a split are flagged; move anyone by hand afterward.
- **Event workflow — 1 Field → 2 Flights → 3 Groups:**
  1. *Field:* **Import field from <tournament>** pulls every player with their team and Handicap
     Index (re-import adds newcomers, updates teams, optionally removes withdrawals). Add guests here.
  2. *Flights:* set the number of flights; players and teams get a flight without being grouped.
  3. *Groups:* **Build groups from flights** forms foursomes inside each flight on the flight's course.
- **Groups by flight:** with "Build groups by flight" on, flights are sized in whole groups
  (two 2-person teams per foursome, so every flight has an even number of teams) and groups are
  formed inside each flight. Whole flights go to one course (split Oak/Pecan, or all on one).
  Starting holes go 1, 2, 3… from the lowest combined handicap up; extra groups double on par 5s.
  Players are re-rated on the course they'll actually play before holes are ordered.
- **Net scoring:** strokes are given by hole handicap (plus handicaps give strokes back). The
  leaderboard ranks gross or net, filters by flight, and the phone shows a dot on holes where a
  player gets a stroke. `…&view=board&flight=A` puts one flight on the TV.
- **Scorecards:** click any leaderboard row (hub or phone) for that group's card, styled after the
  club's printed card — tee rows, handicap and par rows, gross in every cell with birdie circles
  and bogey squares, the net score in the corner on holes where a stroke is given, and Hcp / Net
  totals at the end. Best ball adds a team row per team (the counting score each hole, net or gross
  per the event) and underlines the ball that counted. Final rounds are stamped FINAL; Print gives
  a landscape copy. On phones the card stacks front and back nines.
- **Printed scorecards:** event → Groups → **Print scorecards**. Team events print **one card per team**
  (team name, and the other team in the group as Marker — teams swap cards), two to a page so each page
  is one group; or one card per group. Tee-time groups show the tee time as the headline. Each card:
  event, date, course, format and flight; the group ID and starting hole in a box; yardage, par and
  handicap rows; each player with their playing handicap and a dot on every hole they get a stroke
  (+ where a plus handicap gives one back); a blank best-ball line per team; scorer/attest lines;
  and a QR code that opens live scoring with that group already joined. Two cards per letter page
  (cut in half for the cart) or one large card per page; all groups or one flight. Open scoring
  before the round so the QR codes work.
- **Close scoring** locks it: the public page can no longer change scores.
- Security: the public page can only read an event's public info, look up a group by its ID, and
  save scores for that group's players while the event is open. Group IDs are never exposed.

## How it works

- **Editing:** screens are read-only; every change happens in one side panel.
- **Tournaments:** 1, 2 or 3 days. Each day holds meals and events (fixed quantity,
  or "every player"), plus catered menus (line items at the club's all-in prices). Tournament-
  wide expenses are fixed amounts (prizes, gifts, misc) or per-player (pro shop credit).
  "Start from" copies another tournament's structure with actuals and payments cleared.
- **Members:** Members → Import member list takes the Golf Genius contact list export
  (.xlsx) or any spreadsheet/CSV with name columns. Preview first; re-uploading a newer
  export updates people (matched by Golf Genius ID, GHIN, email, then name) and blank
  cells never erase existing data. Optionally mark people missing from the file Inactive.
- **Field:** Field tab → Import roster takes the Golf Genius registration export for the
  event. Team Id sets the teams, RSVP questions (dinner, plus one, Par 3, anything else)
  are kept per player, and the dinner headcount (players + plus-ones) can be applied to
  a catered menu in one click. Re-uploading a newer export updates the field. Teams can
  also be picked by hand from Members. Players who aren’t current members can still play:
  they’re added to Members as Inactive and marked “Inactive Member” in the field. A later
  member-list import that includes them switches them back to Active. The newest file
  wins for handicap index (by the export’s “created on” time), entry paid and skins per player. The budget
  uses the planned player count until you switch it to the field in Tournament details.
- **Season budget:** all tournaments + annual dues (active members × dues, not
  prorated, recorded per member) + any MGA-level lines. The 50/50 raffle is counted
  inside the tournament it's assigned to, not added twice.
- **Treasury** (sidebar): the treasurer's books for the season.
  - *Ledger* — every dollar in and out: expenses and income recorded here, plus sponsor
    payments and dues recorded elsewhere. Filter, search, export CSV.
  - *Budget vs actual* — every line of every tournament plus MGA-level lines, with variance.
    Use + on a line to record money against it. Once a line has ledger entries, its actual
    comes from them (the typed "Actual $" field shows the ledger total instead).
  - *Reconcile* — upload the bank's activity export (CSV, Excel, or OFX/QFX). Re-uploads and
    overlapping statements are de-duplicated. Suggested matches: same check #, same amount and
    name, nearest date, and one deposit made of several payments. Accept, Find (tick one or more
    entries that add up), Add to books, or Set aside (transfers). Shows bank vs book balances,
    deposits not yet made and checks not yet cleared, and checks the bank's own running balance.
- **Season net (projected):** actual net for tournaments that are over (marked Complete, or past
  their last day) plus budgeted net for upcoming ones, plus MGA-level budget lines.
- **Sync:** last write wins, saved ~0.7s after an edit; open devices update live.
  Own saves are recognized and not echoed back.
- **Backups:** sidebar → Backup / Restore (JSON of everything).

## Later

- Microsoft 365 sign-in per board member (Supabase Azure provider).
- Golf Genius sync for members and signups (needs API access from Golf Genius).
