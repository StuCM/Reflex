---
id: 078
slug: the-top-10-row
status: approved
branch: crew/078-the-top-10-row
model: opus
env: laptop
rounds: 0
work: v2-movies-tv
files:
  - src/view/rail.ts
  - src/screen/browse.ts
  - css/browse.css
  - css/v2.css
  - dev/smoke/movies.js
---

# The Top 10 row draws its numerals, and Movies and TV keep the hero tall

## Goal
A ranked row draws a large outlined numeral beside each poster, as
`designs/v2/Movies.dc.html` does, and all ten are reachable. On Movies and TV
the hero stays full height on every row instead of collapsing to a band.

## Why now
v2 group 2. Stuart, 2026-11-26: numerals "go with board" (700 weight).

## Existing work
After 077 (`ListRow.ranked`, the Top 10 row). Base `feat/v2`.

## Background
- `src/view/rail.ts:42-47`: `TILE_W` 176, `GAP` 26, `STRIDE` 202, `ROW_H`
  418, `TILE_POOL` 12, `ROW_POOL` 4, `TILES_VISIBLE` 9, `BIG_DROP` 80.
  `STRIDE` is global: `drawRow` (l.~267 `place(strip, -firstVisible*STRIDE)`,
  `translate(tile, index*STRIDE)`), `moveRing` (l.106), and the
  `firstVisible` clamp (l.~262) uses `TILES_VISIBLE`.
- `RailTileElement` (l.14) is the pool contract; tiles are recycled across rows
  (`_row !== at`).
- Board (`designs/v2/Movies.dc.html`, `rankedRow`): numeral 260px resting / 300px focused, line-height .76, 170px wide
  with -20px margin, `-webkit-text-stroke` 4px, fill alpha .06 (.14 focused),
  stroke alpha .7 (.95 focused), font `--font-title`, weight 700.
- `css/browse.css:111 #browse.dense` collapses the hero when `rowIndex !== 0`
  (toggled in browse.ts `render()`).

## Board values
Movies.dc.html: everything listed in Background and Approach 5, verbatim.

## Differs from board, because
- Real titles and rankings; the board's are placeholder.
- Genre rows (ours, Stuart) below the board's rows use the same plain-row values.

## Graph context
- "B8 fast pan profile": every key rewriting 48 tiles' styles cost the frame;
  `translate()` caches per tile in a WeakMap. Keep the numeral inside the tile
  so no extra element moves per key.
- Animate only transform/opacity: the focus growth 260→300 is a
  `transform: scale`, never a font-size change.
- Never write custom properties on `:root` per key.

## Constraints that bite here
- `src/screen/browse.ts` is at its 1548-line `max-lines` limit (`.oxlintrc.json`). Net-zero or shrink it; new logic goes in `src/screen/pages.ts` (077 did this).

## Approach
1. One `_rank` element per pooled tile, created with the pool, absolutely
   positioned left of the poster inside the tile; text set only when the
   tile's index or row changes (inside the existing `_idx === index` skip).
2. Per-row stride and visible count: ranked rows use stride
   `170 - 20 + TILE_W + 40` (366) and visible 5; `drawRow`, the clamp and
   `moveRing` take the row's stride instead of the constant. The strip is
   offset +150 on a ranked row so rank 1's numeral is on screen.
3. Toggle `.ranked` on the pooled row element per draw and clear it on reuse.
4. CSS for `.ranked` tiles and the numeral per the board values above.
5. `browse.ts render()`: no `dense` on the `movies` and `tv` pages. Their
   geometry is the Movies board's: row label top 520 (30px 700, 24px sub-line
   rgba(255,255,255,.55)), tiles top 570, peek label top 928 at opacity .6,
   peek tiles top 972 — a row pitch of 402. Plain rows there use the board's
   40px gap (stride 216); Home keeps its own until its board is checked.
6. Row titles draw `ListRow.sub` under the label (24px, rgba(255,255,255,.55));
   a row without one draws none.
7. Smoke (`movies.js`): the Top 10 shows numerals 1–10 by text; walking right
   ten times focuses the tile showing 10 and it is inside the viewport (by
   committed transform, read page-side); a plain row on Movies/TV draws at 216
   stride and a Home row still at 202; `#browse` is not `.dense` on row 3 of Movies, and is on Home.

## Out of scope
- Benchmarking on the TV (ask Stuart first; people may be watching).
- The hero content (079).

## Definition of done
- [ ] Ranked rows draw numerals 1–10 and the tenth is reachable on screen (smoke).
- [ ] Plain rows step 216 on Movies/TV and 202 on Home; pool size unchanged (smoke).
- [ ] Movies and TV never go dense; Home still does (smoke).
- [ ] No inline style writes other than the existing transform/custom-property path (lint).
- [ ] Every value under **Board values** is asserted in the smoke by computed style or rect (px, colour, alpha, font, weight); anything that differs is listed under **Differs from board, because**, and nothing else may differ. The reviewer opens the board (`designs/v2/<board>.dc.html`, now rendering with `support.js`) beside the app at 1920×1080 and checks both lists.
- [ ] the gate passes (`crew gate .claude/tasks/078-the-top-10-row.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Worker notes

## Graph writes proposed
