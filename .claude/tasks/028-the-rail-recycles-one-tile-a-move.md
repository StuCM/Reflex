---
id: 028
slug: the-rail-recycles-one-tile-a-move
status: done
branch: crew/028-the-rail-recycles-one-tile-a-move
model: sonnet
env: laptop
files:
  - src/view/rail.ts
  - dev/smoke/browse.js
---

# One press moves the strip and changes one tile, not twelve

## Goal
Scrolling a row hands exactly one tile a different film — the one wrapping from
the trailing edge to the leading edge. The other eleven keep their item, their
picture and their text, and do no work at all.

## Why now
The user asked why the rail refreshes on every move rather than translating and
fetching one new image. It is the right question: the strip already translates,
but the pool is reassigned linearly, so every tile changes identity per press.
This is the cause of the roughness reported from the panel; 027 made the
symptom cheap.

## Base — read this first
**Branch from `crew/027-a-cached-poster-paints-while-the-rail-moves`, not from
`main`.** 027 is merged-pending and touches both of the files below. It adds a
`drawn` Set and `drawHeld()`, which this task keeps and relies on: after this
change the single recycled tile is the only one that ever needs them.

## Graph context
`src/view/rail.ts` `drawRow`, at line 227:

```ts
rowElement._tiles.forEach((tile, offset) => {
  const index = start + offset;        // ← linear
```

`start` advances with the focus, so every tile's `index` shifts by one per
press and every tile is handed a different item. The short circuit at line 242

```ts
if (tile._idx === index && !(tile._deferred && onScreen)) { … return; }
```

exists to skip exactly that work, and under linear mapping can essentially
never fire.

The strip itself is already one transform — `place(rowElement._strip,
-firstVisible * STRIDE, !reused)` — so nothing about the motion needs changing.
Tile position comes from `translate(tile, index * STRIDE, 0)`, a function of
the index and not of the slot, so a tile may sit anywhere in the strip.

**Three things were checked before speccing this; do not re-derive them.**

1. The pool is exactly the window. `TILE_POOL` is 12 (`rail.ts:50`) and the
   window is `start … start + 11`, so `index % TILE_POOL` is a bijection over
   the visible range and no two indices collide on one tile.
2. Nothing depends on DOM order, which modular assignment scrambles. Both smoke
   readers are order-independent, and `dev/smoke/browse.js` derives visual
   position from the committed transform (`base + xOf(t)`).
3. Focused tiles cannot overlap a neighbour, so arbitrary paint order is safe:
   `.tile.on .tile-inner` scales 1.05 — about 5px a side — against `GAP = 44`.

## Constraints that bite here
- 2018 SoC: the win is work not done. Do not add a per-frame loop, a sort, or a
  second pass over the pool to achieve it.
- `reused` (a different row in this pool element) still resets every tile —
  that is a real row change and must keep repainting all twelve.
- Task 021's rule stands: a tile must never show one film's picture above
  another film's title.
- `row.total < TILE_POOL` and the two ends of a row both clamp `start`, so a
  press there may change no tile at all. That is correct, not a bug.

## Approach
1. In `drawRow`, iterate indices rather than tiles. Replace the
   `rowElement._tiles.forEach((tile, offset) => …)` head with a loop over
   `index` from `start` to `start + TILE_POOL - 1`, taking
   `const tile = rowElement._tiles[index % TILE_POOL]`. The body is unchanged.
2. Leave the short circuit, `translate(tile, index * STRIDE, 0)`, the hidden
   handling for `index >= row.total`, and 027's `drawHeld()` exactly as they
   are. They all already key off `index`.
3. Change nothing else. If the body appears to need editing to work with the
   new head, stop and say so — that is a spec bug.

## Out of scope
- `SETTLE`, `art.warm()` cadence, motion, easing, `STRIDE`, `ROW_H`.
- The vertical pool of rows. Only the tiles within a row change mapping.
- 027's `drawn` Set and `drawHeld()` — kept as they are.
- The masthead, and anything outside `drawRow`.

## Definition of done
- [x] Moving one step along a long row changes exactly **one** tile's `_item`
- [x] A step asserts that count page-side, and its control is the old
      behaviour: run it against this task's base and watch it report **12**
- [x] Walking a row still shows the right film under the right title — the
      existing "a tile carries no picture but its own while the row sweeps" and
      "a row walked twice keeps its pictures while it moves" both still pass
- [x] Moving between rows still repaints, and paging deep into the All row
      still fills tiles
- [x] `npm run verify` passes
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## What changed
- `src/view/rail.ts` — `drawRow`'s tile loop now walks the *indices* of the
  window (`start` … `start + TILE_POOL - 1`) and takes
  `rowElement._tiles[index % TILE_POOL]`, so one step retires one index and adds
  one that lands on the same slot. The body is as it was bar `return` →
  `continue` and a `if (!tile) continue;` for `noUncheckedIndexedAccess`.
  027's `drawn`/`drawHeld()`, the short circuit, `translate`, the hidden
  handling and `settled()` are untouched.
- `dev/smoke/browse.js` — `installChurn()`/`churnReadings()` and a step, "one
  press along a row hands exactly one tile a different film": two rows down,
  four in, settle, then count per press how many of the twelve tiles hold a
  different `_item` than they did before the key. Items are compared by
  reference page-side, from a keydown listener registered after the app's.
  Against the base rail it fails with "press 1 handed 12 of 12 tiles a
  different film".

## What the spec got wrong
Nothing substantive. Two things the Approach's "the body is unchanged" could not
have been literally true about, both mechanical:

- The body's six `return`s exit the arrow function, so under a `for` head they
  had to become `continue`. No logic moved.
- `noUncheckedIndexedAccess` is on, so `rowElement._tiles[index % TILE_POOL]` is
  `RailTileElement | undefined` and needs the house `if (!tile) continue;`
  (`showpage.ts:120` is the same shape). It can never fire — the modulus is in
  range — but the compiler cannot see that.

## Review rounds

### Round 1 — crew-reviewer, 2026-09-11 — PASS

- Reproduced the control independently: the pre-028 `rail.ts` makes the new step
  fail with "press 1 handed 12 of 12 tiles a different film"; the diff's returns
  it to 20/20 in `browse`, 027's two steps included.
- `_tiles` is a dense twelve in `build()`, so `if (!tile) continue;` is
  unreachable and there only for `noUncheckedIndexedAccess` — as claimed above.
- The `reused` branch still resets `_idx = -1` on all twelve, so a real row
  change still repaints in full.
- Scope and commit convention clean. No findings.

## Graph writes proposed
- Decision: a pooled rail assigns `tiles[index % POOL]`, not `tiles[offset]`.
  Linear assignment makes the whole pool change identity per step and renders
  the short-circuit dead. Refines Decision/defer the lookup, not the paint.
