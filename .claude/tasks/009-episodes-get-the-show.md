---
id: 009
slug: episodes-get-the-show
status: draft
branch: crew/009-episodes-get-the-show
model: sonnet
env: laptop
files:
  - js/tmdb.js
  - js/art.js
  - js/showpage.js
  - css/app.css
  - dev/mock-tmdb.js
  - dev/smoke.js
  - test/art.test.js
---

# An episode's tile is the show, and the still moves to the series page

## Goal
A part-watched episode in the rail shows the **show's** picture, not a frame
from that episode — and never the same picture as the hero behind it. The
episode still it used to show moves to where it belongs: the series page, one
per episode row, so drilling into a show is how you see them.

## Why now
The user's words: the rail should carry the series image, "the episode still
would still show when we enter the series... I don't want duplicate images with
the hero." Today `Art.tile` returns `Plex.posterUrl(item)` for an episode — its
`thumb`, which is the still — while `Art.hero` falls through to
`Plex.artUrl(item)`, which for an episode is usually the show's art. So the two
are different pictures by luck, and the tile is a frame nobody recognises.

The series page meanwhile is a wall of text: `docs/backlog.md` §3 has had
"Episode stills — episodes carry a landscape `thumb` we never draw" open since
before any of this.

## Existing work
<!-- filled in by preflight before dispatch. NOTE: task 008 was in flight when
     this spec was written and reshapes js/art.js, css/app.css and
     dev/smoke.js. Re-run the collision check after 008 merges, and read those
     three files as 008 leaves them — the Approach below names functions, not
     line numbers, for exactly that reason. -->

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **`js/art.js` already owns which picture goes where**, with an in-memory and
  `Store` cache under `art:<tmdbId>`, at most 4 lookups in flight, one per id
  however many tiles ask, and misses cached as well as hits. All of that shape
  stays. Task 008 widened the cached payload to carry facts as well as
  backdrops; read it as it now is.
- **Nothing may wait on TMDB.** `Art.tile` and `Art.hero` answer synchronously
  from cache or fall back to Plex, and `Art.warm` notifies listeners when a
  lookup lands. An episode is no different: it draws its still first and swaps
  to the show's backdrop when that arrives.
- **`Meta.load(item)` is the cheap way to a show's ids.** It fetches
  `/library/metadata/<ratingKey>` with `includeGuids: 1`, and caches in memory
  *and* IndexedDB keyed `<server>:<ratingKey>`. So the show behind an episode
  costs **one request per show, ever** — not one per episode, and not one per
  time you walk past. `Plex.tmdbId` then reads the `Guid[]` off it. An
  episode's own `Guid` array holds *episode* ids and is no use here.
- **Load order**: `js/art.js` is loaded at index.html:141, `js/meta.js` at 146.
  Art referencing `Meta` is therefore fine — everything is a global and the
  call happens long after load — and it is what `js/guard.js` already does.
  Do not reorder the script list to "fix" this.
- **Do not reintroduce a per-tile Plex fetch.** `42f5ef9` removed
  `Meta.schedule` from `Browse.render` because resting on any tile cost a
  metadata request against servers we do not own. One request per *show* is a
  different order of magnitude and is the reason this is acceptable; one per
  episode would not be.
- **`Media.railTitle` / `Media.railSub`** already name an episode by its show
  and put `S1 E4 · Spirit Receivers` underneath (`a206671`, unit tested in
  `test/labels.test.js`). This task changes pictures, not words — do not touch
  those rules.
- **The show page is `js/showpage.js`**: seasons as chips across the top,
  episodes as `.sh-episode` rows down the left, each with its number, title,
  minutes, watched state and a guard verdict. It is a deliberate drill-in, not
  a rail, so a thumbnail per visible episode row is a reasonable cost where a
  thumbnail per tile in a 30,000 item walk would not be.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).
  `dev/smoke.js` fails on any request that is not to `localhost:<PORT>`, so the
  `/tv` endpoint has to come from `dev/mock-tmdb.js`.

## Constraints that bite here
- **Chromium 53.** No `async`/`await`, no CSS Grid, no object spread, no
  `Object.entries`, no `position: sticky`. `npm run check` scans for these.
- **Animate only `transform` and `opacity`.** The episode rows must not gain a
  shadow or filter transition.
- **Never crawl a server we do not own.** One show lookup per distinct show on
  screen, cached; episode stills only for the season actually being shown.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/tmdb.js`** — add the television counterpart of the existing film
   lookup: `tvDetails(tmdbId)` →
   `GET /tv/{id}?append_to_response=images&include_image_language=en,null`.
   Same `get()`, same key, same `include_image_language` reason as the film
   call: without it the appended images are filtered to the request language
   and most backdrops vanish. Export it.

2. **`js/art.js` — the show behind an episode.** Add a second small cache,
   `show:<server>:<grandparentRatingKey> -> tmdbId|null`, and a resolver:
   - Given an episode with a `grandparentRatingKey`, call
     `Meta.load({ ratingKey: item.grandparentRatingKey, _server: item._server })`
     and read `Plex.tmdbId` off the result. Cache the answer, `null` included —
     a show TMDB has never heard of must not be looked up again.
   - Then `Tmdb.tvDetails(thatId)` through the **existing** queue and
     in-flight cap, cached under `art:tv:<tmdbId>` so it cannot collide with a
     film of the same id.
   - `Art.pick` is reused unchanged on the `/tv` payload — the backdrops block
     has the same shape. Do not write a second picker.

3. **`js/art.js` — the rule, stated once.** `Art.hero(item)` and
   `Art.tile(item)` for an episode both resolve through the show:
   - `hero` = the show's best backdrop, else `Plex.artUrl(item)`, else its
     poster — as now.
   - `tile` = the show's **second** backdrop. If there is no second one, fall
     back to **the episode's own still** (`Plex.posterUrl(item)`, its `thumb`)
     rather than repeating the hero's picture. Never return a URL equal to the
     one `hero` would return for the same item — that is the user's actual
     requirement and the thing to hold on to if anything else is in tension
     with it.
   - Everything still answers synchronously: until the show's backdrops land,
     the tile is the still and the hero is the Plex art, exactly as today.

4. **`js/showpage.js` — the still per episode row.** Each `.sh-episode` gains a
   thumbnail on its left, from `Plex.posterUrl(ep, 160, 90)` — the episode's
   `thumb` *is* the still, so nothing new is fetched per episode beyond the
   image itself. An episode with no `thumb` gets an empty box of the same size,
   never a broken image and never a row of a different height.

5. **`css/app.css`** — `.sh-episode` grows to fit a 160×90 still: the existing
   `height: 62px` becomes 106px, with the thumbnail floated left and the
   existing number, title, minutes, watched and verdict columns keeping their
   places beside it. Keep the reserved 6px left border so focus still shifts
   nothing sideways. The corner radius should match the rail's tiles.

6. **`dev/mock-tmdb.js`** — answer `/__tmdb/tv/<id>` with the same deterministic
   payload shape as the film route: several backdrops for most ids, and at
   least one id with **exactly one**, so step 3's "fall back to the still
   rather than duplicate" branch is exercised rather than asserted.

7. **`dev/smoke.js`** — three steps, added not substituted:
   - A part-watched episode in Continue watching draws a tile that is a TMDB
     image and is **not** the same URL as `#hero-art` behind it.
   - An episode whose show the mock gives one backdrop draws the episode still
     on the tile and the show backdrop in the hero — different pictures, and
     the tile is a Plex `/photo/:/transcode` URL.
   - Opening a show lists episodes each with a still, and an episode with no
     `thumb` still renders a row of the same height.

8. **`test/art.test.js`** — extend for the episode rule as a pure function.
   Whatever helper step 3 uses to choose between "second backdrop" and "the
   still" must be exported and testable without a network: two backdrops give
   the second; one backdrop gives the still; none gives the still; and in no
   case does it return the hero's path.

## Out of scope
- **TMDB season and per-episode artwork** (`/tv/{id}/season/{n}/episode/{m}`).
  Plex already has the still; a second source for it buys nothing here.
- **Cast, description or facts for shows.** Task 008 did films; extending it to
  television is its own task, and this one must not half-do it.
- **`js/masthead.js`, `js/detail.js`, `js/browse.js`, `js/rail.js`.** The
  header shape is 008's and is finished; this task changes only which URL
  `js/art.js` hands back and what the series page draws.
- **`Media.railTitle` / `Media.railSub`** and anything else about wording.
- **The show page's seasons, verdicts, ordering or key handling.** Only the
  episode row's appearance changes.
- Search and hub rows showing one copy per server — a known gap from 007,
  recorded in `docs/decisions.md`, and not this task's problem.

## Definition of done
- [ ] An episode's rail tile shows the show's picture, and it is never the same
      URL as the hero backdrop behind it.
- [ ] Where TMDB has only one backdrop for a show, the tile falls back to the
      episode still and the hero keeps the backdrop — still two different
      pictures, never one repeated.
- [ ] The show behind an episode is looked up **once per show**: walking a row
      of ten episodes of one series makes one metadata request and one TMDB
      request, and walking it again makes none.
- [ ] A show with no TMDB id is not looked up twice, and its episodes fall back
      to the Plex art and the still.
- [ ] The series page lists each episode with its still, and an episode with no
      `thumb` renders a row of the same height rather than a broken image.
- [ ] Nothing blanks while waiting: the tile draws the still immediately and
      swaps when the show's backdrops arrive.
- [ ] The choice between "second backdrop" and "the still" is a pure exported
      function covered by `test/art.test.js`.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
