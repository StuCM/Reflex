---
id: 009
slug: portrait-rail
status: approved
branch: crew/009-portrait-rail
model: sonnet
env: laptop
files:
  - js/art.js
  - js/rail.js
  - js/showpage.js
  - css/app.css
  - dev/mock-tmdb.js
  - dev/smoke.js
  - test/art.test.js
---

# The rail goes portrait, and the still moves to the series page

## Goal
Rail tiles become 209×314 posters, seven across. The tile is the *poster* and
the hero behind it is the *backdrop*, so the two can never be the same picture
by construction rather than by a fallback ladder. An episode's tile is its
show's poster; the episode still it used to show moves to the series page, one
per episode row.

## Why now
The user asked for the rail in portrait, having weighed it against the cost:
a 2:3 poster is taller than a 16:9 tile, so one full row fits under 008's
header instead of two, plus a 350px peek of the next.

It also deletes a problem rather than solving one. The previous draft of this
task needed the show's *second* backdrop for an episode tile, with a fallback to
the still, so that the tile never repeated the hero — plus a lookup of the show
behind each episode to get a TMDB id at all. Posters make all of that moot: a
poster is never a backdrop, and Plex hands an episode its show's poster as
`grandparentThumb` for free, with no lookup of any kind.

## Existing work
<!-- filled in by preflight before dispatch. NOTE: task 008 was in flight when
     this spec was written and reshapes js/art.js, js/rail.js, css/app.css and
     dev/smoke.js. Re-run the collision check after 008 merges, and read those
     four files as 008 leaves them — the Approach names functions and
     constants, not line numbers, for exactly that reason. -->

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **The TMDB payload already carries posters.** `js/art.js` fetches
  `/movie/{id}?append_to_response=images,credits&include_image_language=en,null`
  once per title and caches it. That `images` block holds `posters` beside
  `backdrops`. Taking the poster from it costs **no extra request** — it is
  already in the cache this task reads.
- **An episode's show poster is free.** Plex puts `grandparentThumb` on the
  episode itself, so no show lookup, no `Meta.load`, no second TMDB endpoint.
  `Plex.photoUrl(Servers.of(item), item.grandparentThumb, w, h)` is all it
  takes, and `photoUrl` is already exported.
- **Nothing may wait on TMDB.** `Art.tile` and `Art.hero` answer synchronously
  from cache or fall back to Plex, and `Art.warm` notifies listeners when a
  lookup lands. Unchanged here: the tile draws the Plex poster immediately and
  swaps to TMDB's if that is better.
- **The rail geometry is derived, not hand-picked** (`bff3d6e`, and 008 carried
  it forward): `BIG_DROP` is `VIEWPORT_H - ROW_H`, `ROWS_FIT` is
  `Math.floor(VIEWPORT_H / ROW_H)`, `ROWS_VISIBLE` is `ROWS_FIT + 1`. Change
  the tile dimensions and every one of those must fall out of the arithmetic.
  A hand-typed number is what put 119px of the second row above the fold the
  first time this was got wrong.
- **The rail draws from a fixed pool** — 4 row elements, 12 tiles each, whatever
  the library size, repositioned by transform. Seven tiles across still fits
  inside a pool of 12 with lookahead to spare; do not grow the pool.
- **`Media.railTitle` / `Media.railSub`** already name an episode by its show
  and put `S1 E4 · Spirit Receivers` underneath (`a206671`, tested in
  `test/labels.test.js`). Both lines stay under the portrait tile. Do not touch
  those rules.
- **The show page is `js/showpage.js`**: seasons as chips, episodes as
  `.sh-episode` rows with number, title, minutes, watched state and a guard
  verdict. It is a deliberate drill-in, so a thumbnail per visible episode row
  is a reasonable cost where one per tile in a 30,000 item walk would not be.
  `docs/backlog.md` §3 has asked for this since before any of this work.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).
  `dev/smoke.js` fails on any request that is not to `localhost:<PORT>`.

## Constraints that bite here
- **Chromium 53.** No `async`/`await`, no CSS Grid, no object spread, no
  `Object.entries`, no `position: sticky`. `npm run check` scans for these.
- **Animate only `transform` and `opacity`**, on a 2018 SoC. The focus ring and
  lift stay a border-colour swap plus a `scale()`; no shadow or filter.
- **Never crawl a server we do not own.** No new requests: posters come from
  the payload already cached, or from image URLs Plex already gave us.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/rail.js` — the shape, and let the rest fall out.**
   - `TILE_W = 209`, `TILE_H = 314` (2:3), `GAP = 44`. Seven across at 1920 with
     the existing 96px left margin: `7 × 209 + 6 × 44 = 1727`, which fits 1728.
   - `TILES_VISIBLE = 7`.
   - `ROW_H` = 44 label + 314 art + 74 for the two lines + 34 below = **466**.
   - Everything else must be **derived** from those, not typed: `BIG_DROP`,
     `ROWS_FIT`, `ROWS_VISIBLE`. Under 008's 816px viewport that gives one whole
     row and a 350px peek — which is the "there are rows below" affordance and
     must not be tuned away.
   - `LEAD` and the pool sizes are unchanged.

2. **`css/app.css` — the tile.** `.tile` becomes 209 wide and `314 + 74` tall;
   `.tile-inner` 209×314. Keep the 4px reserved transparent border and the
   citron focus ring. **Scale the radius to the new width** — 28px on a 372px
   tile is proportionally much rounder on a 209px one; use 16px, and say in the
   comment that it is the same visual weight rather than the same number.
   `.tile-title` and `.tile-sub` keep their sizes and positions.

3. **`js/art.js` — the tile is a poster.**
   - Rename what `Art.pick` returns from `{hero, tile}` to `{hero, poster}`,
     and take `poster` from `payload.images.posters` (highest `vote_average`,
     then `vote_count`, same comparator the backdrops already use) rather than
     the second backdrop. `hero` stays the best backdrop. Update every caller
     and the existing tests — this rename is the point, not incidental: `tile`
     described a slot, `poster` describes the picture, and the two are no
     longer the same question.
   - `Art.tile(item, w, h)` returns, in order: the cached TMDB poster; else for
     an **episode** `Plex.photoUrl(Servers.of(item), item.grandparentThumb, w, h)`;
     else `Plex.posterUrl(item, w, h)` — the item's own `thumb`. Never a
     backdrop: a 16:9 image in a 2:3 box is the smear this task exists to stop.
   - `Art.hero(item, w, h)` is unchanged — best backdrop, falling back to
     `Plex.artUrl` then `Plex.posterUrl` as now.
   - Sizes: request the poster at TMDB's `w342`, not `w500` — the tile is 209
     wide and `w342` is the next size up. The hero keeps `w1280`.

4. **`js/showpage.js` — the still per episode row.** Each `.sh-episode` gains a
   160×90 thumbnail on its left from `Plex.posterUrl(ep, 160, 90)` — an
   episode's `thumb` *is* the still, so nothing new is fetched but the image.
   An episode with no `thumb` gets an empty box of the same size: never a
   broken image, never a row of a different height.

5. **`css/app.css` — the episode row.** `.sh-episode` grows from 62px to 106px
   to fit the still, thumbnail floated left, the existing number, title,
   minutes, watched and verdict columns keeping their places beside it. Keep
   the reserved 6px left border so focus shifts nothing sideways. Match the
   tile's corner radius.

6. **`dev/mock-tmdb.js`** — the generated payload must include a `posters` array
   as well as `backdrops`, deterministic from the id and **visibly distinct
   from the backdrops** (a different generated image, so a test can tell which
   one a surface drew). Keep at least one id with no posters at all, so the
   Plex fallback is exercised rather than asserted.

7. **`dev/smoke.js`** — adjust and add:
   - Any existing step asserting tile width, tiles-across or row geometry must
     be updated to the portrait numbers rather than deleted.
   - A film's tile is a TMDB **poster** and `#hero-art` is a TMDB **backdrop** —
     different URLs, and the tile's is from the posters set.
   - An episode's tile is its show's poster, and every episode of one show in a
     row shows the same tile picture while the hero still differs from it.
   - A title the mock gives no posters falls back to a Plex image and still
     draws something.
   - One whole row sits under the dense header and the next is partly visible.
   - Opening a show lists episodes each with a still, and an episode with no
     `thumb` renders a row of the same height.

8. **`test/art.test.js`** — update for the rename and the new rule: `pick`
   returns the best poster and the best backdrop from one payload; a payload
   with backdrops but no posters gives `poster: null`; one with neither gives
   two nulls; malformed input never throws; and ordering is by `vote_average`
   then `vote_count` independent of payload order.

## Out of scope
- **The header, the description and the cast.** Task 008 owns all of that and
  it is finished before this starts. Do not touch `js/masthead.js`,
  `js/detail.js` or `js/browse.js`.
- **TMDB `/tv` endpoints, season posters, per-episode artwork.** An episode's
  show poster comes from Plex's `grandparentThumb` for nothing; a second source
  buys nothing here.
- **Cast or description for shows** — 008 did films, television is its own task.
- **`Media.railTitle` / `Media.railSub`** and anything else about wording.
- **The detail page's own artwork and layout.**
- **Search and hub rows showing one copy per server** — a known gap from 007,
  recorded in `docs/decisions.md`.
- Growing the tile or row pools.

## What this deliberately supersedes
Task 008's Definition of done says "Two whole rows sit under the dense header
and a third is partly visible". **This task replaces that with one whole row
and a large peek**, because a 2:3 poster is taller than a 16:9 tile and the
user weighed that trade explicitly when choosing portrait. A reviewer must not
read the change from two rows to one as a regression — it is the point. Every
other line of 008's Definition of done still holds and must keep holding.

## Definition of done
- [ ] Rail tiles are 209×314 posters, seven across, and the row arithmetic is
      derived from those numbers rather than typed in.
- [ ] One whole row sits under the dense header with the next partly visible,
      superseding 008's two-row expectation — see above.
- [ ] A film's tile is its poster and the hero behind it is a backdrop — never
      the same image, with no fallback ladder needed to guarantee it.
- [ ] An episode's tile is its show's poster, taken from `grandparentThumb`
      with no extra request, and every episode of a show shows the same tile.
- [ ] A title TMDB has no poster for falls back to a Plex image and never draws
      a 16:9 picture in the 2:3 box.
- [ ] No new network request per tile: posters come from the payload already
      cached or from URLs Plex already supplied.
- [ ] The series page lists each episode with its still, and an episode with no
      `thumb` renders a row of the same height rather than a broken image.
- [ ] `Art.pick` is pure, returns `{hero, poster}`, and `test/art.test.js`
      covers the cases in step 8.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
