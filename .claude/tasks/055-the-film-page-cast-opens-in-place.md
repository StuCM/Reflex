---
id: 055
slug: the-film-page-cast-opens-in-place
status: approved
branch: crew/055-the-film-page-cast-opens-in-place
model: sonnet
env: laptop
rounds: 0
work: actors-in-place
files:
  - src/screen/detail.ts
  - src/app.ts
  - css/detail.css
  - dev/smoke/detail.js
---

# On the film page, the cast can be chosen too, and the extras are bigger

## Goal
On the film page the cast row is focusable; OK on an actor opens the same
in-place view as the series page (050). The cast photos and the extras
video boxes are larger.

## Why now
Stuart, 2026-11-09: the actor view on "both" pages; "increase the size of the
profile picture for them as well as increase the size of the extra video box
below that".

## Existing work
After 050 (reuses `src/view/person.ts`, `src/data/people.ts`, `onOpenTitle`).

## Background
- Film cast is display-only: `castNodes` (`detail.ts:915`) draws `dt-actor`
  cards from Plex `Role.slice(0, 8)`; `strip` is 0 (actions) or 1 (extras);
  `key` (`detail.ts:960`) has no cast zone; `#detail.down #dt-cast
  {opacity: 0}` (`css/detail.css:184`).
- Extras: `.dt-extra` / `.dt-extra-shot` 240×135 (`css/detail.css:189-195`),
  asked at 320×180; `#dt-extras` 210 high at `top:514`, lifted −170 when
  focused; the play glyph is hand-centred (`.dt-extra-play` top 41 left 91).

## Approach
1. `src/screen/detail.ts`: ▼ from the action row goes to the cast (it sits
   above the extras), ▼ again to the extras; ◀ ▶ walk the cast. OK on an
   actor with a TMDB id opens the 050 person view in the cast area (the
   extras hidden by class meanwhile); BACK or ▲ returns to the cast.
2. Faces 120 → 160px (Plex request 240×240); keep 8.
3. Extras 240×135 → 320×180 (request 480×270); re-centre the play glyph and
   retune the `.down` lift and tops so nothing overlaps.
4. `src/app.ts`: the film page passes `onOpenTitle` like the series page.
5. Smoke `dev/smoke/detail.js`: ▼ reaches the cast; OK on an actor shows the
   bio and credits; BACK returns to the cast; ▼ reaches the extras; an extra
   card measures 320×180 (`getBoundingClientRect`).

## Out of scope
- The series page (050). The unheld page's empty cast photos.

## Definition of done
- [ ] The film page cast is focusable and opens the actor view in place (smoke).
- [ ] Faces 160px; extras 320×180, the play glyph centred, nothing overlapping when lifted.
- [ ] Existing detail smoke steps pass.
- [ ] the gate passes (`crew gate .claude/tasks/055-the-film-page-cast-opens-in-place.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
