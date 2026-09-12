// PreToolUse hook: refuse a write outside the task's declared files, at the
// moment it is attempted.
//
// `crew scope` catches the same thing, but only after the work is done and a
// round has been paid for. This turns the contract from a report into a wall.
//
// It fails OPEN by design. A hook that cannot identify the task must not block
// anything — the orchestrator session works on the base branch and edits task
// files, and a hook that stopped it would be turned off within the hour.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { currentBranch } from '../lib/git.js';
import { bookkeeping, declaredFiles, inScope, readTask } from '../lib/task.js';

const allow = () => 0;

const deny = (reason) => {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  return 0;
};

const readStdin = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Which task is this session working on? The branch carries it — the dispatch
 * names the branch `<prefix><id>-<slug>` from the task file — and CREW_TASK
 * overrides for a worktree checked out some other way.
 */
export const findTask = (cfg, branch) => {
  if (process.env.CREW_TASK) {
    const path = resolve(cfg.root, process.env.CREW_TASK);
    return existsSync(path) ? path : null;
  }
  if (!branch || !branch.startsWith(cfg.branchPrefix)) return null;

  const path = join(cfg.root, cfg.tasksDir, `${branch.slice(cfg.branchPrefix.length)}.md`);
  return existsSync(path) ? path : null;
};

export const run = (cfg, _args, payload = readStdin()) => {
  if (!payload) return allow();

  const target = payload.tool_input?.file_path || payload.tool_input?.notebook_path;
  if (typeof target !== 'string' || !target) return allow();

  const taskPath = findTask(cfg, currentBranch(cfg.root));
  if (!taskPath) return allow();

  const task = readTask(taskPath, relative(cfg.root, taskPath));
  const declared = declaredFiles(task);
  if (!declared.length) return allow();

  // Anything outside the repository is not this contract's business.
  const path = isAbsolute(target) ? target : resolve(payload.cwd || cfg.root, target);
  const rel = relative(cfg.root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return allow();

  if (inScope(rel, declared) || bookkeeping(cfg, task).includes(rel)) return allow();

  return deny(
    `${rel} is not in the files: list of ${task.file}.\n\n` +
      `Declared: ${declared.join(', ')}\n\n` +
      'If the spec is wrong, say so in the task file and set status: blocked. ' +
      'Do not widen the scope on your own — that is the one decision the spec gate exists to hold.',
  );
};
