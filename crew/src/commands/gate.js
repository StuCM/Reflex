// The deterministic gate, and the proof that it ran.
//
// `status: done` used to be an unverified self-report: a worker could write it
// having skipped the gate, or having run it four commits ago, and nothing
// downstream could tell. The gate now stamps the commit it passed on, and
// `crew gate --check` refuses a stamp that does not match HEAD.

import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { git, headSha, isClean } from '../lib/git.js';
import { bookkeeping, declaredFiles, readTask, setField } from '../lib/task.js';
import { run as scopeCheck } from './scope-check.js';

// Commands come from crew.config.json, which a person writes. Agent-authored
// strings (a spec's files:, a branch name) never reach a shell — see lib/git.js.
const shell = (command, cfg) => {
  console.log(`\n$ ${command}`);
  try {
    execSync(command, { cwd: cfg.root, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
};

export const run = (cfg, args) => {
  const check = args.includes('--check');
  const taskArg = args.find((arg) => !arg.startsWith('-'));
  if (!taskArg) {
    console.error('usage: crew gate [--check] <task-file>');
    return 2;
  }

  const path = resolve(cfg.root, taskArg);
  const task = readTask(path, relative(cfg.root, path));
  const head = headSha(cfg.root);

  if (check) {
    const { gate, gateSha } = task.meta;
    if (gate !== 'pass') {
      console.error(
        `gate: ${task.file} has no passing gate stamp — run \`npx crew gate\` in the worktree`,
      );
      return 1;
    }
    if (!gateSha) {
      console.error(`gate: ${task.file} is stamped pass with no commit — re-run the gate`);
      return 1;
    }

    // The stamp certifies a commit, but the worker still has to commit its own
    // bookkeeping afterwards, which moves HEAD. So the invariant is not
    // "HEAD equals the stamp" — it is "nothing but bookkeeping has moved
    // since". Anything else means code landed that the gate never saw.
    const allowed = bookkeeping(cfg, task);
    const since =
      gateSha === head
        ? []
        : (git(['diff', '--name-only', `${gateSha}..HEAD`], cfg.root) || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    const unproved = since.filter((file) => !allowed.includes(file));

    if (unproved.length) {
      console.error(
        `gate: ${unproved.length} file(s) changed since the gate passed on ${gateSha}:`,
      );
      for (const file of unproved) console.error(`  ${file}`);
      console.error('\n      re-run the gate — this code has not been proved');
      return 1;
    }
    console.log(`gate: stamped pass on ${gateSha} at ${task.meta.gateAt}`);
    if (since.length) console.log(`      ${since.length} bookkeeping commit(s) since, no code`);
    return 0;
  }

  if (!declaredFiles(task).length) {
    console.error(`gate: ${task.file} declares no files: — the spec is incomplete`);
    return 2;
  }

  for (const command of cfg.prepare) {
    if (!shell(command, cfg)) {
      console.error(
        `\ngate: \`${command}\` failed. That is the bench, not the diff — fix it first.`,
      );
      return 1;
    }
  }

  console.log('\n$ crew scope');
  if (scopeCheck(cfg, [taskArg]) !== 0) return 1;

  if (!cfg.verify) {
    console.error('\ngate: `verify` is unset in crew.config.json — nothing to prove the task with');
    return 2;
  }
  if (!shell(cfg.verify, cfg)) {
    console.error('\ngate: verify failed. Do not ask for review on work that does not build.');
    return 1;
  }

  // A stamp on a dirty tree would certify a commit that does not contain what
  // was proved.
  if (!isClean(cfg.root)) {
    console.error('\ngate: passed, but the work tree is dirty — commit, then run the gate again.');
    return 1;
  }

  setField(path, 'gate', 'pass');
  setField(path, 'gateSha', headSha(cfg.root));
  setField(path, 'gateAt', new Date().toISOString());
  console.log(`\ngate: passed and stamped on ${headSha(cfg.root)}`);
  return 0;
};
