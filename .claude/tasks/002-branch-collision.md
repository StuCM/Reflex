---
id: 002
slug: branch-collision
status: done
branch: crew/002-branch-collision
model: sonnet
env: laptop
files:
  - .claude/crew/bin/preflight.js
  - .claude/skills/crew-run/SKILL.md
  - .claude/skills/crew-spec/SKILL.md
---

# Make the collision check see unmerged branches

## Goal

Before a task is dispatched, the orchestrator is told if any unmerged branch
already touches the files the spec declares. Today it is only told about other
*task files*, so work committed to a branch nobody turned into a task is
invisible.

## Why now

It cost a duplicated task on 2026-08-16, live. Task 001 was specced, approved
and dispatched to fix `dev/smoke.js`, while `claude/player-features` already
carried `537e26a` — the same fix, to the same file, unmerged. The board said
"nothing in flight" and was *correct*: the check was asking the wrong question.

This is cheap to fix and it protects the one gate the whole system rests on.
A spec written without knowing the work exists is a spec the human approves in
good faith and still wastes a session on.

## Graph context

<!-- Inlined by the orchestrator. Do not re-query. -->

- Pattern **"crew's collision check cannot see unmerged branches"** (recorded
  2026-08-16) — the trap itself, with the detection one-liner:
  `git log --oneline HEAD..<branch> -- <files>`. This task is its fix.
- Decision **"verify a peer's branch in a detached throwaway worktree, not
  their worktree"** — the neighbouring habit. Reading another branch is safe
  and cheap; there is no reason not to look.

Nothing else in the graph touches the crew scripts.

## Constraints that bite here

- `bin/` is Node, run directly, **no dependencies** — the crew system is
  copied into other projects by `install.sh` and must not acquire any. Use
  `child_process.execSync` and `git`, nothing else.
- Anything that can be a script *is* a script (README). This is a script, not
  a paragraph added to a skill telling an agent to remember to look.
- It must **fail open**. A repo with no other branches, a detached HEAD, or a
  git call that errors must print nothing and exit 0. The loop never stalls on
  the advisory layer — same rule `graph.sh` already follows.
- `dev/` and `js/` are untouched. This is loop plumbing.

## Approach

1. **`bin/preflight.js`** — add a `collisions` mode, or a second exported
   function if the file is already structured that way. Read it first; it
   already knows how to find the repo root and read a task file.

   Signature: `node .claude/crew/bin/preflight.js collisions <task-file>`.

   - Parse `files:` out of the task's frontmatter (the same parse `board.js`
     already does — reuse it rather than writing a second YAML-ish reader).
   - `git for-each-ref --format='%(refname:short)' refs/heads` for local
     branches. Skip the current branch and any `crew/*` branch whose task is
     already `done`.
   - For each remaining branch: `git log --oneline HEAD..<branch> -- <files>`.
     Non-empty output is a collision.
   - Print one line per hit: branch, short sha, subject, and which declared
     file it touches. Exit 0 either way — this informs, it does not block.

2. **`skills/crew-spec/SKILL.md`** — run it while writing the spec, and inline
   what it finds under a `## Existing work` heading in the task file. The point
   is that the *human approving the spec* sees it, which is too late if it only
   runs at dispatch.

3. **`skills/crew-run/SKILL.md`** — step 1 currently says to read the board for
   in-flight tasks. Extend it: also run the collisions check and refuse to
   dispatch on a hit, the same way it already refuses a `draft`. The user can
   override by saying so; an agent may not.

## Out of scope

- Remote branches. `git fetch` on every spec is a network call on the critical
  path of the one thing the human is waiting for. Local branches are where this
  actually bit us.
- Merging, rebasing or cleaning up the branches it finds. Report only.
- The stale-worktree housekeeping in `crew-status`. Related, separate.
- Any change to `board.js`'s output format — the board is derived and other
  things read it.

## Definition of done

- [ ] `preflight.js collisions .claude/tasks/001-verify-fixture.md` names
      `claude/player-features` and `537e26a`, because that is the case that
      caused this.
- [ ] A task whose `files:` nothing else touches prints nothing and exits 0.
- [ ] Works on a repo with one branch, and on a detached HEAD, without error.
- [ ] `crew-spec` writes an `## Existing work` section; `crew-run` refuses to
      dispatch on a hit and says which branch.
- [ ] `npm run verify` passes (unchanged — nothing here is in its path).
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `.claude/crew/bin/preflight.js` — a `collisions <task-file>` mode: reads the
  spec's `files:`, walks `refs/heads` skipping the current branch, the task's
  own branch and any branch of a `done` task, and prints one line per commit in
  `HEAD..<branch>` touching a declared file. Exits 0 always; git's stderr is
  suppressed so a missing repo prints nothing at all.
- `.claude/skills/crew-spec/SKILL.md` — §2 now runs it once `files:` is settled
  and inlines the result under `## Existing work`, so the human approving sees
  it, with `None.` when it finds nothing.
- `.claude/skills/crew-run/SKILL.md` — §1 now runs it too and refuses to
  dispatch on any output, offering to land, respec or proceed. Only the user
  may choose to proceed.

Commits: `9a3d973`, `0c10c89`, `ab1e3b8`.

## What the spec got wrong

- **DoD item 1 is time-locked.** `537e26a` has since been merged into `main`,
  so it is in `HEAD` and `git log HEAD..<branch>` correctly excludes it. The
  check still names `claude/player-features` on task 001 — via `57407f1`. The
  behaviour the item was testing for is present; the sha it named is not
  reachable any more, and making it reachable would mean reporting merged work
  as a collision. Reviewer confirmed independently.
- **"reuse the parse `board.js` already does"** — `board.js` has no `files:`
  parser; `scope-check.js` does. Neither is importable: both are standalone
  scripts that run (and can `process.exit`) on require, and neither is in this
  task's `files:`. `parseFiles` is therefore duplicated, ~10 lines, marked with
  a `ponytail:` comment. Extracting a shared `bin/task-file.js` is the real fix
  and wants its own task touching all three scripts.
- **`scope-check.js` with its default base is misleading here.** `origin/main`
  is two commits behind local `main`, so the orchestrator's own approve and
  dispatch commits read as scope creep. Against the handover point it is clean:
  `scope-check.js .claude/tasks/002-branch-collision.md 37cf45d` → in scope,
  3 declared / 3 changed. `npm run verify` 26/26.

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

**Round 1 — PASS.** Verified the fail-open cases independently (single branch,
detached HEAD, `.git` removed: all silent, exit 0), confirmed `537e26a` is an
ancestor of `HEAD`, accepted the `parseFiles` duplication as forced by scope,
and re-ran `npm run verify` (26/26) and `preflight.js laptop` (unchanged).
Comments 7% of added lines, under the 25% threshold.

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->

- The trap Pattern is already recorded. On close, link it to this task's
  Decision so recall goes from the failure to the fix.
- **Decision — "the collision check asks git, not the board"**: unmerged work
  is found with `git log HEAD..<branch> -- <files>` over local `refs/heads`,
  run at spec time *and* at dispatch. `HEAD..` is the whole point: merged work
  is not a collision, so the check quietly stops reporting a branch the moment
  its work lands, with no bookkeeping. Fails open by design — an advisory layer
  that can stall the loop is worse than no advisory layer.
- **Pattern (trap) — "a spec's Definition of done can name a sha that merges
  before the worker reads it"**: DoD item 1 named `537e26a`, which landed on
  `main` between approval and dispatch, so the correct implementation could not
  produce it. Prefer naming the *branch* and the behaviour over a sha when the
  spec is about unmerged state. Cost one round of judgement, not a rewrite.
- **Pattern — "crew's `bin/` scripts cannot share code"**: every one of them is
  a standalone script that executes on require, so `parseFiles` and `field` are
  now duplicated across `scope-check.js`, `board.js` and `preflight.js`. A
  third copy is the point at which `bin/task-file.js` earns itself; until then
  the duplication is the smaller diff and is marked in the source.
