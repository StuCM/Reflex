// One JSON line per task event, so the thesis can be checked.
//
// The whole system is an argument that a specified task costs less than an
// unspecified one. Nothing measured it, so nothing could have contradicted it.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gitLines } from '../lib/git.js';
import { declaredFiles, readTask } from '../lib/task.js';

export const run = (cfg, [taskArg, event]) => {
  if (!taskArg || !event) {
    console.error('usage: crew log <task-file> <event>   (spec|dispatch|gate|review|close|block)');
    return 2;
  }

  const path = resolve(cfg.root, taskArg);
  const task = readTask(path, relative(cfg.root, path));
  const base = task.meta.gateSha ? `${cfg.baseBranch}...${task.meta.gateSha}` : null;

  const entry = {
    at: new Date().toISOString(),
    event,
    id: task.id,
    slug: task.meta.slug || null,
    status: task.meta.status || null,
    env: task.meta.env || null,
    model: task.meta.model || null,
    rounds: Number(task.meta.rounds || 0),
    session: task.meta.session || null,
    declared: declaredFiles(task).length,
    commits: base ? gitLines(['rev-list', '--count', base], cfg.root)[0] || null : null,
  };

  const file = join(cfg.root, cfg.log);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  console.log(`log: ${event} ${task.id}`);
  return 0;
};
