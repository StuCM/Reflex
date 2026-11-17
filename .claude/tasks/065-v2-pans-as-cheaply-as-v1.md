---
id: 065
slug: v2-pans-as-cheaply-as-v1
status: review
branch: crew/065-v2-pans-as-cheaply-as-v1
model: sonnet
env: laptop
rounds: 1
work: v2-shell
files:
  - src/core/ui.ts
  - src/app.ts
  - src/view/hud.ts
  - src/view/rail.ts
  - css/base.css
  - css/v2.css
  - css/browse.css
  - dev/smoke/shell.js
  - dev/smoke/browse.js
gate: pass
gateSha: 3af98ab8b99a13a51d88190cf67ea0c08f7bd938
gateAt: 2026-11-17T13:53:41.251Z
---

# v2 pans no worse than v1, the label clears the zoom, and focus style is tunable

## Goal
Panning a row in v2 costs the TV no more than v1 does; the focused poster's
label is never covered by its zoom; and the tuning panel can switch the focus
between scale, sliding ring and both, with Stuart's measured settings as the
defaults.

## Why now
Stuart, 2026-11-17, on Reflex v2 on the B8: "the scale up covers the label.
Performance is not great"; a fast pan dropped "below 10fps" with background
static, noise 0 and shadows off. A diagnostic build (drift writes off the
page root) brought it to ~12 fps and "looks smoother. Best results with hero
at 420 and wc on."

## Existing work
None in flight. Base `feat/v2`.

## Background — measured on the TV over CDP, 2026-11-17
Same synthetic fast pan (24 → presses at 50 ms, then 24 ←), v1 (`com.stu.plexlite`)
against the v2 diagnostic build:

| | v1 | v2 (diag) |
|---|---|---|
| frame time, avg / worst | 77 / 117 ms | 79 / 167 ms |
| keydown handler, median | 11.2 ms | 9.8 ms |
| style recalc, total / median elements | 412 ms / **2** | 709 ms / **67** |
| layers updated per commit | 15 | 26 |
| main thread / GPU thread busy | 68% / 69% | 71% / 73% |
| `TimerBase::run` on main | — | 239 ms in 1.5 s |

So a fast pan is about as slow in v1 (the raster and main-thread floor is
shared), and what v2 adds is: a 30× wider restyle per frame, ~11 more
composited layers, and timer work v1 does not have. Causes found in the code:

1. **`setDrift`** (`src/core/ui.ts:72-77`) writes `--f`/`--r` on
   `document.documentElement` on every render, drift on or off. On Chrome 53 a
   custom property on the root restyles the whole document. The diagnostic
   build that moved them to `#bg` and skipped them unless `body.drift` turned
   <10 fps into ~12 fps.
2. **Skip-on-repeat** (`src/app.ts:365-375`) adds and, 160 ms later, removes
   `.no-anim` on `#browse`, and `css/browse.css:247` is `.no-anim, .no-anim *`
   — every element under `#browse` restyles on each toggle, and the timer
   fires per burst.
3. **Layers**: 061/062/063 added `will-change`/transform layers (glows, hero
   layers, tiles' scale transition). Panel key 2 toggles `will-change` on
   containers; Stuart's best result was with it **on**.

## Graph context
- Pattern "root custom properties kill B8 panning" (2026-11-17): never set a
  custom property on `:root` per key or frame; scope it to the smallest
  ancestor that reads it.
- `src/view/rail.ts` `place()` already adds/removes `no-anim` on a row to
  commit a jump (`rail.ts:103-106`) — keep that local pattern.
- "Bigger element, fixed-height clipped parent"; read transient states
  page-side.

## Approach
1. **Drift**: `setDrift` writes `--f`/`--r` on `#bg` (the glows' parent), and
   returns at once unless `document.body.classList.contains('drift')` —
   exactly the diagnostic build.
2. **Skip-on-repeat**: put `.no-anim` on `#rows` (the strips and tiles), not
   `#browse`, so the hero, menu and background are not restyled; only toggle
   when the state changes (add once per burst, remove once).
3. **Defaults** (`src/view/hud.ts`): hero debounce 420 ms, `will-change`
   containers **on**. Existing saved settings are kept.
4. **Focus style** (panel key 8, persisted, default scale): scale / ring /
   both, as in `tools/motion-lab.html` (`mode-scale|ring|both`, a single
   `#ring` element slid by transform over the focused tile). Classes on
   `#rows`, not on `:root` or `#browse`.
5. **Label**: when the focused tile scales, its `.tile-title` moves down by the
   extra height (transform only: `translateY` of `(1.19 − 1) × 264` px), so the
   poster never covers it. In ring mode it stays put.
6. **Smoke**:
   - a page-side `MutationObserver` on `document.documentElement` counts style
     attribute writes during 10 → presses: **zero** (control: the same
     observer on `#bg` counts > 0 with drift on);
   - with drift off, `#bg` gets no writes either;
   - `.no-anim` appears on `#rows` during a held arrow and never on `#browse`;
   - the focused tile's title rect is below its poster's rect (both modes);
   - key 8 cycles the focus style and the ring follows the focused tile.
   Run the root-writes step against `feat/v2` and watch it fail.

## Out of scope
- The raster/GPU floor shared with v1 (poster image sizes, decode) — a later
  task if the TV still feels slow after this.
- Hero layout, menu, pages.

## Definition of done
- [ ] No style writes on the document root during a pan (smoke, failing on `feat/v2`).
- [ ] `.no-anim` toggles on `#rows` only, once per burst.
- [ ] Defaults hero 420 ms and will-change on; focus style key cycles scale / ring / both.
- [ ] The focused label is never under its poster (smoke, both focus modes).
- [ ] the gate passes (`crew gate .claude/tasks/065-v2-pans-as-cheaply-as-v1.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)
- [ ] (orchestrator, after merge) the same CDP pan on the TV: style recalc median elements ≤ 5 and layers per commit within 3 of v1.

## Review rounds

Round 1: PASS. Gate 147/147. Root-writes step verified to fail on feat/v2 (root writes 10, want 0).

## Changes
- src/core/ui.ts: setDrift writes --f/--r on #bg, only when body.drift.
- src/app.ts: no-anim toggled on #rows, only on change.
- src/view/hud.ts: hero default 420, new focus option (key 8) as f-ring/f-both on #rows.
- src/view/rail.ts: single #ring moved into the focused strip.
- css/browse.css: scale only unless f-ring; labels step down 25px (spec said 50px: a centre scale grows the poster 25px at the bottom); ring styles.
- dev/smoke/shell.js: new steps; no-anim check moved to #rows; hero 420.

Spec note: ring in both mode (182x270) sits inside the scaled poster; cosmetic, tune on the TV.

## Graph writes proposed
Pattern: crew gate runs over 120s; the commit-msg hook rejects scope v2 (use rail).

## Graph writes proposed
