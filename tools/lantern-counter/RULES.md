# Lantern Summer-Counting Rules

Goal: for each camper, count the number of **distinct summers (calendar years)** in which they
had at least one valid registration at Camp Colman. A camper's count comes entirely from the
`ReservationHistory` column of the roster export.

## Parsing

- `ReservationHistory` is a multi-line field. Each line is `M/D/YYYY <session title>`
  (date = session start date).
- **The season/year for a registration is the year of the line's date**, not the title.
  (Older titles have no year prefix; where both exist they always agree — verified, 0 mismatches.)
- Lines that don't match the `date + title` pattern are ignored.

## One registration per summer

Only **one** registration counts per calendar year: the **earliest-dated valid registration**
in that year. Additional sessions in the same summer never add to the count.

The count = number of distinct years with at least one valid registration.
Registration alone is sufficient — attendance/cancellation is not tracked in this data
(confirmed acceptable).

## What counts as a valid registration

A session title is **valid** if it is a Camp Colman overnight summer session, identified by a
**lettered** session code (A–H, doubled letters like AA/EE/HH, or letter+digit like A1/C1/E1),
in any of these programs:

- Traditional Camp (incl. "Colman Traditional Camp", "Traditional Extended",
  grade-restricted variants like "Grades 1 and 2")
- Mini Camp / All Gender Mini Camp (Sessions AA, EE, HH) — incl. the 2019
  "Mini Session - Traditional Camp"
- Teen Camp (Session G historically, Session C in 2025)
- Leadership Development Institute (LDI) and Advanced LDI (ALDI) — lettered sessions only
  (e.g. A1, C1, D1, E1, F1)

Legacy title formats count too: `Session B - Traditional Camp`, `A - Traditional Camp`,
`H - Traditional` (no year prefix — year comes from the line date).

## What does NOT count

- **Family Camp** — any variant: weekend, summer, Labor Day, holiday, "Exceptional Families",
  Cornet Bay, Camp Terry, whether Colman or Orkila.
- **Camp Orkila (sister camp)** — anything naming Orkila, plus all **numbered** sessions
  (`Session 1`–`9`, incl. `2A`/`3A`/`7A`): Traditional Seekers / Explorers / Challengers,
  numbered LDI w/ Kayaking, High Altitude Leadership, San Juan Kayaking, Outdoor Adventures,
  Art Exploration, Olympic Challenge, etc.
- **BOLD & GOLD / expedition trips** — any title with BOLD or GOLD, plus the unlabeled
  "All Gender" expedition titles (Sea to Summit, Olympic Challenge, Olympic Coastal
  Backpacking).
- **Day Camp** — "Week N ..." titles, incl. "(L)" and "(Day Camp)" variants.
- **Events / non-sessions** — open houses, virtual orientations, Values Awards Ceremony,
  YESC events/waivers, cabin rentals, First-Time Camper Events, Women's Wellness Weekend,
  Holdover Nights (between-session stays, e.g. "Holdover Night for Sessions F-G").

## Classification order (as implemented)

1. Exclude if title contains: family camp / families, Orkila, BOLD/GOLD, day camp / "Week N",
   event keywords (open house, orientation, values awards, YESC, cabin rental,
   first-time camper, wellness weekend), or the three unlabeled "All Gender" expedition titles.
2. Exclude if session code is numbered (`Session <digit>...`).
3. Include if session code is lettered (`Session [A-H]{1,2}\d?`), a bare-letter legacy title
   (`A - Traditional ...`), "Mini Session", or "Mini Camp" (valid regardless of session
   letter, e.g. "Session I - Mini Camp").
4. Anything else → flag for manual review (currently nothing in the data hits this).

## Lantern threshold

A camper is a lantern in their **5th distinct summer** — the current summer counts, so a
camper attending their 5th summer right now is a lantern this week. (The tool just returns
the count; the threshold is applied by staff.)
