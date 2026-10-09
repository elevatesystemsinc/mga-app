# Club Hub

The hub for Walnut Creek Country Club and the organizations inside it. It began as the MGA Hub
(members, board, every tournament with its meals, events, field, sponsors and budget, the season budget,
the Calcutta, check-in, the 50/50 drawing, live scoring) and is growing into a club-wide hub with three tiers:
the **club** (master member directory, club-run tournaments), **associations** (MGA, LGA, SMGA — each with its
own hub) and **small groups** (a roster, games with entry fees and payouts, live scoring, a money-game ledger).

One static `index.html` (plus the cashier, check-in and scoring pages), Supabase, Render. The hub keeps its
own table (`mga_hub`), one row per organization.

## Branches and sites

- `main` → **app.wcccmga.org** — the club hub, the product going forward. The club is at `/`; each organization has its
  own address: `/mga`, `/lga`, `/smga`, and `/<id>` for a small group. (Render: one Rewrite rule, `/*` → `/index.html`.)
- **hub.wcccmga.org** — the MGA's address. Served from `main` as well (bare host = the MGA hub, `/club` = the club
  hub), once the Render site for that domain is switched from the old `Hub` branch to `main`; until then it runs the
  old MGA Hub code against its own row, kept in two-way sync (below).

The MGA's hub on app.wcccmga.org and hub.wcccmga.org show the **same data**: the two are kept in two-way sync while
anyone has the club hub or the MGA hub open (every half minute, and right after a save). An edit on either site
reaches the other, edits to different things never collide, and when the very same field is changed in both places
the later save wins. The sidebar shows "MGA Hub in sync" with the time of the last pass and a *Sync now* link.

## Organizations and members

The **club hub** keeps the **Directory** (every club member, one record each — import the club software's export, or
add people by hand) and the list of **Organizations**: associations (MGA, LGA, SMGA) and small groups, each with its
own hub. An organization's **Members** page is the club members who belong to it: add one from the directory, import
the organization's own list (club members are matched and joined; new people are added to the directory too), and keep
status, join date, notes and dues per organization. Editing a person's details anywhere updates the directory.

## Live scoring, always

Every tournament round and every small-group game has an open scoring event the moment it exists — nothing to switch
on. A tournament's rounds are suggested from its length and team size (change them under Rounds & results), the field
flows into each round's event as players sign up, and the Golf page, the scoring link and the leaderboard are ready
from day one. The sidebar and dashboards show the leaderboards of events happening today.

## Rounds & results

Each tournament declares its rounds — one or more per day, each with a format (a day can be scramble on the front
and shamble on the back, the next day best ball). **Create scoring events** builds the live-scoring events from the
field in one click, teams and all; later days copy the first day's flights, and groups can be copied too. **Results**
total every round per team or player, overall and by flight, print to a branded **results sheet (PDF)**, and can be
sent to the Calcutta as finishes. **Flights** are set once per tournament by combined Handicap Index (with the optional
partner handicap differential cap, e.g. 10 strokes: a +2 and a 12 play as +2 and 8) and pushed to every round; day one
groups are built by handicap, later days **paired by the standings** (leaders off last with tee times, on hole 1 for a
shotgun), and every group stays editable. Tournament
details has checkboxes for which tabs a tournament uses: the Calcutta, sponsors, meals, checklist and the 50/50 drawing
are optional; registration, check-in and rounds are always there.

## Game library

The club hub's **Game library** lists every game the hub can score — stroke play, maximum score, Stableford and modified,
quota and Chicago, par/bogey, singles, Nassau, four-ball, Hi-Lo and foursomes match play, best ball of any size,
aggregate, 1-2-3, cha-cha-cha, 1-2-3 by par, yellow ball, shamble, team Stableford, scramble and Florida scramble,
foursomes, greensome, Chapman, a front/back split, and the side games (skins, dots, closest to the pin, long drive,
low gross/net pots, blind-draw partners, hole-in-one) plus random, ABCD and balanced partner draws — and lets the club
switch any of them off for its associations and small groups. **Draw partners** on an event (or a game) draws teams
before or after the round.

## Formats

Scoring events (and small-group games) support stroke play, Stableford, modified Stableford, quota, par/bogey, singles
and four-ball match play, best ball (any 1 to size−1 balls of a 2- to 6-player team, or 1-2-3), aggregate, scramble
(2–6 players), shamble, foursomes, greensome/Chapman, team Stableford, and a front/back split. Allowances default to
the USGA tables (club defaults where the USGA has none) and are editable per event. `docs/formats.md` spells out every
format's team score and handicap math, with worked examples.

## Small groups

A small group's hub is the regular game, and small tournaments when it wants them (the same Tournaments page as an
association, with the Calcutta, meals and the rest switched on per tournament).

**Designing a game.** One screen: the day (date, course, tee time, whether money changes hands before or after the
round, pot or net settlement), the **competitions**, and who's in. A game can run any number of competitions on the
same scores, each with its own entry, its own players and its own payout: stroke play paying three places, a best
ball paying two with partners **drawn after the round**, skins, dots, closest to the pin… Team competitions set how
the partners come about: picked by hand, drawn before the round, or drawn after it. **Skins** is one pot for the day
divided by the skins won: a tied hole is nobody's, and a skin that fails validation is lost. Gross or net,
gross-beats-net and the validation standard on the next hole (par, net par, bogey or net bogey) are each a switch;
a per-hole format (the pot split over 18 holes, ties carrying forward) is there for groups that play it that way.
Skins stay off the screen during the round unless you switch "announce live" on; afterwards **Call out the skins**
walks the cards one hole per tap, a skin stays pending until its validation hole comes up, and a failed validation
flashes "Didn't validate" before that hole's result. Every other competition has its own **Show on the live
leaderboard** switch in the designer, and the live scoring page shows one board per competition that is switched on
(dots are tallied by hand and never show). Removing a player, from the game page or the designer, takes them out
of every competition, the scoring event, the leaderboard and live scoring, scores and all. Games are deleted from the designer; deleting a scoring event
that belongs to a game or a tournament round removes that game or round with it. The **who's-in grid** ticks every player into every competition
they want, so nine can be in the skins while eight play the team game. A new game starts from the last one.

**On the day.** Everyone plays their own ball; every competition is scored live from those cards. A team competition
whose partners are not drawn yet shows individual standings until the **drawing**: a full-screen stage that draws
with real randomness, saves the result first, then reveals the teams one at a time. A competition can be added at any point, even after you have teed off: Design, add it, pick the teams ("Teams =
the groups" for a group-against-group challenge) and the standings pick up the scores already on the cards. Two
team matches are built for exactly that: the **reverse waltz match** (Nassau points for the front, back and 18;
each hole counts the best three balls, then two, then one, repeating, with every ball counting on 9 and 18) and a
plain **team Nassau** on best ball. Set what each segment is worth per player and the match is settled segment by
segment. **Groups & handicaps** on the game page: move players between groups, set each group's starting hole or tee time,
pick a player's tee box, and type an index for the day where it differs from the directory. Course and playing
handicaps update on the spot, and the same card works mid-round: correct an index on the 7th tee and the standings,
the leaderboard and every phone scoring the round pick it up within half a minute, no reload needed. The **settlement** shows what
each player put in, pulled out and nets, and for net settlement the fewest payments that square it. The **game sheet
PDF** carries the competitions and denominations, the teams when they are known, and the groups as they play with
each player's strokes. The **Ledger** shows who is up or down for the season or any quarter, with a one-click
settle-up.

**Admin links.** A small group (or an association) can be run without the board password: in the club hub, open the
organization under Organizations and create an **admin link** (`app.wcccmga.org/misfits#key=…`). Whoever opens it gets
that organization's hub — its games, tournaments, members and live scoring — and sees the club directory (they can add
people to it, not change them). Nothing else in the club is reachable with the link, it works on the device it was
opened on until "Leave this hub", and the club can revoke it at any time. Run `admin-links-setup.sql` once to turn
this on.

## Dues collected by the club

The club charges no dues of its own. An association sets its dues (Members → Dues settings), and new members are
billed automatically; **Bill dues** bills everyone who still owes (full year or an installment). Each bill goes to the
club hub's **Dues collection** page: the club exports the open charges for its billing software (or ticks them off
one by one), marks them *on account*, and when the money is in marks them *collected* — that records the payment on
the member in the association's books, credited to the association. The club's own budget and treasury never count it.

## The club calendar

The club's Tournaments page and dashboard also list every association's and small group's tournaments — name, dates,
field size and status, with a button into that organization's hub. Their budgets and money stay in their own hubs.

First time on a database the club hub offers **Set up from the MGA Hub**: it builds the directory from the MGA's list,
registers the three associations and copies the MGA Hub's data into the MGA's hub. The club hub's Organizations page can
re-run that import later.

Both use the same Supabase project. Render serves the repo root of each branch; the built pages are committed,
so a push is a deploy (see `CLAUDE.md` for the build).

## Supabase (same project)

SQL Editor → run `hub-setup.sql` (creates `public.mga_hub` with RLS and realtime), `calcutta-setup.sql`
(cashier and check-in links), `golf-setup.sql` (live scoring) and `admin-links-setup.sql` (admin links for small
groups and associations). The hub signs in with the shared board login; admin links work without it.

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

### Payout exports

On the Payouts sub-tab: **Spreadsheet** (payouts by person, the detail behind each, and the flights), **Payouts PDF**
(the branded sheet with finishes, team payouts and what each person is owed) and **Winners PDF (no amounts)** — the
same sheet with no dollar figure on it, listing finishes and who should see the cashier, for posting on the board or
online.

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
