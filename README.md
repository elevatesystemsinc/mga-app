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

No Supabase access? Download a backup from the current app (⋯ → Backup all data)
and choose it when the import asks.

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
- **Sync:** last write wins, saved ~0.7s after an edit; open devices update live.
  Own saves are recognized and not echoed back.
- **Backups:** sidebar → Backup / Restore (JSON of everything).

## Later

- Microsoft 365 sign-in per board member (Supabase Azure provider).
- Golf Genius sync for members and signups (needs API access from Golf Genius).
