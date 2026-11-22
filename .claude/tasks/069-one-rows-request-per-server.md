---
id: 069
slug: one-rows-request-per-server
status: approved
branch: crew/069-one-rows-request-per-server
model: sonnet
env: laptop
rounds: 0
work: v2-data
files:
  - src/api/plex/library.ts
  - src/screen/browse.ts
  - src/data/cached.ts
  - types/plex.d.ts
  - dev/mock-plex.js
  - dev/smoke.js
  - dev/smoke/sections.js
  - dev/smoke/deck.js
  - dev/smoke/discovery.js
---

# A page's rows come from one request per server, not one per library

## Goal
Opening Movies, TV or Home asks each server once for its rows, across every
library that page merges, instead of once per library. On Apollo that turns an
18-second wait into about 2 seconds.

## Why now
Stuart, 2026-11-22: "sometimes it loads and then refreshes which is not ideal,
lets make one call for several rows that makes more sense. optimise all calls
to minimise requests but at the fastest speed."

## Existing work
None in flight. Base `feat/v2`. First of three (069, 070, 071); all edit
`src/screen/browse.ts`, so they run in order.

## Background — measured 2026-11-22, read-only, from the laptop
| server | `/hubs/sections/1` (one library, today) | `/hubs/promoted?contentDirectoryID=<all film libraries>` |
|---|---|---|
| Maverick | 2.56 s, 7 hubs, library 1 only | **1.15 s**, 8 hubs, libraries 1, 14, 6 |
| Apollo | **17.99 s**, 7 hubs, library 1 only | **2.10 s**, 10 hubs, libraries 1, 6 |

Promoted hubs take `contentDirectoryID` and `pinnedContentDirectoryID`
(comma-separated library keys), `count`, `includeGuids`, and return the same
`MediaContainer.Hub[]` shape as `/hubs/sections`. They also include
"Continue Watching" and "On Deck" hubs; this task does **not** use those (the
deck keeps its own path, `onDeck` + `devices.mine` + 046's fold).

- Today: `library.ts:216` `hubs(server, sectionKey)` →
  `/hubs/sections/{key}?count=HUB_COUNT&includeGuids=1`, called once per
  section **part** (each server × library) from `loadSection`
  (`browse.ts:~877-930`), with a 20 s timeout.
- The mock answers `/hubs/sections/(\w+)` (`dev/mock-plex.js:760`) and has a
  `/slow-hubs` switch (l.567).

## Graph context
- Servers we do not own: fewer requests is the point; never more than one in
  flight per server for rows.
- "A row's slot is not its identity"; rows merge across servers by identity
  (`merge.lists`).
- Grep done for the harness: hub requests are asserted in `dev/smoke/deck.js`
  and `dev/smoke/discovery.js`; `sections.js` counts section loads.

## Approach
1. `library.ts`: `promotedHubs(server, sectionKeys: string[])` →
   `/hubs/promoted?contentDirectoryID=…&pinnedContentDirectoryID=…&count=HUB_COUNT&includeGuids=1`,
   same timeout and stamping as `hubs()`. Drop hubs titled "Continue
   Watching" and "On Deck" from its result.
2. `browse.ts loadSection`: group the section's parts by server and call
   `promotedHubs` once per server with that server's library keys; merge the
   servers' hubs as today. If a server answers with an error or no hubs, fall
   back to today's per-library `hubs()` for that server only.
3. `cached.ts`: the cached rows key stays per section; nothing new.
4. Mock: `dev/mock-plex.js` answers `/hubs/promoted` from the same hub data
   as `/hubs/sections`, for the listed libraries, and counts requests per
   path.
5. Smoke: opening Movies makes exactly **one** rows request per mock server
   (assert 2 with two servers, and that `/hubs/sections/` is asked 0 times);
   the rows on screen are unchanged in titles and order from before (assert a
   positive list); with `/hubs/promoted` failing on one server, that server
   falls back to `/hubs/sections` and its rows still appear. Update any
   assertion in `deck.js` / `discovery.js` that counts `/hubs/sections/`.

## Out of scope
- Continue watching, the deck. Caching and refresh (070). TMDB (071).

## Definition of done
- [ ] One `/hubs/promoted` per server per section load, none to `/hubs/sections` (smoke, positive count).
- [ ] Same rows as before; fallback works when promoted fails (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/069-one-rows-request-per-server.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
