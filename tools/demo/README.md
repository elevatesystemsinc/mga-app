# Bushwood Country Club — the demo tenant

`bushwood.flagstickhub.com` is a demo client seeded with about six months of activity (May–Nov 2026) across every module:
a 176-person directory with the Caddyshack cast, three organizations (MGA, LGA, Czervik's Thursday Game), five MGA
tournaments (the Member-Member with its Calcutta, 50/50, sponsors, meals and checklist), 26 group games with payouts and a
live one, member accounts with monthly runs, minimums, statements, payments and late charges, ~2,800 register tickets,
bookings, closed times, staff, shifts, the time clock, surveys and an open registration page.

- `seed_bushwood.js` builds every document and table row **inside the hub page in local mode** with the app's own
  functions (`normalize`, `ensureTournamentScoring`, `compPayouts`, `chargeFor`, …), so the shapes always match the code.
  Deterministic randomness: the same script gives the same data (new ids each run).
- `run_seed.py` runs it under Playwright and writes `seed.json` next to itself.
- `reseed_rest.py` loads `seed.json` into the live project through the REST API **as the demo staff login**
  (`DEMO_PW` in the environment): the four `mga_hub` documents are updated in place, every table is cleared and reloaded,
  survey answers and sign-ups go through the public functions. The tenant row and the login are created once by hand.

```
cd tests && python3 ../tools/demo/run_seed.py        # → tools/demo/seed.json
DEMO_PW=… python3 -I tools/demo/reseed_rest.py       # replace what is in the database
```
Two things still take the SQL console afterwards (no RLS path for them): spreading `survey_responses.day` over the
seeded dates, and dropping a `golf_side` row whose event no longer exists (`fixup2.sql`, written by the reseed).
