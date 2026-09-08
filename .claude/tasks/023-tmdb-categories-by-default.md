---
id: 023
slug: tmdb-categories-by-default
status: draft
branch: crew/023-tmdb-categories-by-default
model: opus
env: laptop
files:
  - js/config.js
  - js/tmdb.js
  - js/discovery.js
  - js/browse.js
  - js/sidebar.js
  - dev/mock-tmdb.js
  - dev/smoke/browse.js
  - test/tmdb.test.js
---

# Your categories are the browse screen; the server's hubs move to the menu

## Goal
The rows you see on opening the app are **your** categories, defined in one
place and pulled from TMDB — trending, what is on Netflix or Prime or Disney+,
by genre, whatever the list says — each showing only what your servers actually
have. The server's own hubs (Recently Added, Recently Released, Top Rated) stop
being the default and become entries in the sidebar.

## Why now
The user: *"keep the categories the server has so they are selectable but have
my own categories pulled from tmdb as the main ones that show by default."*
Today it is the other way round — the server's hubs are the browse screen and
TMDB's rows live in a separate Discovery mode most people would never open.

## Existing work
<!-- filled in by preflight before dispatch -->

## The problem this task exists to solve, before anything else

**Discovery is affordable today only because it is a mode you rarely open.**
`Discovery.matchToLibrary` asks the servers whether they hold each TMDB id, one
request per title per server: `MAX_LOOKUPS = 40`, `CONCURRENCY = 4`, and
`Servers.all()` is two. That is **80 requests per row**. Six rows is around 480
requests against servers we do not own, and making this the default screen means
paying it on every launch.

That is not a detail to optimise later; it is the reason this task is `opus` and
the thing the review will be judged on. **CLAUDE.md: sync library data
incrementally and infrequently; do not full-crawl a server we don't own.** A
browse screen that fires 480 guid lookups at someone else's Plex on every start
breaks that rule more thoroughly than anything the app has done.

The approach below is built around three ideas — cache the mapping for good,
resolve only what is about to be seen, and paint from cache first. If a
different shape achieves the same, take it, but the cost bound in the Definition
of done is not negotiable.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **The direction is deliberate and stays** (`js/tmdb.js` header, and
  `docs/decisions.md`): fetch a small curated list from TMDB and ask Plex what
  it has. Never index 30,000 library items against TMDB — that is a full crawl
  and there is nowhere to put the index.
- **`js/discovery.js` already does the matching**, with `mapLimit` for bounded
  concurrency and `Merge.lists` to fold a title found on both servers into one
  entry. Keep both; change when they run, not how.
- **The rail already defers work that is not on screen**: off-screen rows get
  their titles but not their posters, because "asking for two screens' worth
  before the first one has painted is the single most expensive thing this app
  does". A guid lookup is more expensive than a poster. Same discipline.
- **`Store` is an IndexedDB key/value cache** and `loadSection` already paints
  from `rows:<section>` before any network call. That pattern is the answer to
  the first paint.
- **`Merge.lists` folds per-server results**; `Media.identity` is the stable key
  for an entry across servers.
- **The sidebar is how anything reachable-by-d-pad is reached**, and it already
  lists a section's row titles as children (`noteCategories` in `js/browse.js`).
- **Rows are `Rows.list(title, items)` or `Rows.merged(...)`**; the All row stays
  exactly as it is.
- **Chromium 53**: no `async`/`await`, no object spread, no `Object.entries`.
- **Assertions that pass on nothing** are this suite's recurring failure
  (CLAUDE.md, Testing). A step that bounds request counts must be run against
  the unbounded version and seen to fail.

## Constraints that bite here
- **Inert without a TMDB key.** With `tmdbKey` empty the browse screen must fall
  back to exactly what it shows today — Continue watching, the server's hubs,
  the All row — not an empty screen. This is the difference between a feature
  and a broken app for anyone without a key.
- **The categories must be editable in one obvious place**, by a person reading
  the file, without touching `js/discovery.js` or `js/browse.js`.
- **No full crawl, ever**, and no unbounded fan-out.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/config.js` — the category list, as data.** An array the user edits:
   ```
   categories: [
     { title: 'Trending this week', kind: 'trending' },
     { title: 'On Netflix',         kind: 'provider', id: 8 },
     { title: 'On Prime Video',     kind: 'provider', id: 9 },
     { title: 'On Disney+',         kind: 'provider', id: 337 },
     { title: 'Science fiction',    kind: 'genre',    id: 878 },
     { title: 'Because of what you have been watching', kind: 'recommended' }
   ]
   ```
   Order is the order on screen. Comment it with where a genre id comes from
   (`/genre/movie/list`) so the next person can add one without asking.

2. **`js/tmdb.js` — one call per kind.** `trending`, `onProvider` and
   `recommendedFrom` exist; add `byGenre(id)` on `/discover/movie` with the
   same `MIN_VOTES` floor and region. Then a single `idsFor(category)` that
   dispatches on `kind` — so adding a kind is one function, not a new path
   through `js/discovery.js`.

3. **`js/discovery.js` — cache the mapping for good.** A resolved TMDB id is a
   near-permanent fact about a library:
   - `Store` under `tmdb:<id>`: the resolved entry's identity, or `null` for
     "no server has it". Read before asking, always.
   - A `null` is re-checked at most once a week — a film can be added — and a
     hit is never re-checked, because a film is not usually removed and the
     detail page re-fetches anyway.
   - Keep `mapLimit` and its concurrency for what genuinely must be asked.

4. **`js/discovery.js` — resolve only what will be seen.** Do not resolve forty
   titles to build a row. Resolve the **first screenful** (the rail shows seven
   across, so twelve is ample), publish the row, and resolve further only when
   the row is scrolled. A row therefore *grows*; `Rows.list` holds what has been
   found so far, which is the same shape the merged All row already has.

5. **`js/browse.js` — the rows, and the cache.**
   - `loadSection` builds: **Continue watching**, then a row per configured
     category, then the All row. The server's hubs are no longer built here.
   - Cache the built rows under `rows:<section>` as now, so a relaunch paints
     instantly and resolves in the background.
   - With no TMDB key, build the hubs exactly as today. One branch, stated once.

6. **`js/browse.js` and `js/sidebar.js` — the hubs in the menu.** The server's
   hubs become a sidebar entry — `From the server` — listing Recently Added and
   the rest as children; picking one shows that hub as a row. They are still one
   `Plex.hubs` call per part, made when the entry is opened, not on boot.

7. **`dev/mock-tmdb.js`** — answer `/discover/movie` with `with_genres`, and
   make the fixture able to fail: at least one category whose titles the mock's
   servers mostly do **not** hold, so a thin row is exercised, and one id that
   no server has, so the `null` cache path is.

8. **`test/tmdb.test.js`** — `idsFor` dispatching on each `kind`, an unknown
   kind resolving empty rather than throwing, and the vote floor still applied.

9. **`dev/smoke/browse.js`**:
   - With a key, the browse screen's rows are the configured categories, in
     order, and the server's hubs are **not** among them.
   - **The request bound**: opening the browse screen makes fewer than a stated
     number of `/library/all?guid=` requests — count them, and verify the step
     fails against an unbounded implementation.
   - A second visit makes none, because the mapping is cached.
   - With `tmdbKey` empty, the rows are exactly today's — hubs included.
   - The sidebar carries `From the server`, and opening it shows a hub row.

## Out of scope
- **A settings screen for categories.** The list in `js/config.js` is the
  interface until there is a reason for more.
- **Indexing the library against TMDB**, in any form.
- **TV categories.** `/discover/tv` is a natural follow-on; films first.
- **The Discovery mode's own screen** — this supersedes it, so remove its
  sidebar entry, but do not rebuild it elsewhere.
- **`js/rail.js`, `js/art.js`, `js/media.js`, `js/plex.js`.**

## Definition of done
- [ ] The browse screen's rows are the categories from `js/config.js`, in order,
      each showing only titles the servers hold.
- [ ] Opening the browse screen makes **fewer than 40** `/library/all?guid=`
      requests in total, and the smoke step proving it fails against an
      unbounded implementation.
- [ ] A second visit to the same categories makes **none**.
- [ ] A row grows as it is scrolled rather than resolving forty titles up front.
- [ ] With `tmdbKey` empty the browse screen is exactly as it is today.
- [ ] The server's hubs are reachable from the sidebar and are fetched only when
      opened.
- [ ] Adding a category is one entry in `js/config.js` and nothing else.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
