import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '../src/lib/config.js';

/** A throwaway directory with a .claude/tasks/ in it. */
export const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'crew-test-'));
  mkdirSync(join(root, '.claude', 'tasks'), { recursive: true });
  return root;
};

// Overrides come last, so a test can unset `project` or `verify` and see what
// the validator says about it.
export const config = (root, overrides = {}) => ({
  ...DEFAULTS,
  project: 'Test',
  verify: 'true',
  root,
  ...overrides,
});

export const writeTask = (root, name, body) => {
  const path = join(root, '.claude', 'tasks', name);
  writeFileSync(path, body);
  return path;
};

export const task = ({ status = 'building', files = ['src/a.ts'], extra = '' } = {}) =>
  `---
id: 007
slug: thing
status: ${status}
branch: crew/007-thing
${extra}files:
${files.map((f) => `  - ${f}`).join('\n')}
---

# A thing

## Goal
Body text that happens to contain frontmatter-looking lines:

status: not-the-real-one
files:
  - src/definitely-not-declared.ts
`;
