# crew

A task loop for coding agents. An approved spec, a worker in its own worktree,
a deterministic gate, and an independent review that cannot edit.

Project-agnostic: everything specific to a repository lives in two files it
owns — `.claude/crew.config.json` for the mechanics and
`.claude/crew/project.md` for the rules a wrong diff can satisfy.

## The shape

```
YOU + ORCHESTRATOR (the main session — not an agent)
  /crew-spec    discuss → query the graph once → write the spec → YOU APPROVE
  /crew-run     hand the task to its own session in its own worktree
                    │
                    ├─ TASK SESSION (the crew-worker skill)
                    │    implements, and cannot write outside files:
                    │    crew gate    → prepare + scope + verify, then stamp   [no model]
                    │    crew review  → opens a round, refuses one past the limit
                    │    spawns crew-reviewer (read-only)
                    │    writes its own status back to the task file
                    │
  /crew-close   crew gate --check → YOU APPROVE → merge → graph → deploy
  /crew-status  the board, rendered from the task files
```

**Two human gates: the spec, and the merge.** Everything between them runs
unattended, which is only safe because those two hold.

One session per task, one worktree per session. The orchestrator hands over and
reads the board; it does not watch, poll, or narrate.

## Install

```sh
npm install --save-dev @stucm/crew
npx crew init --hook
npx crew doctor
```

`init` writes the config, the project brief, the task directory and the git
hooks, and points `core.hooksPath` at them. It never overwrites a file you may
have edited, so it is also the upgrade path. `--hook` adds the PreToolUse scope
hook to `.claude/settings.json`.

For the skills and the reviewer agent, add the plugin:

```
/plugin marketplace add StuCM/crew
/plugin install crew
```

The plugin ships its own copy of the scope hook, so with it installed you can
skip `--hook`. The npm package is still what the git hooks and CI call, and
works with no Claude Code at all.

## Configuration

One file, with a schema:

```json
{
  "$schema": "./crew/crew.config.schema.json",
  "project": "Reflex",
  "verify": "npm run verify",
  "prepare": ["npm run fixture"],
  "environments": {
    "laptop": { "proves": ["browsing", "the guard", "the merge"] },
    "tv": {
      "proves": ["decode", "HLS", "audio over ARC"],
      "reachableFromAgents": false,
      "note": "Only a person at the panel can clear this."
    }
  }
}
```

`project` and `verify` are the only required keys; everything else has a
default that gives a working loop. `crew doctor` validates it and reports
every fault at once.

**Statuses are derived, not listed.** Six are intrinsic — `draft`, `approved`,
`building`, `review`, `blocked`, `done` — and every environment with
`reachableFromAgents: false` earns one of its own: the config above produces
`pending-tv`. That is how code-complete work is stopped from calling itself
done, without the board knowing what a TV is.

**Prose does not go in the JSON.** `.claude/crew/project.md` holds the rules a
plausible diff can violate, the files where being wrong is expensive, and what
this environment cannot prove. The worker skill and the reviewer agent both
include it, and neither mentions your project by name. That split is not
tidiness: the old roles had a project's runtime constraints written into them
and went stale against a migration they could not see, while the generic half
never would have.

## Commands

| | |
|---|---|
| `crew init [--hook]` | install into a repository; safe to re-run |
| `crew doctor` | is this installation actually wired up? |
| `crew spec-template` | the task template, for a new spec |
| `crew graph <what>` | read the memory graph: `prime`, `prefs`, `traps`, `find` |
| `crew collisions <task>` | unmerged branches already touching its `files:` |
| `crew preflight [env]` | what this machine can and cannot prove |
| `crew gate <task>` | prepare + scope + verify, then stamp the commit |
| `crew gate --check <task>` | has the gate passed on the code that is here? |
| `crew scope <task>` | changed files against the spec's `files:` |
| `crew review <task>` | open a round, refusing one past the limit |
| `crew board` | render `BOARD.md` from the task files |
| `crew log <task> <event>` | append one line to the cost log |
| `crew commit-msg <file>` | the commit convention (git hook) |
| `crew pre-commit` | staged-file format and lint (git hook) |
| `crew hook scope` | PreToolUse: refuse a write outside `files:` |

## Why it is arranged this way

**The orchestrator is the main session, not a subagent.** A subagent cannot
talk to you, so making the manager one adds a relay hop and doubles the context
carried. The main loop already has the conversation, spawns agents, and merges.

**The spec is the token optimisation.** An agent dropped into a repo with a
vague task burns tens of thousands of tokens rediscovering what you already
knew — once per agent, per task. A spec naming files, call sites and a
definition of done removes that cost from every downstream agent.

**Anything that can be a script is a script.** The commit convention, the scope
check, the build, the environment ceiling, the round limit — none of these need
a model. Every rule moved out of prose and into the CLI is a rule no agent ever
pays to read again, and one it cannot decide to skip.

**The reviewer cannot edit.** An agent that can fix will fix instead of review,
and you lose the independence you spawned it for.

**Rounds are counted, not requested.** "Two rounds, then a human" held exactly
as well as the worker felt like holding it. `crew review` is a counter.

**`status: done` is not evidence.** The gate stamps the commit it passed on, and
`crew gate --check` reports whether anything but bookkeeping has landed since.
A worker that skipped the gate, or gated four commits ago, cannot be closed by
accident.

**Scope is refused, not reported.** The PreToolUse hook denies a write outside
`files:` when it happens, rather than the gate reporting it after a round has
been paid for. It fails open on anything it cannot judge — no task identifiable,
no `files:` list, a path outside the repository — because a hook that stops the
orchestrator gets switched off.

**One graph writer.** Workers and reviewers *propose* triples in the spec; only
the orchestrator commits them. Parallel worktrees cannot race.

## The memory graph

Uses [claude-memory-graph](https://github.com/StuCM/claude-memory-graph) if it
is installed, and degrades silently if not.

The orchestrator queries **once**, at spec time, and inlines what matters into
the spec. Workers never query. That is one query per task instead of one per
agent, filtered by judgement, and it keeps workers hermetic — no MCP, no
network, no dependence on a store that may not exist in CI or a container.

Traps are the highest-value writes. *"A 403 here is the agent proxy, not the
app"* recorded once stops every future agent chasing it.

## The cost log

`crew log` appends one JSON line per task event — id, model, env, rounds,
declared files, commits. The whole system is an argument that a specified task
costs less than an unspecified one, and until now nothing measured it, so
nothing could have contradicted it.

## Contributing

This is a Node CLI. It runs on your machine and in CI, **never in a browser and
never in whatever runtime the host project targets** — so it is written in
modern JavaScript and pinned to `node >= 20.11`. The host project's own
constraints are the host project's; this said nothing about its runtime and got
written in ES5 by contagion, which is the reason this paragraph exists.

```sh
npm test     # node --test, no dependencies
```

The tests are the arbiter for the parsing, the matching and the hook decision.
Two of them are worth knowing about before changing anything:

- `test/git.test.js` runs a shell-injection payload through a real repository
  **with a control** that proves the payload fires when it does reach a shell.
  Every git call is an argv array for that reason: a `files:` entry of
  `src/x.ts$(touch /tmp/pwned)` in an agent-written spec used to execute.
- `test/scope-check.test.js` pins the comment ratio to code files. The old
  counter scanned the raw diff, so Markdown headings and list bullets counted
  and any task touching a doc tripped the warning it had not earned.
