---
id: 052
slug: a-weekly-index-of-kids-titles
status: approved
branch: crew/052-a-weekly-index-of-kids-titles
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - src/api/plex/library.ts
  - src/data/kids.ts
  - src/data/cached.ts
  - src/data/discovery.ts
  - types/plex.d.ts
  - dev/library.js
  - dev/mock-plex.js
  - test/kids.test.ts
---

# A weekly index of the kids titles the servers hold

## Goal
The app knows, without asking per title, which TMDB films and shows the
servers hold among their kids and family titles — refreshed at most weekly —
and Discovery can keep only those in a row.

## Why now
Stuart, 2026-11-09: the Kids rows show "only what we have", except the
new-and-coming row. He chose a weekly index over per-tile lookups.

## Existing work
Builds on 051 (same `discovery.ts`). Run after it merges.

## Background
Measured 2026-11-09 on the real servers (read-only, `totalSize` with a
container size of 1). `/library/sections/{k}/genre` lists genre keys;
`/library/sections/{k}/all?genre=<key>` filters by one.

| server · library | total | Family |
|---|---|---|
| Apollo · Movies (1) | 95,825 | 8,818 |
| Apollo · TV Shows - Kids (9) | 2,315 | 1,981 |
| Apollo · TV Shows (3) | 24,965 | 1,896 |
| Maverick · Movies - Kids (6) | 1,161 | 1,061 |
| Maverick · Movies (1) | 6,153 | 487 |
| Maverick · TV Shows - Kids (16) | 378 | 348 |

So: whole libraries whose title contains "Kids", and the Family, Animation
and Children genres of every other movie and TV library (Apollo Movies
Animation 4,869, Children 237; Apollo TV Animation 722, Children 250).
About 45 requests of 500, weekly.
Genre keys differ per server and library — look them up by title.

## Graph context
- Servers we do not own: this is the one large read the app makes. Serial,
  pages of 500, never more than weekly, and never on the critical path —
  the page draws from the old index while a new one builds.
- `items(server, sectionKey, start, size, extra)` (`library.ts:53`) passes
  `extra` through and sets `includeGuids: 1`; `tmdbId(item)` (`library.ts:~292`)
  extracts the id. `contentRatings` (`library.ts:84`) is the shape for a
  `genres(server, key)` helper.
- `sections()` drops `LQ` and `vSports` libraries (041); keep it that way.
- Shows are keyed `tv/<id>`, films by bare id (045, `discovery.ts keyOf`).
- Gotcha: an `X-Plex-Container-Size` header on `/library/sections` truncates
  the list to one library. Do not send paging headers there.

## Approach
1. `src/api/plex/library.ts`: `genres(server, sectionKey)` →
   `{ key, title }[]` from `/library/sections/{key}/genre`.
2. `src/data/kids.ts` (new): `held(): Promise<Set<string>>`.
   - For each reachable server, from `sections()`: a library whose title
     matches `/kids/i` is read whole; any other movie or show library is read
     once per genre titled `Family`, `Animation`, `Children` or `Kids` that it
     has (skip those it lacks). Adult animation entering the set is harmless:
     rows only show what TMDB's kids lists offer.
   - Page with `items(..., start, 500, extra)` serially; keep only the TMDB
     key per item (`tv/<id>` for shows, else the id); never keep the items.
   - Cache per server under `cached.ts` with a 7-day `daily` (`kids:`), as a
     string array. A stale entry is used immediately and rebuilt behind it.
   - `isHeld(set, entry)`: the entry's key is in the set.
3. `src/data/discovery.ts`: `load` accepts `keep?: (entry) => boolean`
   applied to every page (first and later) of a row, except categories with
   `kind === 'upcoming'`. A row left empty after its first page is not added.
4. `dev/library.js` / `dev/mock-plex.js`: a "Movies - Kids" library on one
   mock server and a Family genre on the main Movies library, serving
   `/library/sections/{k}/genre` and `?genre=` filtering with `totalSize` and
   paging; count those requests.
5. `test/kids.test.ts`: the key mapping (show → `tv/<id>`, film → id, item
   without a tmdb Guid skipped), and the `keep` filter leaving upcoming rows
   untouched.

## Out of scope
- Drawing the page (053). Episodes. Refreshing on demand.

## Definition of done
- [ ] `held()` builds the set from Kids libraries whole and the Family genre elsewhere, against the mock (unit or smoke assertion on its contents, with a held and an unheld id).
- [ ] A second call within the week makes no library request (count, with a non-zero control on the first).
- [ ] `load({ keep })` drops unheld entries from every row except `upcoming`.
- [ ] No request sends a paging header to `/library/sections`.
- [ ] the gate passes (`crew gate .claude/tasks/052-a-weekly-index-of-kids-titles.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
