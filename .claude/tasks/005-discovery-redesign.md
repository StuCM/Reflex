---
id: 005
slug: discovery-redesign
status: review
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
- [ ] `npm run verify` is green at the current baseline (28/28 today), with the smoke steps rewritten against the new
      UI and asserting the same behaviour as before
- [ ] the tile pool is still four rows of twelve, whatever the library size
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `css/app.css` — palette 5a in `:root`, every colour in the file now comes
  from it; hero, scrims, sidebar, landscape tiles and the search pill added.
- `index.html` — `#hero-art` and two scrims, `#mh-row` and `#mh-actions` in the
  masthead, `#top-right` with an inlined magnifier, `#sidebar`, and
  `js/sidebar.js` in the script list. `#sections` is gone.
- `js/rail.js` — 372 / 209 / 416 geometry, title moved out of the image into a
  line below it, `Plex.artUrl` with `posterUrl` as the stand-in, and a `LEAD`
  constant because four tiles across cannot keep three to the left of focus.
- `js/masthead.js` — row title, the action pills, and `Masthead.art()` for the
  backdrop.
- `js/sidebar.js` — new, `Sidebar` global, an overlay rather than a `UI.VIEWS`
  entry, so `js/app.js` and `js/ui.js` are untouched.
- `js/browse.js` — chips and `headerFocus` gone, sidebar wired to Left on the
  first tile, category titles remembered per section, `loadSection` gained a
  `focusRow` argument so picking a category of another section lands on it.
- `dev/smoke.js` — `pressChip`/`chipTexts` replaced by
  `openSidebar`/`sidebarRows`/`sidebarPick`; every step asserts what it did
  before, plus one new step for the sidebar itself. 29/29.

## What the spec got wrong, or left to invent

0. **The spec omitted the dense hero state entirely** — orchestrator's error,
   confirmed by the orchestrator in round two. Only the tall hero was described,
   which is why the rows were obscured and why moving down looked broken. See
   *Round two* below.

1. **The Play and More info pills are labels, not targets.** The spec removed
   `headerFocus`, which was the only focus model above the rail, so there is
   nothing to move between two pills with. OK on the rail still opens the
   detail page — unchanged behaviour, and the place playback is actually chosen
   after `Guard`. Wiring a real Play from the rail would mean calling `Guard`
   from `js/browse.js` and inventing a focus model the spec deleted, so the
   pills are drawn and OK does what it always did. **This is the one thing in
   the diff a reviewer should look at hardest.**

2. **The sidebar carries more than the five entries listed.** `prefer:`,
   `devices` and `panel` were chips, and the spec's list of five would have made
   all three unreachable — the smoke test asserts two of them. They are extra
   top-level rows below Search. The DoD list is satisfied as a "lists at least".

3. **Categories only appear for sections that have been built.** The spec says
   to pass in the hub titles Browse already has; Browse only has them for
   sections it has loaded, and fetching the others is explicitly out. A section
   never visited lists no categories and OK on it simply switches to it. After
   one visit it has them, and they persist for the session.

4. **`--dim2` was added to the palette.** Eight tokens could not carry the three
   grey levels the existing detail, show and player rules use, and flattening
   them all to `--dim` lost the hierarchy on screens this task must not break.

5. The results-page header had nowhere to go once the chips went. It is now the
   first results row's own title — the query, the count and `BACK to library` —
   and `#browse` carries a `results` class so the harness can tell the two
   states apart without reading text.

## Round two — the three faults

### Fault 1 — long lists did not scroll in the sidebar

The sidebar drew every entry and clipped whatever ran past the panel, so on a
real library the entries below the fold could not be reached at all. `js/rail.js`
already solves this and the fix reuses its idea: an inner `#sidebar-list` wrapper
carrying a `translateY`, wound by `reveal()` so the focused row is always inside
the panel. No `overflow: auto` — a scrollbar is a control this remote cannot
reach. Row heights differ (64px for a section, 52px for a category), so the
offsets are read off the DOM rather than computed from constants that would have
to know about both.

**The first version of the smoke step for this was worthless and I nearly
shipped it.** It walked the real sidebar to its last entry and asserted the entry
was on screen — and it passed against the unfixed code, because the generated
library builds a list 908px tall inside a 1080px panel and never overflows. The
step now drives `Sidebar.open` directly with a section of thirty categories, so
the list genuinely overruns, and it fails without `reveal()`.

Not fixed, and out of `files:`: `#device-list` in `js/devices.js` and
`#sh-episodes` in `js/showpage.js` are the same shape of list and will have the
same problem on a long enough library. `#menu-inner` in the player already winds
itself correctly.

### Fault 2 — the hero never collapsed (spec omission, orchestrator's)

**The spec described only the tall hero and never mentioned the dense band.**
That is an orchestrator error, recorded here as asked. The consequence was
visible: the tall hero left room for one and a half rows, so stepping down drew
the row you had just moved to mostly below the fold, and moving down read as
nothing happening. This is very likely what was first reported as broken row
scrolling.

Built to the geometry given: 540px hero with the backdrop on row 0, a 132px band
with the backdrop faded out everywhere else, three rows on screen once it
collapses. `#viewport` is fixed in both states and `#rows` carries the whole
408px move as one transform on the transition it was already running, so nothing
animates a height. Flex `order` rearranges the same masthead elements into the
band; nothing moves in the DOM.

One deliberate departure: **the band keeps the badges.** CLAUDE.md is explicit
that the audio verdict has to be readable before OK is pressed, and that is true
on every row, not just the first. They sit between the meta line and the
right-aligned actions.

### Fault 3 — the backdrop showed the wrong film

Reproduced before fixing. Rest on a title, move on, come back: the hero still
showed the *previous* film's art under the new one's title.

The cause was not a stale async result — the guard for that was in place. It was
that `Meta.schedule` returns early **without calling the callback at all** when
the payload is already in its RAM cache:

    if (cache[keyOf(item)]) return;

The backdrop was painted from that callback, so every title already visited once
silently kept the last backdrop. Hitching the art to `Meta` was the wrong idea
from the start: `art` is on the list item and the backdrop never needed the
metadata. `Masthead.art` now keeps its own 280ms debounce and paints whatever was
last handed to it, so a fast sweep costs one full-screen transcode and lands on
the item under the focus. An item with no `art` falls back to its poster rather
than leaving another film's backdrop up.

All three new smoke steps were confirmed to **fail** against the unfixed code and
pass against the fixed code.

### Round-two review found a fourth, which round two caused

`ROWS_VISIBLE` was answering two different questions with one number. It bounds
the scroll window (`rows.length - ROWS_VISIBLE`) *and* decides which rows are
close enough to be worth fetching posters for. At `3`, with `ROW_H` 335 in an
862px viewport, three rows need 971px — so once the window pinned to the end of a
list, the last row sat below the clip with its title entirely invisible. Same
symptom fault 2 was opened for, moved from row 1 to the tail of every section.

Split into two constants: `ROWS_FIT = 2` bounds the window (335 + 301 fits in
862; a third does not), `ROWS_VISIBLE = 3` still governs poster loading, because
the third row does peek and its posters should be there when you reach it.

The dense smoke step now also walks to the end of the list and asserts the
focused tile's **title** is above the clip — the title is what went missing, and
an assertion against the artwork alone would not have seen it. Verified failing
against the old single-constant clamp.

## Review rounds

### Round 1 — `crew-reviewer` — **PASS**

Read the spec and the full diff, re-ran `npm run verify` (29/29, matching the
claim) and drove a separate Playwright session at 1920×1080 to see the hero,
pills, badges, tiles and sidebar settle. Confirmed:

- `js/plex.js`, `js/merge.js`, `js/rows.js`, `js/guard.js`, `js/meta.js`,
  `js/app.js` and `js/ui.js` are untouched.
- No Chrome 55+ syntax in anything shipped; `dev/smoke.js` is Node only.
- No `gap`, `color-mix`, `inset`, `position: sticky`, and no transition on
  anything but `transform`/`opacity`.
- `js/sidebar.js` is loaded before `js/browse.js`.
- The pool is still `ROW_POOL 4` × `TILE_POOL 12`.
- The rewritten smoke steps assert equivalent behaviour, step by step.

On the deviation flagged for a verdict — the Play / More info pills as labels —
the reviewer traced `opts.onOpen` through `js/app.js`, confirmed OK on a tile
opened the detail page both before and after the diff, and agreed the call was
honest and minimal given the spec itself deleted the only focus model above the
rail.

One non-blocking nit raised: `Sidebar`'s modes never set `current`, so opening
the sidebar from inside Kids or Discovery highlighted nothing as the mode
showing — something the chip row did. **Fixed** in `fix(sidebar): mark kids and
discovery as the mode showing`: `Sidebar.open` takes the mode as an optional
third argument and marks it the same way a section is marked. `npm run verify`
re-run after the fix, still 29/29.

## Notes for the orchestrator

`node .claude/crew/bin/scope-check.js` reports the task file itself as out of
scope once it has been committed, because `files:` does not list it. The gate
was clean on every run against the code alone. Worth either adding the task file
to the checker's allow list or running the gate before the write-up.

## Graph writes proposed

**Decision — "the rail's tile geometry is a landscape 372 × 209 on a 416
stride".** Four tiles across 1920 rather than ten, so the rail cannot keep
three tiles to the left of focus the way the portrait layout did; a `LEAD`
constant of 1 replaces the hardcoded `- 3`. Supersedes the 160 × 240 portrait
geometry. Rationale: the design is a television screen, and landscape art is
what a Plex server actually holds as `art`.

**Decision — "the sidebar is an overlay inside the browse view, not a
`UI.VIEWS` entry".** `Browse.key` hands it every key while it is open and takes
them back when it closes, so `js/app.js` and `js/ui.js` need no knowledge of it
at all. The alternative — a seventh view — would have put sidebar state into the
one place in the app that owns which screen is showing, for a panel that is only
ever a part of one screen.

**Pattern — "an absolutely-positioned overlay declared before the content it
covers needs an explicit `z-index`".** `#sidebar` sits before `#viewport` in
`index.html` so that opening it never reflows the rail; with both at `z-index:
auto`, document order put the rail on top and the sidebar rendered *behind* the
tiles while still taking every keypress — which reads exactly like a broken
key handler and is not. Cost a screenshot to find. One `z-index: 5` fixes it.

**Pattern — "a hero backdrop must ride an existing debounce, never the
keypress".** `Masthead.art` is called only from `Browse`'s `Meta.schedule`
callback, so a settled focus costs one full-screen `photo/:/transcode` on a
server we do not own; calling it from `Masthead.render` would have fired one per
arrow press. Same reasoning as the rail's deferred posters.

**Gotcha — "`Meta.schedule` does not call back for an item it already holds".**
`if (cache[keyOf(item)]) return;` is correct for its own job — the badge was
drawn from the cache a moment earlier — but it makes `Meta.schedule` unusable as
a general "the focus has settled" signal. Anything that needs to repaint on a
settled focus from data that is *not* the metadata must carry its own debounce.
Cost: a backdrop that showed the previous film for every title visited twice.

**Pattern — "one constant answering two questions is a bug waiting for the edge
of the list".** `ROWS_VISIBLE` bounded the scroll window and chose which posters
to prefetch. Those are different numbers — how many rows fit *whole*, and how
many are on screen *at all* — and conflating them clipped the last row of every
section. The tell is that the value was correct everywhere except at the end of
a list, which is exactly where a clamp is the only thing deciding the layout.

**Pattern — "a smoke step that cannot overflow proves nothing about
overflow".** The first test for the sidebar winding walked the real list to its
end and passed against the unfixed code, because the generated library builds a
list shorter than the panel. A test for a list-too-long bug has to build a list
that is too long — driving `Sidebar.open` with thirty synthetic categories. The
general habit worth keeping: **break the fix and watch the new test fail before
believing it.** All three of round two's steps were checked that way, and one of
them was worthless until it was.

**Gotcha — "a CSS escape swallows one following space".** `content: "\25C0 \25B6"`
renders as `◀▶` with no gap, because the space terminates the hex escape. Two
spaces are needed for one to survive.

**Gotcha — "widening a palette to eight tokens is not enough for a screen with
three grey levels".** Palette 5a's single `--dim` flattened the detail, show and
player hierarchies that the task was explicitly not allowed to break; `--dim2`
was added rather than losing them.

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->
