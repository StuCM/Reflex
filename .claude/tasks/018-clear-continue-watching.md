---
id: 018
slug: clear-continue-watching
status: approved
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
---

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
- [ ] Green on the Continue watching row enters a select mode that counts what
      is picked, and BACK leaves without changing anything.
- [ ] Confirming removes every picked entry from the row, on every server that
      has it, and they are still gone after a reload.
- [ ] Where the server supports it, entries are **hidden** and their watch state
      is untouched.
- [ ] Where it does not, the user is told that and asked; a show is never marked
      watched without an explicit confirmation naming that consequence.
- [ ] Cancel is the default selection on the confirmation.
- [ ] A title's own page offers the same action, and only when it is on the deck.
- [ ] A server that refuses both leaves the item in the row and says so.
- [ ] `npm run verify` passes, and the mock exercises both the hide and the
      fallback paths.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
