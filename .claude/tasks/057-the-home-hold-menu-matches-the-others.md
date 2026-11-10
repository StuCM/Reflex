---
id: 057
slug: the-home-hold-menu-matches-the-others
status: approved
branch: crew/057-the-home-hold-menu-matches-the-others
model: sonnet
env: laptop
rounds: 0
work: browse-polish
files:
  - index.html
  - css/base.css
  - css/show.css
  - css/browse.css
  - src/view/hold.ts
  - src/view/menu.ts
  - src/screen/browse.ts
  - src/screen/showpage.ts
  - src/app.ts
  - dev/smoke/browse.js
  - dev/smoke/show.js
---

# The home-row hold menu is the same menu as the series page's, and a hold always lands

## Goal
Holding OK on a film in the home rows opens the same menu the series page
opens on an episode — anchored by the tile, with a heading, icons, a scrim and
the other tiles dimmed. And a long press works every time, not just sometimes.

## Why now
Stuart, 2026-11-10: "The hold for menu on the home page doesn't show the same
overlay as the other pages. Stick to a consistent design." — "long press
didn't always work".

## Existing work
None in flight. Runs before 058 (both touch `showpage.ts`, `css/show.css`,
`dev/smoke/show.js`).

## Background
- 048 put the film menu on the plain `#confirm` host
  (`src/screen/browse.ts:1344`): no head, no icons, no scrim, no anchor.
  `#confirm` is also the deck-removal confirmation (`askThen`,
  `browse.ts:375`) — **do not restyle `#confirm`**.
- The reference is 031's episode hold menu: host `#sh-menu`
  (`showpage.ts:44`), `menu.open({ host, head: { kicker, title }, tabs:
  [{ label: '', rows }] })` with glyph icons (`showpage.ts:730-753`),
  `anchorMenu` (~`showpage.ts:715`, MENU_W 512, MENU_EDGE 32), and
  `css/show.css:201-262` (`#show.holding::after` scrim, dimmed cards, the
  `#sh-menu` box, `.menu-kicker`, `.menu-head-title`). `src/view/menu.ts`
  already supports `head`, row `icon` and `note`.
- `src/view/hold.ts` (`createHold`): the 500 ms timer alone fires a hold, so
  a remote that never repeats is fine. The faults are elsewhere:
  - **A (likeliest):** `held` is cleared only by `up()`, and `app.ts:417
    onKeyUp` routes keyup only to the *current* view. A hold on a non-film
    tile calls `openFocused()` while OK is still down, the keyup goes to the
    film page, and browse's `held` stays true — so the next OK on the home
    rows is swallowed.
  - **C:** the timer is not cancelled by other keys: OK down then → within
    500 ms fires the menu on the *new* tile. Same on the series page.
  - **B:** any lost keyup leaves `held` stuck the same way.

## Graph context
- Decision "OK on an episode acts on keyup": a tap acts on keyup because
  playing is irreversible — keep that.
- Pattern "held OK fired the menu row repeatedly": repeated keydowns while
  held must not choose a row — keep `swallow`.
- Pattern "Playwright cannot hold a key": `holdOk()` sends one keydown; the
  browse step already injects synthetic repeats.

## Approach
1. **One menu look.** Add `<div id="hold-menu" class="hidden">` beside
   `#confirm` in `index.html`. Move the hold-menu block (`#sh-menu` rules,
   `.menu-kicker`, `.menu-head-title`) from `css/show.css` to `css/base.css`
   as a shared class `.hold-menu`, put that class on both `#sh-menu` and
   `#hold-menu`, and keep page-specific bits (the scrim selector) per page.
   Lift `anchorMenu`'s arithmetic into a pure helper in `src/view/menu.ts`
   (rect in, left/top out, clamped) used by both pages.
2. **Browse.** `openFilmMenu` uses `#hold-menu`, a head (kicker: the year,
   title: the film), icons (`glyphs.watched`, `glyphs.remove`; reuse
   `watched` for unwatched if no glyph exists), anchored from `.tile.on`'s
   `getBoundingClientRect()`. A `holding` class on the browse view draws the
   scrim and dims the other tiles (opacity only; `css/browse.css`).
   `onClose` removes it.
3. **Holds always land (`src/view/hold.ts`):** `cancel()` clears `held` and
   the timer; screens call it on any non-OK keydown (fixes C) and whenever
   their view is left (fixes A). `app.ts onKeyUp` passes OK keyups to both
   `browse.keyUp` and `showpage.keyUp` whatever the view, so a held flag is
   always released. A hold on a non-film tile stays a tap (opens it), but
   releases the hold first.
4. **Smoke** `dev/smoke/browse.js`: the hold step reads the menu from
   `#hold-menu` (the removal confirmation still on `#confirm`); asserts the
   head title is the film's and the menu's rect is on screen (32..1888 ×
   32..1048) and next to the focused tile; the scrim is present. New step:
   hold OK on a **show** tile (opens it), BACK, then a single OK tap on a
   film opens the film page — failing on `main`. New step: OK down, → within
   500 ms, OK up — no menu opens. `dev/smoke/show.js`: the episode hold menu
   still passes unchanged.

## Out of scope
- Hold menus for shows or collections on the home rows (hold stays a tap).
- New menu rows. The film page's own menus.

## Definition of done
- [ ] The home-row film hold menu uses the shared hold-menu look, anchored to the tile, with head, icons and scrim (smoke).
- [ ] After a hold on a show tile and BACK, the next OK tap works (smoke, failing on `main`).
- [ ] A key pressed during the 500 ms window cancels the hold (smoke).
- [ ] `#confirm` and the deck-removal confirmation are unchanged; the series page hold menu passes unchanged.
- [ ] the gate passes (`crew gate .claude/tasks/057-the-home-hold-menu-matches-the-others.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
