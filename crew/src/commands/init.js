// Installs crew into a repository: the config, the project brief, the task
// directory, the git hooks, and optionally the PreToolUse scope hook.
//
// Idempotent by rule: anything the project may have edited is written once and
// never overwritten. Only the files crew owns — the schema, the git hooks —
// are refreshed, which is what makes upgrading safe.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const PACKAGE = join(import.meta.dirname, '..', '..');
const HOOKS_PATH = join('.claude', 'crew', 'githooks');

// A project's own copy wins, so a template edited to suit the repo is not
// quietly replaced by the packaged one on every upgrade.
export const template = (cfg) => {
  const own = join(cfg.root, '.claude', 'crew', 'templates', 'task.md');
  const from = existsSync(own) ? own : join(PACKAGE, 'templates', 'task.md');
  process.stdout.write(readFileSync(from, 'utf8'));
  return 0;
};

const place = (root, from, to, { overwrite = false } = {}) => {
  const target = join(root, to);
  const had = existsSync(target);
  if (had && !overwrite) {
    console.log(`  kept    ${to}`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(PACKAGE, from), target);
  console.log(`  ${had ? 'updated' : 'wrote  '} ${to}`);
  return true;
};

const SCOPE_HOOK = {
  matcher: 'Edit|Write|NotebookEdit',
  hooks: [{ type: 'command', command: 'npx --no-install crew hook scope', timeout: 10 }],
};

/**
 * Adds the scope hook to .claude/settings.json without disturbing anything
 * else in it. Recognised by its command string, so running init twice does
 * not install it twice.
 */
const addScopeHook = (root) => {
  const path = join(root, '.claude', 'settings.json');
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];

  const already = settings.hooks.PreToolUse.some((entry) =>
    (entry.hooks || []).some((hook) => (hook.command || '').includes('crew hook scope')),
  );
  if (already) {
    console.log('  kept    .claude/settings.json (scope hook already present)');
    return;
  }

  settings.hooks.PreToolUse.push(SCOPE_HOOK);
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  console.log('  updated .claude/settings.json (PreToolUse scope hook)');
};

export const run = (root, args) => {
  console.log(`crew: installing into ${root}\n`);

  mkdirSync(join(root, '.claude', 'tasks'), { recursive: true });

  place(root, 'templates/crew.config.json', '.claude/crew.config.json');
  place(root, 'templates/project.md', '.claude/crew/project.md');
  place(root, 'templates/task.md', '.claude/crew/templates/task.md');
  place(root, 'schema/crew.config.schema.json', '.claude/crew/crew.config.schema.json', {
    overwrite: true,
  });

  for (const hook of ['commit-msg', 'pre-commit']) {
    place(root, `githooks/${hook}`, join(HOOKS_PATH, hook), { overwrite: true });
    chmodSync(join(root, HOOKS_PATH, hook), 0o755);
  }

  // git exits 1 when the key is unset, which is the common case, not an error.
  let hooksPath = '';
  try {
    hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    hooksPath = '';
  }

  if (hooksPath === HOOKS_PATH) {
    console.log('  kept    core.hooksPath');
  } else if (hooksPath) {
    // Someone else's hooks are installed. Say so rather than taking over.
    console.log(`\n  core.hooksPath is "${hooksPath}", leaving it alone.`);
    console.log(`  To use crew's: git config core.hooksPath ${HOOKS_PATH}`);
  } else {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { cwd: root });
    console.log('  set     core.hooksPath');
  }

  if (args.includes('--hook')) addScopeHook(root);

  console.log(`
next:
  1. edit .claude/crew.config.json — project, verify, environments
  2. write .claude/crew/project.md — the rules that make a wrong diff look right
  3. npx crew doctor
`);
  if (!args.includes('--hook')) {
    console.log('  (--hook also installs the PreToolUse scope hook, which refuses a');
    console.log('   write outside files: instead of reporting it afterwards)\n');
  }
  return 0;
};
