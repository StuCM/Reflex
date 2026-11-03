---
id: 038
slug: continue-watching-is-fresh
status: review
branch: crew/038-continue-watching-is-fresh
model: sonnet
env: laptop
rounds: 1
files:
  - src/screen/browse.ts
  - src/app.ts
  - src/data/devices.ts
  - dev/mock-plex.js
  - dev/server.js
  - dev/smoke/deck.js
gate: pass
gateSha: 52023d46fa600bc5905d60a3401306ddb5c75d83
gateAt: 2026-11-03T08:53:16.978Z
---

# Continue watching shows what you have been watching, promptly

## Goal
At launch, Continue watching is replaced by the servers' current list as soon
as that one request answers, not after the hubs. Coming back from the player,
it is fetched again, so what you just watched is at the front.

## Why now
Reported 2026-11-03: "It always shows the same set of cached … then slow to
update but will eventually refresh." This is a bug in use, so it goes ahead of
the browse rework.

## Existing work
`npx crew collisions` could not run, because the crew CLI is not installed.
Checked by hand: no branch other than `main` and `ccr-e2dc43ae-pi2ghm` (docs
only) touches these files. Task 037 also touches `src/screen/browse.ts`, but
only `searchKey()` (~line 1024), which does not overlap. None.

## Graph context
`npx crew graph` was unavailable. Written from the code.

The launch chain, in order, each step waiting on the one before:

1. `start()` in `src/app.ts:435` paints from `cached.sections` and calls
   `browse.loadSection(..., false)`, which draws the cached rows, Continue
   watching included.
2. `plexDiscover()` asks plex.tv for the servers.
3. `plexSections()` runs per server.
4. `browse.loadSection(..., true)` (`src/screen/browse.ts:681`) runs one
   `Promise.all` over **three** things: `plexOnDeck` per server, `plexHubs` for
   **every section part** (20s timeout each, `api/plex/library.ts:156`), and
   `devices.ensureHistory()`.
5. Only then are `built` rows drawn and `cached.rows.put(section.title, …)`
   written.

So the deck, which is one fast request per server, waits behind plex.tv, the
section lists and the slowest hub.

After playback, `toBrowse()` (`src/app.ts:35`) only calls `browse.render()`.
Nothing is refetched until a section reloads.

`devices.ensureHistory()` (`src/data/devices.ts:74`) memoises `played` for the
life of the app. `devices.mine()` filters out anything whose latest history
entry is another account-device. So a film last played elsewhere and then
watched here stays filtered out until restart.

The user also said it shows "the same" cached set every time. If that is
literal, the cache write is not sticking. The smoke step below checks the
round trip, so that would be found here.

## Constraints that bite here
- One request per server for the deck, never more. The servers are someone
  else's, and nothing here may add a hub or library request.
- Keep `isCurrent()` / `generationGuard()` on every async path. A section
  switch mid-flight must not overwrite the new section's rows.
- `async`/`await` is preferred in new code.

## Approach
1. **Deck first.** In `loadSection(i, true)`, start `plexOnDeck` for each
   server on its own. When it lands (and `isCurrent()`), replace or insert the
   `WATCHING` row, using the same `devices.mine` filter and `lastViewedAt` sort
   that exist today, and `render()`. The hubs and history `Promise.all` goes on
   as before and builds the remaining rows. When both are done, write
   `cached.rows.put` with the deck **and** the hubs. Extract the deck-building
   lines (today ~710–723) into one function, used by both paths.
2. **Deck before discovery.** In `start()`, when cached sections and known
   servers exist (`servers.count()`), the cached paint's `loadSection` may
   fetch the deck alone from those servers straight away, before
   `plexDiscover()`. If this cannot be done without fetching hubs twice, stop
   at step 1 and say so in the report. Step 1 is the required part.
3. **After playback.** Export `refreshDeck()` from `browse.ts`. It refetches
   onDeck for the current section's servers and redraws the `WATCHING` row,
   keeping focus clamped (as `dropFromDeck` does). Call it from `toBrowse()`
   in `app.ts` when the view being left was the player or the detail page
   after playback. Add `devices.forgetHistory()`, which clears `played`, and
   call it before that refetch, so `mine()` sees the latest history.
4. **Mock.**
   - `/:/timeline` with `state=stopped` in `dev/mock-plex.js` moves that item
     to the front of `srv.deck` (adding it if absent), with `lastViewedAt` set
     to now. That is how a real server behaves, and it gives the smoke test
     something to see change.
   - A `--slow-hubs <ms>` option in `dev/server.js` delays only
     `/hubs/sections/*`, so the order can be tested.
5. **Smoke steps in `dev/smoke/deck.js`:**
   - *The deck lands before the hubs.* Run with slow hubs (5000ms), seed a
     stale cached deck, reload, and assert that the first Continue watching
     tile changes to the mock's current first entry **before** any hub row
     exists. Assert positive content: the tile's title. Control: the same step
     asserts that the hub row does appear afterwards.
   - *What you watched comes first.* Play a fixture film, stop, return to the
     library, and assert that the first Continue watching tile is that film.
     Skip without a fixture, as the player steps do.
   - *The cache round trip.* After a refresh, reload the page with the network
     to the servers blocked, and assert that the cached deck shows the
     refreshed first entry, not the original.

   Run each against `main` first. The first two must fail there.

## Out of scope
- The hubs themselves, their timeout, or which hubs are shown (the browse
  rework removes them).
- Watched state on tiles elsewhere (`viewCount`/`viewOffset` in other rows).
- Removing items from Continue watching (`dropFromDeck`, task already done).
- Any change to `devices.mine()`'s rule, only when its history is refreshed.

## Definition of done
- [ ] With hubs delayed 5s on the mock, Continue watching updates from the
      servers before the hubs arrive.
- [ ] After playing and stopping a film, returning to the library shows it
      first in Continue watching without a section reload.
- [ ] History is refetched on that return, so `mine()` is not working from the
      launch-time snapshot.
- [ ] The cached deck after a refresh is the refreshed one.
- [ ] No additional request per server beyond one onDeck per refresh.
- [ ] The smoke steps pass, and the first two were observed failing against
      `main` (quote the failure lines).
- [ ] The gate passes (`npx crew gate .claude/tasks/038-continue-watching-is-fresh.md`).
- [ ] No file outside `files:` is touched.
- [ ] Commits follow the convention.

## Review rounds

Round 1: PASS. verify 112/112. Reviewer's note: a failed launch prefetch is
reused once by loadSection rather than retried; minor, left.

Observed failing on the base `src/` (merge-base 6d8a520), mock and smoke kept:

    FAIL  the deck lands before the hubs do
          timed out waiting for the deck to refresh to Absent Dispatch
    FAIL  what you watched comes first when you come back
          timed out waiting for Absent Crossing to lead Continue watching, watched just now
    FAIL  the refreshed deck is what the cache holds

## What changed

- src/screen/browse.ts: deck fetched on its own and drawn on arrival (`landDeck`), `buildDeck` shared by both paths, `refreshDeck()` exported, cache written from the rows as they are (parked search rows included), a launch prefetch taken once by `loadSection`.
- src/app.ts: `playedSince` set in `playChecked`; `toBrowse` refreshes the deck and history once after playback; `start()` refreshes from cached servers before discovery.
- src/data/devices.ts: `forgetHistory()`; `ensureHistory` shares its in-flight fetch.
- dev/mock-plex.js: `stopped` timeline moves the item to the deck front; hub delay, settable at runtime via `/__plextv/slow-hubs?ms=N`.
- dev/server.js: `--slow-hubs <ms>`.
- dev/smoke/deck.js: three steps (deck before hubs, watched comes first, cache round trip).

Spec notes: smoke.js is outside `files:`, so the 5s hub delay is set per step through the runtime endpoint. The cache step holds requests open instead of refusing them, because a refused request is a console error and fails the suite's last step. The "watched comes first" step compares lastViewedAt, since earlier areas may already have played the film.

## Graph writes proposed

- Pattern: `oxfmt` is the formatter (`npx oxfmt --write <files>`); prettier with no config reformats the whole tree. `git apply --unidiff-zero` of -U0 hunks misplaces them; use text-anchored edits.
- Pattern: a smoke step that reads state earlier areas may have changed must not assume position; compare a timestamp.
- Decision: an onDeck answer must not be reused across a hide (`dropFromDeck` clears the prefetch), or removal steps see stale data.

## Graph writes proposed
