---
id: 001
slug: verify-fixture
status: done
env: laptop
branch: crew/001-verify-fixture
files:
  - package.json
  - dev/make-fixture.js
  - dev/smoke.js
---

# Make a fresh clone verify green

## Goal

`npm run verify` on a fresh clone reports a failure that is not a failure.
`dev/fixtures/` is gitignored, so there is no video; the five player steps skip
and *"no console errors and nothing left this machine"* fails on a 404 for
`/video/:/transcode/universal/start.m3u8`. With `npm run fixture` run first it
is 26/26.

The cost is not the minute it takes to fix. It is that a red baseline teaches
everyone — human or agent — to explain away failures, and the next real
regression gets explained away with it. This was observed on 2026-08-15: the
404 was read as a gap in the mock's transcode handling, which it is not.
`dev/mock-plex.js:536` serves that path perfectly well.

## Approach

Make `verify` generate the fixture if it is missing, and make the smoke test
honest when it is absent for any other reason.

1. **`dev/make-fixture.js`** — add an early exit when a `dev/fixtures/sample.*`
   already exists, so re-running is free. It currently re-records 30s
   unconditionally. Print what it found and exit 0.

2. **`package.json`** — have `verify` depend on the fixture:
   `"verify": "npm run check && npm test && npm run fixture && npm run smoke"`.
   Keep `smoke` runnable on its own; do not fold the fixture into `smoke`
   itself, or the skip path in step 3 can never be exercised.

3. **`dev/smoke.js`** — the console-error step should not fail on the missing
   fixture. If `dev/fixtures/` holds no `sample.*`, a 404 for a path under
   `/video/:/transcode/universal/start` is expected: exclude it from the
   console errors that fail the step, and say in the step's output that it was
   ignored and why. Any *other* 404 must still fail. Do not silence 404s
   generally — the point of the step is that nothing unexpected happens.

The existing skip logic for the player steps stays as it is. This is only
about the console-error step and the baseline.

## Out of scope

- The player steps' own skip mechanism.
- Anything in `js/`. This is a harness fix; the app is not at fault.
- Committing a fixture. `dev/fixtures/` stays gitignored — a 1.3MB binary in
  git to save a 30-second generation is the wrong trade.
- `tools/check-es5.js`. `dev/` is not scanned and must not start being.

## Definition of done

- On a clone with no `dev/fixtures/`, `npm run verify` is **26/26**.
- Running `npm run fixture` twice in a row does not re-record the second time.
- `npm run smoke` alone, with `dev/fixtures/` deleted, still passes — the
  console-error step reports that it ignored the expected 404, and the player
  steps skip as they do now.
- Deleting `dev/fixtures/` and introducing an unrelated 404 still fails the
  step.

## Graph context

*(Nothing retrieved: this session has no memory-graph tools. Query before
starting and fill this in — `crew-fix`, `dev-harness`, `smoke-test` are the
likely entities.)*

## Notes for the worker

`dev/` is ES2015+ and Node-only — it never ships to the TV, so `const`, arrow
functions and template literals are all fine there. `tools/package.sh` stages
only what runs. The Chromium 53 rules do not apply to this task at all; that
is unusual here, and it is why the file list is what it is.

## Review rounds

1. **PASS** (crew-reviewer). Re-ran all four Definition-of-done checks itself
   rather than taking the gate on trust. Confirmed the two judgement calls
   below: `make-fixture` exiting 0 without Playwright is right now that
   `verify` depends on it, and this branch's conditional exclusion should win
   over `origin/main`'s unconditional one at merge time.

## What changed

- `package.json` — `verify` now runs `npm run fixture` between `test` and
  `smoke`. `smoke` is untouched, so the no-fixture path stays exercisable.
- `dev/make-fixture.js` — exits 0 with a one-line report if any of
  `dev/fixtures/sample.{mp4,webm,mkv}` already exists, before Playwright is
  even loaded. Missing Playwright now also exits 0 with `SKIPPED:`, matching
  `dev/smoke.js` (see below).
- `dev/smoke.js` — the console handler counts, instead of recording, a 404
  under `/video/:/transcode/universal/start` **when no fixture is present**;
  the console-error step prints how many it ignored and why. Every other 404,
  and that same 404 with a fixture in place, still fails.

## What the spec got wrong

- **`origin/main` already carries part of step 3.** Commit 537e26a, "Excuse the
  converted stream's 404 when there is no fixture", is not in this branch —
  the branch point 87994eb predates it. It excuses the path *unconditionally*
  via a `NO_FIXTURE_404` regex, which also hides a genuine transcode 404 when a
  fixture is present. **`dev/smoke.js` will conflict on merge, and this
  branch's conditional version is the one to keep.** Steps 1 and 2 are not on
  `origin/main` at all.
- **Wiring `fixture` into `verify` regressed the no-Playwright path.**
  `dev/smoke.js` exits 0 when Playwright is absent, so `verify` was green on
  such a machine; `make-fixture` exited 1, which would have turned it red. It
  now exits 0 with the same `SKIPPED:` wording. Not in the spec, but the
  alternative is a new red baseline — the exact harm this task exists to
  prevent.
- **`scope-check.js` defaults to `origin/main`, which is not this branch's
  base.** It listed the four crew commits already on the branch as out of
  scope. Passing the branch point explicitly
  (`scope-check.js <task> 709cc1e`) gives `in scope`, 3/3 declared files.
- **Graph context was empty**, as the spec itself flagged. Nothing was
  retrieved and this session has no memory-graph access either.

## Graph writes proposed

- **Pattern — a skipped test step must be free to run.** `npm run verify`
  generating the fixture, while `npm run smoke` deliberately does not, is what
  keeps the no-fixture branch of the console-error filter reachable. Folding
  the fixture into `smoke` would make the baseline green and the skip path
  permanently untested.
- **Decision — excuse the missing-fixture 404 conditionally, not by path
  alone.** `origin/main`'s regex silences
  `/video/:/transcode/universal/start` always; gating on `hasFixture()` means a
  transcode that breaks *with* a fixture present still fails the step. Same
  green baseline, one less blind spot.
- **Pattern — sibling dev scripts should agree on how they fail.** Chaining
  `make-fixture` (exit 1 on missing Playwright) ahead of `smoke` (exit 0 on the
  same condition) would have made `verify` red on a machine where it used to be
  green. When a script joins an `&&` chain, its exit codes become the chain's.
- **Gotcha — `scope-check.js` trusts `origin/main` as the base.** On a task
  branch cut from something newer, every commit in between reads as scope
  creep. Pass the branch point.
