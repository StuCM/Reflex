---
id: 081
slug: the-menu-the-boards-draw
status: approved
branch: crew/081-the-menu-the-boards-draw
model: opus
env: laptop
rounds: 0
work: v2-movies-tv
files:
  - src/view/menubar.ts
  - src/view/hud.ts
  - src/view/glyphs.ts
  - src/view/clock.ts
  - src/screen/browse.ts
  - src/app.ts
  - index.html
  - css/v2.css
  - css/base.css
  - dev/smoke.js
  - dev/smoke/shell.js
  - dev/smoke/browse.js
---

# The top menu is the one the boards draw: tabs at rest, icon tiles on Up, and a clock

## Goal
At rest every browse page shows the boards' text tab bar (Home · Movies · TV ·
Kids · Collections · Discover) with the current page underlined, a drawn
chevron above it, and the clock top right. Up from the first row hides the
hero and shows the glass icon tiles of `designs/v2/ComboMenu.dc.html` — the
board's eight with Home first and Servers last — with the
page's first row dimmed below a "<row title>" hint. Menu motion is 300 ms.

## Why now
Stuart, 2026-11-26: "we need to make sure we stick to the designs. I think
creating the correct menu should be first"; the boards are canonical over the
spec's "content pushes down 130px"; "Add Home to the list we have and add
icons"; "Use 300ms"; "yes add the clock in"; "The designs must match
exactly"; the menu "Should also show the servers so we can select those for
the old lists"; 300 ms is the tuning panel's menu value only ("yes").

## Existing work
Replaces 062's pill strip. Base `feat/v2`. First in the group.

## Background
Board values (`designs/v2/Combo.dc.html`; `ComboMenu.dc.html` is Combo with
`layout="menu"`):
- **Tab bar** (closed): top 22, centred across 1920; chevron 28px SVG
  `M6 15l6-6 6 6`, stroke rgba(255,255,255,.55) width 2.2, 6px above the
  labels. Labels Space Grotesk 600 30px, 48px apart; active #fff with a 3px
  accent underline (`--ac`) and 8px padding-bottom; inactive
  rgba(255,255,255,.42). Combo lines 21-31.
- **Open** (lines 109-124): tab bar and hero hidden; tiles at left 96, top 220,
  one row, 28 apart, centre-aligned; rest 160×160 radius 30, focused 220×220
  radius 38. Rest glass `linear-gradient(180deg, rgba(255,255,255,.2),
  rgba(255,255,255,.08)), rgba(22,16,44,.74)`, border 1px
  rgba(255,255,255,.26), shadow `inset 0 1px 0 rgba(255,255,255,.3), 0 12px
  30px rgba(0,0,0,.3)`. Focused `(.36→.16)` over rgba(44,34,84,.9), ring
  `0 0 0 3px rgba(255,255,255,.95)`, `inset 0 1px 0 rgba(255,255,255,.5)`,
  `0 24px 60px rgba(0,0,0,.5)`. Icon 52px (76 focused), stroke 1.7, over the
  label 24px (30 focused) weight 600, 10px apart. A chevron-down + row title
  at top 486 (26px, 600, rgba(255,255,255,.55)); the row dimmed to opacity .4,
  **posters only** — every poster 176×264 (none enlarged), top 775, left 96,
  stride 202; no row title above and no captions under; no backdrop.
- **Clock**: right 96, top 44, 32px 600, rgba(255,255,255,.7), on every board.
- Tab labels: Combo l.160 `['Home','Movies','TV','Kids','Collections','Discover']`.
- Tiles and icon paths: Combo `defs` l.191-200, in order Movies, TV,
  Collections, Discover, Streaming, Kids, Search, Settings. Home and Servers
  have none.
- `src/view/hud.ts:18-22, 93-96`: the default `timing: 2` writes
  `--t-menu: 420ms` on `:root` at boot, overriding `base.css:38`.
- Code today: `src/view/menubar.ts` (`PAGES` l.5, 150 ms settle), `css/v2.css:
  67-100` (`#menubar`, `.mb-tile`, push-down, `#menu-hint`), `css/base.css:38
  --t-menu` 420ms, `index.html:55-56`, `browse.ts:325-334 menuKey`, `:1486` Up
  opens, `:1112-1113` close/abandon.
- Smoke: `shell.js:413-545` (labels, `.menu` on `#browse`, 150 ms settle, Kids
  and More); `smoke.js:599-660` helpers `menuIsOpen`, `topRow`,
  `openSidebar`, `toMore` read `#menubar .mb-tile` and `.on` — used across
  browse/sections/deck/show/player smoke files. **Keep `.mb-tile` and `.on`.**

## Board values
Everything in Background marked as board values, verbatim.

## Differs from board, because
- Home first and Servers last among the tiles: Stuart.
- Kids in the tab bar is the board's own; More removed (Settings/Servers take its job).
- The tile row winds past ten tiles: the board draws eight.
- The clock shows the real time; the board's "19:05" is placeholder.

## Graph context
- Animate only transform and opacity. The glass gradients and shadows are
  static; focus swaps a class, the shadow is never transitioned.
- "Root custom properties kill B8 panning": per-tile offsets go on the tiles,
  never on `:root`.
- No flex `gap` (Chrome 84): margins. No `backdrop-filter`.
- "Accent fill defeated the focus ring": the focused tile is told by size and
  the white ring, not by accent fill.

## Approach
1. `glyphs.ts`: the eight board icons from Combo's `defs`, plus Home (a
   house) and Servers (stacked drives) drawn in the same 24-unit grid, stroke
   1.7.
2. `menubar.ts` + `index.html`: two parts — `#tabs` (chevron + the six board
   labels) and `#menubar` (ten tiles: Home, Movies, TV, Collections, Discover,
   Streaming, Kids, Search, Settings, Servers; each `.mb-tile` with icon +
   label, `.on` on the focused one). Search opens search; Settings and Servers
   open today's sidebar (Servers on its server sections, the old lists);
   Streaming shows a "Coming soon" toast until its page exists. More is gone.
   Ten tiles at board size run past 1824px, so the row winds by transform when
   focus nears the right edge, as the rail does — sizes never shrink.
3. Sizes are the board's exactly — rest 160 / icon 52 / label 24, focused
   220 / icon 76 / label 30, radius 30 / 38. No scale approximation (a .727
   scale gives 21.8px labels, not 24). Focus swaps a class that changes those
   sizes; the board draws no growth animation, so none is added.
4. Open: `#tabs`, `#masthead` and `#hero-art` fade out, `#viewport` moves so
   the first row's posters sit at top 775 at opacity .4, with the row title,
   the captions under the tiles and the focused-tile enlargement hidden, `#menu-hint` shows the
   first row's title. Closed: the reverse. All on `--t-menu`; in `hud.ts` the
   menu timing value becomes 300ms (the other timings unchanged).
5. `src/view/clock.ts` (new): draws `HH:MM` into `#clock`, scheduled to the
   next minute boundary (no per-second timer); started from `app.ts`, hidden
   while the player is up.
6. Smoke (`shell.js`): at rest the tab bar shows the six labels with `.on` on
   the current page and changes on a page switch; Up shows ten tiles each
   with an `svg`; Servers opens the sidebar; the More helpers in `smoke.js`
   (`toMore`, `openSidebar`) move to Settings/Servers; `#masthead` computed opacity 0 once open; `--t-menu` is
   300ms; `#clock` text matches the page's own `HH:MM`. Re-time the settle step
   only if 300 ms breaks it; keep its 150 ms settle.

## Out of scope
- Avatar/profile chip (profile screens). Any page content.

## Definition of done
- [ ] Tab bar visible at rest with the current page underlined (smoke, positive text).
- [ ] Up shows ten icon tiles, hero hidden, first row dimmed under its title (smoke).
- [ ] Motion is 300 ms, transform/opacity only; no style on `:root` per key (smoke + lint).
- [ ] Clock shows the time and changes on the minute (smoke with a fake clock or page-side check).
- [ ] Every existing menu helper in `dev/smoke.js` still works (`npm run smoke`).
- [ ] Every value under **Board values** is asserted in the smoke by computed style or rect (px, colour, alpha, font, weight); anything that differs is listed under **Differs from board, because**, and nothing else may differ. The reviewer opens the board (`designs/v2/<board>.dc.html`, now rendering with `support.js`) beside the app at 1920×1080 and checks both lists.
- [ ] the gate passes (`crew gate .claude/tasks/081-the-menu-the-boards-draw.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

- Person, side by side (orchestrator opened ComboMenu.dc.html and the app at 1920×1080, measured by rect): tiles, hint (top 486) and clock match. The tray does not: board posters are all 176×264 at top 775, stride 202, no row title, no captions, no backdrop; app posters start at 724, the first is enlarged, the row title and captions show, and `#hero-art` stays visible. Spec Background/Approach 4 corrected; DoD "seven" → ten; `dev/smoke/browse.js` added to `files:` for the stale "More" strings. Assert the tray by rect against these numbers.

## Worker notes

## Graph writes proposed
