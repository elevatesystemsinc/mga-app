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

**Push back to the current app:** on an imported tournament, **Push to current app** (header or
Verify tab) sends the hub's edits to the Member-Member app so the board can keep using it. It shows
every total before and after, checks the result matches the hub, downloads a backup of the current
app's data first, and only replaces that year (other years, outreach and event info stay). If someone
edited that year in the current app since the hub's copy was taken, it warns and names the changes —
re-import first to keep both. The current app holds one catered menu and three income lines, so
anything beyond that is listed in the preview before you push.

No Supabase access? Download a backup from the current app (⋯ → Backup all data)
and choose it when the import asks.

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
  or "every player"), plus catered menus (line items + tax & service %). Tournament-
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
