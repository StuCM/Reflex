---
id: 001
slug: verify-fixture
status: draft
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

*(none yet)*

## Graph writes proposed

*(worker fills this in)*
