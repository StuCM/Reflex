import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/commands/board.js';
import { statuses } from '../src/lib/config.js';
import { config } from './helpers.js';

const cfg = config('/nowhere', {
  reviewRounds: 2,
  environments: {
    tv: { proves: ['decode'], reachableFromAgents: false, note: 'the panel decides' },
  },
});
const known = statuses(cfg);

const task = (id, status, extra = {}) => ({
  id,
  file: `${id}-x.md`,
  title: `task ${id}`,
  meta: { status, branch: `crew/${id}-x`, env: 'laptop', ...extra },
});

test('waiting on a person comes before everything else', () => {
  const { text } = render(
    [task('001', 'done'), task('002', 'building'), task('003', 'draft'), task('004', 'approved')],
    known,
    ['crew/002-x', 'crew/003-x', 'crew/004-x'],
    cfg,
  );
  const rows = text.split('\n').filter((line) => /^\| \d{3} /.test(line));
  assert.deepEqual(
    rows.map((row) => row.split(' | ')[2].replace(/`/g, '')),
    ['draft', 'building', 'approved', 'done'],
  );
});

test('the waiting section names the reason, per status', () => {
  const { text, waiting } = render(
    [
      task('001', 'draft'),
      task('002', 'pending-tv'),
      task('003', 'blocked'),
      task('004', 'review'),
    ],
    known,
    [],
    cfg,
  );
  const section = text.split('## Waiting on you')[1].split('## In flight')[0];

  assert.equal(waiting.length, 3);
  assert.match(section, /\*\*001 task 001\*\* — spec needs your approval/);
  assert.match(section, /\*\*002 task 002\*\* — the panel decides/);
  assert.match(section, /\*\*003 task 003\*\* — 2 review rounds disagreed/);
  assert.ok(!section.includes('**004'), 'a task in review is not waiting on a person');
  assert.match(text.split('## In flight')[1], /\*\*004 task 004\*\*/);
});

test('a branch that no longer exists is marked, not dropped', () => {
  const { text } = render([task('001', 'building')], known, [], cfg);
  assert.match(text, /crew\/001-x \*\(gone\)\*/);

  const { text: live } = render([task('001', 'building')], known, ['crew/001-x'], cfg);
  assert.match(live, /\| crew\/001-x \|/);
  assert.ok(!live.includes('(gone)'));
});

test('a status crew does not know about is flagged rather than hidden', () => {
  const { text } = render([task('001', 'in-progress')], known, [], cfg);
  assert.match(text, /\| 001 \| task 001 \| `in-progress` \*\(unknown\)\*/);
});

test('in flight shows the round count once there is one', () => {
  const { text } = render([task('001', 'review', { rounds: '2' })], known, ['crew/001-x'], cfg);
  assert.match(text, /`review` on `crew\/001-x`, round 2\/2/);

  const { text: fresh } = render([task('002', 'building', { rounds: '0' })], known, [], cfg);
  assert.ok(!fresh.includes('round'), 'round 0 should not be shown');
});

test('an empty board says so in both sections', () => {
  const { text, total } = render([], known, [], cfg);
  assert.equal(total, 0);
  assert.match(text, /\*no tasks yet\*/);
  assert.match(text, /## Waiting on you\n\nNothing\./);
  assert.match(text, /## In flight\n\nNothing running\./);
});
