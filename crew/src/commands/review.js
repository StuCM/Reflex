// Opens a review round, and refuses one past the limit.
//
// "Two rounds, then a human" was prose in the worker role, which means it held
// exactly as well as the worker felt like holding it. A third round is two
// agents disagreeing, which is a decision, not an iteration — so it is a
// counter, not advice.

import { relative, resolve } from 'node:path';
import { readTask, setField } from '../lib/task.js';
import { run as gate } from './gate.js';

export const run = (cfg, [taskArg]) => {
  if (!taskArg) {
    console.error('usage: crew review <task-file>');
    return 2;
  }

  const path = resolve(cfg.root, taskArg);
  const task = readTask(path, relative(cfg.root, path));
  const rounds = Number(task.meta.rounds || 0);

  if (rounds >= cfg.reviewRounds) {
    console.error(
      `review: ${task.file} has had ${rounds} round(s), the limit is ${cfg.reviewRounds}.`,
    );
    console.error('        Set status: blocked, write the disagreement in a few lines, and stop.');
    setField(path, 'status', 'blocked');
    return 1;
  }

  // Reviewing code the gate has not passed spends a model on a build failure.
  if (gate(cfg, ['--check', taskArg]) !== 0) {
    console.error('\nreview: the gate has not passed on this code. Run `crew gate` first.');
    return 1;
  }

  setField(path, 'rounds', rounds + 1);
  setField(path, 'status', 'review');
  console.log(`review: round ${rounds + 1} of ${cfg.reviewRounds} on ${task.file}`);
  console.log('        spawn crew-reviewer with the task file path and your diff.');
  return 0;
};
