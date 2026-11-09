---
id: 051
slug: tmdb-rows-for-kids
status: approved
branch: crew/051-tmdb-rows-for-kids
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - types/plex.d.ts
  - src/api/tmdb.ts
  - src/data/discovery.ts
  - src/core/config.ts
  - dev/mock-tmdb.js
  - test/tmdb.test.ts
---

# TMDB can answer the Kids page's rows

## Goal
Discovery can load a second list of rows — the Kids list — built from TMDB
queries by genre, company, year range and "not animated", plus a row of kids
films still to come out. Nothing on screen changes yet; 053 draws the page.

## Why now
Stuart, 2026-11-09: the Kids page "should be a discovery page but only kids
stuff", from TMDB: trending films and shows, the services (Netflix, Prime,
Disney+), Animated (Disney, Pixar, DreamWorks), live-action kids films, 90s
classics, and new-and-coming cinema films for their trailers. "Trust what
TMDB is sending for family and kids".

## Existing work
None. 047 (running) adds one field to `types/plex.d.ts`; run after it merges.

## Background
Verified 2026-11-09 against TMDB:
- Companies: Walt Disney Pictures `2`, Walt Disney Animation Studios `6125`,
  Pixar `3`, DreamWorks Animation `521`.
- Providers (GB): Netflix `8`, Amazon Prime Video `9`, Disney Plus `337`.
- Genres: Animation `16`, Family `10751` (film and TV), Kids `10762` (TV only).
- `/trending` cannot be genre-filtered, so "trending kids" is `/discover`
  sorted `popularity.desc`. `/movie/upcoming` has no genre filter, so
  "New and coming" is `/discover/movie` from today forward.

## Graph context
- `fetchPage` (`src/data/discovery.ts:113`) caches pages daily under
  `[tv:]kind:id:page`. Two kids rows with the same kind and id but different
  filters would read each other's pages — the key must carry the filters.
- `goodEnough` (`src/api/tmdb.ts:29`) drops results under `MIN_VOTES = 500`.
  That would empty the upcoming row (no votes yet) and most kids TV.
- TMDB film and TV ids overlap; shows are keyed `tv/<id>` (045).

## Approach
1. `types/plex.d.ts` `DiscoveryCategory`: `kind` gains `'discover'` and
   `'upcoming'`; new optional `params?: Record<string, string | number>`
   (passed straight to TMDB) and `minVotes?: number`.
2. `src/api/tmdb.ts`:
   - `discover(media, params, page, minVotes)` → `/discover/{media}` with
     `params`, adding `watch_region: REGION` when `with_watch_providers` is
     present; filters with `goodEnough` at `minVotes` (default `MIN_VOTES`).
   - `catalogue`: `'discover'` → `discover(...)`; `'upcoming'` →
     `discover('movie', { …params, 'primary_release_date.gte': <today
     YYYY-MM-DD>, sort_by: 'primary_release_date.asc' }, page, 0)`.
3. `src/data/discovery.ts`: `load(context)` takes an optional
   `categories` (default `settings.categories`, so Discovery is unchanged).
   The `fetchPage` key includes a stable string of `params` (keys sorted,
   `key=value` joined) and `minVotes`.
4. `src/core/config.ts`: `kidsCategories`, in this order —
   - New and coming — `upcoming`, `params: { with_genres: '10751|16' }`
   - Popular kids films — `discover`, movie, `{ with_genres: '10751', sort_by: 'popularity.desc' }`
   - Popular kids shows — `discover`, tv, `{ with_genres: '10762', sort_by: 'popularity.desc' }`
   - On Netflix / Shows on Netflix — films `{ with_genres: '10751', with_watch_providers: 8 }`, shows `{ with_genres: '10762', with_watch_providers: 8 }`
   - The same pair for Prime Video (9) and Disney+ (337)
   - Animated — movie `{ with_companies: '2|6125|3|521', with_genres: '16', sort_by: 'popularity.desc' }`
   - Real people — movie `{ with_genres: '10751', without_genres: '16', sort_by: 'popularity.desc' }`
   - Classics from the 90s — movie `{ with_genres: '10751', 'primary_release_date.gte': '1988-01-01', 'primary_release_date.lte': '2000-12-31', sort_by: 'vote_count.desc' }`

   Every kids row has `minVotes: 20`; the upcoming row 0.
   Every **film** row except New and coming also carries
   `certification_country: 'GB', 'certification.lte': 'PG'` (Stuart, 2026-11-09:
   "allow pg but only from the tmdb kids list"). New and coming stays
   genre-only: unreleased films often have no GB certificate yet, and the
   filter would drop them.
5. `dev/mock-tmdb.js`: answer `/discover/movie` and `/discover/tv` for these
   params, and record the query of each request so a test can read it.
6. `test/tmdb.test.ts`: `catalogue` for an `upcoming` category asks
   `/discover/movie` with `primary_release_date.gte` = today and keeps a
   zero-vote result; a `discover` category passes its params and
   `watch_region` when a provider is set; two categories differing only in
   `params` produce different cache keys (export the key function if needed).

## Out of scope
- Drawing the Kids page (053), filtering to held titles (052), the key (054).
- Any change to the existing Discovery rows or their order.

## Definition of done
- [ ] `catalogue` handles `discover` and `upcoming` as above (unit tests).
- [ ] An upcoming film with 0 votes is kept; a discover row drops results under its `minVotes`.
- [ ] Two categories differing only in `params` never share a cache key (unit test).
- [ ] Every kids film row except New and coming sends `certification_country=GB` and `certification.lte=PG` (unit test on the request).
- [ ] Discovery's existing smoke steps still pass unchanged.
- [ ] the gate passes (`crew gate .claude/tasks/051-tmdb-rows-for-kids.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
