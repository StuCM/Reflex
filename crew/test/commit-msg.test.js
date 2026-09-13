import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowedScopes, check } from '../src/commands/commit-msg.js';
import { config, sandbox } from './helpers.js';

const cfg = (overrides = {}) =>
  config('/nowhere', {
    commit: {
      types: ['feat', 'fix', 'docs', 'chore'],
      subjectMax: 72,
      bodyMaxLines: 4,
      requireScope: false,
      banned: ['Co-Authored-By:', 'Claude-Session:'],
      ...overrides,
    },
    scopes: { fromDir: [], extra: [] },
  });

test('a conforming subject passes', () => {
  assert.deepEqual(check('feat(player): play the next episode when one ends\n', cfg()), []);
});

test('the type must be one of the configured ones', () => {
  const errors = check('wibble: do a thing\n', cfg());
  assert.ok(errors.some((e) => e.includes('type(scope): summary')));
  assert.ok(errors.some((e) => e.includes('feat, fix, docs, chore')));
});

// The old check listed two casings of the same footer as separate needles, so
// a third casing committed clean.
test('a banned footer is caught in any casing', () => {
  for (const footer of [
    'Co-Authored-By:',
    'Co-authored-by:',
    'CO-AUTHORED-BY:',
    'co-authored-by:',
  ]) {
    const errors = check(`fix: a thing\n\n${footer} Someone <x@y>\n`, cfg());
    assert.ok(
      errors.some((e) => e.includes('commit attribution')),
      `${footer} was not caught`,
    );
  }
});

test('an over-long subject is rejected with its length', () => {
  const errors = check(`fix: ${'x'.repeat(80)}\n`, cfg());
  assert.ok(errors.some((e) => /subject is 85 chars, max 72/.test(e)));
});

test('a full stop and a capital are both rejected', () => {
  const errors = check('fix: Correct the thing.\n', cfg());
  assert.ok(errors.some((e) => e.includes('full stop')));
  assert.ok(errors.some((e) => e.includes('starts lowercase: "correct the thing."')));
});

// An acronym is not a capitalised sentence: `fix: HLS stream stalls` is right.
test('an all-caps opening word is left alone', () => {
  assert.deepEqual(check('fix: HLS stream stalls on seek\n', cfg()), []);
});

test('past tense and third person are rejected', () => {
  for (const summary of [
    'added a thing',
    'adds a thing',
    'implemented a thing',
    'renamed a thing',
    'bumped the version',
  ]) {
    const errors = check(`fix: ${summary}\n`, cfg());
    assert.ok(
      errors.some((e) => e.includes('imperative')),
      `"${summary}" was allowed`,
    );
  }
});

test('the imperative form of the same verbs is fine', () => {
  for (const summary of [
    'add a thing',
    'implement a thing',
    'rename a thing',
    'bump the version',
  ]) {
    assert.deepEqual(check(`fix: ${summary}\n`, cfg()), [], `"${summary}" was rejected`);
  }
});

test('a body over the line limit is rejected, and comment lines do not count', () => {
  const body = ['one', 'two', 'three', 'four', 'five'].join('\n');
  assert.ok(check(`fix: a thing\n\n${body}\n`, cfg()).some((e) => e.includes('body is 5 lines')));

  const commented = `fix: a thing\n\none\ntwo\n# ignored\n# ignored\n# ignored\n`;
  assert.deepEqual(check(commented, cfg()), []);
});

test('a missing blank line after the subject is rejected', () => {
  const errors = check('fix: a thing\nstraight into the body\n', cfg());
  assert.ok(errors.some((e) => e.includes('blank line')));
});

test('merges and fixups are left alone', () => {
  assert.deepEqual(check('Merge branch "main" into crew/007\n', cfg()), []);
  assert.deepEqual(check('fixup! feat(x): a thing\n', cfg()), []);
});

test('scopes are derived from the source tree, deduplicated and sorted', () => {
  const root = sandbox();
  mkdirSync(join(root, 'src', 'api'), { recursive: true });
  mkdirSync(join(root, 'src', 'screen'), { recursive: true });
  writeFileSync(join(root, 'src', 'api', 'plex.ts'), '');
  writeFileSync(join(root, 'src', 'screen', 'plex.ts'), '');
  writeFileSync(join(root, 'src', 'main.ts'), '');

  const scopes = allowedScopes({ root, scopes: { fromDir: ['src'], extra: ['docs'] } });

  assert.deepEqual(scopes, ['api', 'docs', 'main', 'plex', 'screen']);
  assert.equal(new Set(scopes).size, scopes.length, 'duplicates leaked through');
});

test('an unknown scope is rejected and the allowed list is shown', () => {
  const root = sandbox();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), '');

  const withScopes = { ...cfg(), root, scopes: { fromDir: ['src'], extra: [] } };
  assert.ok(
    check('fix(nope): a thing\n', withScopes).some((e) => e.includes('unknown scope "nope"')),
  );
  assert.deepEqual(check('fix(main): a thing\n', withScopes), []);
});
