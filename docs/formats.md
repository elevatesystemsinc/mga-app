# Game formats — how the hub scores and handicaps them

This is the reference for every format the hub offers for tournaments, golf events and small-group games, and
exactly how team scores and handicaps are worked out for solo play and for 2-, 3-, 4-, 5- and 6-player teams.
The engine that implements it is `src/golfcore.js` (shared by the hub and the public scoring page); the unit checks
are `tests/test_formats.js`.

## The game library

`GAME_CATALOG` in `golfcore.js` is the list the pickers draw from: every game below, grouped as Individual, Match play,
Team · own ball, Team · one ball, Side games and Partner draws. The **club hub → Game library** switches entries on or
off for every association and small group. Beyond the formats in the tables below it adds:

| Game | How it is scored |
|---|---|
| **Maximum score** | Stroke play with each hole capped at net double bogey (par + 2 + strokes received). |
| **Chicago** | Quota from 39 instead of 36 (same point table). |
| **Nassau** | A singles match scored as three bets: front nine, back nine and the eighteen, one point each. |
| **Hi-Lo** | Two against two, two points a hole: the better low ball and the better high ball. |
| **Reverse waltz match** | Team against team (any size, and the teams may be in different groups), Nassau points for the front, back and 18. Each hole counts the best three balls, then two, then one, repeating by hole number; holes 9 and 18 count every ball. Sides play off the low man. |
| **Team Nassau** | The same match on best ball of each side. |
| **Foursomes match play** | Alternate shot, one ball per side off the team handicap (50% of combined), hole by hole. |
| **Cha-cha-cha** | Best ball with 1, 2, 3 balls counting on successive holes, repeating. |
| **1-2-3 by par** | One best ball on par 3s, two on par 4s, three on par 5s. |
| **Yellow ball** | A designated ball rotates through the team (player 1 on hole 1, player 2 on hole 2…) and must count on its hole, plus the best of the rest. |
| **Florida scramble** | A scramble by another name; scored like one. |
| **Chapman / Pinehurst** | Scored as a greensome (60% low + 40% high). |
| **Dots / Doodah / Garbage** (side game) | Birdies and eagles are counted from the scores; sandies, greenies, chip-ins and the like are tallied by the group. Pot ÷ dots. |
| **Blind-draw partners** (side game) | Everyone plays their own ball; partners are drawn afterwards and scored as best ball. |
| **Low gross / low net pot** (side game) | An individual stroke-play pot alongside a team game. |
| **Closest to the pin · Long drive · Hole-in-one** (side games) | Winners entered by the committee. |

**Partner draws** (Golf → event → Field → Draw partners, or a game's Live scoring card): random; ABCD (the field split
into handicap tiers, one player drawn from each tier per team); balanced snake by handicap. Before the round the groups
are then built around the teams; after the round the draw is scored from the individual rounds, so partners can sit
in different groups.

## Handicaps: the three numbers

| Number | How it is worked out |
|---|---|
| **Handicap Index** | From the player's profile (GHIN / Golf Genius import), or typed for the event. Plus handicaps are entered as `+1.2`. |
| **Course Handicap (CH)** | WHS: `Index × Slope ÷ 113 + (Course Rating − Par)`, rounded (.5 up). Uses the player's tee and the men's or women's rating of the course they play. |
| **Playing Handicap (PH)** | `CH × allowance %`, rounded. The allowance depends on the format (table below). Strokes fall on the holes by stroke index: PH 7 = one stroke on index 1–7; PH 23 = one on every hole plus a second on index 1–5; a plus handicap gives strokes back from index 18 down. |

Default allowances follow the **USGA Rules of Handicapping, Appendix C**. Where the USGA publishes none (5- and
6-player scrambles, 3-player best ball, shamble, quota, skins) the default is a common club setting and is marked
*club default*. Every allowance is editable per event, and the printed scorecard states the allowances used.

## Individual formats (teams of 1)

| Format | What counts | Ranking | Default allowance |
|---|---|---|---|
| **Stroke play** | Gross or net strokes for the round. | Fewest strokes (to par for holes played while live). | 95% |
| **Stableford** | Points per hole on net score vs par: albatross 5, eagle 4, birdie 3, par 2, bogey 1, worse 0. | Most points. | 95% |
| **Modified Stableford** | Points per hole: albatross 8, eagle 5, birdie 2, par 0, bogey −1, double bogey or worse −3 (the pro-tour table). Net or gross. | Most points. | 95% |
| **Quota** | Gross points per hole (albatross 16, eagle 8, birdie 4, par 2, bogey 1) against a personal quota of **36 − PH**. Result = points − quota. | Highest result (plus or minus). | 100% *(club default)* |
| **Par / Bogey** | Each hole is won, halved or lost against net par: +1 / 0 / −1. | Best total (e.g. +3 beats −1). | 95% |
| **Match play (singles)** | Two players in a group play hole by hole; the better net score wins the hole. | Match status (3&2, 1 up, AS); standings count a win as 1 point and a halve as ½. | 100% of the **difference**: the lower PH plays off scratch, the other gets the difference on the hardest holes. |
| **Skins** (side game on any individual event or game) | A hole is won outright by the lowest score among everyone in the skins game. Options: gross or net; ties carry over; gross beats net (a tied net score goes to the one player who made it without a stroke); validation (par or net par on the next hole, or the skin is void). | Skins won; pot ÷ skins = value of one skin. | Net skins use the players' full PH. |

## Team formats

A team has 2–6 players. Within a group, players are assigned to teams (A, B, …); a group can hold one team, or
two teams playing against each other. Where a format says "best ball", every player plays their own ball and the
team's score on a hole is the best (lowest net or gross) of the balls that count.

| Format | Team size | What counts on a hole | Team handicap / strokes | Default allowance |
|---|---|---|---|---|
| **Best ball** (four-ball when 2-player) | 2–6, count 1 to size−1 balls | The best *k* of the team's net scores, added together. | Each player's own PH; strokes on their own card. | 1 of 2: 85% · 2 of 3 and 1 of 3: 90% / 80% *(club)* · 1 of 4: 75% · 2 of 4: 85% · 3 of 4: 100% · 1 of 5–6: 75% *(club)* · 2 of 5–6: 85% *(club)* · 3+ of 5–6: 100% *(club)* |
| **Aggregate** | 2–6 | Every player's net score, added together. | Each player's own PH. | 100% |
| **1-2-3 best ball** | 4 | One best ball on holes 1–6, two on 7–12, three on 13–18 (by hole number). | Each player's own PH. | 100% *(club default; many use 1 of 4 = 75% on the first six)* |
| **Scramble** | 2–6 | One team score per hole (everyone plays from the best shot). | One **team PH** = weighted sum of the players' CHs sorted low → high, rounded; the team's strokes fall on the team card by stroke index. | 2: 35/15 · 3: 30/20/10 · 4: 25/20/15/10 (USGA) · 5: 20/15/10/5/5 · 6: 15/12/9/6/3/3 *(club defaults)* |
| **Shamble** | 2–6, count 1 to size−1 | Team drive, then everyone plays their own ball in; the best *k* net scores count. | Each player's own PH. | 1 of 2: 85% · otherwise the best-ball table *(club default; the USGA publishes none)* |
| **Foursomes (alternate shot)** | 2 | One ball, partners alternate shots; one team score per hole. | Team PH = **50% of the partners' combined CH**; strokes on the team card. | 50% combined |
| **Greensome / Chapman (Pinehurst)** | 2 | Both drive, pick one, then alternate (Chapman: play each other's drive, then pick). One team score per hole. | Team PH = **60% of the lower CH + 40% of the higher**. | 60 / 40 |
| **Team Stableford** | 2–6, count 1 to size−1 | Each player's Stableford points on the hole; the best *k* count. | Each player's own PH. | 1 of 2: 85% · 2 of 4: 85% · otherwise the best-ball table |
| **Four-ball match play** | 2 v 2 | Each side's best net ball on the hole; the better side wins the hole. | 90% of each player's CH, then every player in the match plays off the lowest: strokes = PH − lowest PH. | 90% |
| **Foursomes match play** | 2 v 2 | Alternate shot; one score per side. | 50% of combined CH per side; the higher side gets the difference. | 50% combined |
| **Front & back differ** | any | Holes 1–9 one team format, 10–18 another (e.g. scramble out, shamble in). | Each nine uses its own format's handicap rules. | per format |

Totals and ranking: strokes formats rank by fewest (to par while the round is live, both courses combined);
points formats rank by most; par/bogey by best holes-up total. Ties share a position (T2). A team's "thru" is the
holes on which it has a counting score.

### Team-size notes

- **Solo (1):** every individual format; match play pairs the two players in a group.
- **2-player:** four-ball (best 1 of 2), aggregate, scramble 35/15, shamble, foursomes, greensome/Chapman, team
  Stableford, four-ball or foursomes match play. A group of four holds two teams.
- **3-player:** best 1 or 2 of 3, aggregate, scramble 30/20/10, shamble, team Stableford. Groups of three or six.
- **4-player:** best 1, 2 or 3 of 4, aggregate, 1-2-3 best ball, scramble 25/20/15/10, shamble, team Stableford.
  One team per group.
- **5- and 6-player:** best 1–4 (or 1–5) of the team, aggregate, scramble (club defaults above), shamble, team
  Stableford. A team is its own group (the scoring page supports up to six players in a group).

### Worked examples

- *Four-ball, net.* Ann CH 6 → PH 5 (85%); Bo CH 20 → PH 17. Hole with stroke index 4: Ann makes 5 (net 4), Bo 6
  with a stroke (net 5). Team score 4.
- *Scramble, 4 players, CHs 4 / 9 / 15 / 22:* team PH = 4×25% + 9×20% + 15×15% + 22×10% = 1 + 1.8 + 2.25 + 2.2 =
  7.25 → **7**. The team gets a stroke on stroke index 1–7.
- *Foursomes:* CHs 8 and 14 → team PH = 50% × 22 = **11**.
- *Greensome:* CHs 8 and 14 → 60% × 8 + 40% × 14 = 4.8 + 5.6 = **10** (10.4 rounded).
- *Singles match:* PH 5 v PH 12 → the second player gets 7 strokes, on stroke index 1–7.
- *Quota:* PH 10 → quota 26. Points: 10 pars (20) + 3 birdies (12) + 5 bogeys (5) = 37 → **+11**.
- *Stableford, net:* par 4, player makes 5 with a stroke → net 4 → 2 points.

## Where formats appear in the app

- **Golf → scoring event → Details:** format, team size, balls that count, scoring basis (gross / net), allowances
  (editable, with the USGA default one click away). Groups and the printed scorecards, the public scoring page and
  the leaderboards all follow the event's format.
- **Tournaments:** a tournament's scoring event carries the format; the field's teams come across as the teams.
- **Small groups → Games:** a game is any number of competitions on one own-ball round, each a catalog entry with
  its own entry, players and payout places — stroke play, a best ball with partners picked, drawn before or drawn
  after the round, skins (one pot ÷ skins won, with gross/net, gross beats net, carry-overs and a validation standard
  of par, net par, bogey or net bogey on the next hole), dots / doodah, or winners entered by hand. Only a one-ball
  game (scramble, foursomes, greensome) changes how the round is played.
