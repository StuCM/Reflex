# crew, in this project

The loop itself lives in [`crew/`](../../crew) — a standalone package with its
own README, tests and version, installed here as a dev dependency and destined
for its own repository. Nothing in it knows what project it is running in.

Reflex owns exactly two files:

| Path | What it is |
|---|---|
| `.claude/crew.config.json` | the mechanics: verify, prepare, scopes, environments |
| `.claude/crew/project.md` | the rules a wrong diff can satisfy — read by the worker and the reviewer |

Everything else here is placed by `crew init` and refreshed by it:
`crew.config.schema.json`, `githooks/`, `templates/task.md`. The skills in
`.claude/skills/crew-*` and `.claude/agents/crew-reviewer.md` are copies of the
package's, kept in-repo until the plugin is published — at which point they can
be deleted and installed with `/plugin install crew`.

```sh
npm run crew:doctor      # is this wired up?
npx crew preflight tv    # what this machine cannot prove
npx crew board           # render the board
```

## What is specific to Reflex

`env: tv` is the state that matters most. Decode, container support, HLS,
smoothness and audio over ARC cannot be answered on a laptop, and a loop that
marks them `done` is lying. `crew.config.json` declares `tv` as
`reachableFromAgents: false`, which is what makes `pending-tv` a status at all
— crew derives it from the config rather than knowing what a television is.

`dev/fixtures/` is gitignored, so every fresh worktree starts without a video
and one smoke step fails until `npm run fixture` runs. That is why it is in
`prepare`: `crew gate` runs it before verify, so no worker has to discover the
baseline the hard way.

The package is excluded from Reflex's own lint, typecheck and layer rules — it
is Node tooling for a repository whose app targets Chromium 53, and the two
have nothing to say to each other.
