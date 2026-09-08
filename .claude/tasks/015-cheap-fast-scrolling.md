---
id: 015
slug: cheap-fast-scrolling
status: building
branch: crew/015-cheap-fast-scrolling
model: sonnet
env: laptop
files:
  - js/rail.js
  - js/masthead.js
  - css/app.css
  - dev/smoke.js
---

# Scrolling fast costs nothing until you stop

## Goal
Holding a direction key sweeps the rail without fetching anything. Posters and
TMDB lookups start only for the tiles still on screen once the movement
settles, and the hero backdrop fades more slowly and more gently. Sweeping a
row stops feeling like it is dragging the app behind it.

## Why now
The user, on the panel: *"getting some lag when scrolling fast, may need to
change how this acts to improve UX"*.

`Rail.drawRow` assigns `tile._img.src` and calls `Art.warm(item)` the moment a
tile is revealed. Sweep twenty tiles and that is twenty poster loads and twenty
TMDB lookups queued — every one of them for a tile already scrolled past, on a
2018 SoC talking to a remote server. The work is real and almost all of it is
wasted.

The pattern to copy is already in this codebase twice: `Masthead.art` waits
280ms for stillness before asking for a backdrop, and `Browse.scheduleWalk`
waits 150ms before walking the merge. The most expensive thing on the screen is
the one that never got the treatment.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `js/rail.js`, `js/masthead.js`, `css/app.css` or
`dev/smoke.js`. No worktrees are in flight; 014 merged as `a82a730`.

Read these as they now are:

- `js/rail.js` gained `place(el, x, animate)` in `8625a76`, which suppresses the
  strip transition when a pool element is recycled onto a different row. Leave
  it alone and do not let the deferral reintroduce the slide it fixed.
- `css/app.css` — 014 grew `#dt-header` from 264px to 300px and added the
  kicker, chip and ratings rows. The browse header is unchanged. `--t-fade`
  goes beside `--t-quick`, `--t-move` and `--ease`.
- `dev/smoke.js` is at 63 steps.
- 014 also fixed a real latent bug in `js/detail.js`: `close()` never moved the
  generation counter on, so a `Meta.load` landing after BACK still redrew. Not
  this task's file — noted so it is not rediscovered.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **The rail draws from a fixed pool** — 4 row elements, 12 tiles each, however
  big the library. `drawRow` short-circuits on `tile._idx === idx`, so only
  tiles whose content actually changed do work. That stays; this task changes
  *when* the expensive part of that work happens, not how much of it there is.
- **A recycled strip must not animate** (`8625a76`): `place(el, x, animate)` in
  `js/rail.js` suppresses the transition when a pool element is reused for a
  different row, because it carries the previous row's scroll offset. Do not
  undo that, and do not make the deferral re-introduce it.
- **Off-screen rows already defer their posters** (`tile._deferred`), for
  exactly this reason — "asking for two screens' worth before the first one has
  painted is the single most expensive thing this app does". This task extends
  the same idea from *off-screen* to *being scrolled past*.
- **`Art.warm` already caps itself** at 4 lookups in flight and one per tmdbId,
  and caches misses as well as hits. The problem is not concurrency, it is that
  the queue fills with titles nobody is looking at any more.
- **`Masthead.art(item)` debounces on 280ms and short-circuits an unchanged
  URL** (`lastArt`). `paintArt` preloads with `new Image()` and swaps `.on`
  between `#hero-art-a` and `#hero-art-b` in `onload`/`onerror`, dropping a swap
  a newer backdrop has overtaken. `#hero-art` is the wrapper that carries the
  `dense` dimming so the two concerns never fight over `opacity`.
- **Timings are tokens**: `--t-quick` 180ms, `--t-move` 340ms, `--ease`. Every
  transition in `css/app.css` reads from them.
- **Chromium 53, 2018 SoC.** Animate only `transform` and `opacity`. No blur,
  no filter, no shadow transitions.
- **Smoothness is a TV question** (CLAUDE.md). The laptop can prove that the
  *requests* stop; it cannot prove how it feels. Say so rather than claiming
  the feel is fixed.

## Constraints that bite here
- **A tile must never look empty because of this.** Titles, the second line and
  the progress bar are cheap and stay immediate. Only the picture and the
  lookup wait.
- **Resting must always resolve.** Every deferral needs a timer that fires; a
  sweep that ends on a tile whose poster never loads is worse than the lag.
- **Do not lengthen the hero hold so far that a deliberate step feels dead.**
  It is a balance, and the numbers below are the spec's job, not the worker's.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/rail.js` — split a tile's work in two.** In `drawRow`, keep everything
   cheap immediate: position, focus class, title, sub-line, progress. Move the
   two expensive lines — `Art.warm(item)` and `tile._img.src = url` — behind a
   settle:
   - Mark the tile as awaiting its picture (reuse `_deferred`, or a sibling
     flag if that reads better against the off-screen meaning it already has)
     and leave whatever image it currently holds rather than clearing it — a
     tile that keeps the last poster for 200ms looks far better than one that
     blanks.
   - Schedule a single module-level `settle` timer, **160ms**, reset on every
     `render`. When it fires, walk the pool once and give every on-screen tile
     still awaiting a picture its `Art.warm` and its `src`.
   - One timer for the whole rail, not one per tile.

2. **`js/rail.js` — the focused tile is not deferred.** Whatever has the focus
   gets its poster and its lookup immediately, every render. It is one tile, it
   is what the user is looking at, and it is what the hero is about to show.

3. **`js/masthead.js` — hold longer, fade slower.** `HOLD` goes from 280ms to
   **420ms**: long enough that a sweep never starts a full-screen image, short
   enough that a deliberate step still feels answered. The crossfade gets its
   own, longer duration — see step 4 — and `paintArt` is otherwise untouched:
   the preload, the overtake check and the `lastArt` short-circuit all stay.

4. **`css/app.css` — a gentler backdrop.** Add `--t-fade: 620ms` beside the
   existing timing tokens and use it for the two hero layers' `opacity`
   transition only. A backdrop is a big soft image and reads better crossfading
   over half a second; the UI's own motion stays on `--t-move` and must not be
   slowed with it. Ease it with the existing `--ease`.

5. **`dev/smoke.js`** — prove the requests stop, since that is the part a laptop
   can prove:
   - Count image requests to the poster endpoint. Sweep a row with ten rapid
     presses and assert that **fewer requests are made than tiles passed** —
     the current code makes one per tile, so the assertion fails on `main` and
     passes after. Verify it fails both ways rather than assuming.
   - After resting, every on-screen tile has a poster: no tile is left
     permanently without one.
   - The focused tile has its poster immediately, without waiting for the
     settle.
   - The hero still ends up showing the focused item's backdrop after a sweep —
     the existing steps for that must keep passing with the longer hold.

## Out of scope
- **The detail page** — task 014 owns `js/detail.js` and `js/art.js`.
- **Changing `Art`'s cache, its in-flight cap, or what it fetches.** The queue
  filling with stale titles is fixed by not queuing them, not by making `Art`
  cleverer.
- **The row-change transition and `place()`** from `8625a76`. Untouched.
- **Making the rail virtualise differently**, changing the pool sizes, or the
  row geometry.
- **Claiming the feel is fixed.** The laptop proves the requests stop. Whether
  the panel feels smooth is a TV question and belongs in the report, not the
  definition of done.

## Definition of done
- [ ] Sweeping a row with ten rapid presses makes fewer poster requests than
      tiles passed, and the smoke step proving it fails against `main`.
- [ ] After the movement settles, every on-screen tile has its poster — nothing
      is left permanently blank.
- [ ] The focused tile gets its poster and its lookup immediately.
- [ ] A tile keeps its previous picture while awaiting a new one rather than
      blanking.
- [ ] Titles, second lines and progress bars are never deferred.
- [ ] The hero backdrop still ends on the focused item after a sweep, and
      crossfades over `--t-fade` while the rest of the UI stays on `--t-move`.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
