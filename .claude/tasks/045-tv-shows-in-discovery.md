---
id: 045
slug: tv-shows-in-discovery
status: approved
branch: crew/045-tv-shows-in-discovery
model: sonnet
env: laptop
rounds: 0
work: discovery-matches-and-tv
files:
  - src/core/config.ts
  - src/api/tmdb.ts
  - src/data/discovery.ts
  - src/data/cached.ts
  - src/data/art.ts
  - src/rules/labels.ts
  - src/screen/browse.ts
  - types/plex.d.ts
  - dev/mock-tmdb.js
  - dev/library.js
  - dev/mock-plex.js
  - dev/smoke/discovery.js
---

# TV shows in Discovery, as their own rows

## Goal
Discovery carries TV rows beside the film rows. A show either server holds says
so, and OK on it opens the series page.

## Why now
Stuart, 2026-11-03: "currently only shows movies. Want to see tv shows as
well" — "own rows and open the series page".

## Existing work
Builds on 043 (the title-search lookup). Run after it merges.

## Background
- Rows (Stuart accepted the default, 2026-11-03): **Trending shows this
  week**, **Shows on Netflix**, **Shows on Prime Video**, **Sci-fi & fantasy
  shows**, in the same Discovery section as the film rows, after them.
- Measured 2026-11-03 on Maverick: `/hubs/search?query=Breaking Bad&includeGuids=1`
  returns the show with `type: show` and `Guid: [imdb://tt0903747,
  tmdb://1396, tvdb://81189]`. So 043's lookup works for shows unchanged,
  filtering `type === 'show'` instead of `movie`.

## Graph context
- **TMDB movie and TV ids overlap.** `cached.lookup` and art (`art.ts`, which
  keys on the synthetic `tmdb://<id>` Guid) are keyed by id alone, and
  `disc:` catalogue keys are `kind:id:page`. Every key a TV entry writes must
  carry the media type, or a show reads a film's cache entry.
- `src/app.ts` `openItem` already sends `type === 'show'` to the series page,
  so once a TV entry resolves to the server's show, OK needs nothing new.

## Constraints that bite here
- TV results use `name` and `first_air_date`, not `title`/`release_date`.
- TMDB TV genres are coarser: Sci-Fi & Fantasy is `10765`.
- One lookup per resting tile, cached, exactly as films.

## Approach
1. `types/plex.d.ts` `DiscoveryCategory` (l.269): add `media?: 'movie' | 'tv'`
   (absent = movie). `TmdbResult` (l.242): `name?`, `first_air_date?`.
2. `src/core/config.ts:32`: the four TV categories above, `media: 'tv'`.
3. `src/api/tmdb.ts`: `trending`, `onProvider`, `byGenre` and the `catalogue`
   dispatch take the media type and use `/trending/tv/week` and `/discover/tv`
   for TV. `film()` (l.30) reads `name`/`first_air_date` when `title`/
   `release_date` are absent. `details()` (l.153) asks `/tv/{id}` for a show.
4. `src/data/discovery.ts` `entry()`: `type: 'show'` for a TV result, and a
   synthetic Guid that carries the type (e.g. `tmdb://tv/<id>`) so art and the
   lookup cache cannot collide with a film. `askServers` filters by the entry's
   type. The `cached.lookup` and `disc:` keys include the media type.
5. `src/data/art.ts`: details and facts for a show from `/tv/{id}`.
6. Rail sub-line for a show (`railSub`, `src/rules/labels.ts`) if the film
   one reads wrong for a show (e.g. no runtime). Keep it minimal.
7. Mock: `dev/mock-tmdb.js` serves `/trending/tv/week`, `/discover/tv`,
   `/tv/{id}`; the TV fixtures include one show the mock Plex servers hold
   (by `tmdb://` Guid in `dev/library.js`) and one they do not, and one TV id
   equal to a fixture film's TMDB id.
8. Smoke, `dev/smoke/discovery.js`: the TV row is present with its title; a
   held show reads available and OK opens the series page (assert the show
   title on it); an unheld show reads not available; the show whose id equals
   a film's resolves as the show, not the film.

## Out of scope
- The page for a title we lack (044, which will cover shows too).
- Seasons or episodes from TMDB. Changing film rows.
- A separate sidebar entry for TV discovery.

## Definition of done
- [ ] On the laptop, Discovery shows the four TV rows after the film rows.
- [ ] OK on a held show opens its series page.
- [ ] A TV id that equals a film's TMDB id resolves as the show (smoke step).
- [ ] No cache key a TV entry writes is identical to a film's.
- [ ] the gate passes (`crew gate .claude/tasks/045-tv-shows-in-discovery.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
