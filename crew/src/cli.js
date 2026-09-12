#!/usr/bin/env node
// One entry point. Everything crew knows how to do without a model.

import { loadConfig } from './lib/config.js';
import { repoRoot } from './lib/git.js';

const USAGE = `crew — a task loop for agents

  crew init [--hook]        install crew into this repository
  crew doctor               is this installation actually wired up?

  crew spec-template        print the task template, for a new spec
  crew graph <what>         read the memory graph: prime, prefs, traps, find
  crew collisions <task>    unmerged branches already touching its files:
  crew preflight [env]      what this machine can and cannot prove

  crew gate <task>          prepare + scope + verify, then stamp the commit
  crew gate --check <task>  has the gate passed on the code that is here?
  crew scope <task> [base]  changed files against the spec's files:
  crew review <task>        open a review round, refusing one past the limit
  crew board                render BOARD.md from the task files
  crew log <task> <event>   append one line to the cost log

  crew commit-msg <file>    the commit convention (git hook)
  crew pre-commit           staged-file format and lint (git hook)
  crew hook scope           PreToolUse: refuse a write outside files:
`;

// Loaded on demand: a git hook should not parse nine modules to check a
// subject line, and `init` has to run before there is a config to load.
const COMMANDS = {
  'commit-msg': () => import('./commands/commit-msg.js'),
  'pre-commit': () => import('./commands/pre-commit.js'),
  scope: () => import('./commands/scope-check.js'),
  board: () => import('./commands/board.js'),
  preflight: () => import('./commands/preflight.js'),
  gate: () => import('./commands/gate.js'),
  doctor: () => import('./commands/doctor.js'),
  log: () => import('./commands/log.js'),
  review: () => import('./commands/review.js'),
  graph: () => import('./commands/graph.js'),
  init: () => import('./commands/init.js'),
  'spec-template': () => import('./commands/init.js').then((m) => ({ run: m.template })),
};

const main = async (argv) => {
  let [name, ...args] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    console.log(USAGE);
    return name ? 0 : 2;
  }

  // Aliases for the two shapes that read better as their own verb.
  if (name === 'collisions') [name, args] = ['preflight', ['collisions', ...args]];
  if (name === 'hook') [name, args] = [`hook-${args[0] || ''}`, args.slice(1)];

  if (name === 'hook-scope') {
    // A hook must never break the session it is advising. Anything unexpected
    // means no decision, which leaves the normal permission flow in charge.
    try {
      const root = repoRoot();
      if (!root) return 0;
      const { run } = await import('./commands/hook-scope.js');
      return run(loadConfig(root), args);
    } catch {
      return 0;
    }
  }

  const load = COMMANDS[name];
  if (!load) {
    console.error(`crew: unknown command "${name}"\n`);
    console.log(USAGE);
    return 2;
  }

  const root = repoRoot();
  if (!root) {
    console.error('crew: not a git work tree');
    return 2;
  }

  const { run } = await load();
  if (name === 'init') return run(root, args);

  try {
    return run(loadConfig(root), args);
  } catch (error) {
    if (error.crew) {
      console.error(`crew: ${error.message}`);
      return 2;
    }
    throw error;
  }
};

main(process.argv.slice(2)).then((code) => process.exit(code));
