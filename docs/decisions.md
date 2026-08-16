# Decisions

The readable record. The memory graph owns the *links* — what supersedes what,
what a decision touches, where it lives in code. This file owns the *prose*,
and is the fallback when the graph is not running.

Neither restates the other. A decision here carries enough for a human to
understand it without the graph; the graph carries enough for an agent to
traverse it without this file.

Newest first. One entry per decision, appended by the orchestrator at
`/crew-close`.

---

## 2026-08-15 — Agents work through a spec-first loop, not a conversation

Several agents run in one evening each rediscovered the codebase, re-solved
deployment, and chased failures that were environmental rather than real. The
cost was not the number of agents; it was that each one started from nothing.

So: work goes through `.claude/crew/`. The orchestrator is the main session
rather than an agent, because a subagent cannot talk to the user. A spec naming
files and call sites is written and approved before any worker starts — that is
where the token spend is won, since a briefed worker does not explore. The
commit convention, the scope check and the environment ceiling became scripts,
because a rule in prose is paid for by every agent that reads it and a rule in
a script is free forever.

Two human gates: the spec, and anything only the panel can prove.

Supersedes nothing — this is the first process decision recorded.

## 2026-08-15 — Conventional commits, and no attribution footers

Commit history to this point is prose-imperative with long explanatory bodies
(`Give the player the rest of the film`, plus six paragraphs). Going forward:
`type(scope): summary`, four-line body cap, and no `Co-Authored-By` or
generated-by lines.

The reasoning that used to fill commit bodies belongs in the graph, where it
can be superseded and traversed, rather than in a message that can never be
revised. History is not rewritten.

Enforced by `.claude/crew/bin/commit-msg.js` via `core.hooksPath`, so it costs
no agent tokens and cannot be talked past.
