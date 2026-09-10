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
  .filter(Boolean);

// oxfmt formats JSON as well as JavaScript, so a version bump in package.json
// is its business too — filtering to .js here is how one slipped past into CI.
const SCRIPT = /\.(js|mjs|cjs|ts|mts|cts)$/;
const FORMATTED = /\.(js|mjs|cjs|ts|mts|cts|json|jsonc)$/;

const toFormat = staged.filter((file) => FORMATTED.test(file));
const toLint = staged.filter((file) => SCRIPT.test(file));

if (!toFormat.length && !toLint.length) process.exit(0);

function run(tool, args, files) {
  if (!files.length) return true;
  try {
    execFileSync(path.join(root, 'node_modules', '.bin', tool), args.concat(files), {
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

if (!run('oxfmt', ['--check'], toFormat)) {
  console.error('\n  Run `npm run format` and stage the result.\n');
  process.exit(1);
}
if (!run('oxlint', [], toLint)) process.exit(1);
