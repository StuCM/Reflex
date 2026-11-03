---
id: 038
slug: plex-collections-in-the-sidebar
status: done
branch: crew/038-plex-collections-in-the-sidebar
model: sonnet
env: laptop
rounds: 2
work: plex-collections-sidebar
files:
  - src/api/plex/library.ts
  - types/plex.d.ts
  - src/data/cached.ts
  - src/screen/browse.ts
  - src/view/sidebar.ts
  - css/sidebar.css
  - dev/library.js
  - dev/mock-plex.js
  - dev/smoke/sections.js
gate: pass
gateSha: b56c5e249b825c8a27364e8b709cb78240306008
gateAt: 2026-10-11T11:22:22.557Z
---

# The servers' own collections are in the sidebar

## Goal
The sidebar gains a collapsed **Collections** group listing the servers' curated
movie collections ("Top Rated Sci-Fi", "Heist", "IMDB Top 250"…), one entry per
title across every server. OK on one shows its films as a single row, in the
curator's order.

## Why now
Asked for by Stuart on 2026-10-11 while the TMDB browse rework
(`docs/browse-design.md`, backlog 0e) is built. Not a throwaway: these lists
are curated by the server owner and stay alongside the TMDB collections after
the rework.

## Background
Stuart's answers, 2026-10-11:
- "Apollo has collections available from the movies section, 40 or 50 maybe.
  Just make them available in the side bar." Measured: both servers carry the
  same Kometa-style set, so **every server, merged by title** (his choice).
- **Hide any merged collection with fewer than 5 films in total** (his choice).
- **A collapsible group, collapsed by default** (his choice).

Measured against the real servers from the laptop on 2026-10-11 (read-only
GETs, via `probe.py`'s config):

- `GET /library/sections/{key}/collections` lists them in
  `MediaContainer.Metadata[]`, each with `ratingKey`, `title`, `childCount`,
  `smart`, `subtype: "movie"`, `thumb`. Apollo 2.0: Movies 66, Movies - 4K UHD
  52, Movies - LQ 1, vSports - FV 81. Maverick: Movies 46, Archive 51,
  Foreign 1, others 0.
- **`/library/sections/{key}/all?collection=<ratingKey>` returns `totalSize=0`
  on every library.** Do not use the section filter, and so do not use
  `allRow`'s filter or `items(..., {collection})`.
- **`GET /library/collections/{ratingKey}/children`** works: it honours
  `X-Plex-Container-Start` / `X-Plex-Container-Size`, returns `totalSize` and
  `offset`, and with `includeGuids=1` each item carries `Guid[]` (imdb, tmdb,
  tvdb) and `Media`. Order is the collection's own (`collectionSort`).
- Junk exists: a collection titled `""`, disc-rip names (`AILEEN_DVD`,
  `Return.of.the.Jedi.4K83.1080p…`) with 1 film, smart collections with 0, and
  ~80 sports collections of 0–1 items. The 5-film floor removes all of these;
  real ones survive (Bond: 1 + 27 + 27; Nicholas Sparks: 10 + 11 + 2).

## Existing work
`npx crew collisions` not run: the crew CLI is not installed here. Checked by
hand: branches are `main` and `origin/ccr-e2dc43ae-pi2ghm` (docs only). Drafts
035 (`src/data/guard.ts`), local 036 (`src/screen/showpage.ts`, `css/show.css`…)
and the branch's TMDB-paging spec (`src/api/tmdb.ts`, `src/data/discovery.ts`,
`src/rules/rows.ts`, **`src/screen/browse.ts`**, `types/plex.d.ts`) — the last
overlaps on `browse.ts` and `types/plex.d.ts`. Different functions (it touches
`loadDiscover`/`scheduleWalk`; this adds a loader and an `activate` branch),
but run them one after the other, not in parallel.

**Numbering:** 036 is taken twice (local untracked
`036-the-series-page-gets-what-6d-actually-draws` and the branch's
`036-tmdb-rows-keep-loading`). The branch's spec becomes 037 when merged; this
is 038.

## Graph context
- One entry per film across servers is the app's rule (`Media.identities`);
  a collection row is a `merge` row, so its films fold onto the preferred
  server's copy like everything else. That is the intended behaviour.
- Decision "Merge movie libraries into one Movies section" (commit `5f7eb5b`):
  a section is `parts: [{server, key}]`. Collections are listed per part.
- Kids (`loadKids`, `src/screen/browse.ts:800`) is the shape to copy for a
  mode that builds one row from the Movies section: `reset(mode)`,
  `generationGuard()`, build, `render()`.
- `noteCategories`/`cats[section.title]` map sidebar categories to **row
  indices** of the section. Collections are not rows of the section: do not
  put them in `cats`.
- `primeTotals` caches counts under `server:key:tag` in `cached.total`. A
  collection row does not need it — the total is known from `childCount` /
  `totalSize`. Do not call it for a collection row.
- An `activate()` kind with no branch falls through to section handling and
  silently loads the wrong thing. Every new kind needs its branch.
- `src/view/sidebar.ts` already carries two layering-debt entries for screen
  imports. Pass the collection list in as data through `open()`; add no
  import.
- `CLAUDE.md` says `src/data/cache.ts`; the file is `src/data/cached.ts`.

## Constraints that bite here
- Requests to servers we do not own: the collection list is **one request per
  movie library per server, cached daily**, never on every sidebar open. Films
  are fetched a page at a time as the row is walked, never the whole
  collection up front.
- Chromium 53: no object spread in new code, no `Object.entries`; DOM through
  `fill`/`put` in `src/view/dom.ts`; no `innerHTML`, no inline style writes.
- `async`/`await` is preferred over `.then()` chains in new code.

## Approach

1. **`src/api/plex/library.ts`**
   - `collections(server, sectionKey): Promise<PlexCollection[]>` —
     `GET /library/sections/{key}/collections`, map `Metadata[]` to
     `{ ratingKey, title, count: childCount ?? 0, server: server.id }`,
     `.catch(() => [])` like `hubs()`.
   - `collectionItems(server, ratingKey, start, size): Promise<{ total; items }>`
     — `GET /library/collections/{ratingKey}/children` with
     `includeGuids: 1` and the container start/size, returning
     `{ total: totalSize ?? size ?? 0, items: servers.stamp(...) }` exactly as
     `items()` does.
2. **`types/plex.d.ts`**: `PlexCollection` next to `PlexHub`.
3. **`src/data/cached.ts`**: `collections = daily<PlexCollection[]>('col:', DAY)`,
   keyed `${server.id}:${sectionKey}`.
4. **`src/screen/browse.ts`**
   - `collectionList(section)`: for each part of the **movie** section, the
     cached list or a fetch (then `put`). Skip any library whose title matches
     `/\bLQ\b/i`: it holds only cam and telesync copies (Apollo's
     `Movies - LQ`, 16 films, measured 2026-10-11) and its one collection is
     junk. Merge by exact `title` into
     `{ title, count, parts: { server, key: ratingKey }[] }`, summing `count`.
     Drop entries with an empty title or `count < 5`. Sort by title
     (titles are unique after merging, so the unstable sort is safe). Keep the
     result in a module variable for the sidebar.
   - Call it once the Movies section is known (after `setSections`), so the
     sidebar has the list without fetching on open. A failure leaves the group
     empty, not an error.
   - `loadCollection(entry)`: modelled on `loadKids`. `reset('collection')`
     (widen the `mode` union), then one row via `rowModel.merged(entry.title,
     parts, fetch)` where `parts` are built by hand —
     `{ server, key: ratingKey, updatedAt: 0, tag: 'col' + ratingKey }` — and
     `fetch` calls `collectionItems(part.server, part.key, offset, rowModel.PAGE)`.
     Not `allRow`, not `pageFetcher`.
   - `activate()`: a `'collection'` branch calling `loadCollection`, and the
     group's own toggle. BACK leaves the mode the way Kids does
     (`leaveMode`).
   - `openSidebar()`: pass the collection titles to `sidebar.open`.
5. **`src/view/sidebar.ts`** (and `css/sidebar.css` only if the existing
   expanded-section styles do not already fit): a **Collections** row in
   `modes()` after Kids, which expands in place to one row per collection
   (`kind: 'collection'`, `index` into the list), collapsed by default, using
   the same expand/collapse as sections. Marked `current` while that
   collection is showing.
6. **Mock**: `dev/library.js` gives the **first** mock server's movie section
   two real collections (one of ≥ 12 films so the row pages, one of 6) plus
   one 1-film junk collection; give the second server a collection with the
   **same title** as the large one, overlapping by some films, so the merge
   and the dedupe are exercised. `dev/mock-plex.js` serves
   `/library/sections/{k}/collections` and
   `/library/collections/{ratingKey}/children` with paging and `totalSize`.
7. **Smoke** (`dev/smoke/sections.js`), new step:
   - open the sidebar: **Collections** is present and collapsed (no collection
     titles listed);
   - expand it: exactly the two real titles are listed, and the 1-film junk
     title is not (assert the listed titles, positively);
   - OK on the large one: the row's title is the collection's name, its first
     tile titles match the mock's first films in collection order, and the
     row's total equals the merged, deduplicated count;
   - count `/library/collections/` list requests across two sidebar opens:
     **exactly one per movie library** (the control: non-zero, same
     collector), proving the list is cached and not refetched on open.
   Run it against `main` first and watch it fail.

## Out of scope
- TV collections, and any section other than Movies.
- Collection artwork, summaries, or a collection page/grid (backlog 0e item 6).
- Settings to hide or reorder collections (0e item 8).
- Changing the 5-film floor into a setting.
- `includeCollections` on `items()`, `allRow`, `pageFetcher`, `primeTotals`.
- The discovery guid bug and the guard fix (0e items 1–2).

## Definition of done
- [ ] On the laptop (`npm run dev`), the sidebar shows a collapsed
      **Collections** entry; expanding it lists the mock's real collections and
      not the 1-film one.
- [ ] OK on a collection shows one row of its films in collection order,
      deduplicated across both mock servers, and walking right pages further.
- [ ] BACK from a collection returns to the library as it does from Kids.
- [ ] The collection list is requested once per movie library and cached daily;
      reopening the sidebar makes no further list request.
- [ ] No use of `/all?collection=`.
- [ ] The new smoke step passes, and was observed failing against `main`
      (say so in the worker's report, with the failure line).
- [ ] `npm run verify` passes, and the gate passes
      (`npx crew gate .claude/tasks/038-plex-collections-in-the-sidebar.md`).
- [ ] No file outside `files:` is touched.
- [ ] Commits follow the convention (the hook enforces it).

## Blocked

Approach 4 builds the collection row with `rowModel.merged(...)`, and the Goal
says "in the curator's order". These cannot both hold. `merge.stream` /
`fold` (`src/data/merge.ts:18-23, 205-215`) is a k-way merge that picks the
head of whichever stream sorts first by `titleSort`, and assumes every stream is
already title-sorted. Collection children arrive in `collectionSort` order, not
title order, so:

- With one part the order survives (only one head to pick).
- With two or more parts (Bond is 3, Nicholas Sparks is 3, and the mock's
  large collection is 2 by design) the heads are compared by title and the
  result is neither collection order nor either server's order.

The smoke step "first tile titles match the mock's first films in collection
order" would therefore fail on the two-server collection, or pass only if the
mock's order happens to be alphabetical, which would prove nothing.

Decision needed, none of which I can make inside `files:` (merge.ts is not
listed):
1. Add an ordering option to `merge.stream` (e.g. fold by position rather than
   title; across servers, keep the preferred server's order and append the
   others' extras), then list `src/data/merge.ts` (+ its test) in `files:`.
2. Or accept title order for collections (drop "curator's order" from the Goal
   and the smoke assertion).
3. Or fetch each collection whole (it is bounded, 5-60 films) and build a
   `list` row in the preferred server's order, deduped with `merge.lists`;
   this loses paging, which the Definition of done asks for.

**Resolved 2026-10-11 by Stuart: "go with the curator's order for now".**
Done inside `files:` without touching merge.ts: the collection fetcher rewrites
each item's `titleSort` to a zero-padded (part rank, position) key, parts ranked
preferred server first. The merge then yields the preferred server's films in
its collection order, followed by the other copies' extras in theirs.

## Review rounds

Round 1 (CHANGES): paging past one page untested; BACK from a collection
untested; formatting churn in four hunks (SECTION_TITLES, cached.total.put,
YoutubeSnippet, sidebar pushes); "failing on main" not in the report. Fixed: the
mock gained "Marathon" (113 films, Main only) and the step walks the focus
across the 100-film page boundary asserting every film, then BACKs and asserts
the Marathon row is gone; churn reverted; the failure line is below.

Round 2 (PASS, 2026-11-03, run by the orchestrator): verify 110/110; round 1's
four points fixed. Non-blocking: a failed list fetch caches `[]` for a day,
hiding that library's collections until expiry (same as `hubs()`).

## Worker report

Observed failing against `main`'s `src/` + `types/` (mock and step kept):
`FAIL  the sidebar lists the servers' collections, in the curator's order` /
`no Collections row: Continue watching | Movies | * TV Shows | - Recently Added | ...`.
Passes with the change: 110/110.

- `src/api/plex/library.ts`: `collections` and `collectionItems` (`/library/collections/{key}/children`).
- `types/plex.d.ts`: `PlexCollection`; `MergePart.title` (library name, for the LQ skip).
- `src/data/cached.ts`: `collections`, daily.
- `src/screen/browse.ts`: `listCollections` (per-library, session-memoised, LQ skipped, merged by title, floor 5), `loadCollection` (merged row, `titleSort` rewritten to rank+position), `'collection'` mode, activate branches, sidebar data.
- `src/view/sidebar.ts`: collapsed Collections group, expands in place.
- `dev/library.js`, `dev/mock-plex.js`: Heist (both servers), Road Trip, Lonely (junk), Marathon (113); list and children endpoints.
- `dev/smoke/sections.js`: the step, counted from a cold start.
- No `css/sidebar.css` exists; the existing `.sub` rows needed nothing.

Spec was wrong: `rowModel.merged` walks by title (see Blocked); resolved by Stuart.

## Graph writes proposed
- Decision: collection rows get curator order by rewriting `titleSort` to (server rank, position) in the fetcher, because `merge.stream` is a title-ordered k-way merge. Revisit if `merge.ts` grows a position ordering.
- Pattern: resource timing buffer (250) is empty by the time later smoke areas run; count boot requests by clearing the cache key and reloading under a `page.on('request')` collector.
- Pattern: never run prettier here; `npx oxfmt --write <file>` only.
- Pattern: Plex `?collection=<ratingKey>` section filter returns nothing; use
  `/library/collections/{ratingKey}/children`.
