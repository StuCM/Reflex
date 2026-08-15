---
name: crew-close
description: Merge a finished task, record what was learnt to the memory graph, and deploy or queue for the TV. Use when a task has passed review, or the user says "merge it", "close task N", or clears a pending-tv task.
---

# Closing a task

Only the orchestrator does this. Workers never push and never deploy.

## 1. Check the status

- `done` → merge now.
- `pending-tv` → **do not merge on your own judgement.** Ask the user whether
  it has been checked on the panel. If it has not, leave it; a pending-tv task
  that gets merged as "done" is exactly the failure this state exists to stop.

## 2. Merge

```sh
git checkout main && git merge --no-ff crew/<id>-<slug>
<the spec's verify command>
git worktree remove ../crew-<id>
git branch -d crew/<id>-<slug>
```

Verify on `main` after merging, not just in the worktree. Two tasks that each
passed alone can still fail together.

## 3. Record what was learnt — the step that pays for itself

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

## 4. Deploy, or say why not

```sh
node .claude/crew/bin/preflight.js tv
```

If it reports the environment is unreachable, **stop**. Do not attempt a
sideload, do not diagnose the failure, do not try another way. Report to the
user that it is merged and waiting for the bench. Three agents each solving
deployment is the problem this whole gate exists to prevent.

## 5. Next

Tell the user what is now unblocked, and what you would pick up next and why.
That judgement is the job — it is why the orchestrator is the session they
talk to, and not an agent.
