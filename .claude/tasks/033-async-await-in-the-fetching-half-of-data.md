---
id: 033
slug: async-await-in-the-fetching-half-of-data
status: done
branch: crew/033-async-await-in-the-fetching-half-of-data
model: sonnet
env: laptop
rounds: 1
files:
  - src/data/discovery.ts
  - src/data/shows.ts
  - src/data/meta.ts
gate: pass
gateSha: 7866678b5769dd49b7992edddeaa0f5ee46f3a40
gateAt: 2026-09-15T07:47:15.810Z
---

# The fetching half of data/ reads as async/await

## Goal
`discovery.ts`, `shows.ts` and `meta.ts` use `async`/`await` instead of `.then()`
chains. Nothing they do changes.

## Why now
Stuart, on finding `discovery.ts` still chained: *"doesn't look like it was
refactored to spec. We wanted async await in here… I would start with data, but
ultimately everything needs converting."* These three are the densest:
19 of the 34 `.then(` calls in `data/`.
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
1. `src/data/meta.ts` first — 87 lines, 4 chains, and the debounce-and-cache
   shape the other two lean on. It is the smallest honest proof of the pattern.
2. `src/data/shows.ts` — 7 chains, seasons and episodes merged across servers.
   Watch the merge: where two servers are asked at once it stays
   `await Promise.all`.
3. `src/data/discovery.ts` — 8 chains, TMDB lists turned into rows of what the
   servers actually have. This is the file Stuart named.
4. Read each converted function once more against the original for **request
   count and order**. That is the property this task must not break.

## Out of scope
- Every other file in `data/` — tasks 034 and 035 own those, running beside
  this one.
- `src/api/`, `src/screen/`, `src/view/`: later, once `data/` shows the shape.
- Any change to what these functions return, cache, or ask for.

## Review rounds
- **Round 1 — PASS.** Verified independently rather than from the notes: build
  grep 0, verify 104/104, both narrow catches reproduced, `_asking` still
  assigned synchronously, `Promise.all` still parallel and `load` still
  sequential. No findings.

## What changed
- `src/data/meta.ts` — `load` is `async` with one `try`/`catch` around the whole
  fetch; `hit ?? (await metadata(...))` keeps the cache short-circuit and the
  write-back still fires only on a miss. `schedule` passes an `async` callback to
  `setTimeout` instead of `void load(...).then(...)`.
- `src/data/shows.ts` — `childrenOf`, `resolve` and `nextAfter` are `async`;
  both `Promise.all` joins stay as they were, and `nextAfter`'s four-deep nest
  flattens to straight-line guards.
- `src/data/discovery.ts` — `askServers` and `one` are `async`; `resolve` splits
  into the synchronous re-entrancy guard plus `ask`, so `item._asking` is still
  assigned before the first `await` returns.

## Notes for the spec
- **The suggested grep misses both two-argument sites.** `grep -n "then(.*,.*=>"`
  is single-line and oxfmt has wrapped every such call across lines. Both live in
  `discovery.ts` (`resolve`, `one`); `grep -n "^\s*(error" ` or reading the
  `.then(` bodies is what finds them. Neither widened: the `try` covers only the
  fetch stage and the `catch` returns, so `settle` and `context.add` still run
  unprotected exactly as they did under `.then(onOk, onErr)`.
- **`for...of` with `await` does not survive lint.** oxlint's `no-await-in-loop`
  is on through the `perf` category, and `.oxlintrc.json` is outside `files:`, so
  `discovery.load` keeps the original recursive `step` — sequential, which is the
  property that matters, and no suppression comment (the repo has none anywhere).
- **One `.catch(` is deliberately kept**: the per-server
  `findByGuid(...).catch(() => null)` inside `Promise.all` in `askServers`. It is
  a per-promise fallback, not an error path — `try`/`catch` there would mean a
  wrapper `async` function per server to say the same thing.
- `.claude/crew/project.md` still lists "No `async`/`await`" as a hard
  constraint. `CLAUDE.md` was corrected in `655de11`; project.md was not, and it
  is the file the worker role is told to read second. Worth a one-line fix
  outside this task's scope.

## Graph writes proposed
- **Pattern:** the two-argument `.then(onOk, onErr)` does not become
  `try`/`catch` without widening the catch. Named here because this conversion
  is about to be repeated across the tree. The landing that works: `try` around
  the fetch only, `catch` returns early, and the publish step sits *after* the
  `catch` block rather than inside the `try`.
- **Gotcha:** oxlint's `no-await-in-loop` (perf category) rejects the obvious
  `for...of` + `await` conversion of a deliberately sequential chain. Where the
  serialisation is the point — requests to a server we do not own — the
  recursive `step` shape passes without a suppression.
- **Decision:** `resolve` in `discovery.ts` stays a synchronous function
  assigning `item._asking = ask(item)`. An `async resolve` cannot assign its own
  promise to the entry, and that assignment *is* the re-entrancy guard.
