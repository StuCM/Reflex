---
id: 010
slug: series-not-episode
status: done
branch: crew/010-series-not-episode
model: sonnet
env: laptop
files:
  - js/app.js
  - js/shows.js
  - js/showpage.js
  - dev/smoke.js
---

# OK on an episode opens the series, at that episode

## Goal
Pressing OK on an episode anywhere — Continue watching, a hub row, a search
result — opens the **series page**, with the right season selected and that
episode highlighted. You can never land on a single episode as a dead end, so
carrying on to the next one is always one keypress away.

## Why now
`js/app.js:34` sends anything that is not `type === 'show'` to `openDetail`. An
episode in Continue watching therefore opens *that episode's* copy chooser, and
from there the only way out is BACK. There is no route to the next episode at
all — which, for a show you are part way through, is the main thing you want.

The copy chooser is not lost: the series page already offers it per episode
through its `onChoose` handler, which is where choosing a server belongs.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `js/app.js`, `js/shows.js`, `js/showpage.js` or
`dev/smoke.js`. No worktrees are in flight; 009 merged as `c08147a` and its
branch is gone.

Landed since 009 and not to be redone: `463767b` moved `#viewport` to
`top: 500px; height: 580px` and `VIEWPORT_H` to 580, so one row shows with the
next row's label and a sliver of poster below it. That is `css/app.css` and
`js/rail.js`, neither of which this task claims.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **The pieces already exist.** `ShowPage.open(entry, options)` takes a merged
  show entry, calls `Shows.seasons(entry)`, picks a season with
  `Shows.openAt(list)` and holds `seasonIdx` / `epIdx`. `Meta.load(item)`
  fetches `/library/metadata/<ratingKey>` with `includeGuids: 1`, cached in
  memory and IndexedDB. `Plex.findByGuid(server, guid)` finds an item by guid
  on one server. `Merge.lists` folds per-server lists into merged entries. This
  task wires those together; it does not need new plumbing in `js/plex.js`.
- **A merged show entry is what the page wants.** `Shows.seasons` calls
  `Merge.sources(entry)` and asks each copy's server for children, so an entry
  built from one server still works — it simply has one source. Do not fake a
  `_sources` array; build a real merged entry and let it be short.
- **Episodes are matched across servers by the show plus season and episode
  number** (CLAUDE.md), because episodes rarely carry ids of their own. The
  *show* does carry ids, which is why resolving upward to the show and then
  merging is the reliable direction.
- **This is a deliberate keypress, not a rail hover.** A request or two on OK is
  fine; the rule that must not be broken is the one about resting on a tile
  costing a server anything (`42f5ef9`). Nothing here may fire during browsing.
- **`js/shows.js` is the home for "seasons and episodes of a show, merged across
  servers"** (CLAUDE.md's own description). The episode→show resolution belongs
  there, not in `js/app.js`.
- **Never `/allLeaves` on a library we do not own** (CLAUDE.md). One level at a
  time: the show, then its seasons, then one season's episodes — which is what
  `js/shows.js` already does.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).
  `dev/smoke.js` fails on any request that is not to `localhost:<PORT>`.

## Constraints that bite here
- **Chromium 53.** No `async`/`await`, no object spread, no `Object.entries`.
  Promises with `.then()`. `npm run check` scans for this.
- **OK must never appear to do nothing.** Resolving the show takes a request or
  two, so there has to be immediate feedback and a fallback if it fails.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/shows.js` — resolve an episode to its series.** Add
   `entryFor(episode)` → `Promise<mergedShowEntry|null>`:
   - Return `null` immediately for anything without a `grandparentRatingKey`.
   - `Meta.load({ ratingKey: episode.grandparentRatingKey, _server: episode._server })`
     gives the show on the episode's own server, with its `Guid` array.
   - Take the show's identifying guid — the `plex://` one if present, else the
     first `Guid[].id` — and ask **every** server for it with
     `Plex.findByGuid`. Fold what comes back with `Merge.lists` into one entry,
     exactly as the rail does. A server that does not have the show simply
     returns nothing.
   - If no guid can be found, or the fold comes back empty, fall back to the
     single show payload from the episode's own server. One source is a valid
     entry; the page works.
   - Cache the resolved entry by `<_server>:<grandparentRatingKey>` in a
     module-level object, so pressing OK on three episodes of one show costs
     one resolution. Cache `null` too.

2. **`js/showpage.js` — open at a named episode.** `open(entry, options)` gains
   `options.at = { season: <number>, episode: <number> }`, both being Plex's
   `index` values (season number and episode number), not array positions:
   - After `Shows.seasons` resolves, if `options.at` names a season present in
     the list, select that instead of `Shows.openAt(list)`.
   - After the episodes load, set `epIdx` to the episode whose `index` matches
     `options.at.episode`; if there is no match, leave it at 0.
   - A missing or unmatched `at` must behave exactly as today — this is an
     override, not a new required argument.
   - The existing `EPISODE_LEAD` windowing already scrolls the focused row into
     view, so nothing new is needed to reveal it.

3. **`js/app.js` — route episodes to the series.** In `openItem`:
   - `type === 'show'` → `ShowPage.open` as now.
   - `type === 'episode'` → toast `'Opening ' + (item.grandparentTitle || 'series') + '…'`
     immediately so the keypress is visibly acknowledged, then
     `Shows.entryFor(item)`. On success, `ShowPage.open(entry, { at: { season:
     item.parentIndex, episode: item.index }, ...the same handlers the show
     branch already passes })`. On `null` or a rejection, fall back to
     `openDetail(item, toBrowse)` and write the reason to `UI.debug` — OK must
     do *something*.
   - Everything else → `openDetail` as now.
   - The show branch's `onChoose` handler already opens the detail page for a
     chosen episode and returns to the show page. That is how a copy is still
     picked, and it must keep working for episodes arriving by this new route.

4. **`dev/smoke.js`** — extend, do not replace:
   - OK on an episode in Continue watching opens the **show** view, not the
     detail view, with the season chip matching the episode's `parentIndex`
     and the highlighted row being its `index`.
   - From there, moving down and pressing OK still reaches the copy chooser for
     a *different* episode — proving the route onward that this task exists for.
   - The existing step "an episode opens the same copy chooser a film does"
     asserts the behaviour this task deliberately changes. Rework it to reach
     the copy chooser **through** the series page rather than deleting it; the
     copy chooser for an episode must still be reachable and still list every
     copy.
   - OK on a film is unchanged and still opens the detail page directly.

## Out of scope
- **Play next / up next when an episode ends.** That is task 011 and needs
  `js/player.js`; do not touch it.
- **The look of the series page.** Rebuilding it to the new design language is
  a separate backlog item. Only the opening behaviour changes here.
- **`js/detail.js`.** The copy chooser is unchanged; it is simply reached one
  step later for episodes.
- **`js/browse.js`, `js/rail.js`, `css/app.css`.** Nothing about browsing or
  layout changes.
- **Marking watched, resume behaviour, or the guard.**

## Definition of done
- [x] OK on an episode in Continue watching opens the series page, with the
      correct season selected and that episode highlighted.
- [x] The same is true for an episode reached from a search result or a hub row.
- [x] From the series page the next episode is reachable and playable — there
      is no dead end.
- [x] An episode's copy chooser is still reachable, listing every copy, through
      the series page.
- [x] OK on a film still opens the detail page directly, unchanged.
- [x] OK on an episode is acknowledged immediately, and if the series cannot be
      resolved it falls back to the episode's own page rather than doing
      nothing.
- [x] Pressing OK on three episodes of one show resolves the show once, not
      three times.
- [x] `npm run verify` passes.
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## Review rounds

**Round 1 — PASS.** Every Definition of done item met; `npm run verify`
reproduced independently (25 scripts ES5-clean, 7/7 unit files, 43/43 smoke).
The `Plex.allVersions` deviation judged sound — same id fallback order, an
existing precedent in `js/detail.js`, and `Merge.lists([[md]].concat(...))[0]`
folds in the spec's single-payload fallback correctly. No findings.

## What changed

- `js/shows.js` — `entryFor(episode)`: the episode's show from `Meta.load`, then
  every server's copy by that show's ids, folded into one merged entry; cached
  per `<server>:<showKey>` as a promise, `null` included.
- `js/showpage.js` — `open` accepts `options.at = { season, episode }` (Plex
  `index` values). `openSeason` overrides `Shows.openAt`; `wantEp` overrides the
  first-unfinished landing on the first episode load only.
- `js/app.js` — `openItem` routes `type === 'episode'` to a new `openEpisode`:
  toast, resolve, open the series at that episode, falling back to
  `openDetail` with a `UI.debug` line on null or rejection. The show branch
  became `openShow(entry, at)`, shared by both.
- `dev/smoke.js` — new step "OK on an episode opens its series, at that
  episode": season chip and highlighted row match the tile's `parentIndex` /
  `index`, the detail page did *not* open, moving down reaches a different
  episode's copy chooser, and a second OK on the same episode fires zero
  `/library/all?guid=` requests. Verified non-vacuous both ways (assert
  inverted, and cache disabled). The step at line 966 was retitled "an
  episode's copy chooser is reached through the series page".

## What the spec got wrong

- **Step 1's guid picking is a second implementation of `Plex.allVersions`.**
  Used that instead: same id fallback order, already exported, returns every
  copy on a server rather than the first. Leading the fold with the episode's
  own server's show payload (`Merge.lists([[md]].concat(perServer))[0]`) makes
  the spec's separate "fold came back empty" fallback unnecessary. It also
  matters in the harness: the mock's `/library/all?guid=` index holds only
  `tmdb://` ids, so the spec's plex://-first lookup would never fold anything
  across servers there.
- **Step 4's claim about the existing step is not true.** "an episode opens the
  same copy chooser a film does" already reached the chooser *through* the
  series page (ArrowRight on an episode row). Nothing about it asserted the old
  routing, so only its title changed.
- **The role doc's "baseline is 28/28 green" is stale.** It was 42/43 before
  this task, 43/43 after.
- `scope-check.js` counts the task file itself as out of scope once its
  `status:` line is edited. The gate was run clean before that edit.

## Graph writes proposed

- **Decision — an episode is never a terminal screen.** OK on an episode
  anywhere resolves upward to its show and opens the series page at that
  season and episode. Rationale: the copy chooser for a single episode has no
  route to the next one, which is the main thing wanted part way through a
  show. The chooser is not lost — the series page's `onChoose` still reaches it,
  one step later. Supersedes nothing; extends the `openItem` routing.
- **Pattern — resolve upward, then merge outward.** Episodes rarely carry ids of
  their own, so cross-server identity for an episode is the *show's* ids plus
  season and episode number. Anything that needs an episode's counterpart on
  another server should go to the show first (`Meta.load` on
  `grandparentRatingKey`), fold the show across servers, and drill back down —
  never try to match the episode directly.
- **Pattern — lead a cross-server fold with the payload you already hold.**
  `Merge.lists([[known]].concat(perServer))[0]` makes "nothing else has it" a
  one-source entry for free, removing the empty-result branch entirely. Relies
  on `Merge.combine` deduplicating by `copyKey` and on first-seen ordering.
- **Gotcha — the dev mock indexes only `tmdb://` guids.** `dev/library.js`
  builds `srv.byGuid` from `tmdb://` ids alone, so `/library/all?guid=plex://…`
  always misses in the harness while working on real servers. Code that looks up
  by guid should try ids in order (as `Plex.allVersions` does) or its
  cross-server behaviour is untestable on the laptop.
