---
id: 046
slug: seasons-merge-across-servers
status: approved
branch: crew/046-seasons-merge-across-servers
model: sonnet
env: laptop
rounds: 0
work: browse-polish
files:
  - src/data/merge.ts
  - src/screen/browse.ts
  - test/merge.test.ts
  - dev/mock-plex.js
  - dev/smoke/deck.js
---

# Continue watching holds one tile per show

## Goal
A show appears once in Continue watching, as its most recently watched
episode, however many servers and libraries hold it. Today Paw Patrol and
Octonauts each show as three tiles of different episodes.

## Why now
Stuart, 2026-11-09: "seeing it across kids shows. I just see several tiles of
different episodes, same season and across seasons. All should be playing from
one server. Paw patrol is also doing it."

## Existing work
None. 047 and 048 are drafts in the same group; 048 touches `browse.ts` and
runs after this.

## Background
Measured 2026-11-09, `/library/onDeck?includeGuids=1` on both real servers:
Plex answers one episode per show **per library**, and the two servers (and
Apollo's two TV libraries, Kids and 4K HDR) each hold a different "next"
episode:

- Paw Patrol: Maverick S10E8 (seen 1793730796), Apollo Kids S10E7
  (1793729517), Apollo 4K HDR S1E3 (1793037354).
- Octonauts: Maverick S4E6, Apollo Kids S4E7 (newest), Apollo 4K HDR S1E21.

All share the show's `grandparentGuid` (`plex://show/…`). Different episodes
never merge by identity — rightly — so `buildDeck`
(`src/screen/browse.ts:716`) shows each. The same episode in two libraries
(Dexter: Resurrection S2E1) already merges.

## Graph context
- Trap: the mock cannot show this. `dev/mock-plex.js:95-107` puts the *same*
  episode index (`2 + n`) of each show on every server's deck, so the copies
  always merge.
- Continue watching removal (task 018): `clearOne` → `jobFor(entry)`
  (`browse.ts:424`) hides every copy in `merge.sources(entry)`.

## Constraints that bite here
- `Array.prototype.sort` is not stable; `buildDeck` sorts by `lastViewedAt`,
  so keep ties keyed on something unique or fold before sorting.

## Approach
1. `src/data/merge.ts`: `newestPerShow(items)` — among items with
   `type === 'episode'`, keep one per show (key: `grandparentGuid`, else
   `grandparentTitle` lowercased), the one with the greatest `lastViewedAt`;
   attach the others it replaced as `_folded: PlexItem[]` on the kept one.
   Films and anything without a show pass through untouched, order preserved.
2. `src/screen/browse.ts:716` `buildDeck`: apply it after `merge.lists`.
3. `jobFor` (`browse.ts:424`): copies are `merge.sources(entry)` plus the
   sources of each `_folded` item, so removing the tile hides every episode of
   that show the deck held, rather than letting an older one surface.
4. `test/merge.test.ts`: three Paw Patrol episodes with the real numbers above
   collapse to S10E8 with two folded; a film between them keeps its place; an
   episode with no `grandparentGuid` folds by title.
5. Mock `dev/mock-plex.js` (~l.97): on the second server's deck, use a
   different episode of the first show than the first server's.
6. Smoke `dev/smoke/deck.js`: that show has exactly one tile in Continue
   watching, and it is the more recently viewed episode (assert its
   season/episode text). Run against `main` first and watch it fail. Clearing
   that tile (018's flow) leaves no tile of that show.

## Out of scope
- Which server plays the kept episode (the preferred-server rule stands).
- The series page, season merging (checked on real data 2026-11-09: correct).
- Recently Added and the TMDB rows.

## Definition of done
- [ ] In Continue watching, a show held on two servers with different next episodes shows one tile, the most recently watched (smoke step, failing on `main`, failure line in the report).
- [ ] Unit test with the measured Paw Patrol numbers passes.
- [ ] Removing that tile removes every folded episode's copies (smoke asserts no tile of that show remains).
- [ ] the gate passes (`crew gate .claude/tasks/046-seasons-merge-across-servers.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
