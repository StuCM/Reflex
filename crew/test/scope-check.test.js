import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentDelta } from '../src/commands/scope-check.js';

const EXTENSIONS = ['.ts', '.css'];

// Two files: a doc whose every line looks like a comment to a line-at-a-time
// scanner, and a source file with one real comment in four added lines.
const DIFF = `diff --git a/docs/backlog.md b/docs/backlog.md
--- a/docs/backlog.md
+++ b/docs/backlog.md
+# Section 0
+
+* the first item
+* the second item
+# Section 1
-# an old heading
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
+// why this compares two lengths
+const a = 1;
+const b = 2;
+const c = 3;
-// an obsolete note
`;

test('only files with comments are counted', () => {
  const { added, removed, pct } = commentDelta(DIFF, EXTENSIONS);

  // One added comment in four added lines of src/a.ts. The five Markdown lines
  // and its heading are not comments in any language and are not counted —
  // the previous implementation scored 6 added of 9 (67%) on this same diff,
  // so every task that touched a doc tripped the ratio warning.
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(pct, 25);
});

test('a diff of documentation alone reports nothing', () => {
  const docsOnly = DIFF.split('diff --git a/src')[0];
  assert.deepEqual(commentDelta(docsOnly, EXTENSIONS), { added: 0, removed: 0, pct: 0 });
});

test('the +++ and --- headers are never counted as content', () => {
  const { added, pct } = commentDelta(
    ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '+const a = 1;'].join(
      '\n',
    ),
    EXTENSIONS,
  );
  assert.equal(added, 0);
  assert.equal(pct, 0);
});

// The gate is the extension list, not the prefix: point it at Markdown and the
// headings do count, while the real comment in src/a.ts stops counting. Both
// directions, so a config change cannot silently widen or narrow it.
test('the extension list decides, in both directions', () => {
  const { added, pct } = commentDelta(DIFF, ['.md']);
  assert.equal(added, 4, '4 of the 5 added Markdown lines open with # or *');
  assert.equal(pct, 80);
  assert.equal(commentDelta(DIFF, []).added, 0, 'an empty list counts nothing');
});
