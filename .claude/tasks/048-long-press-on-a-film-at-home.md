---
id: 048
slug: long-press-on-a-film-at-home
status: building
branch: crew/048-long-press-on-a-film-at-home
model: sonnet
env: laptop
rounds: 0
work: browse-polish
files:
  - src/view/hold.ts
  - src/screen/showpage.ts
  - src/screen/browse.ts
  - src/app.ts
  - src/api/plex/library.ts
  - css/browse.css
  - dev/mock-plex.js
  - dev/smoke/browse.js
---

# Holding OK on a film in the browse rows opens a menu

## Goal
Holding OK on a film tile in any browse row (Continue watching, the film rows)
opens a small menu: **Mark watched**, **Mark unwatched**, and — when it is in
Continue watching — **Remove from Continue watching**. A tap still opens the film.

## Why now
Stuart, 2026-11-09: "add a long press to movies on the home screen" — "yes mark
watched and like", on the browse rows. Task 031 did the same for episodes on
the series page.

## Existing work
None. 044 (running) touches `src/app.ts`; run after it merges.

## Graph context
- 031 (`e5b9845`): OK acts on **keyup**. `src/screen/showpage.ts:624-662`
  holds the state machine — a 500 ms `HOLD_MS` timer started on keydown, a
  repeated keydown while it runs is the hold, keyup before it fires is a tap.
- Trap "held OK fired the menu row repeatedly": the remote keeps sending
  keydown while held, and those repeats reached the open menu as OK. Cure: an
  `okHeld` flag cleared only on keyup, checked **before** the `menu.isOpen()`
  route at the top of `browse.key`.
- Trap "Playwright cannot hold a key": `dev/smoke/show.js` `holdOk()` does
  `keyboard.down('Enter')`, a wait, `keyboard.up`. Reuse it.
- `src/app.ts:386` `onKeyUp` routes only to `showpage.keyUp` today.

## Constraints that bite here
- Writes go to every copy's server (`merge.sources(entry)` → `servers.of(copy)`),
  as `markWatched` in showpage does.
- OK on a tile must no longer act on keydown, or a hold opens the film first.
- `picking` mode (green key, task 018) keeps OK as a pick toggle; no hold there.

## Approach
1. **`src/view/hold.ts`** (new): lift showpage's hold state machine into one
   helper — `okDown(code)`, `okUp(code)`, `swallow(code)` (the `okHeld` check)
   with `onTap`/`onHold` callbacks. Convert `src/screen/showpage.ts` to use it,
   with no behaviour change (the existing show smoke steps are the proof).
2. **`src/api/plex/library.ts`**: `unscrobble(server, ratingKey)` mirroring
   `scrobble` (l.137) on `/:/unscrobble`.
3. **`src/screen/browse.ts`**: `case K.OK` (l.1333) goes through the hold
   helper; tap = today's `options.onOpen(focusedItem())`. Hold on a **film**
   (`type === 'movie'`) opens `menu.open` (`src/view/menu.ts`) with the rows
   above; "Remove from Continue watching" only when `isOnDeck(item)`, via
   `clearOne`. Hold on anything else behaves as a tap. Export `keyUp(code)`.
   Watched state on the tile updates after a choice (reuse whatever 018 does
   after clearing).
4. **`src/app.ts:386`** `onKeyUp`: also route to `browse.keyUp` when
   `view() === 'browse'`.
5. **`css/browse.css`**: position the menu (centred over the rail is fine; a
   recycled tile pool makes anchoring to the tile not worth it).
6. **Mock** `dev/mock-plex.js`: `/:/unscrobble` clears `viewCount`/`viewOffset`
   and is counted, like scrobble.
7. **Smoke** `dev/smoke/browse.js`: hold OK on a film → the menu's row texts are
   exactly the expected ones (with and without the Continue watching row);
   Mark watched sends one scrobble per copy (assert the count, with a control);
   Mark unwatched sends unscrobble; a tap still opens the film page; holding OK
   fires no menu row (assert no scrobble after a 2 s hold with the menu open).

## Out of scope
- Episodes and shows in the rails (hold = tap for them).
- Ratings / favourites. A menu design beyond the existing menu shell.

## Definition of done
- [ ] Holding OK on a film tile opens the menu with exactly the rows above; a tap opens the film.
- [ ] Mark watched / unwatched reach every copy's server (smoke counts, with a control).
- [ ] Remove from Continue watching appears only for an entry on the deck, and removes it.
- [ ] Holding OK with the menu open does not choose a row.
- [ ] The series page's long press is unchanged (existing show smoke steps pass).
- [ ] the gate passes (`crew gate .claude/tasks/048-long-press-on-a-film-at-home.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
