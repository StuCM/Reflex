---
id: 030
slug: the-layers-become-import-lint
status: approved
branch: crew/030-the-layers-become-import-lint
base: crew/029-delete-the-bridge
model: sonnet
env: laptop
files:
  - eslint.config.mjs
  - tools/check-layers.js
  - package.json
  - .github/workflows/verify.yml
---

# The layer rules resolve imports instead of matching text

## Goal
A file that imports across the layering fails the gate, by name, whether or not
it also mentions the thing in its text.

## Why now
Step 7's second half, and one of the three things the freeze waits on.

## Base
**Branch from `crew/029-delete-the-bridge`.** 029 removes the one genuine
`api/` → `data/` reach; running this first would mean shipping an exception for
it on day one.

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

## Approach
1. Add per-directory `no-restricted-imports` blocks to `eslint.config.mjs`, one
   per layer, each banning the layers above it by path pattern.
2. Add `no-restricted-globals` for `rules/` (`document`, `XMLHttpRequest`,
   `indexedDB`) and `api/` (`document`), replacing the text scan's half.
3. Resolve the `view/` → `screen/` import named above. Prefer moving
   `themeLabel`; if it cannot move, say why in the commit body and add the
   exception with a comment.
4. Delete `tools/check-layers.js`, the `check` script in `package.json`, and the
   "chromium 53 scan" step in `.github/workflows/verify.yml`. Check `verify`
   itself no longer references it.
5. Update CLAUDE.md's Testing section, which describes `npm run check` as the
   layer check, and its Layout section, which says the check "becomes
   `no-restricted-imports` in step 7".

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
- [ ] `tools/check-layers.js` is gone, and nothing references `npm run check`
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

## Review rounds

## Graph writes proposed
- Decision: layer boundaries are enforced by resolved imports, not a regex over
  file text. Supersedes the text scan that `tools/check-es5.js` carried since
  the js/ era.
