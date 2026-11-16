---
id: 062
slug: the-v2-top-menu
status: approved
branch: crew/062-the-v2-top-menu
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - index.html
  - css/v2.css
  - src/view/menubar.ts
  - src/screen/browse.ts
  - src/app.ts
  - src/core/ui.ts
  - eslint.config.mjs
  - dev/smoke/shell.js
  - dev/smoke/sections.js
  - dev/smoke/browse.js
  - dev/smoke.js
  - src/view/hud.ts
  - css/base.css
---

# The v2 top menu, and a background that travels between pages

## Goal
▲ from the first row opens a row of glass tiles at the top — Home, Movies,
TV, Kids, Collections, Discover, More — pushing the page down; ◀ ▶ change
page (with the background's glow shift), ▼ or BACK close it. It replaces the
left sidebar as the way round the app.

## Why now
`docs/v2-spec.md` §3; `docs/v2-decisions.md` adds Kids as a category and a
Servers entry. After 061.

## Existing work
After 061 (`index.html`, `css/v2.css`, `src/app.ts`, `src/core/ui.ts`,
`dev/smoke/shell.js`).

## Background
- Today navigation is `src/view/sidebar.ts` (open/close/isOpen/key), opened
  by ◀ off the start of a row (`browse.ts key()` ~1423) and published to smoke
  as `window.Sidebar` (`src/seam.ts`, used by `sidebarPick` in
  `dev/smoke/sections.js`).
- Pages map onto existing loaders in `src/screen/browse.ts`: Home = the
  library page with Continue watching (`loadSection` of the current section,
  row 0) plus the discovery rows; Movies / TV = `loadSection` on that
  section; Discover = `loadDiscover`; Kids = `openKids` (same path as the
  sidebar and yellow). Collections = the servers' collections (task 040's
  sidebar group) until v2 designs it. **More** = the existing sidebar, as it
  is (sections, categories, Search, Clear from Continue watching, Devices,
  Panel, Autoplay, Theme music), so nothing is lost. Stuart, 2026-11-16:
  "agree with quick fix and investigate later" — the real per-server browser
  is its own task (064), not this one.
- Spec numbers: content pushes down ~130 px over `--t-menu`; glass from spec
  §2 at 0.7 alpha for tiles; focus = 3 px white ring on pills.

- **The background changed in the updated handoff (2026-11-16,
  `docs/v2-spec.md` §7, `tools/motion-lab.html` lines 37-40 and
  `shiftGlow`).** 061 built the first version (three oversized glows nudged by
  tens of px over 700 ms). The new one: three *smaller* blobs that travel a
  long way on a page change, in different directions, over 800 ms —
  g1 1500×1200 at (1000, −500), rgba(154,47,69,.85) to 0 at 68%; g2 1400×1100
  at (−500, 500), rgba(47,91,168,.7); g3 1000×800 at (1300, 600),
  rgba(154,47,69,.35). Offsets for page p: g1 (−260p, 70p), g2 (220p, −90p),
  g3 (−160p, 110p). Optional drift while moving along a row (focus index f,
  row r): g1 x −22f, y +60r; g2 x +16f, y −50r; g3 x −12f.

## Constraints that bite here
- Transform and opacity only; the menu and `#rows` move by custom
  properties.
- BACK unwinds: modal, then menu, then page history (spec §3).
- Kids must stay one code path (graph: "Kids menu entry and yellow share
  loadKids").

## Approach
1. `src/view/menubar.ts` (view layer, owns no state beyond focus): builds the
   seven tiles (Home, Movies, TV, Kids, Collections, Discover, More — the
   order in the updated spec §Kids) in `#menubar`, `open(page)`, `close()`, `isOpen()`, `key(code)`
   returning the chosen page or null. Glass tile styles in `css/v2.css`.
2. `browse.ts`: ▲ on row 0 opens the menu (`#browse.menu` class pushes
   content down 130 px); ◀ ▶ move between tiles **and change page at once**
   (loaders above), calling `ui.setPage(i)` for the glow shift; ▼ or BACK
   close; OK closes. More opens the existing sidebar. ◀ off the start of a
   row no longer opens the sidebar.
3. **Background travel**: update 061's `#bg` glows and `ui.setPage` to the
   new sizes, gradients, offsets and 800 ms (`--t-glow`). The tuning panel's
   key 3 becomes three-way like the lab: static / moves on page change / also
   drifts along a row (drift fed from `browse.ts` focus changes, through
   custom properties, skipped while `.no-anim` is on). Default: moves on page
   change.
4. A small chevron above the first row hints that ▲ opens the menu (spec §3).
5. Smoke: rewrite `sidebarPick` users in `sections.js` / `browse.js` to go
   through the menu or the More entry; new steps in `shell.js` — ▲ opens
   the menu with seven tiles in order (assert text); → moves to Movies and the
   rows become the Movies section; the glows' committed offsets change by the new amounts (positive values);
   with drift on, moving along a row changes g1's x; ▼
   closes and focus is back on row 0; Kids opens the Kids page; More opens
   the sidebar and a category there still works.

## Out of scope
- New page designs for Movies, TV, Collections, Discover (later tasks).
- Profiles, the avatar chip, the clock.

## Definition of done
- [ ] The menu opens, changes pages and closes as described (smoke, positive assertions).
- [ ] Every page reachable from the old sidebar is reachable from the menu or More.
- [ ] The left-off-the-row sidebar route is gone.
- [ ] the gate passes (`crew gate .claude/tasks/062-the-v2-top-menu.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed


Unblocked 2026-11-16 by the orchestrator: `dev/smoke.js` added to `files:`. `openSidebar()` (~line 573) becomes menu-then-More (▲ to open the bar, → to More, OK), so `sidebarPick`, `watchingPick`, `sidebarWalkTo` and every suite built on them keep working unchanged.
