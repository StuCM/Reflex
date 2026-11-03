---
id: 043
slug: discovery-finds-what-the-servers-have
status: approved
branch: crew/043-discovery-finds-what-the-servers-have
model: sonnet
env: laptop
rounds: 0
work: discovery-matches-and-tv
files:
  - src/data/discovery.ts
  - src/api/plex/library.ts
  - src/data/cached.ts
  - dev/mock-plex.js
  - dev/library.js
  - dev/smoke/discovery.js
---

# Discovery finds what the servers have

## Goal
A Discovery tile for a film either server holds says so, and OK opens that
film's page. Today every tile reads "Not in your library".

## Why now
Stuart, 2026-11-03: "on discovery page it can't link the tmdb to my library so
it says everything is not available". Backlog 0e item 1 (`docs/browse-design.md:44`).

## Existing work
None. (Checked by hand: every crew branch is merged; nothing open touches these files.)

## Background
Measured by the orchestrator on 2026-11-03 against Maverick, read-only:

- `/library/all?guid=tmdb://1396&includeGuids=1` → 0 results, and
  `guid=imdb://tt0903747` → 0, for Breaking Bad, which the server holds. The
  graph has the same for Apollo (`tmdb://27205`, Inception). **No external-id
  guid lookup works on these servers.**
- `/hubs/search?query=Inception&includeGuids=1` returns, among albums and
  episodes, the film with `type: movie`, `year: 2010` and
  `Guid: [imdb://tt1375666, tmdb://27205, tvdb://113]`. Same shape for a show.

So: search by title, keep a hit only if its `tmdb://` Guid is the entry's TMDB id.

## Graph context
- Trap: the mock answers `guid=tmdb://` (`dev/mock-plex.js:862` →
  `srv.byGuid`, indexed in `dev/library.js:985-1000`), so the discovery smoke
  steps pass on a lookup the real servers ignore. The smoke suite proves
  nothing about real-server matching unless the mock behaves like one.
- `cached.lookup` (`src/data/cached.ts:67`, `misses('tmdb:', 7*DAY)`) holds a
  hit forever and a miss for 7 days. On the TV it already holds wrong misses
  for every title anyone rested on; they must not be trusted after this ships.
- Lookups are requests to servers we do not own: one per *resting* tile
  (`scheduleResolve` already does this), cached. Never on scroll.

## Constraints that bite here
- `search()` results include albums and episodes: filter to `type === 'movie'`
  (this task is films only; TV is 045).
- `Array.prototype.sort` is not stable; there is nothing to sort here, keep it that way.

## Approach
1. `src/api/plex/library.ts:216` `search(server, query)`: pass `includeGuids: 1`
   so each hit carries `Guid[]`. Check `isFilm` still applies.
2. `src/data/discovery.ts` `askServers` (~l.50): replace the
   `findByGuid(server, "tmdb://<id>")` call with `search(server, entry.title)`,
   then keep the hits where `tmdbId(hit) === entry's TMDB id`
   (`src/api/plex/library.ts:294` `tmdbId`). Year is not needed once the id
   matches. Fold across servers with `merge.lists` exactly as today.
3. `src/data/cached.ts:67`: change the `lookup` prefix (e.g. `tmdb:` →
   `tmdb2:`) so the old misses are never read. One line.
4. `copiesByGuid` stays for any other caller; if discovery was its only caller,
   delete it (grep first).
5. Mock: `dev/mock-plex.js` `/library/all` must answer `guid=tmdb://…` and
   `guid=imdb://…` with zero results, as the real server does (keep `plex://`).
   `/hubs/search` must return `Guid[]` when `includeGuids=1`, and include at
   least one non-movie hit (an album or episode) with the same title so the
   type filter is exercised.
6. Smoke, `dev/smoke/discovery.js`: the existing steps "a title we do hold
   opens the ordinary film page" (l.275) and "a title neither server has says
   so before OK" (l.241) must pass against the honest mock. First make the
   mock honest on `main`'s code and watch l.275 fail; put the failure line in
   the report. Replace the `guid=` request collector (l.12-17) with one that
   counts `/hubs/search` lookups, and keep a companion step asserting a
   non-zero count on it (CLAUDE.md: a counting step needs a control).

## Out of scope
- TV shows (045). The page for a title we lack (044).
- Any change to which tiles are looked up or when.
- Matching by title and year without the id check.

## Definition of done
- [ ] Against the mock, a held film's tile shows it is available and OK opens its film page.
- [ ] The mock returns nothing for `guid=tmdb://` and `guid=imdb://`.
- [ ] The held-film smoke step fails against `main`'s `src/` with the honest mock, and the report quotes the failure line.
- [ ] A search hit whose TMDB id differs (same title, other film) is not taken as a match — a smoke step or unit test shows it.
- [ ] The lookup cache prefix changed, so old cached misses are ignored.
- [ ] The search-lookup counter has a non-zero control.
- [ ] the gate passes (`crew gate .claude/tasks/043-discovery-finds-what-the-servers-have.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
