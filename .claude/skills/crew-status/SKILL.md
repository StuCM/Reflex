---
name: crew-status
description: Show the state of every task and what is worth doing next. Use when the user asks where things stand, what is in flight, what is waiting on them, or what to pick up.
---

# Where things stand

Cheap and mechanical. Render the board and read it — do not read task bodies,
and do not spawn anything.

```sh
node .claude/crew/bin/board.js
cat .claude/tasks/BOARD.md
git worktree list
```

The board is generated from the task files' frontmatter, so it cannot drift
from what the sessions have actually written.

Then, in a couple of lines each, the three things the user actually wants:

- **Waiting on them** — specs in `draft` needing approval, tasks in
  `pending-tv` needing the panel, anything escalated after two review rounds.
  Put this first. It is the only category they can act on right now.
- **In flight** — what is building or in review, and whether it has been
  sitting longer than it should.
- **Next** — what you would pick up, and why. Ground it in the backlog order:
  `docs/backlog.md` is written outward from the video deliberately, so if
  playback is wrong nothing further out matters.

## Housekeeping worth flagging

- Worktrees with no matching task file, or branches whose task is `done` —
  these are leftovers; offer to clean them up.
- Tasks `done` but never merged.
- More than two tasks in `pending-tv` — the bench queue is backing up, and a
  batch is worth one trip to the panel rather than four.
