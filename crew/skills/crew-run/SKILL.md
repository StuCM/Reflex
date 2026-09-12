---
name: crew-run
description: Hand an approved task to its own session in an isolated worktree. Use when the user says "run task N", "start building it", or approves a spec.
---

# Handing a task to a session

Refuse to start unless `status:` is `approved`. A `draft` goes back to
`/crew-spec` — the approval gate is the point of the whole system.

Each task gets **its own session and its own worktree**. The orchestrator does
not implement, does not review, and does not watch. It hands over, then reads
the board.

## 1. Check it can run alongside what is already in flight

Read the board. If another in-flight task declares any of the same `files:`,
**do not start this one** — say which task it collides with and offer to queue
it. Two sessions editing the same module will conflict at merge and you pay for
both.

Then ask git the same question, because the board only sees tasks:

```sh
npx crew collisions .claude/tasks/<id>-<slug>.md
```

Any output is a hit: an unmerged branch already carries commits touching these
files. **Do not dispatch.** Name the branch and the commits, and offer to land
them, respec around them, or proceed anyway. The user may say proceed; you may
not decide it for them, exactly as with a `draft`.

It exits 0 whether or not it finds anything — the advisory layer never stalls
the loop, so read what it printed rather than its status.

## 2. Worktree

The branch name is the one in the task file's `branch:`, and it matters: the
scope hook identifies the task from it.

```sh
git worktree add <worktreeDir>/<project>-<id> -b <branch>
```

## 3. Hand over

Set `status: building`, run `npx crew board` and `npx crew log <task> dispatch`,
then start the session in that worktree with exactly this brief — nothing more:

```
Use the crew-worker skill for task .claude/tasks/<id>-<slug>.md.
You are in a worktree; the spec is the brief.
```

No conversation summary, no context dump. If the session needs something, it
belongs in the spec — that is the artifact that gets reused, and re-explaining
in a prompt is exactly the cost this system exists to remove.

If a tool for spawning a session is available, spawn it there with that prompt
and record the session id in the task file's `session:`. Otherwise give the
user the `cd` and the prompt to paste.

## 4. Then stop

The task session owns the loop from here: it implements, runs the gate, opens
its rounds with `crew review`, spawns `crew-reviewer` itself, and writes its
own status back into the task file.

**Do not poll it and do not narrate it.** Re-render the board when the user
asks where things stand, or when a session reports back.

## 5. When a session reports

The task file's `status:` tells you what happened:

- `review` → still going. Leave it.
- `done` → the gate and review passed. Go to `/crew-close`.
- `pending-<env>` → code-complete, and only that environment can prove it. Tell
  the user what to check. The loop cannot clear this and must not pretend to.
- `blocked` → the rounds disagreed, or the spec could not be judged. Put the
  disagreement in front of the user in a few lines and let them settle it.
  Do not spawn another round to break the tie.

Re-render the board after any status change.
