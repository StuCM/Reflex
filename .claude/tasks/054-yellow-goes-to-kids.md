---
id: 054
slug: yellow-goes-to-kids
status: approved
branch: crew/054-yellow-goes-to-kids
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - src/core/ui.ts
  - src/app.ts
  - src/screen/browse.ts
  - dev/smoke/browse.js
---

# The yellow key goes straight to Kids

## Goal
Pressing yellow on any screen except the player opens the Kids page.

## Why now
Stuart, 2026-11-09: "maybe one of the coloured buttons takes us to kids page
straight away". Red is search and green is select mode on browse; yellow and
blue are free outside the player.

## Existing work
After 053 (and 048, which also edits `src/app.ts`).

## Graph context
- `src/core/ui.ts:11` `KEY` has only `RED: 403`; `browse.ts:115` defines
  `GREEN = 404` locally. Yellow is `405`.
- `player.ts:1526-1535` uses 403-406 as panel keys while playing — the
  player must keep yellow.
- `browse.key` only runs when `view() === 'browse'` (`app.ts:357`), so a
  jump from the film or series page is handled in `app.ts` before the view
  dispatch.

## Approach
1. `src/core/ui.ts`: `KEY.YELLOW = 405`.
2. `src/app.ts` key handler: before the per-view switch, if the code is
   yellow and the player is not playing and no recap is open, close whatever
   page is up (as BACK to browse would) and call a new `browse.openKids()`.
3. `src/screen/browse.ts`: export `openKids()` → `loadKids()` with the
   sidebar closed; a no-op if Kids is already showing.
4. `dev/smoke/browse.js`: yellow from the library opens Kids (assert its
   first row title); yellow from a film page opens Kids; yellow while
   playing does not leave the player (needs the fixture; skip like the
   other player steps without one).

## Out of scope
- Blue. Any change to the player's colour keys.

## Definition of done
- [ ] Yellow opens Kids from browse and from the film page (smoke).
- [ ] Yellow during playback does not leave the player.
- [ ] the gate passes (`crew gate .claude/tasks/054-yellow-goes-to-kids.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
