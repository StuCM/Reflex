---
name: crew-close
description: Merge a finished task, record what was learnt to the memory graph, and deploy or queue it. Use when a task has passed review, or the user says "merge it", "close task N", or clears a task pending an environment.
---

# Closing a task

Only the orchestrator does this. Workers never push and never deploy.

## 1. Check the status, and the stamp

- `done` → go to step 2.
- `pending-<env>` → ask whether it has been checked in that environment. If it
  has not, leave it. Such a task merged as "done" is exactly the failure the
  state exists to stop.
- `blocked` → not yours to close. Put the disagreement to the user first.

```sh
npx crew gate --check .claude/tasks/<id>-<slug>.md
```

This is not a formality. It says whether the gate passed on the code that is
actually on the branch, or whether something landed afterwards that nothing has
proved. `status: done` is the worker's own word for it; the stamp is the
evidence. If it fails, the task goes back for another gate run — not to a
judgement call about whether it probably still passes.

## 2. Ask before merging — this is the second hard gate

Show the user, in a few lines: what the diff does, the review verdict, the gate
output, and anything the worker said the spec got wrong.

**Do not merge until they say yes.** The spec gate and the merge gate are the
two places a human is in this loop by design; everything between them runs
unattended, which is only safe because these two hold.

## 3. Merge

```sh
git checkout <baseBranch> && git merge --no-ff <branch>
<the project's verify command>
git worktree remove <worktree>
git branch -d <branch>
npx crew board
npx crew log .claude/tasks/<id>-<slug>.md close
```

Verify on the base branch after merging, not just in the worktree — two tasks
that each passed alone can still fail together. The baseline is whatever the
base scored before the merge, so a drop means the merge broke something.

## 4. Record what was learnt — the step that pays for itself

You are the **only** writer to the graph. Workers and reviewers proposed
triples in the spec's **Graph writes proposed** section; you decide what is
durable and commit it. Single-writer keeps parallel worktrees from racing, and
keeps the graph clean enough that recall is worth reading.

Use the existing ontology. Do not invent relations — the link tool will list
the valid ones if you get it wrong, and extending is for when nothing fits.

- **Decision** — a choice with `rationale` and `date`. Link `affects` to the
  Project, `madeBy` to the person, `supersedes` to the decision it replaces.
  The chain is the value: a decision with no `supersedes` and no rationale is a
  note, not a decision.
- **Pattern** — a recurring approach, an anti-pattern, or **a trap**. Traps are
  the highest-value thing you can write: *"a sideload with no device paired is
  the bench, not the code"*. Describe the symptom in the words an agent would
  see, because that is what future recall matches on.
- **Constraint** — a hard rule that must not be violated. `appliesTo` the
  Project.
- **Preference** — how this person wants work done. Commit style, comment
  density, review tone. These are the ones that travel between projects.

Write nothing that is merely what the diff did. The diff is already the record.
Write the *why*, the *superseding*, and the *dead ends*.

Then add a line to the project's `decisionsFile` for anything a human would
want to read without the graph running. The graph owns the links; the file owns
the prose; neither restates the other.

## 5. Deploy, or say why not

```sh
npx crew preflight <env>
```

If it reports the environment is unreachable, **stop**. Do not attempt the
deploy, do not diagnose the failure, do not try another way. Report to the user
that it is merged and waiting. Three agents each solving deployment is the
problem this gate exists to prevent.

## 6. Next

Tell the user what is now unblocked, and what you would pick up next and why.
That judgement is the job — it is why the orchestrator is the session they talk
to, and not an agent.
