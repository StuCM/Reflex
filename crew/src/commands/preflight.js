// What this machine can and cannot prove, before anyone tries.
//
// This exists because agents kept "fixing" failures that were the environment:
// a sideload with no device paired, a proxy 403 read as a broken request.
// Naming the ceiling up front is cheaper than three agents rediscovering it.

import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join, relative, resolve } from 'node:path';
import { branches, currentBranch, gitLines } from '../lib/git.js';
import { declaredFiles, readTask, readTasks } from '../lib/task.js';

/** Is this executable on PATH? Resolved without a shell. */
export const onPath = (bin) => {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
};

const environment = (cfg, target) => {
  const env = cfg.environments[target];
  if (!env) {
    const known = Object.keys(cfg.environments).join(', ') || '(none configured)';
    console.error(`unknown environment "${target}" — known: ${known}`);
    return 2;
  }

  console.log(`environment: ${target}`);
  console.log(`proves     : ${env.proves.join(', ')}`);

  if (env.reachableFromAgents === false) {
    console.log('\nNOT REACHABLE FROM AN AGENT.');
    if (env.note) console.log(env.note);
    console.log('\nA task needing this environment is code-complete at best.');
    console.log(`Set status: pending-${target} and stop. Do not try to make it pass here.`);
    return 3;
  }

  const missing = (cfg.deploy?.requires || []).filter((bin) => !onPath(bin));
  if (missing.length) {
    console.log(`\nmissing tools: ${missing.join(', ')}`);
    console.log('This machine cannot deploy. That is expected off the bench,');
    console.log('and is not a bug to fix.');
  }

  console.log(`\nverify: ${cfg.verify}`);
  if (cfg.prepare.length) console.log(`prepare: ${cfg.prepare.join(' && ')}`);
  return 0;
};

/**
 * Unmerged local branches whose commits already touch a task's declared files.
 * Advisory: it informs the spec and the dispatch, and never blocks — the board
 * only knows about tasks, and a commit on a branch nobody turned into a task
 * is invisible to it.
 */
const collisions = (cfg, taskArg) => {
  if (!taskArg) {
    console.error('usage: crew collisions <task-file>');
    return 2;
  }

  const path = resolve(cfg.root, taskArg);
  const task = readTask(path, relative(cfg.root, path));
  const declared = declaredFiles(task);
  if (!declared.length) return 0;

  const finished = new Set(
    readTasks(join(cfg.root, cfg.tasksDir))
      .filter((other) => other.meta.status === 'done')
      .map((other) => other.meta.branch)
      .filter(Boolean),
  );
  const skip = new Set([currentBranch(cfg.root), task.meta.branch, ...finished]);

  let hits = 0;
  for (const branch of branches(cfg.root)) {
    if (skip.has(branch)) continue;

    // One call per branch with every declared path as a pathspec. The old
    // version ran one per branch *per file*, which on a repo with real history
    // was hundreds of git processes to answer one advisory question.
    const lines = gitLines(
      ['log', '--format=commit %h %s', '--name-only', `HEAD..${branch}`, '--', ...declared],
      cfg.root,
    );

    // `commit ` prefixes the format string so a path can never be mistaken
    // for a header line — git's own `--name-only` output has no such marker.
    let commit = '';
    for (const line of lines) {
      if (line.startsWith('commit ')) {
        commit = line.slice('commit '.length);
      } else if (commit) {
        console.log(`${branch}  ${commit}  [${line}]`);
        hits++;
      }
    }
  }

  if (hits) {
    console.log(`\n${hits} unmerged commit(s) already touch these files.`);
    console.log('Read them before starting: git log -p HEAD..<branch> -- <file>');
  }
  return 0;
};

export const run = (cfg, [first, second]) => {
  if (first === 'collisions') return collisions(cfg, second);

  const target = first || Object.keys(cfg.environments)[0];
  if (!target) {
    console.log('no environments configured — nothing to say about this machine');
    console.log(`verify: ${cfg.verify}`);
    return 0;
  }
  if (!existsSync(join(cfg.root, '.git'))) console.log('note: not a git work tree\n');
  return environment(cfg, target);
};
