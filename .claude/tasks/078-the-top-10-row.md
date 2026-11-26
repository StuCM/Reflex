---
id: 078
slug: the-top-10-row
status: done
branch: crew/078-the-top-10-row
model: opus
env: laptop
rounds: 2
work: v2-movies-tv
files:
  - src/view/rail.ts
  - src/screen/browse.ts
  - css/browse.css
  - css/v2.css
  - dev/smoke/movies.js
gate: pass
gateSha: 467c5d7cfd7ab37b54fc025576264b1de30694b6
gateAt: 2026-11-26T19:45:19.607Z
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
- The focused row's label rides up 57px on a transform, because the board
  bottom-aligns a focused row in 315px and a resting one in 264: row tops 402
  apart are 351 apart between resting posters (621, 972), which is the pitch.
- The row's sub-line sits on the label's line, 12px after it, as the board
  draws it (Approach 6 says "under"); it is `::after { content: attr(data-sub) }`
  so `.row-label`'s text, which seven smoke files read, is unchanged.
- Plain rows on Movies and TV show 8 across before the row stops winding, not
  Home's 9: a ninth at the board's 216 stride would end at 2000px.
- Titles under the posters are hidden on Movies and TV: the board has none, and
  they would run into the peek label at 928.

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

- Round 1 (gate stamped 7e81fd9, 178/178): PASS. Advice taken: the 8-across
  plain row added to Differs from board. Advice left: a ranked row on Home keeps
  Home's label styling; Home's board is unchecked, so out of scope here.

- Person, side by side (orchestrator, Movies.dc.html vs the app's Movies page at 1920×1080, by screenshot positions): row label (540), stride 216, poster heights and the Top 10 numerals match. **Focus does not**: the board anchors the focused poster at its left and bottom (left 96, 210×315, bottom 883) and moves every poster after it 34px right (next at 346, then 562…); the app grows it from the centre (left 79) and leaves the rest, so everything after the focus is 34px off. The "Focus is a scale, not a reflow" deviation is refused — the boards are exact. Do it on transform alone: focused tile scales from left bottom, tiles after it `translateX(+34)` (ranked rows the same, per `rankedRow`'s `x += 170 - 20 + w + 40`). Assert the next poster's left by rect.

- Round 2 (gate stamped 467c5d7, 178/178): PASS. Focus is anchored left and
  bottom, and the posters after it move 34px on `.after`. The deviation has been
  removed from Differs from board. Not checked: the focused numeral against the
  board.

## Worker notes

- `src/view/rail.ts` — a `_rank` per pooled tile; `Pitch` per row (Home 202/9,
  board 216/8, ranked 366/5 with +150 offset); `render(rows, rowIndex, board)`
  picks the row pitch 351 and drop 77 on Movies/TV; `.ranked` toggled per draw;
  `adopt()` split out of `drawRow` for `max-lines-per-function`.
- `src/screen/browse.ts` — `board` page flag; no `dense` on Movies/TV. Net zero
  lines (1548).
- `css/v2.css` — board label, sub-line, peek opacity, hidden titles,
  bottom-origin focus, the numeral. `#browse.menu #rows .row-label` raised so
  the menu still hides labels over the board rules. `css/browse.css` untouched.
- `dev/smoke/movies.js` — three steps; all three fail with `src/` and `css/`
  stashed (5/8), pass with them (8/8).
- Round 2: focus as the board, on transform alone. The focused poster scales
  from its left and bottom; `.after` on every later tile of the focused row
  moves its poster and numeral 34px right (`translateX`, transitioned). Only
  the tiles whose side of the focus changed toggle, one per step. The menu's
  tray and the ring mode undo the shift. Smoke asserts the next poster's left
  by rect (plain x+250, ranked 646) and rank 1 focused at 246.
- Plain board rows show 8 across, not 9: the ninth at 216 would end at 2000px.

## Graph writes proposed
