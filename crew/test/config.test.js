import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH, loadConfig, problems, statuses } from '../src/lib/config.js';
import { config, sandbox } from './helpers.js';

const write = (root, cfg) => {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, CONFIG_PATH), JSON.stringify(cfg));
};

test('a minimal config still gets a working loop', () => {
  const root = sandbox();
  write(root, { project: 'Small', verify: 'npm test' });

  const cfg = loadConfig(root);
  assert.equal(cfg.baseBranch, 'main');
  assert.equal(cfg.branchPrefix, 'crew/');
  assert.equal(cfg.reviewRounds, 2);
  assert.equal(cfg.commit.subjectMax, 72);
  assert.deepEqual(cfg.commit.types.slice(0, 2), ['feat', 'fix']);
  assert.deepEqual(problems(cfg), []);
});

test('a nested block merges key by key over the defaults', () => {
  const root = sandbox();
  write(root, { project: 'P', verify: 'x', commit: { subjectMax: 50 } });

  const cfg = loadConfig(root);
  assert.equal(cfg.commit.subjectMax, 50);
  assert.ok(cfg.commit.types.includes('feat'), 'the default types were dropped');
});

test('$schema is not treated as a setting', () => {
  const root = sandbox();
  write(root, { $schema: './x.json', project: 'P', verify: 'x' });
  assert.ok(!('$schema' in loadConfig(root)));
});

test('a string where a list belongs is accepted', () => {
  const root = sandbox();
  write(root, {
    project: 'P',
    verify: 'x',
    scopes: { fromDir: 'src' },
    prepare: 'npm run fixture',
  });

  const cfg = loadConfig(root);
  assert.deepEqual(cfg.scopes.fromDir, ['src']);
  assert.deepEqual(cfg.prepare, ['npm run fixture']);
});

test('a missing config and broken JSON both say what to do', () => {
  const root = sandbox();
  assert.throws(() => loadConfig(root), /crew init/);

  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, CONFIG_PATH), '{ not json');
  assert.throws(() => loadConfig(root), /not valid JSON/);
});

test('problems names every fault at once, not the first', () => {
  const root = sandbox();
  const found = problems(
    config(root, {
      project: 'CHANGE-ME',
      verify: null,
      reviewRounds: 0,
      comments: { warnAddedRatio: 4, extensions: [] },
      scopes: { fromDir: ['nope'], extra: [] },
      environments: { laptop: { proves: [] } },
      deploy: { note: 'no command' },
    }),
  );

  const text = found.join('\n');
  assert.ok(found.length >= 6, `expected several problems, got ${found.length}`);
  for (const key of [
    '`project`',
    '`verify`',
    '`reviewRounds`',
    'warnAddedRatio',
    '"nope"',
    'laptop',
    '`deploy`',
  ]) {
    assert.ok(text.includes(key), `${key} was not reported`);
  }
});

// This is how `pending-tv` stopped being hardcoded in the board: any
// environment an agent cannot reach earns a status of its own, so
// code-complete work cannot call itself done.
test('an unreachable environment creates its own pending status', () => {
  const known = statuses(
    config('/nowhere', {
      environments: {
        laptop: { proves: ['tests'] },
        tv: { proves: ['decode'], reachableFromAgents: false, note: 'only a person at the panel' },
      },
    }),
  );

  assert.ok(known['pending-tv'], 'no pending status for the unreachable environment');
  assert.equal(known['pending-tv'].waitsOnUser, 'only a person at the panel');
  assert.equal(known['pending-tv'].pendingEnv, 'tv');
  assert.ok(!known['pending-laptop'], 'a reachable environment should not get one');
  assert.ok(known.draft.waitsOnUser && known.blocked.waitsOnUser);
  assert.ok(known.building.inFlight && known.review.inFlight);
});

test('the blocked reason quotes the configured round limit', () => {
  assert.match(statuses(config('/x', { reviewRounds: 3 })).blocked.waitsOnUser, /3 review rounds/);
});
