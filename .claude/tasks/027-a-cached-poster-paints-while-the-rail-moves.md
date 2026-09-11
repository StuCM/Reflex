---
id: 027
slug: a-cached-poster-paints-while-the-rail-moves
status: pending-tv
branch: crew/027-a-cached-poster-paints-while-the-rail-moves
model: sonnet
env: laptop
files:
  - src/view/rail.ts
  - dev/smoke/browse.js
---

# A poster we already have is drawn straight away, moving or not

## Goal
Scrolling a row you have already been through stays filled. Only a tile whose
picture is genuinely not known yet waits for the rail to stop.

## Why now
Reported from the panel 2026-09-10: "the first 2 or 3 scrolls look correct then
the tiles go grey and reshow once the move has happened. Doesn't feel smooth."
That is exactly the behaviour tasks 015 and 021 specified — this narrows it
without reopening what they decided.

## Graph context
`src/view/rail.ts` withholds `paint(tile)` while the rail moves: a recycled tile
gets `_wait = true` and stays blank until `settled()` runs, `SETTLE = 160`ms
after motion stops. The first few scrolls look right because those tiles still
hold their own film and are short-circuited at `rail.ts:242`.

The blanking is deliberate and must stay for the unknown case: task 021 found
that keeping the old picture drew one film's poster over another film's title.

What makes this cheap: `art.tile()` (`src/data/art.ts:84`) reads `picked(item)`,
an **in-memory map**, and returns TMDB's poster URL synchronously when it is
already held — no request. TMDB is the source, Plex the fallback, per the
existing decision. So for a row already walked, the URL is known and the browser
has the bytes; withholding the paint buys nothing.

## Constraints that bite here
- 2018 SoC: animate `transform` and `opacity` only. Painting an `img` whose src
  is unchanged must not be re-triggered.
- The pool is fixed — 4 rows of 12 tiles — and a slot is not an identity.
- Task 021's rule holds: a tile must never show one film's picture above another
  film's title. Picture and text change together or not at all.

## Approach
1. In `paint(tile)`, ask `art.tile(...)` for the URL first. If it comes back
   non-empty, set the picture and the text together and leave `_wait` false —
   whether or not the rail is moving.
2. Only when the URL is empty (TMDB not yet held and no Plex fallback) set
   `_wait = true` and leave the tile blank, as now. `settled()` is unchanged and
   still catches those.
3. Do not call `art.warm()` any more often than now — a moving rail must not
   start lookups it will scroll past. Warm on settle only, as today.
4. `SETTLE` stays 160ms. Do not tune it in this task.

## Out of scope
- Changing where artwork comes from. TMDB first, Plex fallback, unchanged.
- The rail's motion, easing, `STRIDE`, or row height.
- The masthead hero.
- Reopening task 021's rule. If a step in the Approach seems to require showing
  a stale picture beside a new title, that is a spec bug — stop and ask.

## Definition of done
- [ ] Walking a row a second time keeps every tile filled while it moves
- [ ] A tile whose picture is not yet known is still blank rather than showing
      the previous film's, and fills in on settle
- [ ] A smoke step sweeps a row twice and asserts the second pass has no blank
      tile, taken page-side — a Playwright round trip is slower than the 160ms
      settle and would read after the rail has stopped
- [ ] The existing step "a tile carries no picture but its own while the row
      sweeps" still passes
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed
- `src/view/rail.ts` — a module-level `drawn` Set of every poster URL the rail
  has fetched; `draw()` assigns `src` only when it differs and records the URL;
  `drawHeld()` paints a non-focused tile straight away when its own picture is
  already in that set, and blanks it otherwise. `drawRow` now sets
  `_wait = !drawHeld(tile)` instead of `_wait = !focused`, and the `held`
  same-item short circuit is gone — `drawHeld` subsumes it. `paint()` and
  `repaint()` go through `draw()`. `settled()`, `SETTLE` and `art.warm()` are
  untouched.
- `dev/smoke/browse.js` — new step "a row walked twice keeps its pictures while
  it moves": settle two rows down, walk 5 right, settle, then take page-side
  readings of a 5-press walk back over that ground. Asserts at least 5 fresh
  tiles per press and no stale ones. Against the unmodified rail it fails on
  press 1 with "only 1 of 12 tiles kept their picture".

## What the spec got wrong
Approach step 2 says to wait only when `art.tile()` is empty, glossed as "TMDB
not yet held **and no Plex fallback**". Implemented literally that never waits:
`art.tile()` falls back to `posterUrl(item, …)`, which is non-empty for any item
with a `thumb`, i.e. effectively all of them. I built it that way first and ran
the suite: the existing step "a moving rail fetches only what has the focus"
fails with *only 0 of 12 tiles waited*, because every tile passed in a sweep now
costs a poster from a server we do not own — exactly what task 015 removed.

The Goal ("a tile whose picture is *genuinely not known yet*"), the Graph
context ("for a row already walked, the URL is known and **the browser has the
bytes**") and the DoD (which requires `npm run verify` to pass) all say the
other thing, so the gate is on "has this picture been fetched before", not "is
there a URL". That is source-agnostic, which the TMDB-held reading would not
have been: an episode never gets a TMDB id, so its show's Plex poster would
have gone on blanking on a second pass.

## Review rounds

### Round 1 — crew-reviewer, 2026-09-11 — accept with notes

- **Task 021's rule holds.** The URL is recomputed from `tile._item` at paint time in
  both `paint()` and `drawHeld()`; the `drawn` Set only decides *whether* to draw now
  or wait, it never supplies the URL. An empty URL is never added, so a tile with no
  poster stays blank rather than false-matching.
- **`drawn` needs no bound.** It grows with scrolling, not library size — short strings,
  low single-digit MB in an extended session, negligible beside the image bytes and the
  IndexedDB cache.
- **Scope clean**, and no `SETTLE` tuning or extra `art.warm()` calls.
- **One finding, addressed in `44b5e0c`:** the step asserted `st.fresh < 5`, which on a
  12-tile pool would have passed with seven tiles grey — weaker than the DoD's "no blank
  tile". Now asserts zero blanks. Re-proved against the unmodified rail: it fails there
  with "11 of 12 tiles went blank on a second pass" and names them.

**Not yet verified on the panel.** The suite proves the tiles no longer blank; whether
the scrolling now *feels* right is the panel's to answer, and that was the original
report.

## Graph writes proposed
- Decision: defer the *lookup*, not the *paint*. A URL already in memory costs
  nothing to draw, and blanking it is the whole of the reported roughness.
  Refines Decision/a tile keeps its picture only while it is the same film.
