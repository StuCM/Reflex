---
id: 029
slug: delete-the-bridge
status: approved
branch: crew/029-delete-the-bridge
model: sonnet
env: laptop
rounds: 0
files:
  - src/api/youtube.ts
  - src/data/cached.ts
  - src/legacy.ts
  - src/seam.ts
  - src/main.ts
  - types/legacy.d.ts
  - types/seam.d.ts
  - eslint.config.mjs
  - dev/smoke/browse.js
  - dev/smoke/show.js
  - dev/smoke/sections.js
  - dev/smoke/recaps.js
---

# The migration bridge becomes a named test seam

## Goal
`src/legacy.ts` stops being a migration bridge publishing twenty-nine globals
and becomes `src/seam.ts`, publishing exactly the five the smoke suite reads —
named, typed, and documented as a test seam. Nothing in `src/` reaches for a
global any more; step 7 of the refactor is finished.

## Why now
Section 0 item 1 of `docs/backlog.md`, and the last thing between the project
and the end of the feature freeze.

## Existing work
`npx crew collisions` printed nothing.

But **this task has already been attempted** and is the reason for this respec.
Branch `crew/029-delete-the-bridge` holds one commit, `b9eeca1
refactor(api): memoise the youtube channel id in memory`, branched from `main`
at `7f99a76`. That commit is **good and should be kept** — start from it rather
than from `main`, and do not redo it. It contains:

- `src/api/youtube.ts` — `channelId()` memoises a module-level `Promise<string>`
  instead of round-tripping `Cached.ytChannel`, cleared on rejection.
- `src/data/cached.ts` — `ytChannel` deleted.
- `src/legacy.ts`, `types/legacy.d.ts` — deleted.
- `src/main.ts` — reduced to one `import './app';`.

It scored 82/94 on smoke, which is what this respec exists to fix. Rebase it
onto current `main` first (`main` has since gained 026, 028 and the crew
package; `npm run smoke` on `main` is **96/96**, which is your baseline).

## Graph context
`npx crew graph` reports the memory-graph CLI is not on PATH, so this section is
written from `docs/decisions.md`, `CLAUDE.md` and the previous attempt.

**The trap that blocked the last attempt, stated plainly so nobody pays for it
twice.** `src/legacy.ts` reads as dead the moment you grep `src/` for its
globals and get nothing back. It is not dead. The smoke suite reads five of them
**page-side**, from inside `page.evaluate` strings and a page-side `keydown`
listener, where no import reaches, no type checker looks and no grep over `src/`
can see them. The previous attempt deleted the file on that evidence and took
twelve smoke steps down with it. **The consumers of a global are not only the
modules that import it.**

**Why a seam and not a rewrite of the assertions.** Rewriting the five call
sites to assert on rendered DOM was considered and rejected by the user.
`dev/smoke/browse.js` classifies a tile as blank / **fresh** / **stale** by
recomputing the expected URL with `Art.tile(t._item, …)` and comparing it to the
`src` actually on the element. Without that call the step can only tell blank
from non-blank — losing exactly the stale-picture distinction task 021 exists to
catch and 027's review round strengthened. The seam keeps every assertion at
full strength, and the five names on `window` are a price already being paid
today.

**Chromium 53 and the build.** A `import.meta.env.DEV` guard was considered and
rejected: `npm run smoke:built` runs the production bundle, where that flag is
false, so the five steps would fail there. The seam is unconditional.

## Constraints that bite here
- The seam is loaded for its side effect, so `.oxlintrc.json:82`'s
  `import/no-unassigned-import` override still applies. Its comment mentions
  legacy modules and is now stale — **leave the comment alone**, it is outside
  `files:`.
- `types/seam.d.ts` is ambient by necessity, exactly as `types/legacy.d.ts` was.
  `CLAUDE.md` says ambient `.d.ts` is invisible to the import graph; that is
  accepted here because the consumer is a `page.evaluate` string, not a module.
- `dev/smoke/*.js` runs in Chromium and uses `var` and `function` deliberately.
  Match the file.

## Approach
1. **Rebase `b9eeca1` onto current `main`.** Keep it. Everything below is on top.

2. **Add `src/seam.ts`.** It imports the five modules the suite reads and
   assigns them to `window`, and its one comment says what it is for — that
   deleting a name here breaks a smoke step that no type checker will warn
   about. Publish exactly these five, no more:

   | name | what the suite does with it | call site |
   |---|---|---|
   | `Art` | `Art.tile(item, 209, 314)` | `dev/smoke/browse.js:62` |
   | `Merge` | `Merge.sources(item)` | `dev/smoke/browse.js:878` |
   | `ShowPage` | `ShowPage.current()` | `dev/smoke/show.js:66` |
   | `Sidebar` | `Sidebar.open(sections, cb, 'library')` | `dev/smoke/sections.js:431` |
   | `Config` | reads **and writes** `Config.youtubeKey` | `dev/smoke/recaps.js:36,37,51` |

   `Config` must stay writable — the recaps step sets `youtubeKey` to `''` and
   restores it, which is how it proves `enabled()` reads the key at call time.

3. **Add `types/seam.d.ts`** declaring those five on `Window`, replacing
   `types/legacy.d.ts`.

4. **`src/main.ts` imports `./seam`** alongside `./app`.

5. **Drop `Youtube._key` from `dev/smoke/recaps.js`.** It is not an app global
   at all — the suite is using it as scratch storage to stash the key across two
   `page.evaluate` calls, and it only ever worked because the bridge published
   `Youtube`. Return the key to node instead and pass it back in:
   `page.evaluate(() => Config.youtubeKey)` then
   `page.evaluate((k) => { Config.youtubeKey = k; }, key)`. The seam publishes no
   `Youtube` and must not gain one.

6. **Leave the other four call sites as they are.** `Art`, `Merge`, `ShowPage`
   and `Sidebar` are on the seam under the same names, so `browse.js`,
   `show.js` and `sections.js` need no edit. They are declared in `files:` only
   so that step 5's sibling edits and any fallout are in scope — **if you do not
   need to touch a file, do not touch it.**

7. **Delete the dead `files: ['src/legacy.ts']` override** at
   `eslint.config.mjs:114-120`. It turned off `naming-convention` for the
   bridge. Judge whether `src/seam.ts` needs the same exemption — it assigns
   capitalised names to `window` — and if it does, repoint the override rather
   than adding a second one.

## Out of scope
- Rewriting any assertion to read the DOM instead of the seam. That was
  considered and rejected; see Graph context.
- `.oxlintrc.json` — including its stale comment.
- Adding anything to the seam beyond the five names above. If a sixth turns out
  to be needed, that is a finding for the task file, not a quiet addition.
- Touching `CLAUDE.md` or `docs/` — the orchestrator applies those at close.
- Any change to what the five app modules themselves do.

## Docs the orchestrator applies at close
- `CLAUDE.md` "Layout": `src/legacy.ts` and the bridge are gone; `src/seam.ts`
  publishes five names for the smoke suite and is the only global surface left.
- `docs/backlog.md` section 0 item 1: done.

## Definition of done
- [ ] `ls src/legacy.ts types/legacy.d.ts` reports both missing
- [ ] `grep -rn "Cached\." src/` returns nothing
- [ ] `src/seam.ts` publishes exactly five names; `grep -c "window\." src/seam.ts`
      is 5
- [ ] `grep -rn "Youtube\._key" dev/` returns nothing
- [ ] `npm run smoke` scores **96/96** — the same as `main`, with no step
      removed, skipped or weakened to get there
- [ ] the five steps the last attempt broke pass by name: `a moving rail fetches
      only what has the focus, and fills in when it stops`, `a film in two of one
      server's libraries keeps both copies`, `a series with a theme plays it,
      quietly and looping`, `the last sidebar entry can be reached and is on
      screen`, `no recaps strip at all without a YouTube key`
- [ ] the gate passes (`npx crew gate .claude/tasks/029-delete-the-bridge.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
- **Pattern:** *a global's consumers are not only the modules that import it.*
  `src/legacy.ts` greps clean across `src/` and is still load-bearing: five
  `dev/smoke/*.js` files reach for its names from inside `page.evaluate`, where
  no import reaches and no type checker looks. Before deleting any global,
  grep `dev/` and any string-evaluated code as well as the module tree. Cost the
  029 attempt a full session and twelve smoke steps.
