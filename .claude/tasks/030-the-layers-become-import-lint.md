---
id: 030
slug: the-layers-become-import-lint
status: approved
branch: crew/030-the-layers-become-import-lint
model: sonnet
env: laptop
rounds: 0
files:
  - eslint.config.mjs
  - tools/check-layers.js
  - package.json
  - .github/workflows/verify.yml
  - .claude/crew.config.json
---

# The layer rules resolve imports instead of matching text

## Goal
A file that imports across the layering fails the gate, by name, whether or not
it also mentions the thing in its text.

## Why now
Step 7's second half, and one of the three things the freeze waits on.

## Existing work
`npx crew collisions` printed nothing.

**029 has landed**, which is what unblocked this. It removed the one genuine
`api/` → `data/` reach, so no exception has to ship for it. Branch from `main`.

## Graph context
`tools/check-layers.js` is 142 lines and a regex scan — its own header says so.
It catches what a file *reaches for*, not what it *imports*: `document.` in
`rules/`, `XMLHttpRequest` outside `api/`, `indexedDB` outside `data/`. It was
cut down to these rules and repointed at `src/` when `js/` went; the syntax scan
and the `index.html` manifest check retired with the bundler.

What it cannot see is the thing that actually matters now that everything is
modules: `src/view/sidebar.ts` imports `themeLabel` from `src/screen/showpage.ts`
— a `view/` → `screen/` import, which is the layering backwards. **That import
is real and currently unflagged.** Deciding it is part of this task, not a
surprise to be worked around: either `themeLabel` moves to a lower layer
(`rules/` is the natural home — it is a pure label) or the rule carries a stated
exception. Prefer the move.

The layering, from CLAUDE.md: `core/` is the floor; `api/` makes requests;
`data/` holds; `rules/` is pure — no DOM, no request, no cache; `view/` draws
and owns no state; `screen/` owns state and keys. Imports go downward only.

`.oxlintrc.json` already has `import/no-cycle`. `eslint.config.mjs` already runs
over `src/` with per-directory blocks, which is where `no-restricted-imports`
belongs.

## Constraints that bite here
- `src/api/http.ts` is the one file whose whole job is the thing `api/` owns,
  and `src/data/store.ts` likewise for IndexedDB. The old check exempted both by
  path; the new rules must not need to.
- The DOM bans (`document` in `rules/` and `api/`) are globals, not imports —
  `no-restricted-globals`, and they must survive.
- CI runs `npm run check` as a named step. If the script goes, the workflow step
  and its name go with it.
- **`npm run check` has four callers, not one.** `package.json`'s `verify` AND
  its `deploy` script, `.github/workflows/verify.yml:31`, and
  `.claude/crew.config.json:13`'s `quickVerify` (`npm run check && npm test`).
  Miss the last and you break the crew gate itself, on every future task. All
  four are in `files:`; go and look rather than trusting this list.
- **`src/seam.ts` crosses layers on purpose and must keep working.** It imports
  `core/config`, `data/art`, `data/merge`, `screen/showpage` and `view/sidebar`
  to publish them for the smoke suite (029). It sits at the root of `src/`,
  alongside `app.ts` and `main.ts`, so per-directory blocks should not match it
  — **verify that they do not, and do not add a rule for root-level files.**
  If a rule does catch it, the seam is right and the rule is wrong.

## Approach
1. Add per-directory `no-restricted-imports` blocks to `eslint.config.mjs`, one
   per layer, each banning the layers above it by path pattern.
2. Add `no-restricted-globals` for `rules/` (`document`, `XMLHttpRequest`,
   `indexedDB`) and `api/` (`document`), replacing the text scan's half.
3. Resolve the `view/` → `screen/` import named above. Prefer moving
   `themeLabel`; if it cannot move, say why in the commit body and add the
   exception with a comment.
4. Delete `tools/check-layers.js` and the `check` script, then fix **every**
   caller listed in Constraints: `verify` and `deploy` in `package.json`, the
   step in `.github/workflows/verify.yml`, and `quickVerify` in
   `.claude/crew.config.json`. `grep -rn "npm run check" . --exclude-dir=node_modules
   --exclude-dir=.git` must come back with nothing but documentation.
5. Do **not** touch `CLAUDE.md`, `README.md` or `docs/` — the orchestrator
   applies those at close, so this task and any other can run without colliding
   on a shared document.

## Out of scope
- `import/no-cycle`, already enabled.
- The size ratchets, and splitting the screen files — task 031.
- Any layering violation other than the `view/` → `screen/` one named above. If
  the new rules surface more, **report them, do not fix them** — an unknown
  number of unrelated edits is how this task stops being reviewable.

## Definition of done
- [ ] An import across the layering fails `npm run lint:names`, named
- [ ] Proven by adding one deliberately in a scratch commit, watching it fail,
      and reverting — say so in the report
- [ ] `document` in `src/rules/` still fails
- [ ] `tools/check-layers.js` is gone, and `grep -rn "npm run check" .
      --exclude-dir=node_modules --exclude-dir=.git` returns only documentation
      lines — no `package.json`, no workflow, no `crew.config.json`
- [ ] `npx crew gate .claude/tasks/030-the-layers-become-import-lint.md` passes,
      which exercises the `quickVerify` you just changed
- [ ] `npm run lint:names` still passes on `src/seam.ts` — the deliberate
      cross-layer file
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Docs the orchestrator applies at close
<!-- Not in files: — see 029. -->

- Testing describes `npm run check` as the layer check. The script is gone; the
  layer rules are `npm run lint:names`, and the three checks become two.
- Layout says the check "is still a regex scan … and becomes
  `no-restricted-imports` in step 7". It has; say what it now is.
- If `themeLabel` moved, the `src/view/` and `src/rules/` bullets follow it.
- `README.md:114` says `deploy` runs `npm run check` first "so code Chromium 53
  cannot run never ships", and `README.md:183` describes it as scanning `js/`.
  Both are stale twice over — `js/` is gone and the syntax scan retired with the
  bundler.

## Review rounds

## Graph writes proposed
- Decision: layer boundaries are enforced by resolved imports, not a regex over
  file text. Supersedes the text scan that `tools/check-es5.js` carried since
  the js/ era.
