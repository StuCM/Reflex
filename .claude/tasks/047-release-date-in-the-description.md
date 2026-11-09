---
id: 047
slug: release-date-in-the-description
status: approved
branch: crew/047-release-date-in-the-description
model: sonnet
env: laptop
rounds: 0
work: browse-polish
files:
  - src/screen/showpage.ts
  - types/plex.d.ts
  - dev/library.js
  - dev/smoke/show.js
---

# The series page says which year the season is from

## Goal
The series page's meta line names the year of the season being looked at,
not the year the show began. The film page already shows the film's year.

## Why now
Stuart, 2026-11-09: "add the date a movie or show came out to the
description" — "just the year, date of season".

## Existing work
None. 044 (running) touches `types/plex.d.ts`; this adds one field there.

## Background
- Film page: the year is already a chip (`chipNodes`, `src/screen/detail.ts:785-797`).
  **Assumed sufficient**; this task does not touch the film page.
- Measured 2026-11-09 on both real servers: season items carry **no `year`**
  (Octonauts, every season). Episodes carry `originallyAvailableAt`
  (`YYYY-MM-DD`). So a season's year is its first episode's air year.

## Constraints that bite here
- No stray separator when there is no year.
- Assert on positive rendered text (CLAUDE.md, Testing).

## Approach
1. `types/plex.d.ts` `PlexItem` (l.110): `originallyAvailableAt?: string`.
2. `src/screen/showpage.ts:89` `paintHeader`: the year bit is the year of the
   first loaded episode of the current season (`episodes[0].originallyAvailableAt`,
   first four chars), falling back to `show.year`. Call `paintHeader` again
   when `loadEpisodes` (l.~464) lands and when the season changes.
3. Mock `dev/library.js` (~l.790): make sure two seasons of one show have
   episodes aired in different years, and the show's `year` differs from the
   later season's.
4. Smoke `dev/smoke/show.js`: on that show, the meta line starts with season 1's
   year; move to the later season and it starts with that season's year.

## Out of scope
- The film page. Full dates. Episode dates.

## Definition of done
- [ ] Moving between seasons changes the year on the series page meta line to that season's first episode's year (smoke step, asserting both years).
- [ ] A show whose episodes have no date shows the show's year, with no stray `·`.
- [ ] the gate passes (`crew gate .claude/tasks/047-release-date-in-the-description.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
