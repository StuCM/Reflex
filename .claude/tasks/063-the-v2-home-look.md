---
id: 063
slug: the-v2-home-look
status: approved
branch: crew/063-the-v2-home-look
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - src/view/rail.ts
  - src/view/masthead.ts
  - src/screen/browse.ts
  - css/browse.css
  - css/v2.css
  - index.html
  - dev/smoke/browse.js
  - dev/smoke/deck.js
  - dev/smoke/discovery.js
  - dev/smoke/sections.js
  - dev/smoke/shell.js
  - css/base.css
---

# Home looks like v2: smaller posters that grow on focus, and a v2 hero

## Goal
The rows use v2's poster sizes (176×264, growing to 210×315 on focus by
scale), with room to rest on one row and see the next; the hero above shows
the focused title in v2's type — eyebrow, big uppercase Space Grotesk title,
meta, synopsis — fading in after the debounce.

## Why now
`docs/v2-spec.md` §2 (posters, type) and §5 Home (`designs/v2/Combo.dc.html`
for layout numbers). After 062.

## Existing work
After 062.

## Background
- `src/view/rail.ts` constants (~43-60): TILE_W 209, TILE_H 314, GAP 44,
  ROW_H 466, VIEWPORT_H 580 → ROWS_FIT 1. Focus scales `.tile-inner`
  (`css/browse.css:260`).
- `src/view/masthead.ts` `showArt` (two crossfading layers via `--art`) and
  `render()` (title/meta/desc/cast).
- `dev/smoke/browse.js:63` hard-codes `Art.tile(t._item, 209, 314)`; other
  areas assert layout.

## Graph context
- The pool is the window: keep `TILE_POOL = 12` and the 4-row pool; nothing
  may become count-dependent ("the rail recycles all twelve tiles").
- "A row's slot is not its identity": compare `_rowRef`.
- "Layout smoke needs data past threshold"; "bigger element, fixed-height
  clipped parent".
- Regex renames hit string literals — do not rename classes.

## Approach
1. `rail.ts`: TILE_W 176, TILE_H 264, the gap from `Combo.dc.html`, ROW_H and
   VIEWPORT_H so the focused row plus a peek of the next fit (spec §3). Focus
   scale ≈ 1.19 on `.tile-inner` (210/176), transform only; drop the focus
   border so focus is the scale and shadow.
2. `masthead.ts` + `css/v2.css`: eyebrow (22 px 600 uppercase, 3 px tracking,
   accent), title (Space Grotesk 700 uppercase, ~92 px, −1 px tracking), meta,
   two-line synopsis; crossfade over `--t-hero`; reads 061's debounce setting.
   Layout numbers from `Combo.dc.html`.
3. **Fonts through tokens**: add `--font-title` (Space Grotesk) and
   `--font-body` (Inter) to `css/base.css :root` and use only those in rules,
   never the family names. Stuart, 2026-11-16: "Not 100% on the fonts … this
   may change in the future" — a change must be one line.
4. Update every smoke size/position assertion to the new numbers (positive
   values), and add one: the focused tile's rendered box is ~210×315 and the
   next row's top is on screen.

## Out of scope
- Rows' content (unchanged), "See all" tiles, the colour-key cue style,
  add-to-list modal, profiles.

## Definition of done
- [ ] Posters 176×264, focused 210×315 by scale, next row peeking (smoke).
- [ ] Hero in v2 type, updating after the debounce (smoke reads its title text after focus moves).
- [ ] Existing smoke areas pass with updated numbers.
- [ ] the gate passes (`crew gate .claude/tasks/063-the-v2-home-look.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
