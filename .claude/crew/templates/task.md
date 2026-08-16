---
id: NNN
slug: short-slug
status: draft
branch: crew/NNN-short-slug
model: sonnet
env: laptop
files:
  - js/example.js
  - test/example.test.js
---

# <Title — what changes, in the user's terms>

## Goal
One or two sentences. What is different afterwards, from the outside.

## Why now
Which backlog item or decision this serves. One line.

## Graph context
<!-- Inlined by /crew-spec from the memory graph. Workers must NOT re-query:
     if something is missing here, the spec is wrong — say so, don't go digging. -->

## Constraints that bite here
<!-- Only the ones that actually touch these files. Not all of CLAUDE.md. -->

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
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds
<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

## Graph writes proposed
<!-- Worker and reviewer append; only the orchestrator commits them.
     Use the existing ontology: Decision (rationale, supersedes, affects),
     Pattern (a recurring approach, anti-pattern, or trap), Constraint,
     Preference. Do not invent relations. -->
