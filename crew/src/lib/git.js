// Every git call in crew goes through here, as an argv array.
//
// Not a style preference: the old scripts built command strings and handed
// them to a shell, so a `files:` entry of `src/x.ts$(touch /tmp/pwned)` in a
// spec ran that command. Specs are written by agents, so that path was live.
// execFile takes no shell, which makes the class of bug unreachable rather
// than guarded against.

import { execFileSync } from 'node:child_process';

const QUIET = ['ignore', 'pipe', 'ignore'];

/** Run git and return stdout, or null if it failed. Never throws. */
export const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: QUIET, maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
};

/** Run git and return stdout split into non-blank lines. Empty on failure. */
export const gitLines = (args, cwd) => {
  const out = git(args, cwd);
  if (!out) return [];
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

/** The repository root, or null outside a work tree. */
export const repoRoot = (cwd = process.cwd()) => {
  const out = git(['rev-parse', '--show-toplevel'], cwd);
  return out ? out.trim() : null;
};

export const currentBranch = (cwd) => {
  const out = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return out ? out.trim() : '';
};

export const headSha = (cwd) => {
  const out = git(['rev-parse', 'HEAD'], cwd);
  return out ? out.trim() : '';
};

/** True if the work tree has no uncommitted change to a tracked file. */
export const isClean = (cwd) => gitLines(['status', '--porcelain'], cwd).length === 0;

/** Local branch names. */
export const branches = (cwd) =>
  gitLines(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd);

/**
 * The branch point against the configured base, trying the local ref then the
 * remote one. A merge base is right whichever of the two is stale — and one of
 * them usually is, because workers never push.
 */
export const mergeBase = (baseBranch, cwd) => {
  for (const ref of [baseBranch, `origin/${baseBranch}`]) {
    const out = git(['merge-base', 'HEAD', ref], cwd);
    if (out) return out.trim();
  }
  return baseBranch;
};

/** Paths changed since `base`: committed, uncommitted, and untracked. */
export const changedFiles = (base, cwd) =>
  [
    ...gitLines(['diff', '--name-only', `${base}...HEAD`], cwd),
    ...gitLines(['diff', '--name-only', 'HEAD'], cwd),
    ...gitLines(['ls-files', '--others', '--exclude-standard'], cwd),
  ].filter((path, i, all) => all.indexOf(path) === i);
