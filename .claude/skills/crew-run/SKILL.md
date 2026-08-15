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
it. Two sessions editing `js/player.js` will conflict at merge and you pay for
both.

## 2. Worktree

```sh
git worktree add ../reflex-<id> -b crew/<id>-<slug>
```

## 3. Hand over

Set `status: building`, run `node .claude/crew/bin/board.js`, then start the
session in `../reflex-<id>` with exactly this brief — nothing more:

```
Read .claude/crew/roles/worker.md and follow it for task
.claude/tasks/<id>-<slug>.md. You are in a worktree; the spec is the brief.
```

No conversation summary, no context dump. If the session needs something, it
belongs in the spec — that is the artifact that gets reused, and re-explaining
in a prompt is exactly the cost this system exists to remove.

If `mcp__Claude_Code_Remote__create_session` is available, spawn it there with
that prompt and record the session id in the task file. Otherwise give the
user the `cd` and the prompt to paste.

## 4. Then stop

The task session owns the loop from here: it implements, runs the
deterministic gate, spawns `crew-reviewer` itself, and takes up to two rounds
of findings. It writes its own status back into the task file.

**Do not poll it and do not narrate it.** Re-render the board when the user
asks where things stand, or when a session reports back.

## 5. When a session reports

The task file's `status:` tells you what happened:

- `review` → still going. Leave it.
- `done` → the gate and review passed on the laptop. Go to `/crew-close`.
- `pending-tv` → code-complete, and only the panel can prove it. Tell the user
  what to check. The loop cannot clear this and must not pretend to: decode,
  containers, HLS, smoothness and audio over ARC are all in this category.
- `blocked` → two rounds disagreed, or the spec could not be judged. Put the
  disagreement in front of the user in a few lines and let them settle it.
  Do not spawn a third round to break the tie.

Re-render the board after any status change.
