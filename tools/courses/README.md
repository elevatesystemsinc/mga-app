# The course library — bulk import

`import_courses.py` builds rows for the `courses` table (the portal's **Courses → Import JSON** takes its output as is).

- **GolfCourseAPI** (`GCA_KEY` in the environment; never commit the key): the scorecard — par, stroke index and yardage per hole per
  tee, course rating and slope for men and women. Searched by name only.
- **OpenStreetMap** (free, ODbL): the list of courses in an area, and the tee-to-green hole lines GameCast draws when mappers have
  entered them (kept only when all 18 are found for a single-course club).

```
export GCA_KEY=…
python3 tools/courses/import_courses.py search "Walnut Creek Country Club" > rows.json
python3 tools/courses/import_courses.py area dfw > dfw.json           # the Dallas–Fort Worth box
python3 tools/courses/import_courses.py area 32.55,-97.55,33.25,-96.45 > rows.json
python3 tools/courses/import_courses.py ids wyprnm6v 0ad9mavs > rows.json
```

Every imported row is **unverified**. Walnut Creek's own cards came through the API identical to the printed scorecard and rating
card, but a club's card changes (re-ratings, new tees), so tick **Verified** in the portal only after checking the card that matters
against the printed scorecard or the USGA course rating database. A stroke-index row the source lacks comes in as 1–18 with a note.
