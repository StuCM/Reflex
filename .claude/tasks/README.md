# tasks

One file per task, `NNN-slug.md`, from `.claude/crew/templates/task.md`.

These are committed on purpose. The task file is the source of truth for what
was agreed and why — sessions end and contexts compact, but a spec on disk
lets any session pick the work up cold.

`status:` moves in one direction:

| status | meaning |
|---|---|
| `draft` | being written; **no agent may start** |
| `approved` | the user said yes; `/crew-run` will pick it up |
| `building` | a worker holds it |
| `review` | in front of the reviewer |
| `blocked` | two rounds disagreed, or the spec cannot be judged — needs a human |
| `pending-tv` | code-complete, but only the panel can prove it |
| `done` | merged |

`pending-tv` is the one that matters most here. Decode, container support,
HLS, smoothness and audio over ARC cannot be answered on a laptop, and a loop
that marks them `done` is lying. Only a human at the panel clears it.
