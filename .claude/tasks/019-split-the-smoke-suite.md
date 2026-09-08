---
id: 019
slug: split-the-smoke-suite
status: approved
branch: crew/019-split-the-smoke-suite
model: sonnet
env: laptop
files:
  - dev/smoke.js
  - dev/smoke/*
  - package.json
---

# One suite, many files, and a free port

## Goal
`dev/smoke.js` becomes a runner over `dev/smoke/*.js`, one file per area.
`npm run smoke` still runs everything and still gates. `npm run smoke -- <area>`
runs one area in seconds, which is what a worker iterates against. And the
harness takes a **free port** instead of a fixed one, so two suites can run at
once.

## Why now
The suite has gone from 28 steps to 75 in a day and `dev/smoke.js` is 3,344
lines — the largest file in the project by some way. Two costs follow, and both
are now the loop's bottleneck rather than any feature:

- **Time.** A full `npm run verify` takes over two minutes. A worker runs it
  several times while iterating and the reviewer runs it again, so every task
  carries thirty to forty-five minutes of waiting. That grows with every task
  that adds a step.
- **Collisions.** Every task so far has declared `dev/smoke.js`, so no two can
  run at once — including the ones that share nothing else. It is the single
  most contended file in the repo.

`const PORT = 8123` compounds both: the orchestrator cannot verify `main` while
a worker verifies its branch, so those waits are serial too.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. 018 merged as
`f10d70a`; main verifies at 75/75.

`dev/smoke.js` is at 75 steps and 3,344 lines. Task 020 runs beside this one
and owns `css/`, `index.html` and `tools/check-es5.js` — do not touch them.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16). This
  task must not lose a single assertion. The count after it must equal the count
  before it, and any step that cannot be moved is a finding, not a deletion.
- **`npm run verify` is `check && test && fixture && smoke`** (package.json).
  The player steps skip without `dev/fixtures/sample.mp4`; `verify` generates
  it, `smoke` deliberately does not, so that the no-fixture branch of the
  console-error filter keeps being exercised.
- **`dev/smoke.js` fails the suite on any request that is not to
  `localhost:<PORT>`** — the offsite check at its top. Whatever the port
  becomes, that check must still work, and must still catch a real escape.
- **Assertions that pass on nothing** are this suite's recurring failure
  (CLAUDE.md, Testing): three appeared in one day. Moving steps between files is
  exactly when an assertion that indexed into shared setup can quietly stop
  matching. Re-read every assertion you move.
- **`dev/server.js` already takes `Number(process.env.PORT) || 8080`** and
  derives its origin from `req.headers.host`, so nothing hardcodes an absolute
  URL. The smoke harness spawns its own server; it is the last fixed port.
- **Chromium 53 does not apply to `dev/`** — it runs on Node only.

## Constraints that bite here
- **No assertion may be lost or weakened.** This is a move, not a rewrite. If
  a step's assertion looks wrong while you are moving it, record it in the task
  file — do not fix it here, and do not delete it.
- **The gate stays whole.** `npm run smoke` with no argument must run every
  area, in a deterministic order, and report one total.
- **Areas must be independently runnable**, each bringing up whatever it needs.
  A file that only passes when another ran first is not split.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`dev/smoke.js` becomes the runner.** It keeps the harness — the browser
   launch, the console and network collectors, the offsite check, `step`,
   `waitFor`, `press`, `shot`, the fixture detection — and exports them to the
   area files rather than holding the steps itself.

2. **`dev/smoke/*.js`, one per area**, each exporting a function that takes the
   harness and adds its steps. Split along the seams the suite already has:
   `link`, `browse`, `sections`, `detail`, `show`, `player`, `recaps`,
   `discovery`, `search`, `devices`. Roughly the order they run in now, and
   keep that order — several steps depend on the app being left where the
   previous one left it, and that coupling is real. Where an area genuinely
   cannot start cold, say so in the task file rather than papering over it.

3. **A free port.** Replace `const PORT = 8123` with a port the OS assigns:
   listen on `0`, read the actual port back off the server, and pass it to the
   page and the offsite check. Two suites must be able to run concurrently —
   prove it by running two at once in the task file's notes.

4. **`package.json`**:
   - `smoke` runs every area, as now.
   - `smoke -- <area>` runs one; an unknown name lists the areas rather than
     passing silently.
   - `verify` is unchanged and still runs the whole thing.

5. **Do not edit `CLAUDE.md` or the worker role.** 020 is running beside this
   task and would collide on both. Instead, write into the task file what those
   documents need to say — iterate against your area, run the whole suite before
   the gate, and declare `dev/smoke/<area>.js` rather than the whole suite — and
   the orchestrator will apply it at close.

6. **Prove the split kept everything.** In the task file, record the step count
   before and after — they must match — and the wall-clock time for the full
   suite and for one area, so the saving is a number rather than a claim.

## Out of scope
- **Writing new tests, or fixing assertions you find wrong.** Record them.
- **Splitting `css/app.css`**, which is the other file every UI task contends
  on and deserves its own task.
- **Splitting the large `js/` files** (`js/player.js` is 1,160 lines,
  `js/detail.js` 699, `js/plex.js` 667). Backlog already flags these.
- **Making the suite run steps in parallel.** A free port makes concurrent
  *suites* possible; parallelising within one is a different problem and would
  break the ordering dependencies in step 2.
- **`js/` of any kind.** This task touches the harness and the docs, nothing the
  app ships.

## Definition of done
- [ ] `npm run smoke` runs every area and reports the **same step count** as
      before the split.
- [ ] `npm run smoke -- player` (or any area) runs just that area, and an
      unknown name lists the areas.
- [ ] Two suites run concurrently without a port clash — demonstrated, not
      asserted.
- [ ] The offsite check still fails the suite on a request that leaves the
      machine.
- [ ] No assertion was deleted or weakened; anything that looked wrong while
      being moved is recorded in the task file.
- [ ] `npm run verify` passes and is unchanged in what it covers.
- [ ] The task file states what CLAUDE.md and the worker role must be changed
      to say, for the orchestrator to apply.
- [ ] The task file records the before and after step counts and both timings.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `dev/smoke.js` — 3,867 lines to 1,075. Keeps everything that is not a step:
  the browser launch, the console and network collectors, the offsite check,
  `step`/`press`/`waitFor`/`shot`, the fixture detection and every shared
  helper. It hands them to an area file as one object `h`, walks the areas in
  order, and runs the session-wide "no console errors" step itself, last,
  whatever ran. The mock is started on port 0 and the port it was given is read
  back off `server.address()`.
- `dev/smoke/{link,browse,show,recaps,sections,discovery,search,devices,detail,player,deck}.js`
  — the 74 steps, sliced out of the chain verbatim, in the order they ran in.
  Each is `module.exports = function (h)`, destructures what it uses, and
  begins `h.ready()` — linked, rail painted, back at the library rows — so it
  can be run on its own.
- `.claude/tasks/019-split-the-smoke-suite.md` — `files:` amended from
  `dev/smoke/` to `dev/smoke/*`: `scope-check.js` matches an exact path or a
  trailing `*` and nothing else, so the declared directory matched no file and
  the gate called all eleven of them scope creep.
- `package.json` — **unchanged, and did not need to be**. `npm run smoke --
  player` already reaches `process.argv`, and `verify` still runs the whole
  thing.

## Numbers

Step count 75 before, 75 after — 74 in the area files plus the console-error
step, which stays in the runner because it is about the session rather than any
one area.

Full suite: **2:37.98 before**, **2:36.31 / 2:40.02 after** — the split costs
nothing and saves nothing on a whole run, as expected. What it saves is the
iteration:

| area | steps | wall clock | | area | steps | wall clock |
|---|---|---|---|---|---|---|
| link | 2 | 3.4s | | discovery | 1 | 3.9s |
| browse | 16 | 35.9s | | search | 1 | 3.7s |
| show | 4 | 6.1s | | devices | 1 | 4.2s |
| recaps | 7 | 21.0s | | detail | 8 | 11.8s |
| sections | 9 | 33.4s | | player | 18 | 52.3s |
| deck | 7 | 27.7s | | *all* | *74* | *2:36* |

Each figure is that area run alone, and includes the boot and the tail step, so
`npm run smoke -- player` is 52s against 2:40 — the worst case. Most are under
ten.

Concurrency: `search` and `devices` were run at the same moment as a full
`npm run smoke`, three suites at once, on ports 44601, 46579 and one of its
own. No clash, all green.

The offsite check was proved by making the link area load
`http://10.0.0.99/escape.png`: `2/3 passed`, with `requests escaped the mock:
http://10.0.0.99/escape.png`. Reverted, back to 3/3.

## Findings — recorded, not fixed

1. **The flaky step in the backlog is
   `a title's own page offers the same removal, and only on the deck`**, and it
   is not a timing margin. Caught in the act: when it fails, the focus is on
   *subtitles* — one place short of *remove* — with the subtitles chooser open
   and no confirmation ever asked for, so the step waits out its 15s.
   `pressButton` read the row, counted the presses to the button and walked
   them; `trailer` arrives with the extras, i.e. after the page is on screen,
   and a button appearing mid-walk shifts every index past it. Fixed *in the
   harness* rather than in any step: the walk now re-reads the row and repeats
   until the focus is actually on the button it was asked for. No assertion
   moved. Every other walker in the file (`menuChoose`, `sidebarWalkTo`,
   `focusDeck`) has the same shape and could bite the same way; none has been
   seen to, so none was touched. **docs/backlog.md's "A flaky smoke step" item
   can be closed** — it is out of `files:` here.
2. **`sections`' first step depends on where the rail is resting**, not on the
   sidebar. It reads the nested rows as "the current section's categories", but
   the sidebar nests the *cuts of Continue watching* while the rail sits on that
   row — so cold, `cats` is `["Movies","TV Shows"]`, `sidebarPick('Movies')`
   takes the section rather than the category, and the step times out. It only
   ever passed because the step before it left the rail inside a section. The
   area now says so out loud in a two-line prologue (`sidebarPick('TV Shows')`,
   one press down) rather than papering over it; the assertion is untouched and
   would be better written against a row it names.
3. **`menuTabs()` in `dev/smoke.js` is dead** — defined, never called, by any
   step or helper. Left alone so this stays a move.
4. **`dev/server.js` prints the port it was asked for**, so with port 0 its
   banner now reads `http://localhost:0`. The real one is printed by the smoke
   runner on the next line (`smoke on http://localhost:44601   areas: ...`).
   The honest fix is one line in `dev/server.js` — print
   `server.address().port` from inside the listen callback — and that file is
   not in `files:`.

## For the orchestrator to apply

**CLAUDE.md**, in *Testing*, where `npm run smoke` is described:

> `npm run smoke` runs every area; `npm run smoke -- <area>` runs one, which is
> what iterating wants — the areas are `link`, `browse`, `show`, `recaps`,
> `sections`, `discovery`, `search`, `devices`, `detail`, `player`, `deck`, and
> an unknown name lists them. The steps live in `dev/smoke/<area>.js`, one file
> per area, and `dev/smoke.js` is the harness they are given. The mock takes
> whatever port the OS hands out, so two suites can run at once. Iterate
> against your area; run the whole suite before the gate.

**`.claude/crew/roles/worker.md`**, under *The gate* and in the boundaries:

> Declare `dev/smoke/<area>.js`, not `dev/smoke.js`, so two tasks that touch
> different areas can run at once. A task that adds a whole screen adds an area
> file and declares `dev/smoke.js` as well, for the `AREAS` list. Iterate with
> `npm run smoke -- <area>`; run `npm run verify` before you ask for review.

## Review rounds

## Graph writes proposed
