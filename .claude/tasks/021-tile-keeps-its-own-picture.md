---
id: 021
slug: tile-keeps-its-own-picture
status: approved
branch: crew/021-tile-keeps-its-own-picture
model: sonnet
env: laptop
files:
  - js/rail.js
  - dev/smoke/browse.js
---

# A tile keeps its picture only while it is the same film

## Goal
Sweeping a row stops showing the previous film's poster travelling with a tile
before popping to the right one. A tile keeps what it is showing only while it
still holds the **same item**; the moment the pool reassigns it, the old picture
goes.

## Why now
The user, twice, from the panel: *"the image hangs in its original spot and then
updates out of sync to the move."*

Task 015 made a swept-past tile keep its picture rather than blank, on the
reasoning that a held poster beats an empty box. That is right while the tile
still represents the same film. It is wrong the instant the 12-tile pool
reassigns that element to a different one — then "keep the picture" means
drawing film A's poster in film B's slot while the tile physically moves, and
swapping 160ms later. Optimising against a blank produced something worse: a
wrong picture that then changes.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. 019 and 020
merged; main verifies at 75/75.

`dev/smoke.js` is now the harness only; the steps live in `dev/smoke/<area>.js`
and this task owns `dev/smoke/browse.js`. Task 022 runs beside it and owns
`js/showpage.js`, `js/browse.js`, `js/sidebar.js`, `js/app.js`, `js/plex.js`,
`index.html`, `dev/mock-plex.js` and `dev/smoke/show.js` — leave them alone.
Iterate with `npm run smoke -- browse` (about 36s) rather than the full suite.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **This is the third appearance of one idea: a pooled renderer's slot is not
  an identity.** First `rowEl._rowRef` — a row element keyed on index went on
  showing the previous row's tiles when search replaced the rows in place.
  Then `_deferred` versus `_wait` — off-screen tiles *clear* their `src`,
  swept-past tiles *keep* theirs, which needed two flags because they mean
  opposite things. Now the picture itself. Expect the fix to be of the same
  shape: compare identity, not position.
- **`js/rail.js` holds the machinery already.** `drawRow` short-circuits on
  `tile._idx === idx`; `paint(tile)` does the two expensive things (`Art.warm`
  and assigning `src`); a module-level 160ms settle timer, restarted by every
  `render`, paints the waiting tiles of on-screen rows; `place(el, x, animate)`
  suppresses the strip transition when a pool element is recycled. Tiles carry
  `_item`, `_idx`, `_filled`, `_deferred` and `_wait`.
- **The settle exists for a reason and stays** (015): sweeping a row must not
  start a poster load and a TMDB lookup per tile passed. Measured on `main`
  before that change: 19 requests for a ten-tile sweep. Do not undo it.
- **The focused tile is exempt** from the settle and paints immediately. Keep
  that.
- **Chromium 53**: no `async`/`await`, no object spread, no `Object.entries`.
  Animate only `transform` and `opacity`.
- **Assertions that pass on nothing** are this suite's recurring failure
  (CLAUDE.md, Testing). A step written for this must be run against `main` and
  seen to fail.

## Constraints that bite here
- **Do not reintroduce the request storm.** The settle, the in-flight cap and
  the focused-tile exemption all stay. This changes what a tile *shows* while
  waiting, not when it fetches.
- **A blank is not the answer either.** Clearing to nothing gives the flicker
  015 was avoiding. The tile should show a neutral placeholder in the app's own
  surface colour — the same thing a tile shows before its first poster arrives —
  so the rail reads as furniture rather than as holes.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/rail.js` — decide by identity.** In `drawRow`, when a tile is assigned
   an item, compare it with what that tile already holds. Two cases:
   - **Same item** (the tile is only moving): keep the picture exactly as 015
     does. Nothing flickers, nothing reloads.
   - **Different item**: clear the image immediately and mark it waiting, so
     the settle paints the right one. Never leave the previous film's poster on
     a tile that now represents something else.
   Identity is the item, not the index — two servers' copies of one film are the
   same entry, and `_idx` changes while sweeping even when the item does not.
2. **The placeholder.** A tile with no picture yet shows its `--surface`
   background, which is what `.tile-inner` already paints. Make sure clearing
   the `src` leaves that rather than a broken-image glyph, and that the title
   and second line stay put — they are cheap and must never be deferred.
3. **`dev/smoke/browse.js`** — one step, and it must fail on `main`:
   - Sweep a row several tiles, then read the focused tile's `img` src and the
     rendered title. They must describe the **same film**: assert that the src
     is either empty or the one belonging to the title now shown — never the
     one belonging to a title that has scrolled past.
   - After the settle, every on-screen tile has a picture, and it is its own.
   - Run it against `main` first and record in the task file that it fails
     there. A step that passes on `main` is not testing this.

## Out of scope
- **The settle interval, the in-flight cap, `Art` and its cache.** 015 settled
  those and they are not the fault here.
- **`place()` and the recycled-strip transition** from `8625a76`.
- **Crossfading a tile's picture.** Might be nice; it is a second change and
  would hide whether this one worked.
- **`css/app.css`** and any of the split stylesheets — the placeholder is the
  surface colour `.tile-inner` already has.
- **The hero backdrop**, which has its own crossfade and is unaffected.

## Definition of done
- [ ] Sweeping a row never shows a tile carrying a picture that belongs to a
      different film from the title beneath it.
- [ ] A tile that is only moving — same item — keeps its picture without a
      flicker or a reload.
- [ ] A tile awaiting its picture shows the surface colour, not a blank gap or a
      broken image, and its title and second line are never deferred.
- [ ] After the movement settles, every on-screen tile shows its own poster.
- [ ] The sweep still makes far fewer requests than tiles passed — 015's step
      still passes unchanged.
- [ ] The new step fails on `main`, and the task file says so.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
