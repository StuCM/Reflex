---
name: crew-run
description: Run an approved task through worker, the deterministic gate, and review. Use when the user says "run task N", "start building it", or approves a spec.
---

# Running a task

Refuse to start unless the spec's `status:` is `approved`. If it is `draft`,
send the user back to `/crew-spec` — the approval gate is the point.

## 1. Isolate

```sh
git worktree add ../crew-<id> -b crew/<id>-<slug>
```

One worktree per task. Two workers in one tree corrupt each other, and
parallelism without isolation is a lie.

## 2. Worker

Spawn `crew-worker` with the model in the spec's `model:` field. Give it:

- the task file path
- the worktree path
- **nothing else.** No context dump, no summary of the conversation. If it
  needs something, that belongs in the spec, and the spec is the thing that
  gets reused.

Let it run. Do not narrate its progress.

## 3. The deterministic gate — no model, no tokens

Before any reviewer is spawned:

```sh
node .claude/crew/bin/scope-check.js .claude/tasks/<id>-<slug>.md
<the spec's verify command>
```

If either fails, send it back to the **same worker** with the output. Do not
spawn a reviewer to look at work that does not build — that is paying a model
to read a stack trace a script already printed.

## 4. Reviewer

Only once the gate is green. Spawn `crew-reviewer` with the task file and the
diff. It judges; it never edits.

- **PASS** → set `status: review-passed`, go to step 5.
- **CHANGES** → back to the worker with the findings verbatim. Then re-review.
- **BLOCKED**, or a second CHANGES round → **stop and bring it to the user.**
  Two rounds is the limit. A third is two agents disagreeing, and that is a
  decision, not a loop iteration. Put the disagreement in front of the user in
  a few lines and let them settle it.

Append each round to the spec's **Review rounds** section, so the history
survives this session.

## 5. Land it

Set the final status:

- `env: laptop` → `status: done`
- `env: tv` → `status: pending-tv`, and tell the user what to check on the
  panel. The loop cannot clear this and must not pretend to. Anything about
  decode, containers, HLS, smoothness or audio over ARC ends here.

Then `/crew-close <id>` to merge and record.

## Running several at once

Only when the specs' `files:` lists do not intersect. Check before you start —
two tasks editing `js/player.js` will conflict at merge, and you will pay for
both. Sequence them instead.
