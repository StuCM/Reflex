---
id: 076
slug: tmdb-feeds-for-movies-and-tv
status: done
branch: crew/076-tmdb-feeds-for-movies-and-tv
model: sonnet
env: laptop
rounds: 1
work: v2-movies-tv
files:
  - src/api/tmdb.ts
  - src/data/discovery.ts
  - src/data/art.ts
  - src/core/config.ts
  - types/plex.d.ts
  - dev/mock-tmdb.js
  - test/tmdb.test.ts
  - test/art.test.ts
gate: pass
gateSha: f32b35ba723a185cad39a47cf14f1338f9b48187
gateAt: 2026-11-26T18:06:46.632Z
---

# TMDB feeds Movies and TV need: one-title recommendations, a row cap, and the service a title is on

## Goal
The data layer can answer three new questions, with no page using them yet:
recommendations from **one** seed title (film or show), a row capped at N
items, and which of Stuart's four services carries a title (name and logo).

## Why now
v2 group 2, Movies/TV. Stuart, 2026-11-26: Top 10 is the weekly trending list;
"your services" are "Netflix prime apple tv disney"; "Because you watched" is
"the last thing we watched".

## Existing work
None. Base `feat/v2`.

## Background
- `src/api/tmdb.ts:68 trending(page, media)` is `/trending/{media}/week` — the
  Top 10 source as is. `:103 discover(media, params, page, minVotes)` adds
  `watch_region=GB` whenever `with_watch_providers` is set (l.119); a pipe list
  is TMDB's OR. `catalogue()` dispatches on the category's `kind`.
- `:137 recommendedFrom(seeds)` is movie-only and pools up to 8 seeds — not a
  single "Because you watched X".
- `:211 details(id)` appends `images,credits,videos`.
- `src/data/art.ts:58 facts()` builds `ArtFacts`; `:167 lookUp` treats a
  cached entry missing a field as a miss.
- `src/core/config.ts:39-63 onService` holds Kids' ids: Netflix 8, Prime
  Video 9, Disney+ 337. Apple TV+ is 350 (TMDB; not yet in the repo).
- `types/plex.d.ts:276 DiscoveryCategory` has no limit field; `catalogue`
  returns a page of ~20 after `MIN_VOTES`.
- `src/data/discovery.ts:~120 pageKey` includes params, so each new row gets
  its own `disc:` daily cache key.

## Graph context
- "TMDB movie and TV ids overlap": key TV as `tv/<id>` (`discovery.keyOf`).
- A cached `facts` written before this change has no `service`; guard with
  `!== undefined` in `lookUp` so old entries refetch once, not every time.

## Constraints that bite here
- No new request per tile: providers ride on the `details` call already made.

## Approach
1. `config.ts`: one exported `SERVICES` list `[{id: 8, name: 'Netflix'},
   {id: 9, name: 'Prime Video'}, {id: 350, name: 'Apple TV+'},
   {id: 337, name: 'Disney+'}]`, and `SERVICE_IDS = '8|9|350|337'`. Leave
   `onService` as is.
2. `tmdb.ts`: `trending(page, media, window = 'week')` accepting `'day'`;
   category field `window?: 'day' | 'week'`. `recommendationsFor(id, media)` → `/{media}/{id}/recommendations`
   page 1, through the same entry mapping as `recommendedFrom`. Add a
   `kind: 'because'` branch to `catalogue` reading `seed` and `media`.
3. `DiscoveryCategory`: optional `limit?: number` and `seed?: number`;
   `discovery.ts` slices to `limit` after the vote filter, before publish.
4. `details()`: append `watch/providers`; `art.ts facts()` sets
   `service: {id, name, logo} | null` — the first of `results.GB.flatrate`
   whose `provider_id` is in `SERVICES`, in `SERVICES` order; `logo` is the
   `logo_path`. `lookUp` treats `service === undefined` as a miss.
5. Mock: `/tv/N/recommendations` alongside the movie one (l.316);
   `watch/providers` in `detailsFor` (l.155) — every third id on Netflix, every
   third+1 on Apple TV+, the rest none — so both cases exist; `/trending/*/day`
   answers with a different order from `/week`.
6. Tests: `catalogue` dispatches `because` to the right path for movie and tv;
   `limit` caps; `facts.service` picks by `SERVICES` order and is `null` when
   no flatrate matches; an old cached entry without `service` is a miss.

## Out of scope
- Any page, row or hero using these. The watchlist seed (TMDB sign-in group).

## Definition of done
- [ ] `recommendationsFor` and `kind: 'because'` work for movie and tv (unit).
- [ ] `limit` caps a category, and `window: 'day'` asks `/trending/{media}/day` (unit).
- [ ] `facts.service` is set from watch/providers and old cache entries refetch (unit).
- [ ] the gate passes (`crew gate .claude/tasks/076-tmdb-feeds-for-movies-and-tv.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

Round 1: PASS. Gate passed on f32b35b (171/171 smoke).

## Worker notes

- config.ts: exported SERVICES and SERVICE_IDS (SERVICE_IDS unused until a page needs it).
- tmdb.ts: trending takes a window; recommendationsFor; catalogue 'because'; details appends watch/providers.
- discovery.ts: limit slices in kept() and caps pages to 1; pageKey separates seed and day.
- art.ts: serviceOf, facts.service, exported isComplete (lookUp treats service undefined as a miss).
- types/plex.d.ts, mock-tmdb.js, tests updated.
- The first full gate run failed one smoke step once (deck) and passed on rerun; the isolated `smoke deck` area fails on base too.

## Graph writes proposed
