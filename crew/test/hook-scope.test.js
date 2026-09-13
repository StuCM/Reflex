import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { run } from '../src/commands/hook-scope.js';
import { config, sandbox, task, writeTask } from './helpers.js';

// The hook answers on stdout, so the decision is what it printed.
const decide = (cfg, payload) => {
  const written = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => written.push(String(chunk));
  try {
    run(cfg, [], payload);
  } finally {
    process.stdout.write = original;
  }
  return written.length ? JSON.parse(written.join('')).hookSpecificOutput : null;
};

const setup = (files = ['src/a.ts', 'css/']) => {
  const root = sandbox();
  const path = writeTask(root, '007-thing.md', task({ files }));
  process.env.CREW_TASK = path;
  return { root, cfg: config(root) };
};

const edit = (root, file) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  cwd: root,
  tool_input: { file_path: join(root, file) },
});

test('a declared file is allowed with no decision at all', () => {
  const { root, cfg } = setup();
  assert.equal(decide(cfg, edit(root, 'src/a.ts')), null);
  assert.equal(
    decide(cfg, edit(root, 'css/detail.css')),
    null,
    'a trailing-slash entry covers its subtree',
  );
});

test('an undeclared file is denied, and the reason names the contract', () => {
  const { root, cfg } = setup();
  const decision = decide(cfg, edit(root, 'src/player.ts'));

  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /src\/player\.ts is not in the files: list/);
  assert.match(decision.permissionDecisionReason, /007-thing\.md/);
  assert.match(decision.permissionDecisionReason, /Declared: src\/a\.ts, css\//);
  assert.match(decision.permissionDecisionReason, /status: blocked/);
});

test('the task file, the board and the log stay writable', () => {
  const { root, cfg } = setup();
  for (const file of [
    '.claude/tasks/007-thing.md',
    '.claude/tasks/BOARD.md',
    '.claude/crew/log.jsonl',
  ]) {
    assert.equal(decide(cfg, edit(root, file)), null, `${file} was denied`);
  }
});

test('a relative path is resolved against the tool call cwd', () => {
  const { root, cfg } = setup();
  const payload = { tool_name: 'Write', cwd: root, tool_input: { file_path: 'src/nope.ts' } };
  assert.equal(decide(cfg, payload).permissionDecision, 'deny');

  const allowed = { tool_name: 'Write', cwd: root, tool_input: { file_path: 'src/a.ts' } };
  assert.equal(decide(cfg, allowed), null);
});

// Every one of these is a case where the hook cannot know the answer. It has to
// stay out of the way: the orchestrator session works on the base branch and
// edits task files, and a hook that stopped it would be switched off by lunch.
test('it fails open on anything it cannot judge', () => {
  const { root, cfg } = setup();

  assert.equal(decide(cfg, null), null, 'no payload');
  assert.equal(
    decide(cfg, { tool_name: 'Bash', cwd: root, tool_input: { command: 'ls' } }),
    null,
    'no file path',
  );
  assert.equal(decide(cfg, { tool_name: 'Edit', cwd: root, tool_input: {} }), null, 'empty input');
  assert.equal(decide(cfg, edit(root, '../elsewhere/x.ts')), null, 'outside the repository');

  delete process.env.CREW_TASK;
  assert.equal(decide(cfg, edit(root, 'src/nope.ts')), null, 'no task identifiable');
});

test('a spec with no files: list cannot deny anything', () => {
  const { root, cfg } = setup([]);
  assert.equal(decide(cfg, edit(root, 'src/anything.ts')), null);
});

test('a notebook path is checked too', () => {
  const { root, cfg } = setup();
  const payload = {
    tool_name: 'NotebookEdit',
    cwd: root,
    tool_input: { notebook_path: join(root, 'x.ipynb') },
  };
  assert.equal(decide(cfg, payload).permissionDecision, 'deny');
});
