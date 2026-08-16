---
id: 004
slug: find-over-filter
status: building
branch: crew/004-find-over-filter
model: sonnet
env: laptop
files:
  - js/detail.js
  - dev/library.js
  - dev/make-fixture.js
  - dev/mock-plex.js
---

# Replace filter-then-index with find

## Goal

Seven places take the first match out of a list by filtering the whole list and
indexing `[0]`. Each becomes a `find()`, which is the same thing said once.
No behaviour changes.

## Why now

It is the habit that produced the line that started this: `make-fixture.js`
building an array of three paths, filtering it, and taking `[0]`, to answer a
yes/no. An agent reading these files copies what it sees, so the pattern
reproduces itself. Removing it removes the example.

## Graph context

<!-- Inlined by the orchestrator. Do not re-query. -->

- Preference **"plain readable code over clever chains"** (2026-08-16) — the
  rule this serves: plainest construct, reuse before writing, never hand a
  function straight to `filter` unless it takes one argument. Also now in
  `~/.claude/CLAUDE.md` and `crew/roles/worker.md`.

Nothing else in the graph touches these files.

## Constraints that bite here

- **`js/` is Chromium 53.** `Array.prototype.find` is Chrome 45, so it is
  safe — but `tools/check-es5.js` is a text scan and must still pass. Run
  `npm run check` and believe it over this sentence.
- `dev/` is Node-only and unconstrained.
- `js/detail.js` is the only `js/` file in the list. Do not widen into other
  `js/` files even if the same pattern is there — this list is what the
  reviewer checks scope against.

## Approach

The seven sites, from `grep -rn "\.filter(.*)\[0\]" js/ dev/`:

1. `js/detail.js:122` — `copies.filter(function (c) { return c.item === other; })[0]`
2. `dev/library.js:266` — `PROFILES.filter(...)[0]` on `p.id === item._profile`
3. `dev/make-fixture.js:29` — the `map().filter(fs.existsSync)[0]` chain. This
   one is not a mechanical swap: **`dev/smoke.js` already has `hasFixture()`
   doing exactly this job.** Prefer exporting and reusing it over writing a
   third form. If exporting from `smoke.js` is awkward, make them at least
   read identically.
4. `dev/mock-plex.js:223` — first video stream
5. `dev/mock-plex.js:227` — audio stream by id
6. `dev/mock-plex.js:229` — selected audio stream
7. `dev/mock-plex.js:499` — deck entry by ratingKey

For each: `list.filter(fn)[0]` → `list.find(fn)`. Both yield `undefined` when
nothing matches, so `|| null` and truthiness checks around them keep working —
check each call site rather than assuming.

## Out of scope

- Any other refactor in these files. No renaming, no restructuring, no
  comment rewrites beyond a line made wrong by the change.
- `.filter()` calls that genuinely want every match. Only the ones indexing
  `[0]`.
- Other `js/` files. If the pattern is there, say so in the task file and it
  becomes another task.

## Definition of done

- [ ] `grep -rn "\.filter(.*)\[0\]" js/ dev/` returns nothing
- [ ] `dev/make-fixture.js` no longer contains a second implementation of the
      fixture check — it reuses `hasFixture()` or reads identically to it
- [ ] `npm run verify` passes at the current baseline (28/28 today — check `crew/README.md`, do not hardcode it)
- [ ] `npm run check` passes, confirming `find` is acceptable to the ES5 scan
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->
