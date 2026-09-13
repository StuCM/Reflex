// What a task actually touched, against the files its spec declared. Scope
// creep becomes a diff rather than a judgement call.

import { bookkeeping, declaredFiles, inScope, readTask } from '../lib/task.js';
import { changedFiles, git, mergeBase } from '../lib/git.js';
import { extname, relative, resolve } from 'node:path';

const COMMENT = /^\+?-?\s*(\/\/|\/\*|\*|#)/;

/**
 * Comment lines added and removed, as a share of all added lines — but only
 * in files whose language has comments. The old version walked the raw diff
 * with no idea which file it was in, so every Markdown heading (`# Goal`) and
 * every list bullet (`* item`) counted, and any task that touched a doc
 * reported a comment ratio it had not earned.
 */
export const commentDelta = (diff, extensions) => {
  let added = 0;
  let removed = 0;
  let addedAll = 0;
  let counting = false;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^b\//, '');
      counting = extensions.includes(extname(path));
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('diff --git')) continue;
    if (!counting) continue;

    if (line.startsWith('+')) {
      addedAll++;
      if (COMMENT.test(line)) added++;
    } else if (line.startsWith('-') && COMMENT.test(line)) {
      removed++;
    }
  }
  return { added, removed, pct: addedAll ? Math.round((added / addedAll) * 100) : 0 };
};

export const run = (cfg, [taskArg, baseArg]) => {
  if (!taskArg) {
    console.error('usage: crew scope <task-file> [base-ref]');
    return 2;
  }

  const path = resolve(cfg.root, taskArg);
  const task = readTask(path, relative(cfg.root, path));
  const declared = declaredFiles(task);

  if (!declared.length) {
    console.error(`scope: ${task.file} declares no files: — nothing to check scope against`);
    return 2;
  }

  const base = baseArg || mergeBase(cfg.baseBranch, cfg.root);
  const changed = changedFiles(base, cfg.root);

  const allowed = bookkeeping(cfg, task);
  const stray = changed.filter((file) => !allowed.includes(file) && !inScope(file, declared));

  const diff = [
    git(['diff', `${base}...HEAD`], cfg.root) || '',
    git(['diff', 'HEAD'], cfg.root) || '',
  ].join('\n');
  const comments = commentDelta(diff, cfg.comments.extensions);

  console.log(`base           : ${base}`);
  console.log(`files declared : ${declared.length}`);
  console.log(`files changed  : ${changed.length}`);
  console.log(
    `comment lines  : +${comments.added} / -${comments.removed}` +
      ` (${comments.pct}% of added code lines)`,
  );

  if (comments.pct > cfg.comments.warnAddedRatio * 100) {
    console.log(`\nnote: comments are ${comments.pct}% of added lines. Check they`);
    console.log('      explain a non-obvious why, not the reasoning that got there.');
  }

  if (stray.length) {
    console.log('\nOUT OF SCOPE — not declared in the spec:');
    for (const file of stray) console.log(`  ${file}`);
    console.log('\nEither the spec was wrong (amend it, say why) or this is scope creep.');
    return 1;
  }

  console.log('\nin scope');
  return 0;
};
