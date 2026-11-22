---
id: 068
slug: the-hero-picture-returns-the-glows-step-aside
status: approved
branch: crew/068-the-hero-picture-returns-the-glows-step-aside
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - index.html
  - css/browse.css
  - css/v2.css
  - src/view/masthead.ts
  - src/screen/browse.ts
  - src/data/art.ts
  - src/view/hud.ts
  - src/core/ui.ts
  - dev/smoke.js
  - dev/smoke/browse.js
  - dev/smoke/sections.js
  - dev/smoke/shell.js
  - dev/mock-tmdb.js
---

# The hero picture comes back, cheaper, and the glows step aside where it shows

## Goal
The browse pages show the focused title's backdrop behind the hero again, as
before 067 — but at 780 px wide, decoded before it fades in, and only after the
focus rests. Where the hero picture shows, the background glows are hidden.
Small posters (w185) are the default, and the noise layer defaults to 0.03.

## Why now
Stuart, 2026-11-17, correcting the orchestrator's reading of "the hero is
replacing the background blur image so we probably don't need it on most
pages": "no my suggestion was the background not the hero" — keep the hero
picture, drop the glows behind it. Then "Yes, bring it back", on the proposal
of w780, decoded before the fade, glows hidden where it shows. Also, after
067 on the TV: "for the rows smallest image seems good".

## Existing work
None in flight. Base `feat/v2`. **067 (`ce6299f`) removed the browse backdrop;
`git show ce6299f` is the map of what to restore** — `#hero-art` layers and
scrims in `index.html` and `css/browse.css`, `paintArt` in `masthead.ts`, the
`showArt` call in `browse.ts`, and the smoke steps it deleted or rewrote in
`dev/smoke/sections.js` ("the hero art follows focus, and comes back", the
palette step's hero-fade read, "stepping down" heroOpacity) and
`dev/smoke/browse.js`, `dev/smoke.js` (`backdrops` collector, `pictures()`).

## Background — measured on the B8, 2026-11-17
Fast pan, same CDP script each time:

| | v1 | v2 with w1280 backdrop (066) | v2 no backdrop (067) |
|---|---|---|---|
| frame avg / worst | 77 / 117 ms | 69 / 133 | 46 / 100 |
| raster | 1679 ms | 1443 | 959 |
| image decode | 361 ms | 385 | 112 |
| GPU thread | 3785 ms | 3140 | 1448 |

The backdrop was the dominant cost. The glows cost almost nothing (Stuart
turned them static with noise 0 and shadows off: no change).

On Chrome 53 `Image.onload` means fetched, not decoded; the decode happens on
first paint — mid-crossfade if the layer fades straight in.

## Graph context
- Decision "browse pages show no backdrop photo" (2026-11-17) — **superseded**
  by this task: Stuart meant the glows, not the hero.
- "The tile and the hero take two different TMDB backdrops, Plex only as
  fallback" — keep.
- Pattern "root custom properties kill B8 panning" — the glows' hidden state
  is a class on `#bg` or `body`, set when the hero shows, not a root variable.

## Approach
1. **Restore** the browse backdrop from `ce6299f` (layers, scrims, `paintArt`,
   `showArt`), with these changes:
   - **Size**: `HERO_SIZE` `w780` (`src/data/art.ts`). Plex fallback asks
     `960×540`, not 1920.
   - **Decoded before the fade**: when the preload loads, set it on the
     hidden layer at opacity 0 and wait two animation frames (so it has
     painted, and decoded) before adding `on` to start the crossfade.
   - **Only after a rest**: unchanged — the hero debounce (default 150 ms).
2. **Glows step aside**: while a hero picture is shown on the browse view,
   `#bg` gets a class that sets the glows' opacity to 0 (transition on
   opacity only); when no picture is available (none fetched yet, or the
   setting below is off) the glows show. The film and series pages already
   hide `#bg`.
3. **Panel**: key 1 (hero delay) gains an **off** value — off / 0 / 150 / 280
   / 420 — where *off* means no hero picture (text only, glows on). Default
   150. Poster size default **w185** (key 9 still switches). Saved settings
   are kept, except the poster size default only applies to a profile that
   never chose one.
4. **Smoke**: restore the deleted hero steps, adjusted:
   - the hero picture follows focus after the rest, its URL contains `/w780/`
     (positive), and no `/w1280/` is requested on browse;
   - the new layer is painted at opacity 0 for at least one frame before its
     class `on` is added (page-side listener records the order);
   - while a hero picture shows, `#bg` has the glows-hidden class; with key 1
     set to off, no backdrop is requested and the glows are visible;
   - fresh profile: poster requests contain `/w185/`;
   - every count has a non-zero control.
   Grep `dev/smoke.js` and `dev/smoke/*.js` for `w342`, `hero-art`,
   `backdrops`, `#bg`, `.glow` before starting; all hits are in `files:`.

## Out of scope
- Detail and series page backdrops. Page-load placeholders (next task).

## Definition of done
- [ ] Browse shows the hero backdrop at w780 after the rest, faded in only after it has painted hidden (smoke).
- [ ] The glows are hidden while a hero picture shows, and visible with the hero off (smoke).
- [ ] Panel key 1 has off; default 150; posters default w185; noise default 0.03 (smoke on a fresh profile).
- [ ] the gate passes (`crew gate .claude/tasks/068-the-hero-picture-returns-the-glows-step-aside.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)
- [ ] (orchestrator, after merge) the CDP pan on the TV, compared with 066 (w1280) and 067 (none).

## Review rounds

## Graph writes proposed
