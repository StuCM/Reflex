---
id: 018
slug: clear-continue-watching
status: done
branch: crew/018-clear-continue-watching
model: opus
env: laptop
files:
  - js/plex.js
  - js/browse.js
  - js/detail.js
  - js/app.js
  - index.html
  - css/app.css
  - dev/mock-plex.js
  - dev/smoke.js
  - js/sidebar.js
---

<!-- js/sidebar.js was added to files: on the orchestrator's amendment: this
     remote has no colour buttons (js/sidebar.js:7), so select mode reachable
     only by green would ship unreachable. One entry in modes(), one kind. -->


# Getting things out of Continue watching

## Goal
Green on the remote turns the Continue watching row into a multi-select: pick
several, press OK, and they are gone from the row. The same action exists on a
title's own page for one thing at a time. A part-watched **show** is removed
without pretending you have seen all thirty seasons of it.

## Why now
The user: the list grows and never shrinks. On Plex the only way out is marking
things watched, and for a series two seasons in that means marking every season
watched — which is why they described it as getting stuck there.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching any of the eight declared files. No worktrees are in
flight; 017 merged as `a9ee56f`, main verified at 68/68.

Read these as they now are:

- `js/detail.js` has a round-button action row (Play, Trailer, Quality, Source,
  Audio, Subtitles) from 016. The new button joins it; the shared button CSS is
  already factored across `.dt-act-btn` and `.osd-btn`.
- `js/menu.js` is the shared shell. The player and the detail page both use it;
  a confirmation is a third caller, not a new component.
- `js/browse.js` holds `watchingType`, the Continue watching cut from 007.
- `dev/smoke.js` is at 68 steps.
- CLAUDE.md's Testing section now warns about assertions that pass on nothing —
  three appeared in one day. Read it before writing the steps in Approach 7.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **These are not our servers.** The user is a shared user on someone else's two
  remote servers. Marking watched is a write against them. It is the user's own
  watch state so it is legitimate, but it is destructive and must never happen
  by accident or as a silent fallback.
- **The mechanism is already decided** (`docs/backlog.md`): try
  `PUT /actions/removeFromContinueWatching?ratingKey=<key>`, which newer Plex
  servers answer and which hides an item **without touching watch state**. Fall
  back to `PUT /:/scrobble?key=<key>&identifier=com.plexapp.plugins.library`
  only where that 404s. **Do not sniff the server version** — discovery has
  `productVersion`, but versions lie and the fallback has to exist anyway.
  Capability detection by trying is the decision; do not revisit it.
- **Continue watching comes from `Plex.onDeck(server)`, per server, not per
  section**, and is folded by `Merge.lists`. An entry can therefore have copies
  on both servers, and clearing it means clearing it on **every server that has
  it** — `Merge.sources(entry)` is that list. Clearing one and not the other
  leaves it in the row.
- **An entry in the row may be a film or an episode** (`fac9937`), and
  `js/browse.js` holds a `watchingType` cut of the row.
- **`js/menu.js` is the shared shell** (016) and takes a row builder per tab.
  A confirmation is two rows; use it rather than inventing a dialog.
- **The colour keys**: red already opens search (`js/browse.js`, `K.RED`).
  Green, yellow and blue are free on the browse screen.
- **`Media.identity(item)`** is the stable key for an entry across servers.
- **Chromium 53.** No CSS Grid, no `position: sticky`, no `async`/`await`, no
  object spread, no `Object.entries`. Animate only `transform` and `opacity`.
- **Assertions that pass on nothing** are the failure mode this suite keeps
  producing (CLAUDE.md, Testing). Assert on positive content, and run any step
  that exists to catch a specific bug against `main` first.

## Constraints that bite here
- **Never mark a show watched without asking.** For a series, losing "I have
  seen two of thirty seasons" is worse than the row being untidy. If
  `removeFromContinueWatching` is unavailable, say so and make the user choose;
  do not fall through to scrobbling a show silently.
- **Nothing is removed without a confirmation**, and the confirmation names what
  will happen — hidden, or marked watched — because those are different things.
- **The row must not lie after the fact.** Whatever is removed goes from the row
  immediately, and the cached `rows:<section>` entry is invalidated so a reload
  does not bring it back.
- **A failure is reported.** A server that refuses both endpoints leaves the
  item in the row and says so; it never disappears optimistically.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/plex.js` — two calls and a capability.**
   - `hideFromDeck(server, ratingKey)` → `PUT /actions/removeFromContinueWatching?ratingKey=…`.
     Resolves `true` on 2xx, `false` on 404 or 400 (the server does not have it),
     rejects on anything else.
   - `scrobble(server, ratingKey)` → `PUT /:/scrobble?key=…&identifier=com.plexapp.plugins.library`.
   - Remember per server whether `hideFromDeck` worked, so a row of ten does not
     re-discover the same 404 ten times. Memory only; do not persist a
     capability that may change under us.

2. **`js/browse.js` — clearing one entry, wherever it came from.**
   `clearFromDeck(entry, mode)` → Promise:
   - `mode` is `'hide'` or `'watched'`, decided by the caller, never guessed.
   - For every copy in `Merge.sources(entry)`, act on that copy's own server and
     rating key. All of them, not just the shown one.
   - `'hide'` calls `hideFromDeck`; if a server answers `false`, resolve with
     `{ ok: false, needsWatched: true }` so the caller can ask.
   - `'watched'` calls `scrobble`. For an **episode**, scrobble the episode. For
     a **show**, scrobble the show's own rating key — Plex propagates, which is
     the whole point of not doing it per season.
   - On success, drop the entry from the Continue watching row, re-render, and
     invalidate the `rows:` cache entry for the section.

3. **`js/browse.js` — green enters select mode.** On the Continue watching row
   only, and only when it has something in it:
   - **Green** enters the mode. The row's label becomes `Select to remove — 0
     picked`, and the hint line says what the keys now do.
   - **OK** marks and unmarks the tile under the focus. Left and right still
     move along the row; up and down are ignored, so the mode cannot be left by
     wandering out of it.
   - **Green again** confirms, opening the confirmation of step 5 for everything
     picked. With nothing picked it does nothing but say so.
   - **BACK** leaves the mode, unmarks everything and changes nothing.

   Three distinct keys for three distinct things: enter, pick, confirm. No
   single press both selects and destroys, and the way out is the key that
   always means "out".

4. **`js/detail.js` — the same, for one.** A round button in the action row,
   after Subtitles: `Remove from Continue watching`, present only when the item
   is actually on the deck. It opens the same confirmation and, on success,
   returns to the browse screen with the row already updated.

5. **`index.html`, `css/app.css`, `js/app.js` — the confirmation.** Built with
   `Menu`: a title naming what will happen and how many, then two rows —
   the action, and *Cancel*. Wording must distinguish the two outcomes:
   - hide: `Remove 3 from Continue watching` / `They stay part-watched.`
   - watched: `Mark 3 watched` / `This server cannot hide them. Marking a show
     watched marks every episode.`
   Cancel is the default selection, not the action.

6. **`dev/mock-plex.js`** — implement both endpoints, and make **one server
   answer 404** to `removeFromContinueWatching` so the fallback path is
   exercised rather than asserted. Removing must actually change what
   `/library/onDeck` returns next time, or the smoke test proves nothing.

7. **`dev/smoke.js`**:
   - Green enters select mode, the label counts, BACK leaves it untouched.
   - Confirming removes the picked entries from the row, and they are still gone
     after the section is reloaded.
   - On the server that 404s, the confirmation says the item will be **marked
     watched** rather than hidden, and cancelling leaves it in the row.
   - The detail page's button appears only for something on the deck.
   - A film with copies on both servers is cleared on both — assert the requests
     to each, not just that the row shrank.

## Out of scope
- **A general "mark watched / unwatched" feature** for anything not on the deck.
  Separate backlog item.
- **Scrobbling on playback completion**, which is its own backlog item and is
  not made better or worse here.
- **The up-next panel, the browse redesign, TMDB categories.**
- **Persisting the per-server capability** across launches.
- **`js/guard.js`, `js/player.js`, `js/menu.js`** beyond calling `Menu.open`.

## Definition of done
- [x] Green on the Continue watching row enters a select mode that counts what
      is picked, and BACK leaves without changing anything.
- [x] Confirming removes every picked entry from the row, on every server that
      has it, and they are still gone after a reload.
- [x] Where the server supports it, entries are **hidden** and their watch state
      is untouched.
- [x] Where it does not, the user is told that and asked; a show is never marked
      watched without an explicit confirmation naming that consequence.
- [x] Cancel is the default selection on the confirmation.
- [x] A title's own page offers the same action, and only when it is on the deck.
- [x] A server that refuses both leaves the item in the row and says so.
- [x] `npm run verify` passes, and the mock exercises both the hide and the
      fallback paths.
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## Review rounds

**Round 1 — CHANGES.** One blocking finding, and it was right: the watched
fallback re-read `Merge.sources(entry)` and so scrobbled *every* copy of an
entry, including the copy a server had already hidden. On a film held by both
servers that threw away the watch state on Main — the server that had done the
non-destructive thing and never needed the fallback — which is the opposite of
"where the server supports it, watch state is untouched". Fixed in `0ccf280`
by threading a job of `{ entry, copies }`: a refusal comes back carrying only
the copies that were refused, and the watched round reaches only those. The
smoke step now asserts Main is never scrobbled, and that assertion was checked
against the old code, where it fails naming all three requests.

Two non-blocking observations came with it, both addressed: the episode → show
scrobble had no deterministic step (there is one now, asserting the scrobble
carries `key=<show>` and never `key=<episode>`), and a server refusing *both*
endpoints is still verified by inspection only — teaching the mock to 404 a
scrobble would be testing something no real server does. The reviewer agreed
that one does not block.

**Round 2 — PASS.**

## What changed, per file

- `js/plex.js` — `hideFromDeck` and `scrobble`, both `PUT`. `hideFromDeck`
  resolves `false` on 400/404 and remembers that per server in memory, so ten
  removals do not rediscover the same 404 ten times.
- `js/browse.js` — the select mode (green in, OK picks, green confirms, BACK
  out), the confirmation built on `Menu`, and the clearing itself: per copy, on
  that copy's own server, with the row and every section's `rows:` cache
  updated only once the server has agreed. Exports `clearOne` and `isOnDeck`.
- `js/detail.js` — a `Remove from Continue watching` button after Subtitles,
  present only when `Browse.isOnDeck` says so; every action now carries a
  `data-act` name so nothing has to count buttons from the end.
- `js/sidebar.js` — one `modes()` entry, `Clear from Continue watching`, shown
  only when the deck row holds something (see the note under the front matter).
- `index.html`, `css/app.css` — `#browse-hint` (the select-mode key map) and
  `#confirm` (the confirmation host), plus `.tile.picked`, amber so a picked
  tile still reads as picked once the focus has moved along.
- `dev/mock-plex.js` — both endpoints, with **Backup answering 404** to
  `removeFromContinueWatching` so the fallback is walked rather than asserted,
  and one film put on both decks so an entry with two copies exists at all.
- `dev/smoke.js` — six new steps, 68 → 75. `pressButton` now finds a button by
  name rather than by an offset from the end of the row.
- `js/app.js` — declared, not touched: `Browse.key` and `Detail.key` already
  route to `Menu` when one is open, so the confirmation needed no wiring.

## What the spec got wrong

- **Approach 2, the watched key.** As written — "for an **episode**, scrobble
  the episode; for a **show**, scrobble the show's own rating key" — both
  branches reduce to `entry.ratingKey`, because `Plex.onDeck` only ever yields
  movies and episodes and nothing else reaches this code. No show could then be
  marked watched, which makes the prescribed note ("Marking a show watched marks
  every episode") and the Definition-of-done line about it vacuous, and leaves
  the actual complaint unfixed: scrobbling one episode only advances the deck to
  the next one, so the series stays in the row. `watchedKey` therefore scrobbles
  an episode's `grandparentRatingKey`. That matches `docs/backlog.md` ("a series
  you are two seasons into is removed by marking all thirty watched") and the
  constraint against falling through to it silently. The reviewer agreed.
- **`js/ui.js` is not in `files:`** but `UI.KEY` is where keycodes live, so
  green is a local `GREEN = 404` in `js/browse.js` instead. Worth moving next
  time something touches `ui.js`.
- **`js/sidebar.js` was missing from `files:`** — added on the orchestrator's
  amendment, because a mode reachable only by a colour button this remote does
  not have is a mode that ships unreachable.

## Graph writes proposed

- **Pattern — a renamed row does not repaint.** `js/rail.js` treats a row as
  unchanged when `rowEl._row` and `rowEl._rowRef` both match, so mutating
  `row.title` in place leaves the old label on screen; only handing the rail a
  *new* row object repaints it. Cost most of a smoke round to find, and it
  looked exactly like the key never arriving. Anything that changes a row label
  without changing its items has to rebuild the row.
- **Decision — capability by trying, per server, in memory.**
  `removeFromContinueWatching` exists on newer servers only. `Plex.hideFromDeck`
  resolves `false` on 400/404 rather than throwing, and caches that per server
  id for the session — not to disk, because a server can be upgraded under us.
  Version sniffing was considered and rejected in `docs/backlog.md`.
- **Decision — the fallback is per copy, not per entry.** Hiding is
  non-destructive and marking watched is not, so when one server hides and
  another refuses, only the refusing copy may be scrobbled. Reading
  `Merge.sources` again on the second round is what re-scrobbles a copy that was
  already dealt with; the copies that were refused have to be carried forward.
  This was the round-one review finding.
- **Gotcha — never `git checkout <file>` to undo a temporary experiment on
  uncommitted work.** It reverted a whole file of unstaged changes mid-task and
  cost a full re-application. Copy the file to the scratchpad and copy it back.
