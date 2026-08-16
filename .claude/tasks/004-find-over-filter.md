---
id: 004
slug: find-over-filter
status: blocked
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

## What changed

- `js/detail.js` — the copy for a newly found version is taken with `find`.
- `dev/library.js` — the profile for an item is taken with `find`.
- `dev/mock-plex.js` — four sites: video stream, audio by id, selected audio,
  deck entry (at line 539, not 499 as the spec says).
- `dev/make-fixture.js` — the fixture check now reads as `hasFixture()` in
  `dev/smoke.js` does: same name list, same `fs.existsSync(path.join(...))`
  body. `find` rather than `some` because the matched filename is needed for
  the "already present" message. Not `.find(fs.existsSync)` — that is the
  one-argument trap.

Gate: scope-check in scope, `npm run verify` 28/28, `npm run check` clean.

## What the spec got wrong

There are **eight** sites, not seven. `dev/smoke.js:1037` —
`after.filter(function (l) { return /decision:/.test(l); })[0]` — was there
before this task and the Approach section missed it.

That makes the Definition of done self-contradictory: item 1 wants the grep to
return nothing, item 5 forbids touching a file outside `files:`, and
`dev/smoke.js` is not in `files:`. The same boundary is what makes exporting
`hasFixture()` "awkward" in item 3.

Left `dev/smoke.js` untouched — "touch only the paths in `files:`" is the
harder rule — so the DoD grep still returns that one line. Needs a human
decision: either add `dev/smoke.js` to `files:` (it is a `dev/` file, and the
Out of scope section only fences off other `js/` files) and convert the eighth
site, or drop it to a follow-up task and amend DoD item 1.

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

### Round 1 — BLOCKED

Reviewer found the seven declared conversions correct and behaviour-preserving,
the `make-fixture.js` fallback acceptable, and the gate green — but blocked on
the DoD contradiction above rather than on the diff. Confirmed the eighth site
exists at `origin/main`, so the spec undercounted at authoring time.

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->

- **Pattern — "a spec that enumerates grep hits pins the count, not the
  query"**: the DoD ran the grep again while the Approach listed a fixed seven.
  When the two disagree the worker cannot satisfy both without leaving scope. A
  spec should either list the sites *or* assert the grep, not both.
