---
id: 030
slug: the-layers-become-import-lint
status: done
branch: crew/030-the-layers-become-import-lint
model: sonnet
env: laptop
rounds: 1
supersedes-round: blocked-2026-09-13
files:
  - eslint.config.mjs
  - tools/check-layers.js
  - package.json
  - .github/workflows/verify.yml
  - .claude/crew.config.json
  - docs/layering-debt.md
gate: pass
gateSha: c2f6d2422823a32b3c3bebe2defa7c759318e068
gateAt: 2026-09-13T18:59:05.250Z
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

What it cannot see is every import that crosses the layering the wrong way, and
**there are at least fifteen of them across eleven files** — not the one this
spec originally claimed. That error is why the first attempt was blocked, and
the correction is the reason for this revision.

**Do not trust any inventory, including the two in this file.** The blocked
round below lists fourteen; the orchestrator's own enumeration found fifteen,
catching `view/` → `api/` in `masthead.ts` and `rail.ts` and `view/` → `data/`
in `sidebar.ts` that the first list missed, and disagreeing about whether
`data/` → `rules/` counts at all. Two careful passes produced two different
answers, which is the whole argument for replacing a hand-maintained list with a
rule. **Write the rules first, run them, and let the failures produce the
list.**

The one worth knowing about in advance: `src/rules/rows.ts:4` imports
`../data/merge` and calls `merge.stream()` and `merge.items()` at lines 19, 27
and 41. `rules/` is the layer CLAUDE.md calls pure — "no DOM, no request, no
cache, which is what makes it the half worth unit testing" — so that sentence is
currently false. The old text scan missed it because it looked for `indexedDB`
rather than for the import.

The layering, from CLAUDE.md: `core/` is the floor; `api/` makes requests;
`data/` holds; `rules/` is pure — no DOM, no request, no cache; `view/` draws
and owns no state; `screen/` owns state and keys. Imports go downward only.

`.oxlintrc.json` already has `import/no-cycle`. `eslint.config.mjs` already runs
over `src/` with per-directory blocks, which is where `no-restricted-imports`
belongs.

## Constraints that bite here
- `src/api/http.ts` is the one file whose whole job is the thing `api/` owns,
  and `src/data/store.ts` likewise for IndexedDB. The old check exempted both by
  path. **The earlier version of this spec said the new rules "must not need"
  path exemptions. That was wrong and is withdrawn** — see Approach: this ships
  as a ratchet, and the exemptions are the point.
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
**This ships as a ratchet, not an invariant.** Stuart's call, taken after the
first attempt surfaced the real count: the rules go in now and block anything
new, today's crossings are written down as named exceptions, and removing them
is booked as separate work. This is how the project already treats `max-lines`,
and it is what lets the freeze lift tonight instead of after an eleven-file
refactor.

1. Add per-directory `no-restricted-imports` blocks to `eslint.config.mjs`, one
   per layer, each banning the layers above it by path pattern. The layering,
   from CLAUDE.md: `core/` is the floor; `rules/` is pure and may import nothing
   but `core/`; `api/` makes requests; `data/` holds and may use `api/` and
   `rules/`; `view/` draws and may use `rules/`; `screen/` owns state and may use
   everything. `src/app.ts`, `src/main.ts` and `src/seam.ts` sit at the root of
   `src/`, in no layer — the blocks must not match them.

2. Add `no-restricted-globals` for `rules/` (`document`, `XMLHttpRequest`,
   `indexedDB`) and `api/` (`document`), replacing the text scan's other half.

3. **Run the rules and let them produce the failure list.** That list, not
   either table in this file, is the truth.

4. Record every failure as an **individual** exception in `eslint.config.mjs` —
   one entry per file-and-target, each with the importing file, the target, and
   what it pulls. Never a blanket `rules: {...: 'off'}` over a directory: the
   point is that adding a sixteenth crossing shows up as a visible diff on a
   list, not as silence. If eslint's own config shape makes per-import
   exceptions impractical, the fallback is one narrowly-scoped `files:` override
   per importing file, still one per file, still commented.

5. Write `docs/layering-debt.md`: the exception list as prose, one line each,
   grouped by pair, with the note that `rules/rows.ts` → `data/merge` is the one
   that contradicts a documented invariant and should go first. This is the
   register the follow-up tasks get written from.

6. Prove the ratchet bites: add a *new* crossing in a scratch commit — an import
   that is not on the exception list — watch `npm run lint:names` fail and name
   it, then revert. Say so in the report. An exception list that would also
   swallow new violations is worth nothing.

7. Delete `tools/check-layers.js` and the `check` script, then fix **every**
   caller listed in Constraints: `verify` and `deploy` in `package.json`, the
   step in `.github/workflows/verify.yml`, and `quickVerify` in
   `.claude/crew.config.json`. `grep -rn "npm run check" . --exclude-dir=node_modules
   --exclude-dir=.git` must come back with nothing but documentation.

8. Do **not** touch `CLAUDE.md`, `README.md` or `docs/` other than the new
   `docs/layering-debt.md` — the orchestrator applies the rest at close.

## Out of scope
- `import/no-cycle`, already enabled.
- The size ratchets, and splitting the screen files — task 031.
- Any layering violation other than the `view/` → `screen/` one named above. If
  the new rules surface more, **report them, do not fix them** — an unknown
  number of unrelated edits is how this task stops being reviewable.

## Definition of done
- [x] A **new** import across the layering — one not on the exception list —
      fails `npm run lint:names`, named
- [x] Proven by adding one deliberately in a scratch commit, watching it fail,
      and reverting — say so in the report
- [x] Every existing crossing is an individual commented exception; no blanket
      disable over a directory. `docs/layering-debt.md` lists the same set
- [x] The exception count in `docs/layering-debt.md` matches the number of
      entries in `eslint.config.mjs` — say what the number turned out to be
- [x] `document` in `src/rules/` still fails
- [x] `tools/check-layers.js` is gone, and `grep -rn "npm run check" .
      --exclude-dir=node_modules --exclude-dir=.git` returns only documentation
      lines — no `package.json`, no workflow, no `crew.config.json`
- [x] `npx crew gate .claude/tasks/030-the-layers-become-import-lint.md` passes,
      which exercises the `quickVerify` you just changed
- [x] `npm run lint:names` still passes on `src/seam.ts` — the deliberate
      cross-layer file
- [x] `npm run verify` passes
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## Docs the orchestrator applies at close
<!-- Not in files: — see 029. -->

- Testing describes `npm run check` as the layer check. The script is gone; the
  layer rules are `npm run lint:names`, and the three checks become two.
- Layout says the check "is still a regex scan … and becomes
  `no-restricted-imports` in step 7". It has; say what it now is.
- **`src/rules/` is described as pure — "no DOM, no request, no cache, which is
  what makes it the half worth unit testing". That is currently false**
  (`rules/rows.ts` imports `data/merge`). Say what is true, and point at
  `docs/layering-debt.md`.
- `docs/backlog.md` section 0 item 2 is done; the layering debt becomes its own
  backlog entry, pointing at `docs/layering-debt.md`.
- `README.md:114` says `deploy` runs `npm run check` first "so code Chromium 53
  cannot run never ships", and `README.md:183` describes it as scanning `js/`.
  Both are stale twice over — `js/` is gone and the syntax scan retired with the
  bundler.

## Review rounds

### Round 1 — PASS

The reviewer re-ran the three ratchet probes rather than taking the report on
trust, and added a fourth of its own (`view/sidebar.ts`, already forgiven for
`data/` and `screen/`, importing `api/http` — still red, so an exception really
is per file *and* target). No findings.

### Blocked before round 1 — the spec's premise does not match the tree

Two things in **Graph context** and **Constraints** are wrong, and both change
the design rather than the implementation.

**1. There is not one cross-layer import. There are fourteen, across five
layer pairs.** The spec names `view/sidebar.ts` → `screen/showpage.ts`
(`themeLabel`) as "the" violation and says 029 removed the only genuine
`api/` → `data/` reach. 029 removed `api/youtube.ts` → `data/cached.ts`; it did
not touch these. Full inventory, from `grep -rn "^import" src --include='*.ts'`
(every one a value import, none type-only):

| pair | file → target |
| --- | --- |
| `api` → `data` | `api/plex/client.ts`, `api/plex/library.ts`, `api/plex/images.ts`, `api/plex/auth.ts`, `api/plex/discovery.ts` — all `import * as servers from '../../data/servers'` |
| `core` → `api` | `core/ui.ts` → `api/http` (`request`, for the debug beacon) |
| `data` → `view` | `data/devices.ts` → `view/dom` (`fill`, `put`) |
| `rules` → `data` | `rules/rows.ts` → `data/merge` — and `rules/` is the layer the spec calls pure, "no DOM, no request, no cache" |
| `view` → `screen` | `view/sidebar.ts` → `screen/showpage` (`themeLabel`) **and** `view/sidebar.ts` → `screen/player` (`autoplayLabel`) |

So a rule set written to the layering as CLAUDE.md states it fails
`npm run lint:names` on eight files, none of which are in `files:`. The only
way to a green gate is eight path exceptions across four pairs — which is
squarely against the spec's own constraint that "the new rules must not need"
path exemptions, and is a design decision (is this a ratchet that freezes
today's shape, or an invariant that today's code must be moved to satisfy?)
that the spec does not make.

**2. Approach step 3 cannot be done inside `files:`.** "Prefer moving
`themeLabel`" means editing `src/screen/showpage.ts`, `src/view/sidebar.ts`,
`src/screen/browse.ts` (it imports `themeLabel` too) and a new or existing
`src/rules/` file. `files:` declares no path under `src/`, and `crew scope`
hard-fails on a stray file, so the preferred branch of step 3 is unreachable
and only the stated fallback — ship an exception — is available. `autoplayLabel`
is the same shape in the same file and the spec does not mention it at all.

Also worth knowing for the respec: `src/rules/rows.ts` → `data/merge` is the
same violation the retired text scan was written to catch (`rules/` reaching
the cache), and it slipped through precisely because the scan looked for
`indexedDB` rather than for the import. It is the strongest evidence the task
is worth doing, and the least exemptable of the fourteen.

**What would unblock this**, either:

- widen `files:` to the `src/` files the moves need — at minimum
  `src/view/sidebar.ts`, `src/screen/showpage.ts`, `src/screen/player.ts`,
  `src/screen/browse.ts`, `src/rules/labels.ts`, `src/rules/rows.ts`,
  `src/data/devices.ts`, `src/core/ui.ts`, `src/api/plex/*.ts` — and say which
  crossings move and which are legitimate; or
- decide explicitly that this task ships the rules *as a ratchet*, with the
  fourteen existing crossings listed as exceptions in `eslint.config.mjs` and
  their removal booked as a follow-up task. That is a small, reviewable diff
  inside the current `files:`, but it is not what the spec asks for and it is
  not mine to choose.

Nothing was implemented and nothing outside this file was touched.

## Graph writes proposed
- Decision: layer boundaries are enforced by resolved imports, not a regex over
  file text. Supersedes the text scan that `tools/check-es5.js` carried since
  the js/ era.

## What changed

- `eslint.config.mjs` — a `LAYERS` table, a 15-line `DEBT` table of today's
  crossings, and a `banBlock` helper that turns both into per-layer
  `no-restricted-imports` blocks plus one per-file override each. Also
  `no-restricted-globals` for XHR and IndexedDB across `src/`, `document` on top
  of that in `rules/` and `api/`, and the two owner files exempted from the one
  their own layer owns.
- `docs/layering-debt.md` — new. The same fifteen as prose, grouped by pair,
  `rules/rows.ts` → `data/merge` called out to go first.
- `tools/check-layers.js` — deleted.
- `package.json` — `check` script gone; `verify` starts at `lint`; `deploy` runs
  `lint:names` in its place.
- `.github/workflows/verify.yml` — the "chromium 53 scan" step gone (it ran a
  layer check under a name two refactors stale); "naming rules" is now "layers
  and naming rules".
- `.claude/crew.config.json` — `quickVerify` is `npm run lint:names && npm test`.

## What the rules found

**Fifteen crossings across eleven files**, which is the orchestrator's count
rather than the blocked round's fourteen. The difference is arithmetic, not
disagreement: `view/sidebar.ts` → `screen/` is *two* imports (`player` and
`showpage`), and this list is one entry per import so the config, the doc and
the error count are all the same number.

`data/` → `rules/` does not appear, and should not: `data/` is above `rules/` in
the layering, so that import goes downward.

Proof the ratchet bites, all three done as scratch edits and reverted (the tree
was clean before the commit):

1. `import * as art from '../data/art'` added to `src/rules/quality.ts` →
   `rules/ must not import data/ — the layering only goes downward`.
2. `document.body` in the same file → `Unexpected use of 'document'. no DOM here
   — draw it in view/`.
3. `import { fill } from '../view/dom'` added to `src/rules/rows.ts`, which *is*
   on the exception list → still red. The exception is per file **and** target,
   so being forgiven `data/` buys nothing anywhere else.

`eslint --print-config src/seam.ts` carries no `no-restricted-imports` at all —
root-level files match no layer block — while keeping the global bans. Nothing
was added for root files, as the spec required.

## What the spec got wrong

Nothing that changed the work. Two notes for the record:

- Out of scope says "any layering violation other than the `view/` → `screen/`
  one named above", which is a sentence left over from the pre-ratchet draft —
  under the ratchet nothing is fixed, so it reads as its own opposite. Taken as
  "fix none of them, report them all", which is what Approach says.
- `docs/refactor-plan.md` names `tools/check-layers.js` at lines 7, 245, 316 and
  437 and calls the import-lint replacement "the last job of step 7". It is now
  done and the file is stale, but `docs/` outside `layering-debt.md` was
  explicitly off limits, so it is left for the orchestrator alongside the
  README and CLAUDE.md edits already listed.

## Graph writes proposed

- **Decision:** layer boundaries are enforced by resolved imports, not a regex
  over file text. Supersedes the text scan `tools/check-es5.js` carried since
  the `js/` era. The scan could not see `rules/rows.ts` importing `data/merge`
  at all — it looked for `indexedDB`, and the import is the violation.
- **Decision:** the layer rules ship as a ratchet. The fifteen crossings that
  predate them are named exceptions in `eslint.config.mjs`, registered in
  `docs/layering-debt.md`, and removed as separate work. Chosen over an
  eleven-file refactor because it blocks the sixteenth today.
- **Pattern:** an exception list is only worth what a probe says it is. Three
  scratch edits proved this one names a new crossing, catches a banned global,
  and does not leak from one forgiven target to another — the failure mode being
  guarded against is a list that quietly swallows new violations too.
