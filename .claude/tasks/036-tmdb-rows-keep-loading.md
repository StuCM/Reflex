---
id: 036
slug: tmdb-rows-keep-loading
status: draft
branch: crew/036-tmdb-rows-keep-loading
model: sonnet
env: laptop
rounds: 0
files:
  - src/api/tmdb.ts
  - src/data/discovery.ts
  - src/rules/rows.ts
  - src/screen/browse.ts
  - src/view/rail.ts
  - types/plex.d.ts
  - dev/mock-tmdb.js
  - dev/smoke/discovery.js
  - test/tmdb.test.ts
  - test/rows.test.ts
---

# A TMDB row keeps going when you reach its end

## Goal
Scrolling to the end of a Discovery row asks TMDB for the next page and the row
grows, until TMDB has no more. Today every TMDB row is one page — often 12–15
titles once the vote floor has dropped some — and then it simply stops.

## Why now
Backlog 0e item 3, from `docs/browse-design.md`. The user's most-felt browsing
fault ("once you hit the end of the row that's it"), and every row in the
redesign is a TMDB query that needs this. Independent of 0e items 1 and 2.

## Existing work
`npx crew collisions` could not run: the crew CLI is not installed in the
session that wrote this (no `node_modules`). Checked by hand instead: the only
branches are `main` and `ccr-e2dc43ae-pi2ghm`, which is docs only. No branch
touches any file in `files:`. Draft task **035** touches `src/data/guard.ts`
only and does not overlap. None.

## Graph context
`npx crew graph` was unavailable for the same reason. Written from `CLAUDE.md`,
`docs/browse-design.md` and the code.

- The rail draws from a fixed pool (4 rows × 12 tiles) and asks the row model
  for `itemAt(row, index)`. A null item draws a placeholder, not a gap. Growing
  `row.total` is all it takes for the rail to draw further.
- The **merge** rows already grow this way: `scheduleWalk()` in
  `src/screen/browse.ts` (~line 771), debounced 150ms, compares
  `rowModel.haveUpTo(row)` against `rowModel.needsUpTo(row)` (focus +
  `LOOKAHEAD` 24), then advances and repaints **only if something changed**,
  or it reschedules for ever once exhausted. Copy that shape. Do not invent a
  second one.
- `src/rules/rows.ts` imports `data/merge`. That is layering debt #1, so do not
  add a second `data/` import there. A new row kind keeps its *fetch* in the
  screen and its *arithmetic* in `rules/`.
- TMDB lists sorted by `popularity.desc` shift between requests, so page 2 can
  repeat a title from page 1. Rows must de-duplicate by TMDB id.
- Smoke lessons from `CLAUDE.md`: assert positive content (an actual count of
  tiles or requests), and give every counting step a control asserting a
  non-zero count on the same collector. Run the new step against `main` and
  watch it fail.

## Constraints that bite here
- Chromium 53: `lib: ES2015` built-ins only (no `flat`, no `Object.entries`,
  no `finally`). `async`/`await` is preferred over `.then()` chains in new code.
- TMDB is a courtesy API: never more than one page request in flight per row,
  and never a request for a row that is not focused.
- `rules/` stays pure: no request, no cache, no DOM in anything new there.

## Approach

1. **`src/api/tmdb.ts`: pages.** `trending`, `onProvider` and `byGenre` take a
   `page = 1` argument, pass `page` to TMDB, and resolve
   `{ films: TmdbFilm[]; pages: number }`, where `pages` is TMDB's `total_pages`
   capped at 500 (TMDB refuses above that). `catalogue(category, seeds, page)`
   passes it through. `recommendedFrom` is not paged: it resolves `pages: 1`.
   Add `total_pages?: number` to `TmdbResponse` in `types/plex.d.ts`.
2. **`src/data/discovery.ts`: a page at a time.** `one()` caches **per page**:
   key `${kind}:${id ?? seeds}:${page}`, same daily tier
   (`cached.catalogue`). Store `{ films, pages }`. If the cached value is a bare
   array (yesterday's format), treat it as a miss. Export
   `more(category, seeds, page): Promise<{ entries: DiscoveryEntry[]; pages: number }>`
   for the screen to call. The `add` callback in `LoadContext` gains the
   category and its page count, so the screen can build a paged row.
3. **`src/rules/rows.ts`: a `paged` row kind.**
   `paged(title, items, next: number, pages: number): PagedRow` with
   `{ kind: 'paged', title, items, total, focus, next, pages, asking: false }`.
   `itemAt` and `haveUpTo` handle it like `list`. Add two pure helpers:
   - `wantsMore(row)` is true when the row is `paged`, not `asking`,
     `next <= pages`, and `haveUpTo(row) <= needsUpTo(row)`.
   - `extend(row, items)` appends only ids not already present (compare
     `_tmdb.id`), advances `next`, and sets `total`.

   Add `PagedRow` to the `Row` union in `types/plex.d.ts`.
4. **`src/screen/browse.ts`: walking it.** `loadDiscover`'s `add` builds
   `rowModel.paged(...)` for paged kinds and `rowModel.list` for
   `recommended`. Extend `scheduleWalk()`: for a `paged` row with
   `wantsMore`, set `asking`, `await discovery.more(...)`, `extend`, clear
   `asking`, and repaint only if `total` grew. If a page comes back empty after
   de-duplication and the vote floor, try the next one, **at most three
   consecutive empty pages**, then treat the row as exhausted
   (`next = pages + 1`). Keep the `generationGuard()` check. A section switch
   mid-fetch must not touch the new rows. Any other `kind === 'list'` checks
   in this file stay list-only (picking is Continue watching).
5. **`src/view/rail.ts`**: only if it needs it. A `paged` row draws like a
   `list` row. No count in the label.
6. **`dev/mock-tmdb.js`: pages.** `/trending/movie/week` and `/discover/movie`
   honour `page` (shift the deterministic slice by `(page - 1) * ROW`) and
   return `total_pages: 3`, so exhaustion is reachable. Keep the `unheld` genre
   titles unheld on every page (ids stay in the 900000 range, made unique per
   page).
7. **Tests.**
   - `test/tmdb.test.ts`: `page` reaches the URL, `pages` comes from
     `total_pages` and is capped at 500, and recommended is `pages: 1`.
   - `test/rows.test.ts`: `wantsMore` true and false cases (asking, exhausted,
     focus far from the end), `extend` drops duplicates and advances `next`.
8. **`dev/smoke/discovery.js`: a step.** On Trending, hold ▶ to the end of
   page 1 and rest. Assert:
   - the row's `total` exceeds the mock's `ROW` (12), as positive content;
   - **exactly one** TMDB request carrying `page=2` (the control: same
     collector, non-zero);
   - after walking to the true end, no request for `page=4`, and the total
     stops growing.

   Run the step against `main` first: it must fail there.

## Out of scope
- Paging the **recommended** row. It is computed across seeds, not a TMDB list.
- Paging search results, the merge rows, or any Plex request.
- Shuffling, Classics, new row types, row definitions as data (0e items 4–5).
- The matching bug (0e item 2): rows will still say "Not in your library" on
  a real server. Do not touch `askServers` or `findByGuid`.
- The guard (0e item 1, task 035's file).
- Any visual change to tiles, labels or the masthead.

## Definition of done
- [ ] On the laptop (`npm run dev`), walking ▶ along Trending past its first
      page draws further tiles without pressing anything else, and the row
      stops cleanly at the mock's last page.
- [ ] `trending`, `onProvider` and `byGenre` send `page` and resolve
      `{ films, pages }`. `pages` is capped at 500.
- [ ] Pages are cached separately. A cached value in the old array format is
      treated as a miss, not a crash.
- [ ] No duplicate TMDB id appears twice in one row.
- [ ] At most one page request is in flight per row, and none for an unfocused
      row.
- [ ] Three consecutive empty pages end the row.
- [ ] `test/tmdb.test.ts` and `test/rows.test.ts` cover the above and fail if
      paging is reverted.
- [ ] The new smoke step passes, and was observed failing against `main`
      (say so in the worker's report, with the failure line).
- [ ] The gate passes (`npx crew gate .claude/tasks/036-tmdb-rows-keep-loading.md`).
- [ ] No file outside `files:` is touched.
- [ ] Commits follow the convention (the hook enforces it).

## Review rounds

## Graph writes proposed
