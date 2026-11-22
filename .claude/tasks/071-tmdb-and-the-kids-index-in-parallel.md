---
id: 071
slug: tmdb-and-the-kids-index-in-parallel
status: approved
branch: crew/071-tmdb-and-the-kids-index-in-parallel
model: sonnet
env: laptop
rounds: 0
work: v2-data
files:
  - src/data/discovery.ts
  - src/data/kids.ts
  - src/screen/browse.ts
  - src/view/menubar.ts
  - dev/smoke.js
  - dev/smoke/shell.js
  - dev/smoke/discovery.js
  - dev/smoke/browse.js
  - test/kids.test.ts
---

# TMDB rows and the kids index load in parallel, and the menu waits less

## Goal
Discover and Kids ask TMDB for several rows at once (still showing them in
their set order); the kids index reads each server at the same time instead of
one after another; and changing page with the arrows starts loading sooner.

## Why now
Stuart, 2026-11-22: "optimise all calls to minimise requests but at the
fastest speed."

## Existing work
After 070 (same `browse.ts`).

## Background — from the code (scout, 2026-11-22)
- `discovery.load` runs categories strictly one after another (`step()`,
  `discovery.ts:190-198`) "because the rows go to a server we do not own" —
  but these are TMDB, which is not such a server. Cold Discover is ~9 round
  trips, Kids ~7.
- `kids.held()` (`kids.ts:56-85`) walks servers, libraries and genre pages
  serially.
- The menu waits 300 ms after the last arrow before loading
  (`menubar.ts:54, 78-81`).

## Graph context
- Servers we do not own: the kids index stays **one request at a time per
  Plex server**; only different servers run side by side.
- `art.ts` caps image fetches at 4 in flight; use the same cap for TMDB data.

## Approach
1. `discovery.ts`: fetch up to **4** categories at once; publish rows to
   `add` strictly in config order (a row waits for the ones before it), so the
   page never reorders.
2. `kids.ts`: build each server's part of the index in parallel
   (`Promise.all` over servers), serial within a server.
3. `menubar.ts`: settle **150 ms**; and on an arrow, restore a page's 070
   snapshot at once if it has one (no request), leaving only the network part
   behind the settle.
4. Smoke: cold Discover with the mock adding 300 ms per TMDB request finishes
   all rows in under 40% of the serial time, rows in config order (assert the
   titles); at most 4 TMDB requests in flight at once (page-side counter, and
   > 1 as a control); the kids index requests to two servers overlap in time,
   and requests to one server never overlap; the menu loads a page 150 ms
   after the last arrow. `test/kids.test.ts`: per-server serial, cross-server
   parallel.

## Out of scope
- Plex rows (069), snapshots (070).

## Definition of done
- [ ] TMDB rows load ≤ 4 at a time, shown in order (smoke).
- [ ] Kids index parallel across servers, serial within one (smoke + unit).
- [ ] Menu settle 150 ms; snapshot pages show at once (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/071-tmdb-and-the-kids-index-in-parallel.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
