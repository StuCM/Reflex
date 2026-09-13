// Is this project's crew installation actually wired up?
//
// Every misconfiguration used to surface as a stack trace from whichever
// script hit the missing key first — `cfg.deploy.requires` on a config with no
// deploy block being the common one. One command that reports all of it beats
// six that each crash differently.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { branches, git } from '../lib/git.js';
import { problems, statuses } from '../lib/config.js';
import { readTasks } from '../lib/task.js';
import { onPath } from './preflight.js';

const HOOKS = join('.claude', 'crew', 'githooks');

export const run = (cfg) => {
  const notes = [];
  const fails = [];

  for (const problem of problems(cfg)) fails.push(problem);

  const hooksPath = (git(['config', '--get', 'core.hooksPath'], cfg.root) || '').trim();
  if (!hooksPath) {
    fails.push('git has no core.hooksPath — the commit convention is advice only');
    notes.push(`  fix: git config core.hooksPath ${HOOKS}`);
  } else if (!existsSync(join(cfg.root, hooksPath))) {
    fails.push(`core.hooksPath is "${hooksPath}", which does not exist`);
  } else if (!existsSync(join(cfg.root, hooksPath, 'commit-msg'))) {
    fails.push(`core.hooksPath is "${hooksPath}" but has no commit-msg hook`);
  }

  if (!existsSync(join(cfg.root, cfg.projectBrief))) {
    fails.push(`no ${cfg.projectBrief} — the roles have no project rules to include`);
  }

  const settings = join(cfg.root, '.claude', 'settings.json');
  if (existsSync(settings)) {
    if (!readFileSync(settings, 'utf8').includes('crew hook scope')) {
      notes.push('note: no PreToolUse scope hook in .claude/settings.json — scope creep is');
      notes.push('      caught at the gate rather than prevented. See `crew init --hook`.');
    }
  }

  // Only what an environment says it needs. Falling back to deploy.requires
  // told every project that its laptop was missing the sideload tools.
  for (const [name, env] of Object.entries(cfg.environments)) {
    if (env.reachableFromAgents === false) continue;
    const missing = (env.requires || []).filter((bin) => !onPath(bin));
    if (missing.length)
      notes.push(`note: ${name} cannot run: ${missing.join(', ')} is not on PATH`);
  }

  const known = statuses(cfg);
  const live = new Set(branches(cfg.root));

  for (const task of readTasks(join(cfg.root, cfg.tasksDir))) {
    if (!known[task.meta.status]) {
      fails.push(
        `${task.file}: status "${task.meta.status}" is not one of ${Object.keys(known).join(', ')}`,
      );
    }
    // Only while the branch is still around. A task whose branch is gone was
    // merged and cleaned up, and reporting its missing stamp is 20 lines of
    // history telling you nothing you can act on.
    if (task.meta.status === 'done' && task.meta.gate !== 'pass' && live.has(task.meta.branch)) {
      notes.push(
        `note: ${task.file} is done with no gate stamp — run \`crew gate\` before closing it`,
      );
    }
  }

  console.log(`crew: ${cfg.project || '(unnamed project)'} at ${cfg.root}`);
  console.log(`verify: ${cfg.verify || '(unset)'}`);
  console.log(`statuses: ${Object.keys(known).join(', ')}`);
  console.log('');

  for (const note of notes) console.log(note);
  if (!fails.length) {
    console.log(notes.length ? '' : 'nothing wrong.');
    return 0;
  }

  console.error(`\n${fails.length} problem(s):\n`);
  for (const fail of fails) console.error(`  ${fail}`);
  return 1;
};
