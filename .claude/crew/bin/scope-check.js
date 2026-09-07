#!/usr/bin/env node
// Compares what a task actually touched against the files its spec declared.
// Scope creep becomes a diff, not a judgement call.
//
//   node .claude/crew/bin/scope-check.js <task-file> [base-ref]
'use strict';

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

var root = path.resolve(__dirname, '..', '..', '..');
var cfg = require(path.join(root, '.claude', 'crew.config.json'));

var taskFile = process.argv[2];
var base = process.argv[3] || defaultBase();

if (!taskFile) {
  console.error('usage: scope-check.js <task-file> [base-ref]');
  process.exit(2);
}

var spec = fs.readFileSync(path.resolve(root, taskFile), 'utf8');
var declared = parseFiles(spec);

if (!declared.length) {
  console.error('scope-check: the spec declares no files: — cannot check scope');
  process.exit(2);
}

var changed = sh('git diff --name-only ' + base + '...HEAD')
  .concat(sh('git diff --name-only HEAD'))
  .concat(sh('git ls-files --others --exclude-standard'))
  .filter(unique);

/* The worker's own bookkeeping is never scope creep: the role requires writing
   status and notes into the task file and re-rendering the board, and neither
   is ever in files:. Without this the gate can only pass if it is run before
   the worker does what it was told to do. */
var bookkeeping = [taskFile.replace(/^\.\//, ''), '.claude/tasks/BOARD.md'];

var stray = changed.filter(function (f) {
  if (bookkeeping.indexOf(f) !== -1) return false;
  return !declared.some(function (d) { return match(f, d); });
});

var comments = commentDelta(base);

console.log('base           : ' + base);
console.log('files declared : ' + declared.length);
console.log('files changed  : ' + changed.length);
console.log('comment lines  : +' + comments.added + ' / -' + comments.removed +
            ' (' + comments.pct + '% of added lines)');

if (comments.pct > cfg.comments.warnAddedRatio * 100) {
  console.log('\nnote: comments are ' + comments.pct + '% of added lines. Check they');
  console.log('      explain a non-obvious why, not the reasoning that got there.');
}

if (stray.length) {
  console.log('\nOUT OF SCOPE — not declared in the spec:');
  stray.forEach(function (f) { console.log('  ' + f); });
  console.log('\nEither the spec was wrong (amend it, say why) or this is scope creep.');
  process.exit(1);
}

console.log('\nin scope');

// ---------------------------------------------------------------------

// The branch point, not a branch tip. Either tip can be the stale one — workers
// never push, so origin/main is routinely behind local main here, and preferring
// it made every landed commit since the last push read as scope creep. A merge
// base is right whichever way round they are.
function defaultBase() {
  var branch = (cfg.baseBranch || 'main');
  var refs = [branch, 'origin/' + branch];
  for (var i = 0; i < refs.length; i++) {
    try {
      return execSync('git merge-base HEAD ' + refs[i],
                      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) { /* no such ref in this checkout; try the next */ }
  }
  return branch;
}

function parseFiles(text) {
  var m = /^files:\s*$/m.exec(text);
  if (!m) return [];
  var rest = text.slice(m.index + m[0].length).split('\n');
  var out = [];
  for (var i = 0; i < rest.length; i++) {
    var line = rest[i];
    if (/^\s*-\s+\S/.test(line)) out.push(line.replace(/^\s*-\s+/, '').trim());
    else if (line.trim() !== '') break;
  }
  return out;
}

// Declared entries may be exact paths or a trailing-* prefix.
function match(file, decl) {
  if (decl.slice(-1) === '*') return file.indexOf(decl.slice(0, -1)) === 0;
  return file === decl;
}

function commentDelta(ref) {
  var diff = '';
  try {
    diff = execSync('git diff ' + ref + '...HEAD -- . && git diff HEAD -- .',
                    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) { return { added: 0, removed: 0, pct: 0 }; }

  var added = 0, removed = 0, addedAll = 0;
  diff.split('\n').forEach(function (l) {
    if (/^\+\+\+|^---/.test(l)) return;
    if (l.charAt(0) === '+') {
      addedAll++;
      if (/^\+\s*(\/\/|\/\*|\*|#)/.test(l)) added++;
    } else if (l.charAt(0) === '-') {
      if (/^-\s*(\/\/|\/\*|\*|#)/.test(l)) removed++;
    }
  });
  return {
    added: added,
    removed: removed,
    pct: addedAll ? Math.round((added / addedAll) * 100) : 0
  };
}

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' })
      .split('\n').filter(function (s) { return s.trim() !== ''; });
  } catch (e) { return []; }
}

function unique(v, i, a) { return a.indexOf(v) === i; }
