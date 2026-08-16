---
name: crew-close
description: Merge a finished task, record what was learnt to the memory graph, and deploy or queue for the TV. Use when a task has passed review, or the user says "merge it", "close task N", or clears a pending-tv task.
---

# Closing a task

Only the orchestrator does this. Workers never push and never deploy.

## 1. Check the status

- `done` → go to step 2.
- `pending-tv` → ask whether it has been checked on the panel. If it has not,
  leave it. A pending-tv task merged as "done" is exactly the failure this
  state exists to stop.
- `blocked` → not yours to close. Put the disagreement to the user first.

## 2. Ask before merging — this is the second hard gate

Show the user, in a few lines: what the diff does, the review verdict, the
gate output, and anything the worker said the spec got wrong.

**Do not merge until they say yes.** The spec gate and the merge gate are the
two places a human is in this loop by design; everything between them runs
unattended, which is only safe because these two hold.

## 3. Merge

```sh
git checkout main && git merge --no-ff crew/<id>-<slug>
npm run verify
git worktree remove ../reflex-<id>
git branch -d crew/<id>-<slug>
node .claude/crew/bin/board.js
```

Verify on `main` after merging, not just in the worktree — two tasks that each
passed alone can still fail together. The baseline is 26/26; anything less
means the merge broke something.

## 4. Record what was learnt — the step that pays for itself

You are the **only** writer to the graph. Workers and reviewers proposed
triples in the spec's **Graph writes proposed** section; you decide what is
durable and commit it. Single-writer keeps parallel worktrees from racing, and
keeps the graph clean enough that recall is worth reading.

Use the existing ontology. Do not invent relations — `memory_link` will list
the valid ones if you get it wrong, and extending is for when nothing fits.

- **Decision** — a choice with `rationale`, and `date`. Link `affects` to the
  Project, `madeBy` to the person, `supersedes` to the decision it replaces.
  The chain is the value: a decision with no `supersedes` and no rationale is
  a note, not a decision.
- **Pattern** — a recurring approach, an anti-pattern, or **a trap**. Traps
  are the highest-value thing you can write: *"sideload fails with no TV
  paired — this is the bench, not the code"*. Describe the symptom in the
  words an agent would see, because that is what future recall matches on.
  Link `manifestsIn` from the Decision it implements.
- **Constraint** — a hard rule that must not be violated. `appliesTo` the
  Project.
- **Preference** — how this person wants work done. Commit style, comment
  density, review tone. These are the ones that travel between projects.

Write nothing that is merely what the diff did. The diff is already the
record. Write the *why*, the *superseding*, and the *dead ends*.

Then add a line to `docs/decisions.md` for anything a human would want to read
without the graph running. The graph owns the links; the file owns the prose;
neither restates the other.

## 5. Deploy, or say why not

```sh
node .claude/crew/bin/preflight.js tv
```

If it reports the environment is unreachable, **stop**. Do not attempt a
sideload, do not diagnose the failure, do not try another way. Report to the
user that it is merged and waiting for the bench. Three agents each solving
deployment is the problem this whole gate exists to prevent.

## 6. Next

Tell the user what is now unblocked, and what you would pick up next and why.
That judgement is the job — it is why the orchestrator is the session they
talk to, and not an agent.
