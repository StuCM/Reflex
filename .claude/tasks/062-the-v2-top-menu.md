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
---

# The v2 top menu: Home, Movies, TV, Collections, Discover, Kids, More

## Goal
▲ from the first row opens a row of glass tiles at the top — Home, Movies,
TV, Collections, Discover, Kids, More — pushing the page down; ◀ ▶ change
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

## Constraints that bite here
- Transform and opacity only; the menu and `#rows` move by custom
  properties.
- BACK unwinds: modal, then menu, then page history (spec §3).
- Kids must stay one code path (graph: "Kids menu entry and yellow share
  loadKids").

## Approach
1. `src/view/menubar.ts` (view layer, owns no state beyond focus): builds the
   seven tiles (Home, Movies, TV, Collections, Discover, Kids, More) in `#menubar`, `open(page)`, `close()`, `isOpen()`, `key(code)`
   returning the chosen page or null. Glass tile styles in `css/v2.css`.
2. `browse.ts`: ▲ on row 0 opens the menu (`#browse.menu` class pushes
   content down 130 px); ◀ ▶ move between tiles **and change page at once**
   (loaders above), calling `ui.setPage(i)` for the glow shift; ▼ or BACK
   close; OK closes. More opens the existing sidebar. ◀ off the start of a
   row no longer opens the sidebar.
3. A small chevron above the first row hints that ▲ opens the menu (spec §3).
4. Smoke: rewrite `sidebarPick` users in `sections.js` / `browse.js` to go
   through the menu or the More entry; new steps in `shell.js` — ▲ opens
   the menu with seven tiles in order (assert text); → moves to Movies and the
   rows become the Movies section; the glows' committed offsets change; ▼
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
