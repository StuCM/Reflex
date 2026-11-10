---
id: 060
slug: new-and-coming-is-kids-cinema
status: approved
branch: crew/060-new-and-coming-is-kids-cinema
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - src/core/config.ts
  - src/api/tmdb.ts
  - test/tmdb.test.ts
  - dev/mock-tmdb.js
---

# New and coming is the family films coming to UK cinemas

## Goal
The Kids page's New and coming row lists family films opening in UK cinemas
in the next six months, most popular first — not every Family-or-Animation
title worldwide from tomorrow on.

## Why now
Stuart, 2026-11-10, on the TV: "new and coming is a strange list of shows not
kid related". Approved: "Fix and deploy".

## Background
- Today: `kidsCategories` New and coming (`src/core/config.ts:47`) is
  `kind: 'upcoming', params: { with_genres: '10751|16' }`; `catalogue`'s
  `upcoming` branch (`src/api/tmdb.ts`) adds `primary_release_date.gte: today`
  and `sort_by: primary_release_date.asc`. Measured 2026-11-10: 364 results
  led by a French cooking film, a dog-judo documentary, Korean shorts.
- Measured 2026-11-10, the query this task builds:
  `/discover/movie?with_genres=10751&region=GB&with_release_type=3&primary_release_date.gte=<today>&primary_release_date.lte=<today + 6 months>&sort_by=popularity.desc`
  → 153 results: Hexed, Sonic the Hedgehog 4, The Angry Birds Movie 3,
  Ice Age: Boiling Point, Narnia: The Magician's Nephew, Diary of a Wimpy
  Kid Christmas, Way of the Warrior Kid.

## Approach
1. `src/core/config.ts`: New and coming `params: { with_genres: '10751',
   region: 'GB', with_release_type: 3 }`, still `minVotes: 0`, still no
   certification filter.
2. `src/api/tmdb.ts` `upcoming` branch: `primary_release_date.gte` today,
   `primary_release_date.lte` today plus six months (YYYY-MM-DD, local date
   arithmetic, no libraries), `sort_by: popularity.desc`.
3. `test/tmdb.test.ts`: update the upcoming test to assert exactly those
   parameters (gte today, lte six months on, popularity sort, GB, release
   type 3, genre 10751 only, no certification), and that a zero-vote result
   is still kept.
4. `dev/mock-tmdb.js`: only if the smoke's upcoming film needs the new params
   to be answered; keep "Coming Soon Kids Film" served.

## Out of scope
- The other Kids rows. The index.

## Definition of done
- [ ] The upcoming request carries the parameters above (unit test).
- [ ] Existing Kids smoke steps pass (New and coming still opens the unheld film's page).
- [ ] the gate passes (`crew gate .claude/tasks/060-new-and-coming-is-kids-cinema.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
