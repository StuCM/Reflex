#!/usr/bin/env node
// oxfmt and oxlint over the staged files only. Both are Rust and finish in
// milliseconds, so this stays a hook rather than becoming a reason to pass
// --no-verify. Anything slower (types, tests, the smoke suite) is CI's job.
//
// Never blocks on its own failure to run: a missing tool is a warning, because
// a hook that breaks committing is a hook that gets disabled.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => /\.(js|mjs|cjs|ts|mts|cts)$/.test(file));

if (!staged.length) process.exit(0);

function run(tool, args) {
  try {
    execFileSync(path.join(root, 'node_modules', '.bin', tool), args.concat(staged), {
      cwd: root,
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`  pre-commit: ${tool} is not installed — skipping. npm install`);
      return true;
    }
    return false;
  }
}

const formatted = run('oxfmt', ['--check']);
if (!formatted) {
  console.error('\n  Run `npm run format` and stage the result.\n');
  process.exit(1);
}
if (!run('oxlint', [])) process.exit(1);
