---
id: 006
slug: tmdb-artwork
status: building
branch: crew/006-tmdb-artwork
model: sonnet
env: laptop
files:
  - js/config.js
  - js/tmdb.js
  - js/art.js
  - js/plex.js
  - js/merge.js
  - js/rail.js
  - js/masthead.js
  - index.html
  - dev/server.js
  - dev/mock-tmdb.js
  - dev/smoke.js
  - test/art.test.js
---

# The tile and the hero stop being the same picture

## Goal
A film's rail tile and the hero backdrop behind it show two different images,
drawn from TMDB where the title has a TMDB id. An episode's tile shows its own
still. Where TMDB has nothing to offer, everything falls back to the Plex art
it draws today.

## Why now
The hero is a blown-up copy of the focused tile, which is what makes the browse
screen look unfinished. Plex carries only two images per item — `art` (wide)
and `thumb` (a poster, or an episode still) — and both surfaces reach for `art`
first, so there is no second picture to reach for. TMDB has many backdrops per
title, and it is already wired into this app for the discovery rows.

It also moves image load off servers we do not own: every tile today is a
`/photo/:/transcode` that someone else's box generates on demand.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
claims any file in `files:`. The two branches that exist besides `main`
(`claude/agent-loop-system-kvg3eo`, `claude/local-testing-codebase-cleanup-0t3mcz`)
are both empty against `main`: `git log main..<branch>` and
`git diff --name-only main...<branch>` return nothing for either. There is no
unlanded artwork work to build on.

One thing that is *not* on a branch: the masthead simplification described
under Graph context is uncommitted in the working tree on `main` at spec time.
It must be committed before this task's worktree is cut, or the worker
branches from a masthead that still has badges.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md` and the working session that produced
this task. Workers must not go digging for more.

- **TMDB is already wired and inert.** `js/tmdb.js` and `js/discovery.js`
  exist and work — trending, JustWatch provider rows (Netflix 8, Prime 9,
  Disney+ 337, region GB) and recommendations. They do nothing only because
  `Config.tmdbKey` is `''`. This task adds an image call to the same client;
  it does not touch discovery.
- **The direction of travel is external-first, and deliberate.** The comment at
  the top of `js/tmdb.js` states it: fetch a small list from TMDB and ask Plex
  what it has, never index 30k library items against TMDB. Artwork is the same
  shape — one lookup for a title already on screen, never a crawl.
- **TMDB ids are already on the items.** `includeGuids: 1` is set on
  `Plex.items` (js/plex.js:304) and on `Plex.onDeck` (js/plex.js:352), so
  `Plex.tmdbId(item)` (js/plex.js:458) reads the `Guid[]` array with no extra
  request. Two gaps close in this task: `Merge.slim` (js/merge.js:122) drops
  `Guid`, so the All row loses it, and `Plex.hubs` (js/plex.js:361) does not
  ask for guids at all.
- **The masthead was just stripped back** (this session, uncommitted on `main`
  at spec time): the decorative Play/More-info/heart controls, the summary, the
  key-hint line and the codec/audio badges are gone, and `Meta.schedule` no
  longer runs from `Browse.render`. `Masthead.render` is now row label, title,
  one meta line; `Masthead.art()` owns the backdrop on its own 280ms debounce.
  Do not reintroduce a per-tile metadata fetch — the whole point of that
  removal was that resting on a tile costs a remote server nothing.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16). Do not
  explain a red step away. `dev/smoke.js` fails on *any* request that is not to
  `localhost:<PORT>`, a `data:` URI, or the deliberately-dead 10.255.255.1 —
  see dev/smoke.js:171. TMDB therefore has to be moked, not called.
- **Backlog item picked up for free** (docs/backlog.md §3): "Episode stills.
  The show page is a wall of text; episodes carry a landscape `thumb` we never
  draw." The tile rule below draws it. The show page itself is out of scope.

## Constraints that bite here
- **Chromium 53.** No `async`/`await`, no object spread, no `Object.entries`,
  no CSS Grid. Promises with `.then()`. `npm run check` scans for this.
- **No bundler.** A new `js/art.js` must be added to the script list in
  `index.html`, in dependency order — after `js/tmdb.js` and `js/store.js`,
  before `js/rail.js`. `npm run check` fails if a file in `js/` is missing
  from that list.
- **Nothing may hardcode a base URL.** CLAUDE.md: `js/config.js` owns "plex.tv
  base URL, TMDB key, debug beacon. Nothing else may hardcode these."
  `js/tmdb.js` currently hardcodes `API = 'https://api.themoviedb.org/3'`,
  which is why `tmdbBase` is part of this task.
- **Never crawl a server we do not own.** One TMDB lookup per title actually on
  screen, cached, and never for a tile the rail has deferred.
- **Comments**: one concise line on an exported function. No narration of the
  reasoning that got there.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/config.js`** — add two settings beside `tmdbKey`:
   - `tmdbBase: 'https://api.themoviedb.org/3'`
   - `tmdbImageBase: 'https://image.tmdb.org/t/p/'`

2. **`js/tmdb.js`** — replace the hardcoded `API` with `Config.tmdbBase`, and
   add one exported function:
   - `images(tmdbId)` → `GET /movie/{id}/images` through the existing `get()`,
     resolving to the raw payload (`{ backdrops: [], posters: [], logos: [] }`).
     One request per title; `append_to_response` is not needed because nothing
     else on the payload is wanted.
   - Add `images` to the returned object.

3. **`js/art.js` (new)** — the only module that decides what picture goes where.
   Two halves, and the first must be pure so it can be unit tested:

   - `Art.pick(images)` — **pure**. Takes a TMDB `/images` payload and returns
     `{ hero: <path|null>, tile: <path|null> }`. Rules:
     - Sort `backdrops` by `vote_average` descending, then `vote_count`
       descending, so the choice is stable rather than payload-order.
     - `hero` is the first backdrop.
     - `tile` is the **second** backdrop, or `null` if there is only one.
       Never the same path as `hero`.
     - Both `null` for an empty or malformed payload. Never throw.
   - `Art.url(path, size)` — `Config.tmdbImageBase + size + path`.
   - `Art.tile(item)` / `Art.hero(item)` — return a URL **synchronously**, from
     the in-memory cache if it is warm and from the Plex fallback otherwise, so
     nothing ever waits on TMDB to paint:
     - **tile**: an episode returns `Plex.posterUrl(item, w, h)` — its `thumb`
       *is* the still, and no TMDB call is made for episodes at all. A film or
       show returns the cached TMDB tile backdrop at `w500`, else
       `Plex.artUrl(item, w, h) || Plex.posterUrl(item, w, h)` exactly as the
       rail does today.
     - **hero**: the cached TMDB hero backdrop at `w1280`, else
       `Plex.artUrl(item, 1920, 1080) || Plex.posterUrl(item, 1920, 1080)`.
   - `Art.warm(item)` — fetches and caches if it has not already, then calls the
     callback registered with `Art.onReady(fn)` so the caller can repaint.
     - Skip entirely when `!Tmdb.enabled()`, when the item is an episode, or
       when `Plex.tmdbId(item)` is null.
     - Cache under `art:<tmdbId>` in `Store`, and in a module-level object so a
       second visit costs neither a request nor an IndexedDB round trip.
       A negative result (no usable backdrops) is cached too, or an obscure
       film is re-fetched on every pass through the row.
     - At most **4 in flight at once**, and never more than one request per
       tmdbId however many tiles ask. `Discovery.mapLimit` is the existing
       shape to copy; do not add a dependency on `js/discovery.js`.

4. **`js/rail.js`** — in `drawRow`, replace the
   `Plex.artUrl(item, TILE_W, TILE_H) || Plex.posterUrl(...)` line with
   `Art.tile(item, TILE_W, TILE_H)`, and call `Art.warm(item)` on the same
   branch — i.e. only for tiles that are actually on screen, after the
   `if (!onScreen)` guard that already defers posters. Register an `Art.onReady`
   handler at build time that calls `Rail.invalidateEmpty()`-style
   re-rendering for the tile whose art landed; a whole-rail repaint on every
   image is not acceptable, so mark just that tile dirty (`tile._idx = -1`) and
   let the next `render()` redraw it.

5. **`js/masthead.js`** — `paintArt()` asks `Art.hero(artWant)` instead of
   building the URL itself, and calls `Art.warm(artWant)`. The existing
   `lastArt` short circuit stays. The `Art.onReady` handler repaints the
   backdrop if the item that landed is still the one on screen.

6. **`js/plex.js`** — add `includeGuids: 1` to the `hubs` request
   (js/plex.js:361), so Recently Added and the other hub rows carry a TMDB id
   like the section rows do.

7. **`js/merge.js`** — keep `Guid: item.Guid` in `slim()` (js/merge.js:122), so
   a film walked into the All row keeps its TMDB id. Add `art: item.art` at the
   same time — `slim` drops it today, which is why the All row already falls
   back to posters. Note the size cost in the comment above `slim`: it is a
   short array of `{id}` on each of up to 30,000 entries.

8. **`index.html`** — `<script src="js/art.js"></script>` after `js/tmdb.js`
   and before `js/ui.js`.

9. **`dev/mock-tmdb.js` (new)** and **`dev/server.js`** — stand in for TMDB so
   the smoke test's "nothing left this machine" holds:
   - `dev/server.js` injects `tmdbBase: '/__tmdb'`, `tmdbImageBase:
     '/__tmdbimg/'` and a non-empty `tmdbKey` into `REFLEX_CONFIG` (the real key
     still comes from `TMDB_KEY` when set, for `--proxy` work).
   - `dev/mock-tmdb.js` answers `/__tmdb/movie/<id>/images` with a deterministic
     payload derived from the id — most ids get **two or more** backdrops, and
     at least one id in the library must get exactly **one**, so the
     "only one backdrop" fallback is exercised. `/__tmdbimg/<size><path>`
     serves a generated image, distinguishable from the Plex mock's, in the
     same way `dev/mock-plex.js` already generates posters.
   - The existing discovery endpoints must keep working: the smoke step
     "discovery says what it needs rather than failing quietly" currently
     passes *because* `tmdbKey` is empty. Setting it non-empty will change
     that step's outcome — either mock `/discover/movie` and `/trending` well
     enough for it to pass, or keep `tmdbKey` empty and add a separate
     `tmdbImagesOnly` seam. **Decide by mocking the discovery endpoints**: a
     dev server that answers some TMDB paths and not others is a trap for the
     next person.

10. **`test/art.test.js`** — unit test `Art.pick` through `test/load.js`:
    two backdrops give a different `hero` and `tile`; one backdrop gives a
    `hero` and a null `tile`; none gives two nulls; a malformed payload
    (missing `backdrops`, a non-array, entries with no `file_path`) returns two
    nulls rather than throwing; ordering is by `vote_average` then `vote_count`
    and does not depend on payload order.

11. **`dev/smoke.js`** — one new step, after "posters load": rest on a film in
    Continue watching, wait for the hero backdrop to settle, and assert that
    the focused tile's `img.src` and `#hero-art`'s `background-image` are
    **different URLs** and that both come from `/__tmdbimg/`. Then step onto a
    title the mock gives one backdrop and assert the fallback still paints
    something rather than an empty box.

## Out of scope
- **Portrait posters in the rail.** The tile stays 372×209 landscape and the
  row geometry does not change. This was put to the user and set aside.
- **Logos** (TMDB title-treatment PNGs) replacing the hero's text title. Worth
  doing, and a separate task — it changes the masthead's layout, not its
  source of pictures.
- **Episode stills on the show page** (docs/backlog.md §3). The rail tile
  draws them here; `js/showpage.js` is not touched.
- TV artwork beyond the show's own backdrop: no season posters, no
  `/tv/{id}/season/{n}/episode/{m}` lookups.
- The detail page (`js/detail.js`) and its `#dt-art`. Same picture as today.
- Discovery rows themselves — `js/discovery.js` is not in `files:`, only the
  mock behind it.
- Evicting the art cache. `Store` never evicts anything; that is an existing
  backlog item and not this task's problem.
- Restoring anything removed from the masthead earlier in this session.

## Definition of done
- [ ] With the dev mock, resting on a film in the rail paints a hero backdrop
      whose URL differs from that film's tile image, and both are TMDB images.
- [ ] A title the mock gives only one backdrop still paints a tile and a hero;
      neither is blank.
- [ ] An episode's tile is its own still (`thumb`), and no TMDB request is made
      for it.
- [ ] With `tmdbKey` empty, every tile and the hero look exactly as they do on
      `main` today, and no TMDB request is made at all.
- [ ] No TMDB request is made for a tile the rail has deferred as off-screen.
- [ ] A second pass through the same row makes no further TMDB requests.
- [ ] `Art.pick` is pure, is exported, and `test/art.test.js` covers the five
      cases in step 10 and fails if the behaviour regresses.
- [ ] `npm run verify` passes, including the "nothing left this machine" step.
- [ ] `npm run check` passes — `js/art.js` is in `index.html` and nothing in it
      is newer than Chromium 53.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
