---
id: 002
slug: branch-collision
status: approved
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

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->

- The trap Pattern is already recorded. On close, link it to this task's
  Decision so recall goes from the failure to the fix.
