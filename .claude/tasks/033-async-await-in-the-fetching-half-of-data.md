---
id: 033
slug: async-await-in-the-fetching-half-of-data
status: building
branch: crew/033-async-await-in-the-fetching-half-of-data
model: sonnet
env: laptop
rounds: 0
files:
  - src/data/discovery.ts
  - src/data/shows.ts
  - src/data/meta.ts
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
- [ ] Every `.then(` in the declared files is gone, except any deliberately
      kept — and each of those is named in the task file with its reason
- [ ] No `.catch(` left where `try`/`catch` says it better
- [ ] Any two-argument `.then(onOk, onErr)` converted without widening what is
      caught, or named in the task file if the shape changed
- [ ] `npm run build` then `grep -c "await \|async function" build/assets/*.js`
      is **0** — the downlevel still happens and nothing raw reaches the panel
- [ ] `npm run verify` green, at no fewer smoke steps than `main` scores
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

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

## Graph writes proposed
- **Pattern:** the two-argument `.then(onOk, onErr)` does not become
  `try`/`catch` without widening the catch. Named here because this conversion
  is about to be repeated across the tree.
