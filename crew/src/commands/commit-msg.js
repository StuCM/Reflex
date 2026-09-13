// The commit convention, enforced by the git hook so it costs no tokens and
// applies to every commit — human or agent.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// `!` is not a word character, so a \b after it never matches.
const GENERATED = /^(Merge|Revert)\b|^(fixup|squash)!/;

// Past tense and third person, the two moods a model reaches for first.
const NOT_IMPERATIVE =
  /^(add(ed|s)|fix(ed|es)|updat(ed|es)|chang(ed|es)|remov(ed|es)|delet(ed|es)|refactor(ed|s)|implement(ed|s)|mov(ed|es)|renam(ed|es)|bump(ed|s)|creat(ed|es)|introduc(ed|es)|mak(es)|made)\b/i;

/**
 * Every module and directory name under the source roots, at any depth, plus
 * the configured extras. Derived rather than listed so the vocabulary cannot
 * go stale as the tree is reorganised.
 */
export const allowedScopes = (cfg) => {
  const found = new Set(cfg.scopes.extra);

  const walk = (dir) => {
    const base = join(cfg.root, dir);
    if (!existsSync(base)) return;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        found.add(entry.name);
        walk(join(dir, entry.name));
      } else {
        const name = /^(.+)\.(js|mjs|cjs|ts|mts|cts|tsx|jsx|py|go|rs)$/.exec(entry.name);
        if (name) found.add(name[1]);
      }
    }
  };
  cfg.scopes.fromDir.forEach(walk);
  return [...found].sort();
};

/** Every objection to one commit message, as a list of sentences. */
export const check = (raw, cfg) => {
  const { commit } = cfg;
  const lines = raw.split('\n').filter((line) => !line.startsWith('#'));
  const subject = (lines[0] || '').trim();

  if (GENERATED.test(subject)) return [];

  const errors = [];

  // Case-insensitively: the old check listed `Co-Authored-By:` and
  // `Co-authored-by:` as separate needles, so a third casing walked through.
  for (const needle of commit.banned) {
    if (raw.toLowerCase().includes(needle.toLowerCase())) {
      errors.push(`remove "${needle}" — this project does not use commit attribution`);
    }
  }

  const shape = new RegExp(`^(${commit.types.join('|')})(\\(([a-z0-9._/-]+)\\))?(!)?: (.+)$`);
  const parsed = shape.exec(subject);

  if (!parsed) {
    errors.push('subject must be "type(scope): summary"');
    errors.push(`  types: ${commit.types.join(', ')}`);
    errors.push(`  got:   ${subject || '(empty)'}`);
  } else {
    const scope = parsed[3];
    const summary = parsed[5];

    if (subject.length > commit.subjectMax) {
      errors.push(`subject is ${subject.length} chars, max ${commit.subjectMax}`);
    }
    if (summary.endsWith('.')) errors.push('subject must not end with a full stop');
    // Sentence case, not an acronym: `Add the thing` is wrong, `HLS stalls`
    // and `4K refuses to play` are right, so the test is the second character.
    if (/^[A-Z]([a-z]|$|\s)/.test(summary)) {
      errors.push(`subject starts lowercase: "${summary[0].toLowerCase()}${summary.slice(1)}"`);
    }
    if (NOT_IMPERATIVE.test(summary)) {
      errors.push('subject must be imperative mood ("add", not "added"/"adds")');
    }
    if (commit.requireScope && !scope) errors.push('a scope is required: type(scope): summary');
    if (scope) {
      const allowed = allowedScopes(cfg);
      if (allowed.length && !allowed.includes(scope)) {
        errors.push(`unknown scope "${scope}"`);
        errors.push(`  allowed: ${allowed.join(', ')}`);
      }
    }
  }

  const body = lines.slice(1).join('\n').trim();
  if (body) {
    if (lines[1] !== undefined && lines[1].trim() !== '') {
      errors.push('leave a blank line between the subject and the body');
    }
    const bodyLines = body.split('\n').filter((line) => line.trim() !== '');
    if (bodyLines.length > commit.bodyMaxLines) {
      errors.push(
        `body is ${bodyLines.length} lines, max ${commit.bodyMaxLines} —` +
          ' put the reasoning in the memory graph, not the commit',
      );
    }
  }
  return errors;
};

export const run = (cfg, [msgPath]) => {
  if (!msgPath) {
    console.error('crew commit-msg: no message file given');
    return 2;
  }

  const errors = check(readFileSync(msgPath, 'utf8'), cfg);
  if (!errors.length) return 0;

  console.error('\ncommit rejected:\n');
  for (const error of errors) console.error(`  ${error}`);
  console.error(`\n  example: ${cfg.commit.types[0]}(scope): describe what changes\n`);
  return 1;
};
