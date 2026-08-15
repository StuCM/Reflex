---
name: crew-spec
description: Write and get approval for a task spec before any work starts. Use when the user wants to start a new piece of work, or says "spec this", "let's plan X", or names a backlog item to pick up.
---

# Writing a task spec

You are the orchestrator. You hold the conversation, the project, and the
reasons. This skill produces the one artifact everything else runs on.

The spec is where the token budget is won or lost. A worker given file names
and call sites starts writing immediately; a worker given a paragraph spends
30k tokens rediscovering what you already knew. **Specificity here is the
optimisation, not the ceremony.**

## 1. Prime from the graph — you, once, not every agent

```sh
.claude/crew/bin/graph.sh prime
.claude/crew/bin/graph.sh prefs
.claude/crew/bin/graph.sh traps
.claude/crew/bin/graph.sh find <the subsystem this touches>
```

Read what comes back and keep only what bears on *this* task. Then **inline it
into the spec's Graph context section**, in your own words, compressed.

This is deliberate: one query per task instead of one per agent, filtered by
someone with judgement, and workers stay hermetic — they need no MCP, no
network, and no memory of previous sessions. If the CLI is absent it says so
and you fall back to `docs/decisions.md`; the loop does not stall.

Pay attention to anything that reads as a trap or a phantom problem. Carrying
one line — *"a 403 from the proxy is environmental, not the app"* — into the
spec is what stops the next agent spending an hour on it.

## 2. Establish what the task actually is

Talk it through with the user. Push on:

- **What is different afterwards, from the outside?** If you cannot say it in
  a sentence, the task is too big — split it.
- **Which files?** Go and look. `Grep` for the call sites. The `files:` list is
  a contract, and a wrong one causes a false scope failure later.
- **Where can it be proven?** Set `env:`. If the answer is the TV, say so now
  and set expectations: code-complete is the best the loop can reach.
- **What is explicitly out of scope?** Ask directly. An empty Out of scope
  section means the reviewer invents its own.
- **Which model?** `sonnet` for well-specified work. `opus` only for the parts
  CLAUDE.md says must not be wrong — the guard, the media rules, anything that
  decides what plays.

## 3. Write it

Copy `.claude/crew/templates/task.md` to
`.claude/tasks/<NNN>-<slug>.md` — next free number, three digits.

Fill every section. The Definition of done is the one that matters most: the
reviewer executes it literally, so nothing in it may be a matter of taste.
Each item must be checkable by someone who was not in this conversation.

## 4. Get approval — this is a hard gate

Show the user the spec. Ask plainly whether to proceed.

**Do not spawn a worker until they say yes.** They asked for this gate for a
reason: a wrong spec is the most expensive thing in the system, and it is
cheapest to fix right now.

On approval set `status: approved` and tell them `/crew-run <id>` is next.
