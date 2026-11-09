---
id: 049
slug: the-season-bar-scrolls-not-wraps
status: approved
branch: crew/049-the-season-bar-scrolls-not-wraps
model: sonnet
env: laptop
rounds: 0
work: browse-polish
files:
  - src/screen/showpage.ts
  - css/show.css
  - index.html
  - dev/library.js
  - dev/smoke/show.js
---

# The season bar stays one line and scrolls to the focused season

## Goal
On the series page the season chips sit on one line; when they are wider
than the screen the line slides so the focused season is always in view.
The description above gets a third line.

## Why now
Stuart, 2026-11-09: "The season bar doesn't have enough space and stacks on
top and disappears under the episode images. This should just expand right
and come into view instead of wrapping. Need a bit more space for the
description above."

## Existing work
After 048 (moves the hold machine out of `showpage.ts`). Draft 042 touches
the same files but is not approved.

## Background
- `#sh-seasons` (`css/show.css:62`) is absolute at `top:232`, no width, no
  `nowrap`; `.chip` is inline-block (`css/base.css:131`). Many seasons wrap
  to a second line at ~y274, under `#sh-strip` (`top:292`), which paints over it.
- `#sh-summary` (`css/show.css:48`) is `max-height:60px` — two lines at 21px × 1.4.
- Vertical blocks are hard-coded tops: seasons 232, strip 292 (400 high),
  cast label 716, cast 762 (`css/show.css:125,129`), recaps 786 (`:220`).

## Graph context
- The in-page scroll pattern: `showpage.ts:191` sets `--strip-x` and
  `css/show.css:69` does `transform: translateX(var(--strip-x, 0))` with a
  transform transition. Copy it as `--seasons-x`.
- `#sh-seasons` is in the `.lifted` transform group (`css/show.css:28-35`).
  Never put two transform writers on one element: the slide goes on a new
  inner row.
- Renaming or nesting ids: grep `dev/smoke/*.js` and `src/seam.ts` for the
  selector; `.chip`, `.chip.on` must keep matching.

## Approach
1. `index.html:61`: `#sh-seasons` gets one child `#sh-seasons-row`.
2. `css/show.css`: `#sh-seasons` gains `width: 1792px; overflow: hidden`;
   `#sh-seasons-row` is `white-space: nowrap` with
   `transform: translateX(var(--seasons-x, 0))` and the strip's transition.
3. `src/screen/showpage.ts:105` `renderSeasons`: fill the inner row; then,
   from the focused chip's `offsetLeft` and `offsetWidth`, set `--seasons-x`
   so the chip is inside the 1792px window (no shift while it already is;
   never shift past the start).
4. Description: `#sh-summary` `max-height: 90px` (three lines); move the
   seasons, strip, cast label, cast and recaps tops down by 30px together.
5. `dev/library.js`: one mock show with 12 seasons.
6. Smoke `dev/smoke/show.js`: on that show, every chip has the same
   `getBoundingClientRect().top`; walk right to the last season and assert
   the focused chip's rect is inside `#sh-seasons`'s rect and its bottom is
   above `#sh-strip`'s top (read after the transition settles, page-side).
   Run against `main` first and watch it fail.

## Out of scope
- Season chip design. The cast row (050). Draft 042's icons.

## Definition of done
- [ ] Twelve seasons sit on one line; the focused one is always inside the bar (smoke, failing on `main`).
- [ ] The description shows up to three lines.
- [ ] Existing show smoke steps pass.
- [ ] the gate passes (`crew gate .claude/tasks/049-the-season-bar-scrolls-not-wraps.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
