---
id: 066
slug: a-key-press-restyles-only-what-moved
status: approved
branch: crew/066-a-key-press-restyles-only-what-moved
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - src/view/rail.ts
  - src/view/masthead.ts
  - css/browse.css
  - dev/smoke/shell.js
  - dev/smoke/browse.js
  - dev/smoke/sections.js
---

# A key press restyles only what moved

## Goal
Moving the focus one poster rewrites the position of only the elements whose
position changed, and the hero's text fades in once when its content changes —
not on every key press. Panning gets cheaper than v1, not just equal to it.

## Why now
Stuart, 2026-11-17: "Yes, spec it", after the TV profile following 065.

## Existing work
None in flight. Base `feat/v2`.

## Background — measured on the B8 over CDP, 2026-11-17
Invalidation tracking (`disabled-by-default-devtools.timeline.invalidationTracking`)
over 16 presses, identical in v1 and v2:

- 1376 inline-style mutations on `DIV.tile`, 128 on `.strip`, 96 on `.row` —
  about 86 per key. `src/view/rail.ts` `translate()` (l.89) sets `--tx`/`--ty`
  on every tile, strip and row on every render whether or not the value
  changed (callers l.102-121, 246, 266, 281, 346). Each write invalidates that
  element's style.
- v2 only: `src/view/masthead.ts render()` toggles `fa`/`fb` on `#masthead`
  on every call to restart the text fade, so `#mh-row`, `#mh-title`,
  `#mh-meta`, `#mh-desc`, `#mh-cast` get Animation invalidations on every key
  (43 each), though the hero only changes after the 420 ms debounce.

After 065 a fast pan is 75 ms/frame in v2 against v1's 77; style recalc is
still ~700 ms per pan with a median of 68 elements per recalc (v1: 2).

## Graph context
- Pattern "every key rewrites all 48 tiles' styles" (2026-11-17).
- `rail.ts place()` adds/removes `no-anim` around a jump and reads
  `offsetWidth` to commit it — a skipped write there must still commit the
  jump when it *did* change.
- `dev/smoke/sections.js:952` reads `--tx` from tiles' inline style: values
  must still be present after the change (cache, don't remove).

## Approach
1. `rail.ts`: `translate()` keeps the last `across`/`down` per element (a
   `WeakMap<HTMLElement, string>` or a property on the pooled element) and
   returns without writing when both are unchanged. `place()` only toggles
   `no-anim` and reads `offsetWidth` when the value actually changes.
2. `masthead.ts`: restart the fade (`fa`/`fb`) only when the text it shows
   changes — compare the new title/meta to what is on screen — never on a
   render that leaves them the same.
3. Smoke (`dev/smoke/shell.js`), page-side `MutationObserver` on `#rows`
   with `attributeFilter: ['style']`, `subtree: true`:
   - one → press on a row changes the style attribute of **at most 4**
     elements (the strip, the old and new focused tiles' neighbourhood, the
     ring) — assert the count, and assert it is > 0 (control);
   - a held arrow over 10 presses: mutations per press ≤ 4 on average;
   - the hero's title still updates to the focused tile after the debounce
     (existing step), and `#masthead`'s class changes **at most once** per
     content change across 5 presses that land on the same title (positive:
     exactly once when it lands on a new one).
   Run the mutation-count step against `feat/v2` and watch it fail.

## Out of scope
- Image sizes and decode (the raster floor shared with v1).
- The number of composited layers.

## Definition of done
- [ ] One → press mutates ≤ 4 inline styles under `#rows` (smoke, failing on `feat/v2`).
- [ ] The hero fade restarts only when its content changes (smoke).
- [ ] Existing smoke passes, including `sections.js:952`.
- [ ] the gate passes (`crew gate .claude/tasks/066-a-key-press-restyles-only-what-moved.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)
- [ ] (orchestrator, after merge) the CDP pan on the TV: style recalc median elements ≤ 5, and total style time under v1's 412 ms.

## Review rounds

## Graph writes proposed
