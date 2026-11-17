---
id: 067
slug: pictures-cost-less-to-show
status: approved
branch: crew/067-pictures-cost-less-to-show
model: sonnet
env: laptop
rounds: 0
work: v2-shell
files:
  - src/data/art.ts
  - src/view/masthead.ts
  - src/view/rail.ts
  - src/view/hud.ts
  - css/browse.css
  - css/v2.css
  - dev/smoke/shell.js
  - dev/smoke/browse.js
  - dev/smoke.js
---

# Posters and the hero cost less to show, and the panel can tune their sizes

## Goal
The TV spends less time decoding and drawing pictures while panning: posters
and backdrops are asked for at sizes that suit the screen, the next hero is
ready before it is needed, and the tuning panel can switch both sizes so
Stuart can trade sharpness for speed on the TV. The hero waits 150 ms.

## Why now
Stuart, 2026-11-17, after 066 on the B8: "I think hero needs to go to 150ms but
changing settings I think you are right we have hit the optimisation of the
animations its the poster and hero image loading that I think is slowing
things."

## Existing work
None in flight. Base `feat/v2`.

## Background
- `src/data/art.ts:13-14`: posters `w342` for a 176 px tile (210 focused);
  hero `w1280`. Plex fallbacks via `photoUrl/posterUrl(item, width, height)`
  ask the server's transcoder at the tile size.
- `src/view/masthead.ts:28-60`: the hero preloads with `new Image()` and swaps
  on `onload`. On Chrome 53 `onload` means fetched, not decoded: the decode
  happens on the raster threads when the layer first paints, which is the
  ~17 ms `ImageDecodeTaskImpl` the TV profile shows, landing mid-pan.
- TV profile (CDP, 2026-11-17): raster ~1.5 s per 6 s pan in both v1 and v2;
  GPU thread ~70% busy; 28 image decodes of ~17 ms.
- TMDB sizes: posters w92 / w154 / w185 / w342 / w500 / w780; backdrops
  w300 / w780 / w1280 / original.

## Graph context
- Decision "The tile and the hero take two different TMDB backdrops, Plex only
  as fallback" — keep that split.
- "Defer the lookup, not the paint": the rail's 160 ms settle gates *fetches*;
  a picture already in hand paints at once (task 027) — keep that.
- Pattern "root custom properties kill B8 panning": settings apply as classes
  or custom properties on the smallest element, never `:root` per key.

## Approach
1. **Sizes as settings** (`src/data/art.ts`, `src/view/hud.ts`): poster size
   `w185` / `w342` (panel key 9, default **w342** until Stuart judges), hero
   size `w780` / `w1280` (panel key 0 is reset; use the next free key the
   panel has — document it in the panel), default **w1280**. `art.tile` /
   `art.hero` read them; a change takes effect for pictures fetched after it.
2. **Hero default 150 ms** (`hud.ts`), keeping saved settings.
3. **Hero ready before it is shown** (`masthead.ts`): once the debounce fires
   and the picture loads, put it on the hidden layer *and let it paint once
   at opacity 0* (one frame) before fading it in, so the decode happens before
   the crossfade, not during it. Also, after the focus has rested on a tile
   for the debounce, prefetch (`new Image`, no paint) the hero of the tiles
   either side, so moving one step shows an already-fetched picture.
4. **Posters**: the 160 ms settle and the drawn-set stay. No other change
   unless the panel setting needs one.
5. **Smoke** (`dev/smoke/shell.js`, `browse.js`, `dev/smoke.js` collectors if
   they match `w342` or `w1280` in URLs — grep first):
   - with poster size w185, a newly drawn tile's request URL contains `/w185/`;
     with w342, `/w342/` (assert the URL, positively);
   - with hero w780, the hero's `--art` URL contains `/w780/`;
   - after resting on a tile, the neighbours' hero URLs have been requested
     (count requests to the mock's image path: ≥ 2, and the control: 0 while
     sweeping without resting);
   - hero default is 150 ms on a fresh profile.

## Out of scope
- Server-side poster generation, Plex art sizes beyond the fallback path.
- Changing the debounce of tile fetches (160 ms settle).

## Definition of done
- [ ] Poster and hero sizes switch from the panel and change the URLs fetched (smoke).
- [ ] The hero crossfade starts only after the new picture has painted once hidden.
- [ ] Neighbour heroes are prefetched after a rest, never during a sweep (smoke, with control).
- [ ] Hero default 150 ms.
- [ ] the gate passes (`crew gate .claude/tasks/067-pictures-cost-less-to-show.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)
- [ ] (orchestrator, after merge) the CDP pan on the TV with w185 and w780: raster time and decodes per pan lower than with w342 / w1280.

## Review rounds

## Graph writes proposed
