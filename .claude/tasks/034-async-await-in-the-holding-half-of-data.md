---
id: 034
slug: async-await-in-the-holding-half-of-data
status: review
branch: crew/034-async-await-in-the-holding-half-of-data
model: sonnet
env: laptop
rounds: 1
files:
  - src/data/art.ts
  - src/data/merge.ts
  - src/data/devices.ts
  - src/data/cached.ts
  - src/data/store.ts
gate: pass
gateSha: 9f67d02314429dd7a2a965da3f5289d99e6639b6
gateAt: 2026-09-15T07:43:30.595Z
---

# The holding half of data/ reads as async/await

## Goal
`art.ts`, `merge.ts`, `devices.ts`, `cached.ts` and `store.ts` use `async`/
`await` instead of `.then()` chains. Nothing they do changes.

## Why now
The other half of Stuart's ask, running beside 033. 13 of the 34 `.then(` calls
in `data/`.
## Graph context
`npx crew graph` reports the CLI is not on PATH; written from
`docs/refactor-plan.md`, `CLAUDE.md` and the code.

**Why this was not done during the migration.** `docs/refactor-plan.md:129`
chose *"Variant B: `async`/`await`, one function, guard clauses first"* and said
plainly that the ban in `CLAUDE.md` "was a consequence of having no compiler,
not something the panel imposes". `CLAUDE.md` went on saying *"No `async`/
`await` (Chrome 55). Use Promises with `.then()`"* until 2026-09-15. Every
worker loads `CLAUDE.md` and almost none read the plan, so **0 of 46 files in
`src/` use `async`/`await`**. The workers were right to follow the file they
were given; the file was wrong. Fixed in `655de11`.

**It is genuinely safe, and this was measured rather than assumed.** A reachable
`async` function was added, built, and the bundle read: no `await` and no
`async function` survive, and a `function*` and a `yield` appear in their place.
Chromium 53 has had generators since Chrome 39. `build.target: 'chrome53'` in
`vite.config.mts` is what does it.

## Constraints that bite here
- **The two-argument `.then(onOk, onErr)` is not `try`/`catch`.** In
  `.then(a, b)`, an error thrown *inside* `a` does **not** reach `b`. In
  `try { r = a(await p) } catch (e) { b(e) }`, it does. Converting that form
  naively widens the catch and changes behaviour. Every such site must either
  keep the narrow shape deliberately or the change must be called out in the
  task file. **Search for it before starting**: `grep -n "then(.*,.*=>" <file>`.
- **`Promise.prototype.finally` is banned (Chrome 63) but `try`/`finally` is
  not** — it is syntax, not a method, and predates everything. Where a chain
  works around the missing `.finally()`, `try`/`finally` is the tidier landing
  and is allowed.
- **A `new Promise` wrapping a callback API stays.** IndexedDB is
  request/`onsuccess`, not a promise — there is nothing to await until something
  wraps it. `src/data/store.ts` is the case. Convert the consumers, not the
  wrapper.
- `await` inside a loop serialises what a chain may have run at once. Where the
  existing code starts several requests and joins them, it stays
  `await Promise.all([...])` — **this app talks to a server the user does not
  own, so the request count and ordering must not change.**
- No behaviour change at all. Same requests, same order, same error paths, same
  cache keys. This is a readability refactor and nothing else.

## Definition of done
- [x] Every `.then(` in the declared files is gone, except any deliberately
      kept — and each of those is named in the task file with its reason
- [x] No `.catch(` left where `try`/`catch` says it better
- [x] Any two-argument `.then(onOk, onErr)` converted without widening what is
      caught, or named in the task file if the shape changed
- [x] `npm run build` then `grep -c "await \|async function" build/assets/*.js`
      is **0** — the downlevel still happens and nothing raw reaches the panel
- [x] `npm run verify` green, at no fewer smoke steps than `main` scores
- [x] the gate passes (`npx crew gate <this file>`)
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## Approach
1. `src/data/cached.ts` and `src/data/store.ts` first — they are the floor the
   others sit on. **`store.ts`'s two `new Promise` wrappers around IndexedDB
   stay**; they are what makes the rest awaitable. Convert its one `.then` and
   its callers, not the wrappers.
2. `src/data/art.ts` — the TMDB queue. It has a concurrency limit (`pump`,
   `MAX_IN_FLIGHT`) and `await` inside its loop would serialise it. Keep the
   queue's shape; convert the bodies.
3. `src/data/merge.ts` — the streaming merge behind the All row. The most
   delicate: it walks two servers' pages as you scroll, and CLAUDE.md is
   explicit that it must not full-crawl. Request count is the thing to preserve.
4. `src/data/devices.ts` — whose viewing is this, and the Continue watching
   filter.

## Out of scope
- `src/data/discovery.ts`, `shows.ts`, `meta.ts` — task 033, running beside this
  one.
- `src/data/guard.ts` — task 035.
- `src/data/servers.ts` has no chains and needs no change.
- The `new Promise` wrappers in `store.ts`.

## Review rounds
- **Round 1 — PASS.** No findings. Checked the narrow catches, the `fold`/`fill`
  split's request pattern, the kept `new Promise` wrappers, the bundle grep and
  the touched-file list independently.

## What changed
- `src/data/store.ts` — `transact` is `async`, awaiting `open()` and returning
  the transaction's `new Promise`; `get` and `put` fall back to `memory` in a
  `catch`. Both `new Promise` wrappers kept, as the spec asks.
- `src/data/cached.ts` — `daily.get` and `misses.get` are `async` arrows; the
  staleness arithmetic is unchanged.
- `src/data/art.ts` — the chain splits into `lookUp` (cache hit, else TMDB) and
  an `async fetchOne` that calls `landed()` **outside** the try, so a throw in
  `landed` cannot decrement the in-flight count twice. `pump` is untouched, so
  `MAX_IN_FLIGHT` requests still run at once.
- `src/data/merge.ts` — `fetchInto` guards only the `state.fetch` call; the fold
  below it is deliberately unguarded. `fill` splits into a sync `fold` (the
  per-film walk, returning the streams that ran dry) and an `async fill` that
  awaits one `Promise.all` per round and recurses — the same shape the old
  `.then(() => fill(...))` had, so one page per dry stream per round as before.
  `advance` keeps its shared-promise identity; `walk` clears `state.busy` in a
  `finally`.
- `src/data/devices.ts` — `ensureHistory` is a whole-body `try`/`catch`, which
  is what its trailing `.catch` already was. The `open()` tail moved into an
  `async load()`, because `open` is called synchronously from the key handler
  and cannot become a promise without touching files outside `files:`.

## What the spec got wrong
- Nothing in the spec. But **`.claude/crew/project.md` still says "No
  `async`/`await`"** under Hard constraints — it was not updated alongside
  `CLAUDE.md` in `655de11`, and it is outside `files:` so this task could not
  fix it. The next worker reads it and will write `.then()` chains again.
- `await` in a `while` loop trips oxlint's `no-await-in-loop`, which is on via
  the `perf` category. The repo has zero inline lint disables and
  `.oxlintrc.json` is outside `files:`, so `merge.ts` keeps the round-recursion
  instead of a loop-with-await.

## Graph writes proposed
- **Decision:** a `new Promise` around a callback API is not a chain to be
  converted — it is the adapter that makes awaiting possible. `store.ts` keeps
  its two.
- **Pattern:** converting `.then(onOk, onErr)`, put the success-side side
  effects *after* the `try`/`catch`, not inside the `try`. `art.ts`'s `landed()`
  decrements the in-flight count; inside the try a throw there would run it
  twice and the queue would over-issue for the rest of the session.
- **Pattern:** oxlint's `no-await-in-loop` is on in this repo (`perf` category)
  and there are no inline disables anywhere, so a paged walk converts to
  `await` + recursion per round, not a `while` loop with an `await` in it.
- **Decision:** `.claude/crew/project.md` is a second copy of `CLAUDE.md`'s
  hard constraints and drifted from it within days — its async/await ban
  outlived the one in `CLAUDE.md`. Two copies of the same rule, and the one
  nobody edits is the one workers read.
