---
id: 075
slug: profiles-underneath
status: done
branch: crew/075-profiles-underneath
model: sonnet
env: laptop
rounds: 1
work: v2-foundations
files:
  - src/data/store.ts
  - src/data/profiles.ts
  - src/data/devices.ts
  - src/screen/player.ts
  - src/screen/pages.ts
  - src/core/ui.ts
  - css/base.css
  - test/profiles.test.ts
  - dev/smoke.js
  - dev/smoke/shell.js
  - dev/smoke/deck.js
  - dev/smoke/detail.js
  - dev/smoke/browse.js
  - dev/smoke/discovery.js
  - dev/smoke/show.js
  - dev/smoke/sections.js
  - src/seam.ts
  - types/seam.d.ts
gate: pass
gateSha: 780c5f422538c2c62644435216b95ed6d2357139
gateAt: 2026-11-23T18:45:15.488Z
---

# Profiles underneath: who is watching, their accent, and their plays

## Goal
The app knows which profile is active — Together (default), Stu or Naoise —
gives each its own accent colour, records every play locally tagged with the
profile, and lets Continue watching follow the profile. No profile screens yet:
this is the layer the profile UI and every v2 feed will build on.

## Why now
v2 plan, foundation 1d: "every feed built after it should read the profile
from the start". Stuart, 2026-11-23, took the recommendation to record plays
locally ("Plex history cannot tell Stu from Naoise on one device"). Spec §6.

## Existing work
After 073 (shares `src/screen/pages.ts`). Base `feat/v2`.

## Background
- `src/data/store.ts:13 open` — IndexedDB `indexedDB.open(NAME, 1)` with one
  `kv` store; `transact` (l.33).
- `src/data/devices.ts:19 mine` — today's "whose viewing is this" filter on
  Continue watching (by device history); the profile filter is the same seam.
- `src/api/plex/playback.ts:164 timeline` is called from
  `src/screen/player.ts:1124` while playing — the point to record a play.
- `css/base.css:24 --ac` is the accent token. Spec §2/§6 accents: Together
  `#F4C8B6`, Stu `#AEBBF0`, Naoise `#8FD9C4`; 4 hours idle returns to Together.
- `src/core/ui.ts KEY` has no channel keys (427/428 unverified on the B8).

## Graph context
- Pattern "root custom properties kill B8 panning": the accent may be set on
  `:root` **only on a profile change** (rare), never per key or frame.
- Pattern "inserting a saved option shifts indices": version anything
  persisted.

## Approach
1. `store.ts`: version 2, adding object stores `plays` (key `[profile,
   ratingKey, server]`, fields `at`, `offset`, `duration`, `type`, show key),
   `title_tags`, `smart_lists`, `hidden`. The upgrade keeps `kv` intact.
2. `src/data/profiles.ts` (new): `current()`, `set(id)`, `all()` (fixed three
   for now, names and accents as above), persisted in `kv` with a version;
   sets `--ac` on `:root` on change; `touch()` resets a 4-hour idle timer that
   returns to Together; `recordPlay(item, offset, duration)` writes to `plays`.
3. `player.ts`: on each timeline report call `profiles.recordPlay` (cheap,
   debounced to once per 30 s per item).
4. Continue watching (`pages.ts` deck build, via `devices.mine`): in Stu or
   Naoise, keep only deck items that profile has a play for; in Together,
   unchanged.
5. `ui.ts KEY`: `CH_UP: 427`, `CH_DOWN: 428`; on browse they cycle the
   profile (marked unverified on the device in a code comment is not needed —
   a debug line logs the keycode when pressed).
6. `test/profiles.test.ts`: profile persistence and idle return (fake
   timers), play recording keys, the deck filter.
7. Smoke: a fresh profile is Together with `--ac` #F4C8B6; `Profiles.set`
   via the seam to Stu changes `--ac` to #AEBBF0 and Continue watching shows
   only items with a Stu play (seed one via `Profiles.recordPlay`), and back in
   Together shows all (positive counts). Publish `Profiles` through
   `src/seam.ts` / `types/seam.d.ts`.
8. **The smoke suite opens IndexedDB at version 1** page-side
   (`dev/smoke.js:874`, `deck.js:124`, `detail.js:841`, `browse.js:1247`,
   `discovery.js:582`, `show.js:1569`, `sections.js:921`); after the upgrade
   that throws VersionError. Change each to `indexedDB.open('reflex')` with no
   version, so the next bump cannot break them.

## Out of scope
- Who's watching modal, colour picker, Settings page, avatar chip (later
  group). Backup file. Smart list rules.

## Definition of done
- [ ] Store upgrades to v2 with the four tables, keeping existing data (unit + smoke on an existing v1 DB).
- [ ] Current profile persists; accent follows it; 4-hour idle returns to Together (unit).
- [ ] Plays are recorded per profile while playing; Continue watching follows the profile (smoke).
- [ ] the gate passes (`crew gate .claude/tasks/075-profiles-underneath.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

Round 1: PASS. Non-blocking: no unit/smoke run of a real v1->v2 upgrade (no fake-indexeddb; smoke checks the five stores on a fresh v2 DB); CH keys change the accent but the on-screen deck follows only on next rebuild.

## Graph writes proposed

## Worker notes
- store.ts: v2, stores kv/plays/title_tags/smart_lists/hidden; `keysIn`, `putIn` added.
- profiles.ts (new): current/set/all/touch/recordPlay/hasPlayed/ready; self-starts at import (app.ts is outside files), CH keys cycle on browse.
- devices.mine filters by profile; pages.fetchDeck awaits profiles.ready(); player.report records plays.
- base.css defaults are now the Together peach (also --ac-soft/--ac-tint); profiles sets all three. sections.js assertion updated.
- Spec gap: no hook to refresh the deck live on profile change (browse.ts/app.ts out of scope).
- Smoke seven indexedDB.open calls now unversioned.

## Graph writes proposed
- Pattern: a smoke step judging a deck must reload the page; sidebar re-picks showed a stale Continue watching row.
