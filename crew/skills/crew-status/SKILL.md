---
name: crew-status
description: Show the state of every task and what is worth doing next. Use when the user asks where things stand, what is in flight, what is waiting on them, or what to pick up.
---

# Where things stand

Cheap and mechanical. Render the board and read it — do not read task bodies,
and do not spawn anything.

```sh
npx crew board
cat .claude/tasks/BOARD.md
git worktree list
```

The board is generated from the task files' frontmatter, so it cannot drift
from what the sessions have actually written. A status it marks *(unknown)* is
a typo in a task file, not a new state.

Then, in a couple of lines each, the three things the user actually wants:

- **Waiting on them** — specs in `draft` needing approval, anything in a
  `pending-<env>` state needing an environment no agent can reach, anything
  escalated after the last review round. Put this first. It is the only
  category they can act on right now.
- **In flight** — what is building or in review, and whether it has been
  sitting longer than it should.
- **Next** — what you would pick up, and why. Ground it in the project's
  backlog order rather than in what looks easiest.

## Housekeeping worth flagging

- Worktrees with no matching task file, or branches whose task is `done` —
  these are leftovers; offer to clean them up.
- Tasks `done` but never merged, or `done` with no gate stamp — run
  `npx crew doctor`, which names both.
- More than two tasks pending the same unreachable environment — that queue is
  backing up, and a batch is worth one trip rather than four.
