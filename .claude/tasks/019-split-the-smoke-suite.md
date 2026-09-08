---
id: 019
slug: split-the-smoke-suite
status: draft
branch: crew/019-split-the-smoke-suite
model: sonnet
env: laptop
files:
  - dev/smoke.js
  - dev/smoke/
  - package.json
  - .claude/crew/roles/worker.md
  - CLAUDE.md
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
<!-- filled in by preflight before dispatch -->

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

5. **`CLAUDE.md` and `.claude/crew/roles/worker.md`** — tell workers the new
   shape: iterate against your area, and run the whole suite before the gate.
   Note that a task now declares `dev/smoke/<area>.js` in `files:` rather than
   the whole suite, which is what lets two UI tasks run at once.

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
- [ ] CLAUDE.md and the worker role say how to run one area and that tasks now
      declare a single area file.
- [ ] The task file records the before and after step counts and both timings.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
