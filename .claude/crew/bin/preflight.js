#!/usr/bin/env node
// Says what this machine can and cannot prove, before anyone tries.
//
// This exists because agents kept "fixing" failures that were the environment:
// a sideload with no TV paired, a proxy 403 read as a broken request. Naming
// the ceiling up front is cheaper than three agents rediscovering it.
'use strict';

var path = require('path');
var execSync = require('child_process').execSync;

var fs = require('fs');
var root = path.resolve(__dirname, '..', '..', '..');
var cfg = require(path.join(root, '.claude', 'crew.config.json'));

// stderr is swallowed on purpose: outside a repo, git's complaint is not this
// script's news to break.
var GIT = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

if (process.argv[2] === 'collisions') {
  collisions(process.argv[3]);
  process.exit(0);
}

var target = process.argv[2] || 'laptop';
var env = cfg.environments[target];

if (!env) {
  console.error('unknown environment "' + target + '" — known: ' +
                Object.keys(cfg.environments).join(', '));
  process.exit(2);
}

console.log('environment: ' + target);
console.log('proves     : ' + env.proves.join(', '));

if (env.reachableFromAgents === false) {
  console.log('\nNOT REACHABLE FROM AN AGENT.');
  console.log(env.note || '');
  console.log('\nA task needing this environment is code-complete at best.');
  console.log('Mark it pending-tv and stop. Do not try to make it pass here.');
  process.exit(3);
}

var missing = (cfg.deploy.requires || []).filter(function (bin) {
  try { execSync('command -v ' + bin, { stdio: 'ignore' }); return false; }
  catch (e) { return true; }
});

if (missing.length) {
  console.log('\nmissing tools: ' + missing.join(', '));
  console.log('This machine cannot deploy. That is expected off the TV bench,');
  console.log('and is not a bug to fix.');
}

console.log('\nverify: ' + cfg.verify);

// ---------------------------------------------------------------------

// Names unmerged local branches whose commits already touch a task's declared
// files. Advisory: it informs the spec and the dispatch, and never blocks —
// anything git cannot answer prints nothing and still exits 0.
function collisions(taskFile) {
  if (!taskFile) {
    console.error('usage: preflight.js collisions <task-file>');
    process.exit(2);
  }

  var spec = fs.readFileSync(path.resolve(root, taskFile), 'utf8');
  var declared = parseFiles(spec);
  if (!declared.length) return;

  var skip = [currentBranch(), field(spec, 'branch')].concat(doneBranches());
  var hits = 0;

  sh('git for-each-ref --format="%(refname:short)" refs/heads').forEach(function (branch) {
    if (skip.indexOf(branch) !== -1) return;
    declared.forEach(function (file) {
      sh('git log --oneline "HEAD..' + branch + '" -- "' + file + '"').forEach(function (line) {
        console.log(branch + '  ' + line + '  [' + file + ']');
        hits++;
      });
    });
  });

  if (hits) {
    console.log('\n' + hits + ' unmerged commit(s) already touch these files.');
    console.log('Read them before starting: git log -p HEAD..<branch> -- <file>');
  }
}

// crew/* branches of finished tasks are merged history, not work in flight.
function doneBranches() {
  var dir = path.join(root, '.claude', 'tasks');
  var out = [];
  fs.readdirSync(dir).forEach(function (f) {
    if (!/^\d{3}-.*\.md$/.test(f)) return;
    var text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (field(text, 'status') !== 'done') return;
    var branch = field(text, 'branch');
    if (branch) out.push(branch);
  });
  return out;
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', GIT).trim();
  } catch (e) { return ''; }
}

function field(text, key) {
  var m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(text);
  return m ? m[1].trim() : null;
}

// ponytail: same shape as scope-check.js's parser — the two scripts are run
// standalone and share no module, so there is nothing to import.
function parseFiles(text) {
  var m = /^files:\s*$/m.exec(text);
  if (!m) return [];
  var rest = text.slice(m.index + m[0].length).split('\n');
  var out = [];
  for (var i = 0; i < rest.length; i++) {
    if (/^\s*-\s+\S/.test(rest[i])) out.push(rest[i].replace(/^\s*-\s+/, '').trim());
    else if (rest[i].trim() !== '') break;
  }
  return out;
}

function sh(cmd) {
  try {
    return execSync(cmd, GIT)
      .split('\n').filter(function (s) { return s.trim() !== ''; });
  } catch (e) { return []; }
}
