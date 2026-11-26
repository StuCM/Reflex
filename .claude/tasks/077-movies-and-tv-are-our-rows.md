---
id: 077
slug: movies-and-tv-are-our-rows
status: approved
branch: crew/077-movies-and-tv-are-our-rows
model: sonnet
env: laptop
rounds: 0
work: v2-movies-tv
files:
  - src/screen/browse.ts
  - src/view/menubar.ts
  - src/view/glyphs.ts
  - src/screen/pages.ts
  - src/core/config.ts
  - src/rules/rows.ts
  - types/plex.d.ts
  - test/rows.test.ts
  - dev/mock-tmdb.js
  - dev/smoke.js
  - dev/smoke/movies.js
  - dev/smoke/shell.js
  - dev/smoke/deck.js
---

# Movies and TV are our rows, from TMDB, with no server rows

## Goal
Movies shows, in order, the Movies board's rows with its labels and sub-lines:
**Trending this week** / Updated daily, **Top 10 today** / Most watched in your
region, **Because you watched <title>** / From your history — then a row per service
(**Popular on Netflix**, **Popular on Prime Video**, **Popular on Apple TV+**,
**Popular on Disney+**), then genre rows of ours: Top thrillers, Top sci-fi, Top comedies, Top action, Top horror, Top
documentaries. TV: Trending this week, Top 10 today, **Your next episodes** /
Shows you are watching (the deck's episodes), Because you watched <show>, then
the same four service rows, then Top crime, Top sci-fi & fantasy, Top comedies, Top dramas, Top documentaries,
Top animation. No Plex hub on either page, no Continue watching on Movies. The
Top 10 row is marked ranked in the row model (drawn plain until 078).

## Why now
Stuart, 2026-11-26: "the servers rows are not in this at all, all rows are
custom by us and from tmdb lists"; Continue watching "only on home"; then "no
lets have next episodes still on the tv show page"; "could we add a few more
rows … Maybe like Top thrillers, top sci fi for example"; "I don't think
streaming is needed this is folded in with movies and tvs" — so the service
rows live here and the menu's Streaming tile (081) goes. Labels follow `designs/v2/Movies.dc.html:145-157`.

## Existing work
After 076 (uses `SERVICES`, `limit`, `kind: 'because'`). Base `feat/v2`.

## Background
- `src/screen/browse.ts:313-315` registers movies/tv/home to `showPage`, which
  calls `loadView` (l.891): deck (l.952) then `mergeHubs`. `loadKids`
  (l.1118) is the working pattern for a page of TMDB rows through
  `discovery.load({categories, keep, add})` (src/data/discovery.ts:190 —
  parallel fetch, in-order publish, `disc:` daily cache).
- `viewSection('movies')` (l.130) still feeds the "Nothing there" toast; keep.
- Seed: `pages.buildDeck` (pages.ts:99) is profile-filtered, newest first,
  `includeGuids=1`. A film's `tmdbId(item)` is direct. An episode needs its
  show: `meta.load({ratingKey: grandparentRatingKey, _server})`
  (src/data/meta.ts:42, one cached request), then `tmdbId(show)`.
- The deck holds in-progress items only, so a finished film is not a seed —
  accepted for now (plays-based seed later).
- `pages.refreshed(shown, fresh)` (l.54) keeps the old Row when items match.
- `rowModel.list` is at `src/rules/rows.ts:6`; `ListRow` at `types/plex.d.ts:212`.

## Graph context
- **Keep TMDB rows out of `cached.rows`** (`cacheLists`, browse.ts:~860):
  `DiscoveryEntry._asking` is a Promise, `store.put` swallows the clone error,
  and nothing persists. They have their own `disc:` cache. Do not read or write
  `rows:Movies` / `rows:TV Shows` from these pages either — the sidebar's
  `lib0`/`lib1` own those keys.
- Rows landing at different times must not move the focus: follow `landDeck`
  (l.824-851), which bumps `rowIndex` when inserting above.
- "TMDB movie and TV ids overlap": `tv/<id>` keys.

## Approach
1. `config.ts`: `PAGE_ROWS.movies` and `PAGE_ROWS.tv` as `DiscoveryCategory[]`:
   each entry `{title, sub, kind, …}`:
   - Trending this week / Updated daily — `discover`, `{with_watch_providers: SERVICE_IDS, sort_by: 'popularity.desc'}` (mixed across the services, v2-spec §5).
   - Top 10 today / Most watched in your region — `trending`, `window: 'day'`, `limit: 10`, `ranked: true`.
   - Movies: Because you watched <title> / From your history — `because`.
   - TV: Your next episodes / Shows you are watching — the deck's episodes (step 3), then Because you watched <show> / From your history.
   - Popular on <service> ×4 (`SERVICES` order) / sub-line "On your services" — `discover`, `{with_watch_providers: <one id>, sort_by: 'popularity.desc'}`.
   - Genre rows — `discover`, `{with_genres: <id>, sort_by: 'vote_average.desc'}` with the existing vote floor. Movies: thrillers 53, sci-fi 878, comedies 35, action 28, horror 27, documentaries 99. TV: crime 80, sci-fi & fantasy 10765, comedies 35, dramas 18, documentaries 99, animation 16. Sub-line "Highest rated".
   `ListRow` gains `sub?: string`; the rail draws it under the title (board:
   24px, rgba(255,255,255,.55)) — the CSS is 078's, the field is this task's.
2. `rows.ts`: `rowModel.ranked(title, items)` — a list row with `ranked: true`,
   capped at 10; `ListRow.ranked?: true`. Unit test it.
3. `browse.ts`: `loadView` for `'movies'` / `'tv'` takes a new branch,
   `loadPageRows(name)`, beside `loadKids`: no `mergeHubs`, no deck row, no
   `cacheLists`. Seed = first `buildDeck` item of the page's type (film, or
   episode → its show); "Because you watched <seed title>"; no seed → that row
   is omitted. TV inserts **Your next episodes** third: the `buildDeck` items of
   type episode, in deck order, omitted when empty, landing without moving
   focus. Snapshot with `pages.keep` as the other pages do.
4. Mock TMDB: answer `with_watch_providers` discover (any ids) and the four
   single-provider rows with distinct lists so each row is tellable.
5. Smoke, new area `movies` (`dev/smoke/movies.js`, registered in
   `dev/smoke.js`): Movies shows its thirteen labels in order; TV its sixteen, with
   Your next episodes third (positive count from the mock deck); Top 10
   has exactly 10 tiles; Movies and TV make **zero** hub calls
   (with a control asserting Home makes ≥1 on the same collector); no
   "Continue watching" on either, and no "Your next episodes" on Movies.
6. Re-point the shell steps that relied on hubs on Movies/TV:
   `shell.js:704-750` (assert TMDB row labels and tiles), `:755-806` (use a
   Home hub instead of Movies' Top Rated), `:877-951` (`heldTitles` for Home
   only; Movies/TV asserted by labels). `deck.js:687-693, 745-760` read the
   sidebar's `rows:Movies` key and should still pass — touch only if they fail.

## The Streaming tile
`src/view/menubar.ts` drops the Streaming tile (nine tiles: Home, Movies, TV,
Collections, Discover, Kids, Search, Settings, Servers) and its "Coming soon"
toast; `src/view/glyphs.ts` drops its icon if nothing else uses it. Update
`shell.js`'s tile count and order, and any `smoke.js` helper walking the tiles.
Record it under 081's "Differs from board" in `docs/v2-decisions.md`? No —
that file is outside `files:`; note it in Worker notes for the orchestrator.

## Out of scope
- Drawing the ranked row (078), the hero (079), Home's split (080).
- The watchlist seed; finished-film seeds.

## Definition of done
- [ ] TV shows Your next episodes third, from the profile's deck (smoke).
- [ ] Movies and TV show their rows in order, with the board's labels and sub-lines, from TMDB, with no Plex hub request (smoke, with control).
- [ ] Because you watched names its seed, and is absent with an empty deck (smoke).
- [ ] Top 10 is a ranked row of exactly 10 (unit + smoke).
- [ ] Nothing is written to `rows:Movies` / `rows:TV Shows` by these pages (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/077-movies-and-tv-are-our-rows.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Worker notes

## Graph writes proposed
