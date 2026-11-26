---
id: 073
slug: each-page-has-its-own-loader
status: done
branch: crew/073-each-page-has-its-own-loader
model: sonnet
env: laptop
rounds: 1
work: v2-foundations
files:
  - src/screen/browse.ts
  - src/screen/pages.ts
  - src/screen/router.ts
  - src/view/menubar.ts
  - src/app.ts
  - src/core/ui.ts
  - src/api/plex/library.ts
  - dev/smoke.js
  - dev/smoke/shell.js
  - dev/smoke/sections.js
  - dev/smoke/deck.js
  - dev/smoke/browse.js
gate: pass
gateSha: 62a7fbd509741f81047cb07c4224ae9a44a7f3dc
gateAt: 2026-11-23T17:56:05.078Z
---

# Each page has its own loader and its own memory, and Home is no longer Movies

## Goal
Home, Movies, TV, Kids, Collections and Discover each load through their own
loader and are remembered under their own key. Home becomes its own page —
Continue watching, then rows mixed from every library — instead of the same
page as Movies. Adding a page later means adding a loader, not editing a
switch in a 1,500-line file.

## Why now
v2 plan (`.claude/plans/maps/v2-layout.html`, part "Browse shell"), foundation
1b. Stuart, 2026-11-23, took the recommendation "split each v2 page into its
own module; shell routing is where to do it".

## Existing work
After 072 (shares `src/app.ts`). Base `feat/v2`.

## Background
- `src/screen/browse.ts:302 goToPage` and `:286 currentPage` route menu pages;
  pages 0 and 1 both call `showSection`, which is why Home equals Movies.
  `Mode` (l.73) is `library | kids | discover | collection`.
- `src/screen/pages.ts:20 keep` / `:24 recall` key snapshots by **section
  number**, so only library pages are remembered (071's report).
- `browse.ts` is at its max-lines ratchet (1,547 of 1,548).
- 069 added `library.ts sectionHubs` / `promotedHubs` — one
  `/hubs/promoted` per server for a list of library keys.

## Graph context
- "Kids menu entry and yellow share loadKids" — keep one Kids path.
- Snapshots: 2-minute freshness from the last server fetch (070).
- Grep done: `dev/smoke.js` and `dev/smoke/shell.js` reference the menu pages;
  `sections.js` switches sections; `deck.js` reads Continue watching on Home.

## Approach
1. `src/screen/router.ts` (new): a table from page id (`home`, `movies`,
   `tv`, `kids`, `collections`, `discover`) to `{ load(context), key }`. The
   loaders are today's functions, moved or wrapped: Movies = the movie
   section, TV = the TV section, Kids = `loadKids`, Collections = today's
   collection loader, Discover = `loadDiscover`.
2. **Home** = Continue watching, then the rows from one `/hubs/promoted`
   per server across **all** that server's movie and TV libraries
   (`sectionHubs` with every part), merged as today.
2b. **No "All films" row on any menu page** (Home, Movies, TV). Stuart,
   2026-11-23: "all films shouldn't show as a row. I think this would only be
   available through the server controls. No need in the app as discovery
   and search provide the access." The All row stays only where the sidebar
   (More) opens a library section — the server-controls fallback — until the
   Servers browser replaces it.
3. `pages.ts`: snapshots keyed by page id; every page (not only library
   pages) is remembered and restored instantly within the freshness window.
4. `browse.ts`: `goToPage` / `currentPage` delegate to the router; move code
   out so the file ends **below** its ratchet (say how many lines).
5. `menubar.ts`: unchanged order; pages map to router ids.
6. Smoke: Home's rows differ from Movies' (Home has a TV row; Movies does
   not — positive titles); Movies → Home → Movies within 2 minutes makes zero
   requests (control > 0 first time); Kids, Discover and Collections are now
   restored instantly on return (positive: rows in the first frame);
   Home, Movies and TV have no All row (assert row titles, positively);
   `dev/smoke/browse.js:891` ("the All row knows its size") and `:938`
   ("spans every movie library") reach the All row through More → the
   library section instead of from launch;
   `deck.js` Continue watching steps pass on Home.

## Out of scope
- Movies/TV page designs (Top 10, trending) — later group.
- Servers entry (still More).

## Definition of done
- [ ] Home is its own page with Continue watching and mixed rows (smoke).
- [ ] Every page restores from its own snapshot within the window (smoke, with control).
- [ ] `browse.ts` is below its max-lines ratchet.
- [ ] the gate passes (`crew gate .claude/tasks/073-each-page-has-its-own-loader.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

Round 1: PASS (crew-reviewer). Gate stamped on 62a7fbd.

## Worker notes
- browse.ts 1547 -> 1518 lines (ratchet 1548). Collections listing moved to router.ts, mergeHubs to pages.ts.
- router.ts: page ids, loader table, collection listing. Snapshots keyed by page id (home, movies, tv), libN (More), kids, discover, collection:<title>.
- Only the menu and yellow restore a kept Kids/Discover/Collection page; the sidebar loads them fresh (discovery.js, outside files:, depends on a cold Discover from the sidebar).
- Smoke: deck.js now treats Home as the launch page; browse.js reaches the All row through More; shell.js has the new Home/Movies/TV and restore steps.
- Not run against feat/v2 to watch the new steps fail.

## Graph writes proposed
