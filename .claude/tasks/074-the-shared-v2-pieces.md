---
id: 074
slug: the-shared-v2-pieces
status: approved
branch: crew/074-the-shared-v2-pieces
model: sonnet
env: laptop
rounds: 0
work: v2-foundations
files:
  - src/view/menu.ts
  - src/view/grid.ts
  - src/view/legend.ts
  - src/view/tabs.ts
  - css/v2.css
  - index.html
  - src/seam.ts
  - types/seam.d.ts
  - dev/smoke/shell.js
  - dev/smoke/detail.js
  - dev/smoke/player.js
  - dev/smoke/show.js
---

# The pieces most v2 pages share: glass modal, colour-key legend, tabs, poster grid

## Goal
Four building blocks exist, styled to the v2 spec and tested on their own, so
the page tasks that follow (detail, series, player, Discover, Collections,
profiles, Kids) use them instead of each inventing its own: a glass modal, a
legend row of remote colour keys, inner tabs, and a virtualised poster grid.

## Why now
v2 plan, foundation 1c (`.claude/plans/maps/v2-layout.html`, part "v2
components"). Stuart, 2026-11-23, took the recommendations, including: the
remote-key cue is "legend on detail pages as designed, chips on rows, drop the
badge".

## Existing work
None in flight. Base `feat/v2`. Runs first of the foundations (no shared
files with 072, 073, 075's code), so 072's warning can use the glass modal.

## Background
- `src/view/menu.ts:141 open` is the existing overlay that swallows every key
  (tabs, rows, a `head`, row icons and notes; 057 added `holdMenuAt`). The
  detail page, the player and the hold menus draw with it. **The glass modal
  is this shell with a glass skin**, not a second overlay.
- Spec §2: glass = `linear-gradient(180deg, rgba(255,255,255,0.14),
  rgba(255,255,255,0.04)), rgba(24,16,46,0.96)` for modals (0.7 for tiles),
  1px `rgba(255,255,255,0.26)` border, `inset 0 1px 0 rgba(255,255,255,0.4)`,
  big soft shadow; overlay `rgba(8,5,18,0.78)`; focus = 3px white ring. Remote
  keys: OK primary, Yellow add to list, Red mark watched, Blue recap or
  trailer. Grid posters 206×309 with 40px gaps, 7 wide (Discover/List boards).
  No CSS grid, no flex `gap`, no `backdrop-filter`.
- `src/view/dom.ts fill/put` are the only DOM helpers; no inline style except
  custom properties.
- `src/seam.ts` publishes modules to the smoke suite under `window.*`.

## Graph context
- Fixed pools: the grid must not create an element per item — one screenful
  plus a buffer (spec §1: ~94,000 films).
- "Root custom properties kill B8 panning": per-move values on the grid's own
  element, never `:root`.

## Approach
1. **Glass modal** (`menu.ts`, `css/v2.css`): glass is the **default** skin
   of the menu shell — the glass background, border and highlight, the dark
   overlay, the v2 type (`--font-title` / `--font-body`). Every existing
   caller (`detail.ts:634`, `showpage.ts:744`, `browse.ts:434, 1415`,
   `player.ts:1011`) gets it without being edited, so 074 stays in its files
   and shares none with 072/073/075. Their smoke steps keep passing
   (selectors unchanged).
2. **Legend** (`src/view/legend.ts`): `legend(host, entries)` draws a row of
   coloured dots with labels — `{ key: 'ok'|'red'|'yellow'|'blue', label }` —
   in v2 style (spec §2). No behaviour; pages wire keys themselves.
3. **Tabs** (`src/view/tabs.ts`): `tabs(host, labels, active)` with the accent
   underline on the active tab; `step(dir)` returns the new index; Left/Right
   between tabs, Down leaves (the page decides).
4. **Grid** (`src/view/grid.ts`): `grid(host, { columns: 7, tile: 206×309,
   gap: 40 })` virtualised: a fixed pool of rows × 7 tiles plus one buffer row,
   flex-wrap inside rows (no CSS grid, no `gap` — margins), moved by
   `--grid-y` on the grid element; `render(items, focus)`; focus = the same
   scale + ring as the rail; "not on server" items at 45-50% opacity with a
   tag (spec §2).
5. `src/seam.ts` + `types/seam.d.ts`: publish `Legend`, `Tabs`, `Grid` for the
   smoke suite.
6. Smoke (`dev/smoke/shell.js`), each mounted into a test host page-side:
   - the grid with 500 items keeps ≤ 7 × (rows on screen + 1) tile elements,
     and walking focus to item 300 shows item 300's title (positive);
   - the legend renders the four labels in order with their colour classes;
   - tabs move the active underline and report the index;
   - a glass modal has the glass class and overlay and swallows keys; the
     existing hold-menu and detail menu steps still pass.

## Out of scope
- Using these on any page (the page tasks do that). The cover tile (fan of
  three) — Collections task.

## Definition of done
- [ ] Glass modal, legend, tabs and a virtualised grid exist and are smoke-tested (positive assertions, pool size bounded).
- [ ] Existing overlays use the glass skin with their steps unchanged.
- [ ] the gate passes (`crew gate .claude/tasks/074-the-shared-v2-pieces.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
