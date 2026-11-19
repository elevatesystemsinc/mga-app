# Budgeting — how the money works, for an association and for a nonprofit

The owner, Nov 2026: "make a polish and optimization pass on the functionality of budgeting for nonprofits, in particular DCO…
build this to be a true budgeting tool… this budgeting tool should work between organizations, for instance the Walnut Creek
MGA, as well as nonprofits." This is the breakdown of the whole money side as it stands after that pass, what changed, and
what the next phase should be.

## 1. The shape: one year, several programs, one set of books

Every organization — the MGA, the LGA, a small group, a nonprofit — budgets the same way:

```
the year (an association's season, a club's or nonprofit's calendar year)
├── programs
│   ├── tournaments          Golf → Tournaments → a tournament's Budget tab   (tcalc)
│   ├── fundraising events   Fundraising → an event's Budget tab              (fundPlan / fundTotals; the club tier only)
│   └── organization-level   Budget page → "<Organization>-level money"      (season lines: dues, rent, insurance, a grant…)
├── the roll-up              Budget page (scalc) · Treasury → Budget vs actual (budgetRows)
└── the books                Treasury → Ledger (bookEntries) · Reconcile (the bank statement)
```

Every line of every program has a **budget** and an **actual**. The actual comes from one of three places, in this order:
1. the Treasury ledger, once any entry is **linked** to the line (`ledgerIndex` / `actualOf`: the sum of linked entries);
2. what the program records on its own (entries paid, sponsor payments logged, seats taken, auction wins, raffle tickets, gifts);
3. the number typed on the line.

The **projection** for the year takes the actual of every program that is past and the budget of every program still to come
(`scalc.projected`), plus the organization-level lines at budget. That is the number on the dashboard and the Budget page.

## 2. Tournaments (every organization) — `tcalc(t)`, the tournament's Budget tab

| Line | Budget | Actual |
|---|---|---|
| Entry fees | players × entry fee (`plannedPlayers`, or the field when *Budget basis* is the field) | ledger entries linked to Entry fees, else `t.actuals.entryFees` |
| Skins / day money | players × skins fee, paid back out as a payout line | ledger, else typed |
| Sponsors | Σ pledged (Sponsors tab: tiers, pledged, **payments logged per sponsor**) | Σ payments received |
| Other income lines | typed (`t.income`; one may be marked the season's 50/50 drawing) | ledger, else typed |
| Meals & events, by day | qty × unit (qty can follow the player count) | ledger, else typed |
| Per-player items | players × per-player cost | ledger, else typed |
| Tournament-wide lines | typed, grouped | ledger, else typed |

For a nonprofit a tournament starts with sponsors, a budget and the 50/50 on, the Calcutta off (`NONPROFIT_FEATURES`), and every
tournament gets a fundraising event of its own (`fundForTournament`), so its money is on the Fundraising page and in the year.

**DCO's case.** Data Center Open is one tournament a year. Its revenue is sponsorship packages (Title, Presenting, Gigawatt,
Megawatt, Kilowatt, Registration, Breakfast, Lunch, Beverage cart, Cocktail hour, Lanyard…), most of which include player
spots; the entry fee on the tournament is $0 and the players come through the packages. Its expenses are the venue and golf
(TPC Sawgrass), food and beverage, swag, printing and the check to PGA HOPE. In the tool that is: tiers with a default amount
→ sponsors pledged / received on the tournament's Sponsors tab; Meals & events for the agenda with unit costs once the venue
quotes; tournament-wide lines for swag and printing; **the check to the beneficiary is an organization-level expense line**
(Budget page → Add Organization line: "Grant to PGA HOPE"), because it is the year's purpose, not the tournament's cost.

## 3. Fundraising events (the club tier, module `events`) — `fundPlan(e)` / `fundTotals(e)`, the event's Budget and Money tabs

An event is the evening: tickets and tables, sponsors and levels, the silent and live auctions, raffles, donations (the
paddle raise), checkout by paddle. Its money, stream by stream:

| Stream | Plan | Actual ("raised": what is committed) | Collected (cash in hand) |
|---|---|---|---|
| Tickets | typed; until then **the seats on offer × their price** (ticket types with a quantity) | seats taken × price | checkout payments |
| Sponsors | typed | Σ pledged (levels; **payments logged per sponsor**, like a tournament's) | Σ sponsor payments |
| Silent auction | typed | the high bid per item at or over its reserve | checkout payments |
| Live auction | typed | lots sold by paddle | checkout payments |
| Raffles | typed | tickets sold × price | checkout payments |
| Donations | typed | gifts recorded | checkout payments |
| Golf tournament | **the linked tournament's own budget** | the tournament's actual revenue | its sponsor payments and entries |

Expenses are **one list with a budget and an actual per line** (`e.expenses[]`: name, budget, actual, note). The Budget tab shows
budget / actual / variance; the Money tab shows what was spent and how much was collected, by method. An expense's actual follows
the Treasury ledger once money is recorded against the line (the **+** on Budget vs actual), else the number typed on it.

**A fundraiser with a golf tournament** (Battle of the Nines by day, the gala that night; DCO's tournament day): the event's
Budget tab shows the tournament's lines first (read there, edited on the tournament), then the evening's; **the sponsors are
one list — the tournament's** (the event's Sponsors tab renders it; the public page shows the tournament's tiers as the levels);
the thermometer and the goal count both. On the year's books the tournament is counted under Tournaments and the event
counts only the evening (`{own:true}`), so nothing is counted twice. A golf-day event's tabs lead with Sponsors · Budget · Money.

## 4. The roll-up and the books

- **Budget page** (`vBudget`): the tournaments table, the organization-level lines (dues for an association), the fundraising
  events card, three KPIs (budgeted revenue, budgeted expenses, projected net), **Budget vs actual PDF** and **CSV** for the year.
  The copy is per organization kind: a nonprofit reads "Annual budget … every tournament and fundraising event of the year";
  no page says "MGA" to anyone but the MGA.
- **Treasury → Budget vs actual** (`budgetRows(y)` → `xBva`): a card per program — every tournament, every fundraising event,
  the organization-level lines — with budget, actual, variance and the **+** that records money straight against a line. The
  same `budgetRows` feeds `budgetPDF(y)` (letterhead, the summary, every program's lines) and `budgetCSV(y)`.
- **Treasury → Ledger** (`bookEntries`): everything the books say happened — ledger entries, tournament sponsor payments, dues
  payments, and now **an event's checkout payments and its sponsors' payments** — each with its budget line, cleared or open
  against the bank. **Reconcile** matches the bank statement to these.
- **Dashboard**: projected net for the year (tournaments + events + organization lines), sponsor money received of pledged
  (tournaments + events), the thermometers of the year's events with a goal.

## 5. What this pass changed (Nov 2026)

- Fundraising events are **programs of the year**: `scalc` counts their plan, actual and projection; their streams and expense
  lines are linkable budget lines (`fund:<event>|fstream|<stream>`, `fund:<event>|fexp|<line>`); their money is in the ledger.
- The event's two expense lists (planned on the Budget tab, actual on the Money tab, nothing tying them together) became **one
  list with budget and actual per line**; old documents fold in by name on load (`normFundEvent`).
- Event sponsors carry **payments** (pledged / received, method, check #, date) instead of a Paid tick; a ticked sponsor becomes
  one payment on load. Collected = checkout payments + sponsor receipts, everywhere it is shown.
- A linked tournament's sponsors are the event's sponsors — one list, one set of tiers, on the event page too.
- The ticket plan defaults to the seats on offer × their price (a basis the organizer can read), until a figure is typed.
- `budgetRows(y)`, the **Budget vs actual PDF** and **CSV**, the Budget page's PDF / CSV buttons.
- Organization-neutral copy ("Organization-level" on the club tier, the short name on an association or a group; the ledger
  CSV named after the organization); nonprofit wording on the Budget page; no Board card on a nonprofit's dashboard.

## 6. The next phase — what a sellable budgeting tool still needs (to confirm with the owner)

1. **Categories (a chart of accounts).** Every line — tournament, event or organization-level — tagged with a category, so the
   year rolls up *by category* as well as by program: for a nonprofit Sponsorships · Player entries · Tickets · Auctions ·
   Raffles & games · Donations & grants · Sales, against Golf & venue · Food & beverage · Production · Prizes & gifts ·
   Printing & marketing · Grants & program · Administration; for an association Dues · Entry fees · Sponsorships · 50/50,
   against Golf & course · F&B · Prizes & payouts · Printing · Administration. Seeded per organization kind, editable, the
   default per line kind (a Meal item → F&B, a sponsor → Sponsorships) with an override per line. The Budget page and the PDF
   get a "By category" section; the IRS Form 990 functional split (program / fundraising / management) is one more tag away.
2. **Monthly phasing and cash flow.** A budget line may be spread over months (or dated: a venue deposit 90 days out); the
   ledger is already dated, so the year gets a month-by-month budget vs actual and a cash position.
3. **Prior year beside this year.** Every budget table with a "Last year actual" column; **Start next year from this year**
   (tournaments already have *Start from*; events and the organization lines would get it).
4. **Sponsorship packages with player spots** (DCO): a tier carries the foursomes it includes; the field fills from the
   sponsors; a package's value splits into the sponsorship and the golf for the acknowledgement's fair-market-value line.
5. **Invoices and online payment for sponsors and tickets** (the member-account payment layer, Trinity Merchant Group once it is built, is the one to reuse): an invoice PDF per
   sponsor from the tier, a pay link, the receipt into the ledger on its own.
6. **Reports a board expects**: the year-end statement of activities (revenue by category, expenses by category, net), a
   per-event P&L one-pager, the sponsor list with status — all from `budgetRows` plus categories.

Items 1 and 3 are the structural ones; 2, 4, 5 and 6 build on them.
