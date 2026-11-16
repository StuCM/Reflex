---
id: 061
slug: the-v2-shell-and-its-tuning-panel
status: approved
branch: crew/061-the-v2-shell-and-its-tuning-panel
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - css/base.css
  - css/v2.css
  - css/fonts/space-grotesk-latin-500-normal.woff2
  - css/fonts/space-grotesk-latin-700-normal.woff2
  - css/fonts/LICENSE
  - css/noise.png
  - index.html
  - package.json
  - package-lock.json
  - src/view/hud.ts
  - src/core/ui.ts
  - src/app.ts
  - src/view/masthead.ts
  - eslint.config.mjs
  - dev/smoke/shell.js
  - dev/smoke.js
---

# The v2 background, motion settings, and a tuning panel on the real app

## Goal
The app runs on v2's background (near-black with three soft glows and a
static noise layer that hides banding), with v2's fonts and Stuart's chosen
motion settings, and a hidden tuning panel that carries the motion lab's
toggles and its fps / worst-frame / jank / key-to-frame numbers — over real
posters and heroes.

## Why now
First task of v2 (`docs/v2-spec.md` §2 and §7, overridden where
`docs/v2-decisions.md` says). Stuart, 2026-11-16, after the motion lab on the
B8: "it needs built in to the app as I need posters to come up and hero
images to show to really see"; focus = scale; gradient shift on but "very
liney on the tv"; timing slow; shadows on; hero undecided; skip-on-repeat on.

## Existing work
None. Branch base is `feat/v2`. Tasks 062 (top menu) and 063 (Home look)
follow and depend on this.

## Background
- `css/base.css :root` holds the tokens (`--bg`, `--ac`, `--t-quick` 180,
  `--t-move` 340, `--t-fade` 620, `--ease`, the same cubic-bezier as the lab).
  Inter 400/500/600 is bundled in `css/fonts` with an OFL `LICENSE`. **Space
  Grotesk is not**: add `@fontsource/space-grotesk` (OFL) as a devDependency,
  copy the latin 500 and 700 woff2 into `css/fonts`, append its licence.
- No noise or dither asset exists. Banding on the B8 comes from 8-bit radial
  gradients on near-black.
- `src/view/masthead.ts:20` `HOLD = 420` is the hero debounce today.
- The motion lab (`tools/motion-lab.html`) drives everything from CSS
  variables on its stage and classes (`fast`, `shadows`, `wc1`, …). Its
  `style.webkitTransform =` writes are not allowed here: set custom properties
  (`setProperty('--gx', …)`) and let CSS do the transform.

## Graph context
- "A step can be structurally unable to see the thing it tests": read
  transforms page-side from committed values, not rects mid-transition.
- `src/view/rail.ts place()` relies on reading `offsetWidth` to commit a
  no-animation jump before transitions return: do not add and remove the
  no-animation class in the same frame.
- The 160 ms rail settle gates poster *fetches*; keep it for that only.
- Serialise gates; smoke areas share one IndexedDB.

## Constraints that bite here
- Only `transform` and `opacity` animate. No filter or blur on the glows.
- `will-change` on containers only (`#rows`, `.strip`, `.glow`, the hero
  layers), never on `.tile`.
- No inline style except custom properties; DOM through `fill`/`put`.

## Approach
1. **Tokens** (`css/base.css`): v2 colours (`--bg: #0B0912`, the three glow
   colours from spec §2). **Timing reuses the existing tokens** — every
   transition in `css/browse.css`, `show.css`, `detail.css` already reads
   `--t-quick` (focus), `--t-move` (rows) and `--t-fade` (`css/base.css:35-37`).
   Set them to the slow preset (180 / 360 / 620) and add only `--t-menu 420ms`
   and `--t-glow 700ms`. The panel's timing presets rewrite those tokens on
   `:root`. Space Grotesk `@font-face` 500/700.
2. **Background** (`index.html`, `css/v2.css`): `#bg` as the first child of
   `<body>`, behind every view: three oversized `.glow` divs with the spec's
   radial gradients (positions as in the lab: g1 2200×1700 at 900,−700; g2
   2000×1500 at −900,300; g3 1500×1100 at 1300,500), each translated by
   `--gx/--gy`, transitioning over `--t-glow`; and `#bg::after` a tiled
   `css/noise.png` (generate offline: 128×128 greyscale noise, opaque, used at
   `opacity: 0.05` so it can be tuned) over them. Hidden (class on body) when
   the view is detail, show or player, whose scrims are still v1.
   `ui.setPage(i)` sets the glow offsets (the lab's per-page offsets: g1
   −90i,30i; g2 70i,−40i; g3 −50i,50i). Nothing calls it with more than 0 yet
   except the panel's test key (062 wires pages).
3. **Skip on repeat** (`src/app.ts onKey`, `src/core/ui.ts`): a key is
   *fast* if `event.repeat` or under 110 ms since the last arrow. Fast arrows
   add the **existing** `.no-anim` class (`css/browse.css:235`, already used
   by `src/view/rail.ts:102`) to `#browse`, and a 160 ms timer removes it
   after the last one. On by default (Stuart chose it after it was explained:
   held arrows jump instead of animating); the panel can turn it off.
4. **Hero debounce**: `masthead.ts` reads the debounce from a setting
   (default 280 ms) instead of the constant.
5. **Tuning panel** (`src/view/hud.ts`, `#hud`, `css/v2.css`): hidden by
   default, toggled with **Blue** on the browse view. While visible, number
   keys cycle: 1 hero debounce (0 / 150 / 280 / 420), 2 will-change (off /
   containers), 3 glow shift (on / off; test with 9 = next fake page),
   4 shadows (on / off), 5 timing (fast / default / slow, the lab's three
   presets), 6 skip on repeat (on / off), 7 noise opacity (0 / 0.03 / 0.05 /
   0.08), 0 reset stats. Its readout is the lab's: fps (frames in the last
   second), worst frame in 2 s, jank (frames > 25 ms since reset),
   key>frame (keydown to next frame), and the current value of each toggle.
   The rAF loop runs only while the panel is visible. Settings persist in
   `localStorage` (wrapped in try/catch) and apply on launch. Number keys and
   Blue do nothing new while the panel is hidden.
6. **Focus = scale and shadows**: shadows on `.tile-inner` are static
   (`box-shadow`, not animated), toggled by a `.shadows` class on `#browse`.
   The focus already scales `.tile-inner`; leave the size change to 063.
7. **Layers**: add `hud.ts` to the `LAYERS` table in `eslint.config.mjs`
   (`view`).
8. **Smoke** `dev/smoke/shell.js` (register the area in `dev/smoke.js`):
   `#bg` has three glows and the noise layer; Blue shows the panel with a
   non-zero fps after a second; key 9 changes the glows' committed
   `--gx` (read page-side) and back; key 5 changes the computed `transition-duration` of a `.strip` (not
   just a value on `:root`); a
   setting survives a reload; with the panel hidden, number keys change
   nothing; Space Grotesk is loaded (`document.fonts.check('700 20px "Space
   Grotesk"')`). Run against `feat/v2` before the change and watch it fail.

## Out of scope
- The top menu and pages (062). Poster sizes, Home layout, hero styling (063).
- Restyling detail, series page or player.
- Profiles and accent colours.

## Definition of done
- [ ] On the laptop the browse view sits on the v2 background with glows and noise; detail/show/player do not show it.
- [ ] Blue opens the tuning panel with live numbers; its toggles change the app's actual behaviour and persist across a reload (smoke).
- [ ] Held arrows skip animation; single presses animate.
- [ ] Space Grotesk 500/700 ship in the package (unzip the `.ipk` from `npm run package` and list them; say so in the report).
- [ ] the gate passes (`crew gate .claude/tasks/061-the-v2-shell-and-its-tuning-panel.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
