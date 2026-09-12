import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, git, gitLines, headSha, isClean } from '../src/lib/git.js';
import { sandbox } from './helpers.js';

const repo = () => {
  const root = sandbox();
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(root, 'a.txt'), 'one\n');
  run('add', '-A');
  run('commit', '-qm', 'first');
  return root;
};

test('git never reaches a shell', () => {
  const root = repo();
  const marker = join(root, 'pwned');
  const hostile = `a.txt$(touch ${marker})`;

  // Control: the same string through a shell really does run the command, so a
  // pass below means the argv path is doing the work — not that the payload is
  // inert. Without this the test could pass on any typo.
  execSync(`git log --oneline -- "${hostile}"`, { cwd: root, stdio: 'ignore' });
  assert.ok(existsSync(marker), 'the control did not fire — the payload is wrong');
  rmSync(marker);

  gitLines(['log', '--oneline', '--', hostile], root);
  git(['diff', '--name-only', hostile], root);
  assert.ok(!existsSync(marker), 'a declared path reached the shell');
});

test('a failing git call is an empty answer, not a throw', () => {
  const root = repo();
  assert.deepEqual(gitLines(['log', 'no-such-ref'], root), []);
  assert.equal(git(['rev-parse', 'no-such-ref'], root), null);
});

test('changedFiles sees committed, uncommitted and untracked paths, once each', () => {
  const root = repo();
  const base = headSha(root);

  writeFileSync(join(root, 'a.txt'), 'two\n');
  writeFileSync(join(root, 'b.txt'), 'new\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'second'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, 'a.txt'), 'three\n');

  const changed = changedFiles(base, root);
  assert.deepEqual([...changed].toSorted(), ['a.txt', 'b.txt']);
  assert.equal(new Set(changed).size, changed.length, 'a path appeared twice');
});

test('isClean is false with an uncommitted change', () => {
  const root = repo();
  assert.ok(isClean(root));
  writeFileSync(join(root, 'a.txt'), 'changed\n');
  assert.ok(!isClean(root));
});
