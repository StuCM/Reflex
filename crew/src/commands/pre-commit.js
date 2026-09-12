// Formatters and linters over the staged files only, in milliseconds, so this
// stays a hook rather than becoming a reason to pass --no-verify. Anything
// slower — types, tests, the smoke suite — is the gate's job.
//
// Never blocks on its own failure to run: a missing tool is a warning, because
// a hook that breaks committing is a hook that gets disabled.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { extname } from 'node:path';
import { gitLines } from '../lib/git.js';

export const run = (cfg) => {
  if (!cfg.preCommit.length) return 0;

  const staged = gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], cfg.root);
  if (!staged.length) return 0;

  for (const step of cfg.preCommit) {
    const files = staged.filter((file) => step.extensions.includes(extname(file)));
    if (!files.length) continue;

    // node_modules/.bin first so a project's pinned version wins over a global
    // one, then PATH for tools installed some other way.
    const local = join(cfg.root, 'node_modules', '.bin', step.tool);
    for (const bin of [local, step.tool]) {
      try {
        execFileSync(bin, [...(step.args || []), ...files], { cwd: cfg.root, stdio: 'inherit' });
        break;
      } catch (error) {
        if (error.code === 'ENOENT') {
          if (bin === step.tool) {
            console.error(`  pre-commit: ${step.tool} is not installed — skipping.`);
          }
          continue;
        }
        if (step.fix) console.error(`\n  Run \`${step.fix}\` and stage the result.\n`);
        return 1;
      }
    }
  }
  return 0;
};
