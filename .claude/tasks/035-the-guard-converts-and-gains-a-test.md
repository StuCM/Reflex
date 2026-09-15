---
id: 035
slug: the-guard-converts-and-gains-a-test
status: draft
branch: crew/035-the-guard-converts-and-gains-a-test
model: opus
env: laptop
rounds: 0
files:
  - src/data/guard.ts
  - test/guard.test.ts
---

# The guard reads as async/await, and is finally tested

## Goal
`src/data/guard.ts` uses `async`/`await`, and gains the unit test it has never
had.

## Why now
The last file in `data/` still chained — and the one CLAUDE.md calls **"the most
important logic in the app"**, which "has no unit test", adding that *"if you
touch it, adding one is in scope by default"*. This task touches it, so the test
comes with it.

**Model is `opus`, not `sonnet`.** Everything that reaches the player goes
through this file, and CLAUDE.md reserves that model for the code that must not
be wrong.
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
1. **Write the test first, against the code as it stands.** A conversion with no
   test is a refactor you cannot prove, and writing the test afterwards means
   writing it against the code you just changed — which proves nothing. Get it
   green on the current `.then()` version, commit that, then convert.
2. The test must cover the rules CLAUDE.md names as the ones that must not be
   wrong: 4K must direct play or be refused; below 4K a transcode is allowed;
   a commentary track is never selected; TrueHD and DTS-HD MA never pass ARC;
   a quality cap on a 4K file is refused by the ordinary rule.
3. Convert the two chains. `guard.check` is the entry point everything else
   calls.
4. Re-run the test. It must pass **unchanged** — if the conversion needs the
   test edited, the conversion changed behaviour.

## Out of scope
- `src/rules/media.ts` — already pure and unit tested; the guard calls it.
- Every other file in `data/` — tasks 033 and 034.
- Any change to what the guard decides. If a test written in step 1 shows the
  guard doing something surprising, **report it, do not fix it** — a behaviour
  change hidden inside a conversion is exactly what this task must not produce.

## Definition of done — additional
- [ ] `test/guard.test.ts` exists, and was green against the **unconverted**
      guard first, in its own commit
- [ ] The same test passes unchanged after the conversion
- [ ] The five rules in Approach step 2 each have a case

## Review rounds

## Graph writes proposed
- **Pattern:** convert-with-a-test means the test lands first, against the old
  code, in its own commit. A test written after a refactor tests the refactor,
  not the behaviour it was meant to preserve.
