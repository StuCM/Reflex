# Project brief

The half of the crew roles that is about *this* project. The worker role and
the reviewer agent both include this file; neither one mentions your project by
name.

Keep it to what makes a plausible-looking diff wrong here. Not a tour of the
codebase — the spec names the files, and a worker that reads this instead of
writing code has cost you the thing crew exists to save.

The shape that works:

## Hard constraints

Rules a diff can violate while looking correct, and what the violation costs.
A runtime ceiling, a protocol the server will reject, a profile that must not
be widened. Say the consequence, because that is what stops an agent
"fixing" its way past the rule.

## Where a plausible diff does real damage

The two or three files where being wrong is expensive, and what to check in
each.

## What this environment cannot prove

The things only real hardware, a staging deploy or a person can settle — and
therefore the tasks whose honest end state is `pending-<env>` rather than
`done`. Name them, or every loop will mark them done.

## Baseline

What a clean run actually scores, and anything that must be set up before the
gate is meaningful — a fixture, a seeded database, a service on a port. An
agent that cannot tell its own breakage from the one it inherited will invent
an explanation for it.
