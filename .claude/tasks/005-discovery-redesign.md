---
id: 005
slug: discovery-redesign
status: building
model: sonnet
env: laptop
branch: crew/005-discovery-redesign
files:
  - index.html
  - css/app.css
  - js/rail.js
  - js/masthead.js
  - js/browse.js
  - js/sidebar.js
  - dev/smoke.js
---

# The discovery screen: hero, landscape tiles, and a sidebar

## Goal

The browse screen becomes: a full-bleed backdrop of whatever is selected, a
title and actions over it, landscape tiles below, and the sections moved off the
top into a sidebar that slides in from the left. Continue watching is the first
row.

## Why now

From a Claude Design project the user built (`Reflex Discovery.dc.html`,
option **4a**, palette **5a**). The current screen is a row of text chips and
portrait posters; the design is a television screen. Everything needed is
already in the app — `Plex.artUrl`, the hub titles, `Merge`-ed rows — so this is
presentation, not plumbing.

## Graph context

<!-- Inlined by the orchestrator. Do not re-query, and do NOT try to reach the
     design tool: everything you need is written out below. -->

- Constraint **Chromium 53** — the design was drawn in a modern browser and uses
  six things webOS 4.0 does not have. The translations are given below; they are
  not optional and `npm run check` enforces most of them.
- Pattern **"debugging a webOS app with no usable console"** — you cannot see
  this on the panel. Judge it in `npm run dev` at 1920×1080 and no further.
- Preference **"plain readable code over clever chains"** — applies to every
  line you write here.

## Constraints that bite here

**The design cannot be copied literally.** Translate as follows:

| Design uses | Why not | Use instead |
|---|---|---|
| `color-mix(in srgb, X 26%, transparent)` | Chrome 111 | precomputed `rgba()` |
| `inset: 0 0 470px 0` | Chrome 87 | `top/right/bottom/left` |
| `gap:` in flex | Chrome 84, and `check-es5.js` fails on it | margins |
| `text-wrap: balance` | Chrome 114 | omit |
| `transition: box-shadow` | house rule: layout/paint on a 2018 SoC | animate `transform`/`opacity` only |
| Phosphor icons from unpkg | app runs `file://`, no network | inline SVG, only the glyphs used |

**Palette 5a — ink & citron.** Put these in `:root` as custom properties
(Chrome 49, safe) and use them everywhere; no loose hex in rules.

```
--bg:      #0c0f16   ground
--surface: #141a26   tiles, sidebar rows, buttons
--raised:  #171b24   focused surface
--ac:      #cfe06a   citron: focus, primary button, current row title
--ac2:     #d8794f   terracotta: progress bars, row icons
--fg:      #eef0f2
--dim:     rgba(238,240,242,.44)
--soft:    rgba(238,240,242,.07)
```

**Tiles change shape: 372×209 landscape, title underneath**, not 160×240
portrait. `Rail` is built around `TILE_W 160 / TILE_H 240 / STRIDE 184`; the new
numbers are `372 / 209 / 416` with the title in a line below the image. Ask
`Plex.artUrl(item, 372, 209)` rather than `posterUrl` — landscape art, not the
poster. **Fall back to `posterUrl` when an item has no `art`**, or half the
library goes blank.

**Do not change the row model or the merge.** `Rows`, `Merge`, `Guard`, `Meta`
and everything in `js/plex.js` stay exactly as they are. If you find yourself
editing those, stop — the spec is wrong.

## Approach

1. **`css/app.css`** — the palette as custom properties, then restyle. Keep the
   existing `.hidden`, `.view` and player rules working; the player and the
   detail page are not in this task and must not break.

2. **`index.html`** — inside `#browse`: a `#hero-art` backdrop layer, two
   gradient scrims over it (left-to-right and bottom-up, both plain
   `linear-gradient`), the existing `#masthead` repositioned over the hero, a
   `#top-right` holding only the search button, and a `#sidebar` before
   `#viewport`. **No top-left cluster at all** — no app icon, no wordmark, no
   menu button. Remember `check-es5.js` fails if a file in `js/` is missing from
   the script list.

3. **`js/masthead.js`** — becomes the hero. Row title in small caps above
   (in `--ac2`), the film title at ~100px, then the action row: a citron
   **Play** pill, a **More info** pill, and the badges that already exist. Set
   `#hero-art`'s `background-image` from `Plex.artUrl`, and leave it alone when
   the focused item has no art rather than flashing to empty. It already
   debounces via `Meta.schedule`; do not add a second timer.

4. **`js/rail.js`** — the new geometry, and the title line under each tile.
   Focus is a citron ring: implement as a `transform: scale()` on the inner
   element plus a border colour swap, **not** a `box-shadow` transition. The
   pool stays fixed — four rows, twelve tiles — that property is the reason the
   rail is fast and it is not up for negotiation.

5. **`js/sidebar.js`** — new module, global `Sidebar`, loaded before
   `js/browse.js`. It is an overlay inside the browse view, **not** a
   `UI.VIEWS` entry, so `js/app.js` and `js/ui.js` need no change.

   ```
   Sidebar.open(sections, onPick)   // sections: the merged list Browse holds
   Sidebar.close()
   Sidebar.isOpen()
   Sidebar.key(code) -> bool        // true if it consumed the key
   ```

   Contents, top level, each selectable in its own right:
   **Movies · TV Shows · Discovery · Kids · Search**. Under Movies and TV Shows,
   that section's own category rows — the hub titles `Browse` already has from
   `Plex.hubs`, so pass them in rather than fetching again. Up/Down moves,
   Right/OK enters a section's categories, Left/Back closes.

6. **`js/browse.js`** — `Browse.key` gets the sidebar first: if
   `Sidebar.isOpen()`, hand it the key. Left on the first tile of a row opens
   it. The `chips()` row and `headerFocus` go away entirely, replaced by the
   sidebar; the search chip becomes the search button. Continue watching is
   already row 0 — confirm it, do not rebuild it.

7. **`dev/smoke.js`** — the assertions are written against `#sections .chip`
   and will all fail. Rewrite them against the sidebar and the hero. `pressChip`
   becomes something like `openSidebar` + pick by label. **Every existing step
   must still assert the same behaviour** — this is a UI change, not a coverage
   reduction. If a step cannot be expressed against the new UI, say so in the
   task file rather than deleting it.

## Out of scope

- The detail page, the show page and the player. Not one line.
- `js/plex.js`, `js/merge.js`, `js/rows.js`, `js/guard.js`, `js/meta.js`.
- Anything on the TV. This is judged in `npm run dev` only.
- The other design options (1a–3b, 5b, 5c). 4a with palette 5a, nothing else.
- Fetching new artwork sizes for the detail page.

## Definition of done

- [ ] `npm run dev` shows: backdrop of the focused item, hero title and actions
      over it, landscape tiles, Continue watching first, no top-left chrome
- [ ] Left on the first tile opens the sidebar; it lists Movies, TV Shows,
      Discovery, Kids, Search, and the categories under Movies and TV Shows
- [ ] the search button reaches the search screen in one press
- [ ] `npm run check` passes — no `gap`, no `color-mix`, no `inset`, no
      `box-shadow` transition
- [ ] `npm run verify` is 26/26, with the smoke steps rewritten against the new
      UI and asserting the same behaviour as before
- [ ] the tile pool is still four rows of twelve, whatever the library size
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->
