---
id: NNN
slug: short-slug
status: draft
branch: crew/NNN-short-slug
model: sonnet
env: laptop
rounds: 0
files:
  - src/example.ts
  - test/example.test.ts
---

# <Title — what changes, in the user's terms>

## Goal
One or two sentences. What is different afterwards, from the outside.

## Why now
Which backlog item or decision this serves. One line.

## Existing work
<!-- `npx crew collisions <this file>`, verbatim, plus one line on what you make
     of each hit after reading it. `None.` if it printed nothing, so the reader
     knows the question was asked. -->

## Graph context
<!-- Inlined by /crew-spec from the memory graph. Workers must NOT re-query:
     if something is missing here, the spec is wrong — say so, don't go digging. -->

## Constraints that bite here
<!-- Only the ones that actually touch these files. Not the whole project brief. -->

## Approach
Numbered and specific. Name the functions and the call sites, so the worker
starts writing instead of exploring. If a step needs a decision the spec has
not made, that is a spec bug — stop and ask.

1.
2.

## Out of scope
Explicit. This is the list the reviewer checks scope creep against, so an
empty section means the reviewer will invent one.

-

## Definition of done
The reviewer executes this literally. Nothing here may be a matter of taste.

- [ ] <behaviour, observable>
- [ ] tests cover the behaviour, and fail if it regresses
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds
<!-- Reviewer appends one block per round. `rounds:` in the frontmatter counts
     them, and crew refuses to start one past the configured limit. -->

## Graph writes proposed
<!-- Worker and reviewer append; only the orchestrator commits them.
     Use the existing ontology: Decision (rationale, supersedes, affects),
     Pattern (a recurring approach, anti-pattern, or trap), Constraint,
     Preference. Do not invent relations. -->
