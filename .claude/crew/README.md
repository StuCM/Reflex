# crew — a task loop for agents

A small system for getting work through agents without paying three times for
the same context. Project-agnostic: everything specific to a repo lives in
`.claude/crew.config.json`.

## The shape

```
YOU + ORCHESTRATOR (the main session — not an agent)
  /crew-spec    discuss → query the graph once → write the spec → YOU APPROVE
  /crew-run     hand the task to its own session in its own worktree
                    │
                    ├─ TASK SESSION (crew/roles/worker.md)
                    │    implements
                    │    gate: scope-check + verify        [no model]
                    │    spawns crew-reviewer (read-only, max 2 rounds)
                    │    writes its own status back to the task file
                    │
  /crew-close   YOU APPROVE → merge → record to the graph → deploy or queue
  /crew-status  the board, rendered from the task files
```

**Two human gates: the spec, and the merge.** Everything between them runs
unattended, which is only safe because those two hold. Deploying to the TV
always asks as well — nothing there can be proven without a person at the
panel.

One session per task, one worktree per session. The orchestrator hands over
and reads the board; it does not watch, poll, or narrate.

## Why it is arranged this way

**The orchestrator is the main session, not a subagent.** A subagent cannot
talk to you, so making the manager one adds a relay hop and doubles the
context carried. The main loop already has the conversation, spawns agents,
and merges.

**The spec is the token optimisation.** An agent dropped into a repo with a
vague task burns tens of thousands of tokens rediscovering what you already
knew — once per agent, per task. A spec naming files, call sites and a
definition of done removes that cost from every downstream agent. Time spent
on the spec is the cheapest time in the system.

**Anything that can be a script is a script.** The commit convention, the
scope check, the build, the environment ceiling — none of these need a model.
Every rule moved out of prose and into `bin/` is a rule no agent ever pays to
read again.

**The reviewer cannot edit.** An agent that can fix will fix instead of
review, and you lose the independence you spawned it for.

**Two review rounds, then a human.** A third round is two agents disagreeing,
which is a decision, not an iteration.

**One graph writer.** Workers and reviewers *propose* triples in the spec;
only the orchestrator commits them. Parallel worktrees cannot race, and the
graph stays clean enough that recall is worth reading.

## The memory graph

Uses [claude-memory-graph](https://github.com/StuCM/claude-memory-graph) if it
is installed, and degrades silently if not.

The orchestrator queries **once**, at spec time, and inlines what matters into
the spec. Workers never query. That is one query per task instead of one per
agent, filtered by judgement, and it keeps workers hermetic — no MCP, no
network, no dependence on a store that may not exist in CI or a container.

Reads go through `bin/graph.sh`, which wraps the read-only CLI, so no agent
needs MCP tools loaded to benefit. Writes are MCP-only and orchestrator-only.

The existing ontology covers everything: `Decision` (rationale, supersedes,
affects, manifestsIn), `Pattern` for recurring approaches, anti-patterns and
**traps**, `Constraint` for hard rules, `Preference` for how you like to work.
Do not extend it without needing to.

Traps are the highest-value writes. *"A 403 here is the agent proxy, not the
app"* recorded once stops every future agent chasing it.

## Files

| Path | What it is |
|---|---|
| `.claude/crew.config.json` | project settings — verify, scopes, environments |
| `.claude/tasks/NNN-slug.md` | task state: spec, status, review history |
| `.claude/tasks/BOARD.md` | glance view, **generated** from the task files |
| `.claude/crew/templates/task.md` | the spec template |
| `.claude/crew/roles/worker.md` | the task session's brief |
| `.claude/agents/crew-reviewer.md` | the reviewer, spawned by the task session |
| `.claude/skills/crew-*/` | the orchestrator's four commands |
| `bin/commit-msg.js` | commit convention, enforced by git hook |
| `bin/scope-check.js` | changed files vs the spec's declared files |
| `bin/board.js` | renders the board from task frontmatter |
| `bin/preflight.js` | what this machine can and cannot prove |
| `bin/graph.sh` | read-only memory graph access |
| `bin/install.sh` | copy the system into another project |

The board is **derived, never hand-maintained**. Task files are the single
source of truth, so a session that updates its own task cannot leave the board
disagreeing with it.

## Setup

```sh
git config core.hooksPath .claude/crew/githooks
```

Without it the commit convention is advisory. With it, every commit — human or
agent — is checked for free.

## Reflex, specifically

The roles carry this project's rules rather than generic advice: Chromium 53,
the `index.html` script list, the direct play profile, the 4K rule, the ARC
audio tiers, and the fact that `npm run verify` is **28/28 green** once
`npm run fixture` has been run — so a worker can tell its own breakage from the
baseline instead of inventing an explanation for a failure it inherited.

`dev/fixtures/` is gitignored, so every fresh worktree starts without a video
and one step fails until `npm run fixture` runs. Both roles are told to run it
first.

`env: tv` is the state that matters most. Decode, containers, HLS, smoothness
and audio over ARC cannot be answered on a laptop, and a loop that marks them
`done` is lying.

## Porting to another project

```sh
.claude/crew/bin/install.sh /path/to/other/project
```

Copies the agents, skills and `crew/`, then writes a starter config you edit:
`verify`, `scopes`, and any environment the agents cannot reach. Nothing else
in the system knows what project it is running in.
