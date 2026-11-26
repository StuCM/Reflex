---
id: 081
slug: the-menu-the-boards-draw
status: done
branch: crew/081-the-menu-the-boards-draw
model: opus
env: laptop
rounds: 2
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
gate: pass
gateSha: bbb1849ac3ba338f8750d6de039130eebc35dd1a
gateAt: 2026-11-26T17:22:21.928Z
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

- Round 1 (ead7338): **PASS**. Advice: the DoD's "seven" should read ten; `#hero-art` stays under the open menu as Approach 4 says, though ComboMenu draws none (a follow-up if it must match exactly); arrowing off a page tile onto a non-page tile within 150ms cancels that page's settled load (old More behaviour); the search pill is hidden everywhere; `dev/smoke/browse.js` still says "More". None taken: the first two are spec decisions, the last is outside `files:`. The reviewer checked board values from the diff and CSS and did not open the board beside the app.

- Person, side by side (orchestrator opened ComboMenu.dc.html and the app at 1920×1080, measured by rect): tiles, hint (top 486) and clock match. The tray does not: board posters are all 176×264 at top 775, stride 202, no row title, no captions, no backdrop; app posters start at 724, the first is enlarged, the row title and captions show, and `#hero-art` stays visible. Spec Background/Approach 4 corrected; DoD "seven" → ten; `dev/smoke/browse.js` added to `files:` for the stale "More" strings. Assert the tray by rect against these numbers.

- Round 2 work (8dba8ac, folded into the one commit): the tray fix below. **Not reviewed: no round opened.** The gate passed on 8dba8ac (171/171) but only against a scratch copy of this file, because the installed crew (`node_modules/@stucm/crew` → `Reflex/crew`) requires a fully clean tree *including* this task file, and HEAD's copy of it predates `dev/smoke/browse.js` joining `files:`, so the scope check fails on HEAD's copy. Copying that stamp in by hand was refused, correctly. `crew task … block` does not exist in that version either, so `status:` is untouched. To unblock: commit this task file's `files:` change on the branch, or update `Reflex/crew` to the claude-crew version whose gate excludes bookkeeping. Then `crew gate` + `crew review` + reviewer.

- Round 2 (bbb1849): **PASS**. `npm run verify` 171/171. The tray matches the corrected spec: `#viewport` translateY(151px) at opacity .4 puts posters at 775, and the row label, captions, ring, `#hero-art` and scrims are 0 in the menu, with the focused lift removed and the ground glows shown. The shell smoke asserts every on-screen poster by rect (at least nine) and `#g1` opacity 1. Orchestrator's side-by-side at 1920x1080 agrees. No findings.

## Worker notes

- `src/view/glyphs.ts` — `line()` plus the board's eight stroked icons (`television` for TV: `id-length` rejects `tv`), Home (house) and Servers (two drives) in the same 24-unit grid.
- `src/view/menubar.ts` — `#tabs` drawn by `tabs(pages, current)` (no-op on a repeat), ten tiles built once with `.on` toggled per key; the strip winds by `--mb-x` on `#mb-strip` (Servers only, by 184px). Load callback takes a tile id; `MORE` gone.
- `src/view/clock.ts` (new) — `wallClock` from `rules/clock` into `#clock`, rescheduled to the next minute boundary.
- `src/screen/browse.ts` — `goToTile` maps a tile id to the router page (glows on unsettled); OK on Streaming toasts "Coming soon" and leaves the menu open, Search opens search, Settings/Servers open the sidebar; `render` keeps the tab bar on `pageId()`; Up opens with the first row's title.
- `src/app.ts` — starts the clock at boot. `src/view/hud.ts` — the default (slow) row's menu timing 420 → 300; `css/base.css` `--t-menu` 300ms to match.
- `index.html` — `#tabs` (chevron + `#tab-list`), `#menubar > #mb-strip`, `#menu-hint` (chevron-down + `#menu-hint-title`), `#clock` after `#video`.
- `css/v2.css` — the board values; open state fades `#tabs`/`#masthead`, `#viewport` translateY(100px) (rest tiles 624 → 724) at opacity .4. `#clock` hidden by `#video:not(.hidden) ~ #clock`. `#top-right` (search pill) hidden: the clock takes its corner and the board has no pill.
- `dev/smoke.js` — `openSidebar` goes left to Servers from Home/Movies, otherwise right to Settings (the old More rule, so no new page is passed on the way); `menuIsOpen` exported.
- `dev/smoke/shell.js` — new rest step (tab bar + clock board values, a second page on a Playwright fake clock rolls 09:59 → 10:00 with no key); menu step asserts every tile/hint/tray board value by computed style or rect, `--t-menu` 300ms and the transition properties; Streaming/Search step; winding step with a root-style-write counter and a strip-write control; the page-hop step and the 150ms settle step re-routed for the new tile order.

Spec discrepancies:
- DoD says "Up shows ten icon tiles"; Goal, Approach 2 and 6 and *Differs from board* all say ten. Built ten.
- "hides the hero": Approach 4 fades `#tabs` and `#masthead` only, so the backdrop (`#hero-art`) stays under the open menu, where ComboMenu draws none. Left as specified.
- Space Grotesk ships 500 and 700 only (`css/fonts`), as does the board's own font link, so 600 computes as 600 but renders from the nearest face in both.
- `dev/smoke/browse.js:895,900` still say "More" in a comment and a waitFor label; not in `files:`.

Round 2 (tray, from the side-by-side):
- `css/v2.css` — `#viewport` drops 151px (posters 624 → 775); in the menu the row label, captions, `#ring`, `#hero-art` and both scrims go to opacity 0 and the focused poster loses its 1.19 lift; label/caption opacity on `--t-menu`. `#bg.hero-on:not(.menu)` so the ground glows show under the tray as on the board.
- `src/view/menubar.ts` — toggles `menu` on `#bg` with `#browse`.
- `dev/smoke/shell.js` — asserts every on-screen tray poster by rect (`96+202i, 775, 176×264`, at least nine), row label/captions/hero/scrims opacity 0, and waits for `#g1` opacity 1 (it was 0 under the hero before, so not a pass-on-nothing).
- `dev/smoke/browse.js` — "More" → "Servers" in the comment and the waitFor label.

## Graph writes proposed

- Gotcha: the vendored `Reflex/crew` gate checks `git status --porcelain` with no bookkeeping exclusion, so a worker whose task file was amended by the orchestrator (and must not be committed) cannot get a stamp. claude-crew's own `gate.js` already excludes `bookkeeping()`; the vendored copy needs updating.

- Pattern: a smoke step that needs a clock to tick can open a second page with `page.context().newPage()` and `clock.install({ time })` before `goto`, then `clock.runFor()` — the main page's timers stay real for every later step.
