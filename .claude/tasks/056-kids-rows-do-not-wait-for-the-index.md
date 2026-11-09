---
id: 056
slug: kids-rows-do-not-wait-for-the-index
status: building
branch: crew/056-kids-rows-do-not-wait-for-the-index
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - src/screen/browse.ts
  - src/data/kids.ts
  - src/api/plex/library.ts
  - dev/server.js
  - dev/mock-plex.js
  - dev/smoke/browse.js
  - test/kids.test.ts
---

# The Kids rows appear without waiting for the index, and survive it failing

## Goal
Opening Kids shows New and coming at once and the other TMDB rows as soon as
the held set is known; a slow or failed index build never leaves the page
with only Continue watching. The index pages are about half the size.

## Why now
Stuart, 2026-11-09, on the TV after 053 shipped: "I could only access a single
row" — "continue watching, down did nothing". No TMDB row appeared at all, not
even New and coming.

## Existing work
None in flight.

## Background
- `loadKids` (`src/screen/browse.ts:1085`) draws Continue watching, then
  starts `discovery.load` **inside** `kids.held().then(...)`. So every row,
  New and coming included, waits for the whole index; and there is no
  `.catch`, so one failed request means no rows ever.
- Measured 2026-11-09 against Apollo: one index page (Movies, Family genre,
  500 items, `includeGuids=1`) is **1.1 MB and ~1.5 s**. A cold build is ~45
  such pages, ~50 MB of JSON for a 2018 panel to fetch and parse. The laptop
  mock answers instantly, which is why the smoke passed.
- Measured: `excludeElements=Media,Genre,Country,Director,Writer,Role` cuts a
  page to ~695 KB; `excludeFields=summary,tagline` a little more; `Guid` is
  still returned. `includeFields` is ignored.

## Graph context
- Servers we do not own: keep the build serial, weekly, off the critical path.
- A smoke step that opens a TMDB title must delete the `tmdb2:` keys it wrote.

## Approach
1. `loadKids`: call `discovery.load` straight away. The `keep` it passes reads
   the current held set: `upcoming` rows are never filtered (already so), and
   while the set is unknown other rows are held back rather than dropped —
   add them when the set lands (re-filter their first page then). A row that
   is empty after filtering is still not added.
2. `kids.held()` rejecting (or any index request failing) must not stop the
   page: catch it, keep New and coming, show a debug line, and leave the held
   rows out. A partial build (some servers or libraries failed) uses what it
   got; the failed parts are retried on the next open, not cached as empty.
3. `src/api/plex/library.ts` / `src/data/kids.ts`: index requests send
   `excludeElements=Media,Genre,Country,Director,Writer,Role` and
   `excludeFields=summary,tagline`.
4. Mock: `dev/server.js` / `dev/mock-plex.js` gain a way to delay or fail the
   index (genre and kids-library listings) on demand, e.g. a query flag or an
   option the smoke can set.
5. Smoke `dev/smoke/browse.js`: with the index slowed (several seconds), Kids
   shows New and coming before the index finishes, and the held rows appear
   after; with an index request failing, Kids still shows New and coming and
   ▼ from Continue watching moves to it. Run both against `main` and watch
   them fail.
6. `test/kids.test.ts`: a failing library request yields the other servers'
   ids and is not cached as empty.

## Out of scope
- Changing which rows Kids has, or the PG cap. Making the build incremental
  across days.

## Definition of done
- [ ] With a slow index, New and coming is on screen before the index completes (smoke, failing on `main`).
- [ ] With an index request failing, Kids still has New and coming and ▼ reaches it (smoke, failing on `main`).
- [ ] Held rows appear once the set lands.
- [ ] Index requests carry the exclude parameters (assert on the mock's received query).
- [ ] A failed library is not cached as empty (unit test).
- [ ] the gate passes (`crew gate .claude/tasks/056-kids-rows-do-not-wait-for-the-index.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
