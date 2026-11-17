---
id: 067
slug: pictures-cost-less-to-show
status: review
branch: crew/067-pictures-cost-less-to-show
model: sonnet
env: laptop
rounds: 1
work: v2-shell
files:
  - src/data/art.ts
  - src/view/masthead.ts
  - src/screen/browse.ts
  - index.html
  - src/view/rail.ts
  - src/view/hud.ts
  - css/browse.css
  - css/v2.css
  - dev/smoke/shell.js
  - dev/smoke/browse.js
  - dev/smoke.js
  - dev/smoke/sections.js
gate: pass
gateSha: ce6299f17039d01b75f9b6c571839efd475044ee
gateAt: 2026-11-17T16:55:25.124Z
---

# Browse pages drop the backdrop photo, and the panel tunes poster size

## Goal
On the browse pages (Home, Movies, TV, Kids, Collections, Discover) the hero
is text over v2's glows — no full-screen backdrop photo is fetched, decoded or
faded. The tuning panel's key 9 switches the poster size between w185 and
w342 so Stuart can trade sharpness for speed on the TV. The hero text waits
150 ms.

## Why now
Stuart, 2026-11-17, after 066 on the B8: "its the poster and hero image
loading that I think is slowing things", "hero needs to go to 150ms", and
then: "the hero is replacing the background blur image so we probably don't
need it on most pages". The v2 boards (`designs/v2/*.dc.html`) carry no
backdrop image on any page.

## Existing work
None in flight. Base `feat/v2`. Replaces this spec's first version (poster
and hero sizes on two keys, hero prefetch), which blocked because the panel
has no free key.

## Background
- `src/view/masthead.ts:28-60` `paintArt()` fetches `art.hero(wanted)` (TMDB
  `w1280`, `src/data/art.ts:14`) into two crossfading layers `#hero-art-a/-b`
  (`index.html`) after the debounce; Chrome 53 decodes it on first paint,
  which is the ~17 ms decode the TV profile showed mid-pan.
- The detail page and series page draw their own backdrops (`detail.ts`,
  `showpage.ts`) — **not touched** here; they are v1 until redesigned.
- `src/view/hud.ts`: keys 1-8 are settings, 9 is the fake "next page" glow
  test from 061 (now redundant: 062's top menu changes pages for real), 0
  resets stats. `dev/smoke/shell.js` has the step "key 9 shifts the glows and
  cycles back".
- `src/data/art.ts:13` posters `w342` for a 176 px tile (210 focused).

## Graph context
- Pattern "root custom properties kill B8 panning": settings apply on the
  smallest element.
- "Defer the lookup, not the paint" — keep the rail's 160 ms fetch settle.

## Approach
1. **No backdrop on browse** (`masthead.ts`, `browse.ts`, `index.html`,
   `css/browse.css`, `css/v2.css`): the browse view no longer calls
   `masthead.showArt` / `paintArt`; remove the `#hero-art-a/-b` layers and
   their scrims from the browse view (keep any shared code the detail/series
   pages use). The masthead text keeps its debounce and fade.
2. **Hero default 150 ms** (`hud.ts`), keeping saved settings.
3. **Key 9 = poster size** w185 / w342 (default w342 until Stuart judges);
   `art.tile` reads it; it applies to tiles fetched after the change. Remove
   the fake-page key and its smoke step; the glow-shift step uses the real
   menu instead (▲, →).
4. **Smoke**: on Home, after focus moves and the debounce passes, **no**
   request is made for a TMDB `w1280` backdrop and there is no
   `#hero-art-a` in `#browse` (positive control: the detail page still
   requests its backdrop); with key 9 → w185 a newly drawn tile requests
   `/w185/`, with w342 `/w342/`; `dev/smoke.js` `tilePosters` (~400) follows
   the setting; hero default 150 ms on a fresh profile.

## Out of scope
- Detail and series page backdrops. Plex art sizes. The tile fetch settle.

## Definition of done
- [ ] Browse pages fetch and show no backdrop photo (smoke, with the detail-page control).
- [ ] Key 9 switches poster size and changes the URLs fetched (smoke).
- [ ] Hero default 150 ms; the glow step goes through the real menu.
- [ ] the gate passes (`crew gate .claude/tasks/067-pictures-cost-less-to-show.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)
- [ ] (orchestrator, after merge) the CDP pan on the TV: image decodes and raster time per pan lower than after 066.

## Review rounds

Round 1: PASS. Nits left: shell.js hero assertion message reads "in in"; showFacts only warms the lookup.

Changes: masthead.ts drops backdrop layers (showArt -> showFacts); browse.ts calls it; index.html, browse.css, v2.css lose #hero-art and scrims; art.ts setPosterSize; hud.ts hero default 150 and key 9 = poster; smoke: shell.js (menu glow step, poster step, 150 ms), browse.js (no-backdrop step with detail control, hero asserts removed), sections.js (hero-art steps dropped/rewritten), smoke.js (poster and backdrops collectors).

## Graph writes proposed

Decision: browse pages carry no backdrop photo (v2 boards have none); detail/series keep theirs.
