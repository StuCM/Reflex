---
id: 028
slug: the-rail-recycles-one-tile-a-move
status: approved
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
- [ ] Moving one step along a long row changes exactly **one** tile's `_item`
- [ ] A step asserts that count page-side, and its control is the old
      behaviour: run it against this task's base and watch it report **12**
- [ ] Walking a row still shows the right film under the right title — the
      existing "a tile carries no picture but its own while the row sweeps" and
      "a row walked twice keeps its pictures while it moves" both still pass
- [ ] Moving between rows still repaints, and paging deep into the All row
      still fills tiles
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
- Decision: a pooled rail assigns `tiles[index % POOL]`, not `tiles[offset]`.
  Linear assignment makes the whole pool change identity per step and renders
  the short-circuit dead. Refines Decision/defer the lookup, not the paint.
