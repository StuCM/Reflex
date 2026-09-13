// Task files are the single source of truth, so this is the only parser for
// them. The old scripts each had their own copy — three regexes that matched
// `^key:` anywhere in the file, so a body line reading `files:` could win over
// the real frontmatter.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
export const TASK_FILE = /^(\d{3})-.*\.md$/;

/**
 * Scalars and one-level lists from the leading `---` block only. Values are
 * read verbatim: no YAML, no types, no anchors — a task file that needs those
 * has outgrown being a task file.
 */
export const frontmatter = (text) => {
  const fenced = FENCE.exec(text);
  if (!fenced) return {};

  const out = {};
  let listKey = null;

  for (const line of fenced[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      out[listKey].push(item[1].trim());
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;

    const [, key, value] = pair;
    if (value === '') {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = value.trim();
    }
  }
  return out;
};

/** Parse a task file from disk into { path, file, id, meta, title, text }. */
export const readTask = (path, file = path) => {
  const text = readFileSync(path, 'utf8');
  const meta = frontmatter(text);
  const heading = /^#\s+(.+)$/m.exec(text);
  return {
    path,
    file,
    id: String(meta.id ?? TASK_FILE.exec(file)?.[1] ?? '???'),
    meta,
    title: heading ? heading[1].trim() : file,
    text,
  };
};

/** Every NNN-slug.md in the tasks directory, in id order. */
export const readTasks = (dir) => {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => TASK_FILE.test(name))
    .sort()
    .map((name) => readTask(join(dir, name), name));
};

/** The `files:` contract, normalised to repo-relative paths. */
export const declaredFiles = (task) => {
  const files = task.meta.files;
  if (!Array.isArray(files)) return [];
  return files.map((path) => path.replace(/^\.\//, '')).filter(Boolean);
};

/**
 * Does a changed path fall inside one declared entry? Three forms, and the
 * third is the one that keeps being forgotten: a trailing slash means
 * everything under that directory, so a spec declaring `css/` does not report
 * every file the task creates there as scope creep. A bare path stays exact —
 * widening it would let `src/api` quietly authorise the whole subtree.
 */
export const matches = (path, declared) => {
  if (declared.endsWith('*')) return path.startsWith(declared.slice(0, -1));
  if (declared.endsWith('/')) return path.startsWith(declared);
  return path === declared;
};

export const inScope = (path, declared) => declared.some((entry) => matches(path, entry));

/**
 * Paths a worker is required to write that are never in `files:` — its own
 * task file, the board, the cost log. Excluded from scope creep, and the only
 * changes a passing gate stamp survives.
 */
export const bookkeeping = (cfg, task) =>
  [task.file, join(cfg.tasksDir, 'BOARD.md'), cfg.log].filter(Boolean);

/**
 * Replace a frontmatter scalar, adding it before the closing fence if absent.
 * Only the one line changes, so a hand-written spec keeps its shape.
 */
export const setField = (path, key, value) => {
  const text = readFileSync(path, 'utf8');
  const fenced = FENCE.exec(text);
  if (!fenced) throw new Error(`${path}: no --- frontmatter block to update`);

  const line = new RegExp(`^${key}:.*$`, 'm');
  const block = line.test(fenced[1])
    ? fenced[1].replace(line, `${key}: ${value}`)
    : `${fenced[1]}\n${key}: ${value}`;

  writeFileSync(path, `---\n${block}\n---\n${text.slice(fenced[0].length)}`);
};
