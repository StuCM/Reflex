---
id: 080
slug: home-splits-continue-watching
status: done
branch: crew/080-home-splits-continue-watching
model: sonnet
env: laptop
rounds: 1
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
  - dev/smoke/devices.js
  - dev/smoke/discovery.js
  - dev/smoke/link.js
  - dev/smoke/movies.js
  - dev/smoke/player.js
  - dev/smoke/recaps.js
  - dev/smoke/search.js
  - dev/smoke/show.js
gate: pass
gateSha: 595bf70052ce27058ff099a63b8b81032bf03eec
gateAt: 2026-11-26T22:54:00.894Z
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
Round 1: PASS (crew-reviewer). Non-blocking: a mixed sidebar pick re-splits when a deck refresh lands; unrelated reformat in pages.ts loadPageRows; landNext would drop a TV row titled Continue watching (none exists).

- Orchestrator, after scope block: spec bug — `dev/smoke/browse.js` added to `files:`; apply your patch (`rowsOf(2)`, `press('ArrowDown', 2)`). The deck step 'the refreshed deck is what the cache holds' passed in the orchestrator's full verify on feat/v2 (182/182 at 605565b): it is the known flaky deck step, so re-run the gate rather than treat it as baseline. The split also showing on the v1 section pages (shared `loadView`) is accepted.

- Orchestrator, after second scope block: every `dev/smoke/*.js` is now in `files:` — Home's row order is walked by most areas, so fix any position-dependent step you find (apply /tmp/claude-1000/show-js.patch first) rather than blocking again. The deck step that fails in `smoke -- deck` alone passes in full runs (the area does not pass in isolation); judge it by the full gate. Re-run the 'glows' step once if it alone fails.

## Worker notes
BLOCKED on scope: `files:` omits `dev/smoke/browse.js`, and two steps there index Home's rows by position.
Home's row 1 is now Your next episodes, so `rowsOf(1)` ('a film row', l.1601) holds an episode, and the section
steps' first `ArrowDown` ('a hold on a show', l.1641) lands on it rather than a show. The failed hold menu then
cascades into show/recaps areas (13 failures in a full run). Verified fix, saved at
/tmp/claude-1000/browse-js.patch: `rowsOf(1)` to `rowsOf(2)`, and `press('ArrowDown')` to `press('ArrowDown', 2)`
in that second step. With it `npm run smoke -- browse` is 31/31. Not applied (outside files:).

Committed on the branch as d8dca3a (no review round opened; the gate cannot pass without the browse.js edit).
- src/screen/pages.ts: WATCHING, NEXT_TITLE, isDeckRow, splitDeck, deckRows, placeDeck (insert/replace/remove deck rows, focus-shifting); refreshed carries `sub`; TV uses splitDeck.
- src/screen/browse.ts: Home builds/lands/caches both rows via deckRows/placeDeck; landNext refreshes TV's Your next episodes after a play; clear/pick act on the focused deck row (pickTitle remembers which); the sidebar Continue watching pick still shows one mixed list. 1547 lines (limit 1548).
- dev/smoke/deck.js: Home split by count; films-only deck has no Next row; focus holds when a half lands above it (fails without the bump); clear from Your next episodes; TV row refreshed after a play (fails without landNext); Top Rated no longer in the 4-row pool; show-tile step reads the Next row.
- dev/smoke/shell.js: 'Recently Released' replaces 'Top Rated' as the row watched for redraws; placeholder wait needs more than 3 labels now.
- Baseline failure, not mine: deck 'the refreshed deck is what the cache holds' fails on main too.
- Deck rows also split on the v1 library sections (shared loadView), not only Home; the spec said Home.

## Graph writes proposed
- Pattern: a smoke step that indexes Home's rows by position (rowsOf(n), ArrowDown n) breaks whenever a row is inserted above; grep for them before adding a row. The rail pool is 4 rows, so a hub past the fourth is not in the DOM.

## Second block (worker)
browse.js patch applied and committed. A full run (185/187 with the patch below) then showed one more positional step:
`dev/smoke/show.js` ~l.306, 'a show section drills into series and episodes' presses ArrowDown once "off Continue watching",
which now lands on Your next episodes; the failure cascades into 'episode still', 'series switch', 'copy chooser' and the whole
recaps area (11 failures). One-line fix, verified (`npm run smoke -- show recaps` 33/33): `press('ArrowDown')` to `press('ArrowDown', 2)`
at show.js:306. Patch: /tmp/claude-1000/show-js.patch. Add `dev/smoke/show.js` to `files:`. Not applied.
Also: deck 'the refreshed deck is what the cache holds' failed in every run I made here (also on the base); the glow step failed once under load.
My TV-play step now tries each Next tile until one direct-plays, since the mock has transcode-only episodes.
