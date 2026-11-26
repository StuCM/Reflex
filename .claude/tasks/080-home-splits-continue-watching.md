---
id: 080
slug: home-splits-continue-watching
status: approved
branch: crew/080-home-splits-continue-watching
model: sonnet
env: laptop
rounds: 0
work: v2-movies-tv
files:
  - src/screen/browse.ts
  - src/screen/pages.ts
  - dev/smoke.js
  - dev/smoke/deck.js
  - dev/smoke/shell.js
  - dev/smoke/detail.js
  - dev/smoke/sections.js
  - dev/smoke/browse.js
---

# Home has a Continue watching row for films and one for TV

## Goal
Home's single mixed Continue watching row becomes two: **Continue watching**
(films) then **Your next episodes** (episodes), both profile-filtered, newest
first. An empty one is not drawn.

## Why now
Stuart, 2026-11-26: Continue watching "only on home row for tv and a row for
movies".

## Existing work
After 077 (both edit `loadView` in browse.ts). Base `feat/v2`.

## Background
- Built at `src/screen/browse.ts:952` (`built.push({title: WATCHING, items:
  deck})`), mirrored in `landDeck` (l.824-851), `cacheLists` (l.865),
  `listRows` (l.743), `deckCut` (l.344), `showWatching` (l.349-360),
  `watchingRowIndex` (l.341), `paintPicking` (l.394), `markPicks`,
  `kidsWatching` (l.1123/1158).
- ~40 smoke assertions find the row by the exact label "Continue watching":
  `deck.js:46-60, 151, 187, 197, 295, 359, 445, 450, 506, 528, 541-572, 549,
  598, 624-635, 709, 747, 783, 830, 912, 989`; `shell.js:524, 804, 1011, 1024,
  1052`; `smoke.js:746-815, 922-943`; `detail.js:919, 1078`;
  `sections.js:29-75, 114, 196-308`. Kids' own row (`browse.js`) is separate.

## Graph context
- "A smoke step judging a deck must reload the page" (075).
- Insert without moving focus: `landDeck` bumps `rowIndex` per row inserted
  above — now possibly two.

## Constraints that bite here
- `src/screen/browse.ts` is at its 1548-line `max-lines` limit (`.oxlintrc.json`). Net-zero or shrink it; new logic goes in `src/screen/pages.ts` (077 did this).

## Approach
1. `pages.ts`: `splitDeck(deck)` → `{films, episodes}`, order kept; replace
   077's inline episode filter for TV's Your next episodes with it.
2. `browse.ts`: Home pushes two rows; `landDeck` replaces/inserts both by
   title; `watchingRowIndex` and the clear/pick paths act on whichever row the
   item is in. The sidebar's Continue watching pick (v1 surface under More)
   keeps its mixed list.
3. TV's **Your next episodes** row (077, built in `pages.ts loadPageRows`) is
   refreshed the same way when the deck changes — today `landDeck` leaves the
   movies/tv pages alone, so it is stale after playback. Use `splitDeck` for it.
4. Smoke: where a step relies on an episode in "Continue watching" on Home,
   look for it in "Your next episodes"; add a step that Home shows both rows with
   their own counts (positive) and that a films-only deck draws no "Next
   episodes" row.

## Out of scope
- Movies/TV pages' rows (077; TV's Next episodes is the same episode half). Finished-item history.

## Definition of done
- [ ] Home shows Continue watching (films) and Your next episodes (episodes), each correct by count (smoke).
- [ ] An empty half draws no row; focus does not jump when either lands (smoke).
- [ ] Clear from Continue watching works from either row (smoke).
- [ ] After a play, TV's Your next episodes shows the new state on return (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/080-home-splits-continue-watching.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

- Orchestrator, after scope block: spec bug — `dev/smoke/browse.js` added to `files:`; apply your patch (`rowsOf(2)`, `press('ArrowDown', 2)`). The deck step 'the refreshed deck is what the cache holds' passed in the orchestrator's full verify on feat/v2 (182/182 at 605565b): it is the known flaky deck step, so re-run the gate rather than treat it as baseline. The split also showing on the v1 section pages (shared `loadView`) is accepted.

## Worker notes

## Graph writes proposed
