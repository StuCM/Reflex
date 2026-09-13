import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  declaredFiles,
  frontmatter,
  inScope,
  matches,
  readTask,
  setField,
} from '../src/lib/task.js';
import { sandbox, task, writeTask } from './helpers.js';

test('frontmatter reads the fenced block and ignores the body', () => {
  const meta = frontmatter(task());
  assert.equal(meta.status, 'building');
  assert.deepEqual(meta.files, ['src/a.ts']);
});

// The old parsers matched ^key: anywhere in the file. This task body contains
// both a `status:` line and a second `files:` list, so a parser that scans the
// whole text picks up the wrong one — and a spec whose body discusses files
// would silently change what the gate enforces.
test('a body that looks like frontmatter does not win', () => {
  const meta = frontmatter(task({ status: 'review' }));
  assert.equal(meta.status, 'review');
  assert.deepEqual(meta.files, ['src/a.ts']);
  assert.ok(!meta.files.includes('src/definitely-not-declared.ts'));
});

test('declaredFiles strips a leading ./ and drops blanks', () => {
  const meta = { meta: { files: ['./src/a.ts', '', 'src/b.ts'] } };
  assert.deepEqual(declaredFiles(meta), ['src/a.ts', 'src/b.ts']);
});

test('matches: exact, prefix star, trailing slash', () => {
  assert.ok(matches('src/a.ts', 'src/a.ts'));
  assert.ok(!matches('src/a.ts', 'src/a'));
  assert.ok(matches('src/api/plex.ts', 'src/api/*'));
  assert.ok(matches('css/detail.css', 'css/'));
  assert.ok(!matches('cssx/detail.css', 'css/'));
});

// A bare path must not authorise its subtree, or declaring `src/api` in a spec
// would quietly permit every file under it.
test('a bare path does not authorise the directory below it', () => {
  assert.ok(!matches('src/api/plex.ts', 'src/api'));
  assert.ok(!inScope('src/api/plex.ts', ['src/api']));
});

test('setField replaces one line and leaves the body alone', () => {
  const root = sandbox();
  const path = writeTask(root, '007-thing.md', task());

  setField(path, 'status', 'done');
  const after = readFileSync(path, 'utf8');

  assert.equal(readTask(path).meta.status, 'done');
  assert.match(after, /^# A thing$/m);
  assert.match(after, /Body text that happens to contain/);
  assert.equal(readTask(path).meta.branch, 'crew/007-thing');
});

test('setField adds a field that is not there yet', () => {
  const root = sandbox();
  const path = writeTask(root, '007-thing.md', task());

  setField(path, 'gateSha', 'abc1234');
  assert.equal(readTask(path).meta.gateSha, 'abc1234');
  assert.deepEqual(readTask(path).meta.files, ['src/a.ts']);
});
