---
id: 007
slug: one-movies-section
status: blocked
branch: crew/007-one-movies-section
model: sonnet
env: laptop
files:
  - js/browse.js
  - js/sidebar.js
  - dev/smoke.js
---

# One Movies, one TV Shows, and Continue watching above them

## Goal
The sidebar lists `Continue watching`, `Movies` and `TV Shows` instead of one
entry per Plex library. Every movie library on every server is folded into the
single Movies section, so its All row spans the lot, deduplicated — a film held
in both a 4K library and an LQ one appears once, with both copies on its detail
page.

## Why now
The user's two servers carry six libraries between them — `Movies - 4K UHD`,
`Movies - LQ`, `TV Shows`, `TV Shows 4K`, `TV Shows - Anime` and more. The
sidebar lists all six, and because each section builds its own Continue
watching row, the menu also fills up with duplicate `Continue watching`
entries as sections are visited. That duplication is new: the per-section type
filter was removed in `fac9937`, which made every section's Continue watching
row identical.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `js/browse.js`, `js/sidebar.js` or `dev/smoke.js`.
No worktrees are in flight; task 006 was merged and its branch deleted.
The scrim fix `de1fe59` on `main` touches only `css/app.css`, which this task
does not claim.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **A section is already N parts, and the merge already handles it.**
  `Browse.setSections` groups a server's libraries by `title.toLowerCase() +
  '/' + type`, and each group carries `parts: [{server, key, updatedAt}]`.
  `allRow` maps those parts straight into `Rows.merged`, and `Merge.stream`
  walks any number of them in title order. Folding three movie libraries into
  one section is therefore a change to *how sections are grouped*, not to the
  paging or the merge. Do not touch `js/merge.js` or `js/rows.js`.
- **Deduplication is by identity, not by library.** `Media.identities` matches
  on any external id in common (imdb, tmdb, tvdb, the plex:// guid), falling
  back to normalised title and year. The same film in a 4K library and an LQ
  library is one entry with two `_sources`, exactly as the same film on two
  servers already is. This is why merging the libraries is safe.
- **`Merge.estimate` will now over-count at first.** The merged length is the
  sum of the parts' totals less the duplicates found *so far*, so a Movies
  section spanning six parts starts high and shrinks as it is walked. That is
  the existing, intended behaviour (`primeTotals`), not a bug to fix here.
- **Continue watching is per server, not per section.** `Plex.onDeck` returns
  films and episodes together for the whole account, and since `fac9937` it is
  no longer filtered by the section's type. That is deliberate — the first
  screen answers "what was I watching" across both.
- **Row titles are the sidebar's children.** `noteCategories` records
  `rows.map(r => r.title)` per section title, and picking one jumps to that row
  index. The two lists must stay the same list.
- **The sidebar is keyboard-only.** No pointer, no scrollbar; `reveal()` winds
  the list with a transform. Left from the first tile of a row opens it. Any
  new entry has to be reachable with the d-pad alone.
- **Kids and Discovery are modes, not sections** (`mode` in `js/browse.js`,
  `atMode` in `js/sidebar.js`). Continue watching is *not* becoming a mode —
  see the Approach.

## Constraints that bite here
- **Chromium 53.** No `async`/`await`, no object spread, no `Object.entries`.
  Promises with `.then()`. `npm run check` scans for this.
- **Never crawl a server we do not own.** The Movies section must still cost
  one `size=0` count per part and page only as far as it is scrolled.
- **Sections a server does not have are not an error.** One server having a
  `4K Films` library the other lacks is the normal case; the parts list is
  simply shorter.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/browse.js` — `setSections(perServer)`.** Group by `sec.type` alone
   rather than by title and type:
   - `type === 'movie'` → one section titled `Movies`.
   - `type === 'show'` → one section titled `TV Shows`.
   - Any other type (`artist`, `photo`) → skipped entirely; this app plays
     neither, and they are noise in the menu.
   - Order: `Movies` first, then `TV Shows`, regardless of the order the
     servers list them in. Both appear only if at least one server has a
     library of that type.
   - Every matching library from every server becomes a `part`. Keep the
     existing `{ server, key, updatedAt }` shape untouched.
   - The `currentTitle` restore at the end of the function still works, because
     it matches on `title` — which is now `Movies` or `TV Shows`.

2. **`js/browse.js` — the cache key.** `loadSection` caches under
   `'rows:' + sec.title`. That key is now `rows:Movies` where it used to be
   `rows:Films`, so nothing stale is read — no migration needed, and none
   should be written.

3. **`js/browse.js` — `allRow` default titles.** With one section per type the
   titles `All films` and `All shows` are still right. Leave them.

4. **`js/sidebar.js` — Continue watching above the sections.** Add one
   synthetic top-level entry, before the sections, built from a new field on
   the objects `Browse.openSidebar` passes in — do not have the sidebar reach
   into `Browse`:
   ```
   Continue watching        kind: 'watching', type: null
     Movies                 kind: 'watching', type: 'movie'
     TV Shows               kind: 'watching', type: 'episode'
   Movies                   kind: 'section'
     <its row titles>       kind: 'row'
   TV Shows                 kind: 'section'
     <its row titles>       kind: 'row'
   <the modes, unchanged>
   ```
   - Its children expand and collapse exactly as a section's do — reuse
     `expanded`, treating the entry as index `-1` so the existing
     `at(kind, index)` and `build()` logic keeps working.
   - The `current` mark goes on it when the focus is on the Continue watching
     row and no type filter is applied.

5. **`js/browse.js` — `activate` handles `kind: 'watching'`.** All three
   entries move the focus to the Continue watching row (row 0 of the current
   section) and set a module-level `watchingType`:
   - `type: null` — the mixed row, as today.
   - `type: 'movie'` / `'episode'` — the same row with `items` filtered to that
     type. Filter a copy; never mutate the cached row.
   - Re-render. Changing sections or reloading clears `watchingType` back to
     `null`.
   - If the filter leaves the row empty, keep the row with its title and show
     `UI.toast('Nothing part-watched there')` rather than removing it — a
     vanishing row on a keypress reads as a crash.

6. **`js/browse.js` — `openSidebar`.** Pass the Continue watching entry's state
   alongside the sections, so step 4 has what it needs: whether row 0 is
   focused, and the current `watchingType`.

7. **`dev/smoke.js`** — rework the section steps for the new shape:
   - The existing `sidebarPick('Films')` / `sidebarPick('TV Shows')` helpers
     must now pick `Movies` and `TV Shows`. Find every call site.
   - New step: the sidebar lists exactly `Continue watching`, `Movies`,
     `TV Shows` and the modes — no per-library entries, and exactly one
     `Continue watching`.
   - New step: the Movies section's All row total is greater than either
     server's own `Films` count, and less than their sum, proving the three
     movie parts were merged *and* deduplicated. The mock's Main server has a
     `4K Films` library whose contents are a subset of its `Films` library, so
     this is already representable — do not change the mock.
   - New step: `Continue watching > TV Shows` leaves only episodes in the row,
     and `Continue watching > Movies` leaves only films.

## Out of scope
- **`js/merge.js`, `js/rows.js`, `js/plex.js`.** The merge already takes N
  parts. If it looks like it does not, that is a spec bug — stop and say so.
- **The mock and the generated library** (`dev/mock-plex.js`, `dev/library.js`).
  Main already has a second movie library; that is the fixture.
- **Browsing one library on its own.** Merging is the point; there is
  deliberately no way back to just the 4K library. If that is wanted later it
  is a filter, not a section.
- **Episode titles, episode artwork, and the show page.** All of that is
  task 008 and will collide — do not touch `js/masthead.js`, `js/rail.js`,
  `js/art.js` or `js/showpage.js`.
- **`css/app.css`.** Nothing here needs a style change; task 008 owns that file
  next.
- Kids and Discovery, which stay modes and keep working as they do.

## Definition of done
- [ ] The sidebar lists `Continue watching`, `Movies`, `TV Shows` and the
      modes, and nothing else — no library names, and exactly one
      `Continue watching` however many sections have been visited.
- [ ] The Movies section's All row spans every movie library on every server:
      its total is greater than any single library's and less than the sum,
      and a film held in two libraries appears once with both copies listed on
      its detail page.
- [ ] `Continue watching > Movies` shows only films; `> TV Shows` shows only
      episodes; `Continue watching` itself shows both, most recent first.
- [ ] A type filter that empties the row leaves the row and its title in place
      and toasts, rather than removing it.
- [ ] Boot still lands on the Continue watching row of the Movies section, with
      the tall hero and no second row visible.
- [ ] Kids, Discovery and Search still work from the sidebar.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `js/browse.js` — libraries group by `sec.type` into `Movies` then `TV Shows`,
  other types dropped; a `Continue watching` cut (`watchingType`, `showWatching`)
  filtering a kept copy of the unfiltered deck; `openSidebar` passes that state.
- `js/sidebar.js` — a `Continue watching` entry above the sections with `Movies`
  and `TV Shows` under it, expanding on the same `expanded` machinery at index
  `-1`; the per-section `Continue watching` category is no longer listed.
- `dev/smoke.js` — `Films` → `Movies` at the call sites; three new steps (the
  sidebar's shape, the All row spanning every movie library, the two cuts);
  `sidebarWalkTo` split out and taught to disambiguate a nested entry from a
  top-level one of the same name.

Gate: `npm run verify` 38/38, `scope-check … main` in scope. (`scope-check`
defaults to `origin/main`, which is stale in this checkout — pass `main`.)

## Review rounds

### Round 1 — BLOCKED

1. *(fixed here)* Opening the sidebar while resting on the Continue watching row
   opened the **section** instead: `secs[i].current` is true at the same time and
   was applied second. The watching entry now wins, and a smoke step covers it.
   Fixing it exposed a second thing worth knowing: `Movies` and `TV Shows` now
   name both a section and a cut, so the smoke helper had to be taught which one
   it meant. A user has the indent to tell them apart; a `querySelector` did not.
2. *(the blocker — needs a human)* **`js/merge.js` drops a second copy from the
   same server, so the Goal's "both copies on its detail page" cannot hold for
   two libraries on one server.** `Merge.combine` returns early on
   `primary._server === item._server`, by design: until now a server contributed
   one part per section, so that only ever fired on an accidental duplicate. With
   every movie library folded into one section, a film held in both
   `Movies - 4K UHD` and `Movies - LQ` on the *same* server now loses one copy
   outright rather than gaining a `_source` — and which copy survives is
   whichever the walk saw first. That is the case the app exists for: the survivor
   may be the 4K TrueHD remux the guard then refuses, with the playable LQ copy
   invisible. The spec puts `js/merge.js` out of scope and says to stop and say
   so, so this stops here.

   The fix is small and belongs in `js/merge.js`: make a copy's identity in
   `combine` the server **and** the library part it came from (its section key, or
   just its `ratingKey`) rather than the server alone. `test/merge.test.js` would
   need the case, and `dev/library.js` would need Main's `4K Films` to hold
   distinct copies rather than the same objects as `Films` — as it stands the
   mock cannot tell "deduplicated" from "thrown away", which is why the smoke
   suite is green either way.

   Two ways forward, both a human's call: fold `js/merge.js`, `test/merge.test.js`
   and `dev/library.js` into this task's `files:`, or accept one copy per server
   per film for now and relax that clause of the Definition of done.

Everything else in the spec is implemented and green. The work is on
`crew/007-one-movies-section` in two commits; nothing is pushed.

## Notes on the spec

- **Graph context, bullet 2 is wrong.** "The same film in a 4K library and an LQ
  library is one entry with two `_sources`, exactly as the same film on two
  servers already is" — it is not, per the blocker above. Everything else in that
  section held.
- `js/app.js:193` still says "Browse merges them by title". It merges them by
  type now. The file is not in `files:`, so the comment is left stale.

## Graph writes proposed

- **Decision — a section is a *kind of thing*, not a library.** `Browse.setSections`
  groups by `sec.type`, titles the groups `Movies` and `TV Shows`, and drops
  `artist` and `photo` outright. What a server calls a library never reaches the
  screen. Rationale: the merge already takes N parts, so folding six libraries
  into two sections costs nothing at the paging layer, and the menu was the thing
  actually suffering.
- **Decision — Continue watching is per account, so it is a top-level entry.**
  It is still row 0 of whichever section is showing, but the sidebar lists it
  once, above the sections, with `Movies`/`TV Shows` cuts under it. `onDeck`
  returns both kinds for the whole account, so one entry per section was the same
  row listed twice.
- **Pattern — `Merge.combine` deduplicates by *server*, not by copy.** Two parts
  from one server (two libraries) collapse to one copy with no `_source`, by
  design and with a comment saying so. Anything that widens what a section spans
  has to check that assumption first: this task walked into it.
- **Pattern — a "current" flag on two entries at once needs an order, not both.**
  The sidebar marks the section current whenever the Continue watching row is
  current, so whichever assignment ran last decided where the menu opened. The
  more specific one has to run second.
- **Gotcha — `scope-check.js` defaults to `origin/main`.** In a fresh worktree
  that ref can be many commits behind local `main`, and every file touched since
  is reported as scope creep. Pass `main` explicitly.
