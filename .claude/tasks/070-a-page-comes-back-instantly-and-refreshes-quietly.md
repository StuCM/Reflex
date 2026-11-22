---
id: 070
slug: a-page-comes-back-instantly-and-refreshes-quietly
status: approved
branch: crew/070-a-page-comes-back-instantly-and-refreshes-quietly
model: sonnet
env: laptop
rounds: 0
work: v2-data
files:
  - src/screen/browse.ts
  - src/screen/pages.ts
  - src/view/rail.ts
  - src/view/masthead.ts
  - src/data/cached.ts
  - css/browse.css
  - dev/smoke.js
  - dev/smoke/shell.js
  - dev/smoke/browse.js
  - dev/smoke/sections.js
  - dev/smoke/deck.js
---

# A page comes back instantly, refreshes without a visible swap, and shows shapes while it waits

## Goal
Changing page never blanks the screen to "Loading…". A page seen in the last
few minutes comes back at once with its rows and focus; fresh data replaces a
row only if it changed, without moving the focus or flashing; a page with
nothing yet shows placeholder poster shapes until its rows arrive.

## Why now
Stuart, 2026-11-22: "sometimes it loads and then refreshes which is not
ideal … optimise all calls to minimise requests but at the fastest speed."
Earlier: "the load per page is slow which is a bit confusing".

## Existing work
After 069 (same `browse.ts`).

## Background — from the code (scout, 2026-11-22)
- `reset()` (`browse.ts:679-692`) clears `rows` and renders on every page
  change, even back to a page loaded seconds ago → "Loading…"
  (`masthead.ts:71`) and hidden pool tiles (`rail.ts:146-149`).
- Warm Movies/TV paint `cached.rows` (`browse.ts:884-896`), then always
  re-request the deck, hubs and the All row's first page, and replace the
  rows wholesale (`rows = listRows(built)`, ~l.925), resetting `rowIndex` —
  the visible "loads then refreshes".
- The deck is re-fetched unless the last fetch was under 30 s
  (`browse.ts:794, 810`).

## Graph context
- Servers we do not own: a page revisited within the freshness window asks
  them nothing.
- `rail.ts` is a fixed pool; nothing may become count-dependent. Placeholders
  are the pool's own tiles in an empty state, not new elements per tile.
- Read transient states page-side; counting steps need a non-zero control.

## Approach
1. **Snapshots** (new `src/screen/pages.ts`, since `browse.ts` is at its max-lines ratchet; add it to the `screen` layer if `eslint.config.mjs` needs no edit, else stop and say so): keep each page's last `{rows, rowIndex, focus per row,
   sectionIndex, mode}` in memory. Switching to a page with a snapshot
   younger than **2 minutes** restores it synchronously — no `reset()` blank,
   no request. Older or missing: restore it if present (stale), then refresh.
2. **Quiet refresh**: when fresh rows arrive for the page on screen, replace
   only rows whose item identities or order changed, keep `rowIndex` and each
   row's focus (by identity, else index), and never re-render a row that did
   not change.
3. **Deck freshness**: Continue watching is fetched at most once per 2
   minutes across pages (and still refreshed after playback ends, as today).
4. **Placeholders**: a row that is loading draws its pool tiles as empty
   poster shapes (`.tile.placeholder`, static, no animation) with the row's
   title; the masthead shows the page name instead of "Loading…".
5. **Smoke**:
   - Movies → TV → Movies within 2 min: on return the rows are on screen in
     the first frame after the key (page-side check), focus is where it was,
     and **zero** requests to the mock servers (control: the first visit made
     > 0);
   - after the window, the return still shows the old rows at once, makes
     the requests, and a row whose mock data did not change is not re-rendered
     (count its tiles' style writes: 0) while a changed row updates;
   - a cold page shows placeholder tiles before its rows (positive: the
     placeholder class is present, then gone);
   - no "Loading…" text appears on any page change.

## Out of scope
- TMDB concurrency, the kids index, the menu settle (071).

## Definition of done
- [ ] Returning to a page within 2 minutes is instant and makes no request (smoke, with control).
- [ ] A refresh changes only changed rows and keeps focus (smoke).
- [ ] Placeholders while a page is empty; no "Loading…" (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/070-a-page-comes-back-instantly-and-refreshes-quietly.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
