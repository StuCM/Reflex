#!/usr/bin/env node
// Points git at the crew hooks. Run by `npm install` via the prepare script,
// because core.hooksPath is per-clone and does not travel with the repo — a
// fresh clone would otherwise have the commit convention as advice only.
//
// Never fails the install: no git, no .git directory, or a checkout used as a
// dependency should all be quiet no-ops.
'use strict';

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var root = path.resolve(__dirname, '..', '..', '..');
var hooks = path.join('.claude', 'crew', 'githooks');

if (!fs.existsSync(path.join(root, '.git'))) process.exit(0);
if (!fs.existsSync(path.join(root, hooks))) process.exit(0);

try {
  var current = '';
  try {
    current = execFileSync('git', ['config', '--get', 'core.hooksPath'],
                           { cwd: root, encoding: 'utf8' }).trim();
  } catch (e) { /* unset — git exits 1 */ }

  if (current === hooks) process.exit(0);

  // Someone else's hooks are already installed. Say so rather than
  // silently taking them over.
  if (current) {
    console.log('crew: core.hooksPath is "' + current + '", leaving it alone.');
    console.log('crew: run `npm run crew:setup` to switch to the crew hooks.');
    process.exit(0);
  }

  execFileSync('git', ['config', 'core.hooksPath', hooks], { cwd: root });
  console.log('crew: commit hook enabled');
} catch (e) {
  console.log('crew: could not set core.hooksPath (' + e.message + ')');
}
