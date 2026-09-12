// Loads .claude/crew.config.json over the defaults below, and says plainly
// what is wrong with it rather than throwing a TypeError three frames deep.
//
// The defaults matter as much as the schema: a project that only sets `verify`
// gets a working loop, so adopting crew is one line before it is a decision.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_PATH = join('.claude', 'crew.config.json');

export const DEFAULTS = {
  project: null,
  graphProject: null,
  baseBranch: 'main',
  branchPrefix: 'crew/',
  worktreeDir: '..',
  tasksDir: '.claude/tasks',
  projectBrief: '.claude/crew/project.md',
  decisionsFile: null,
  backlogFile: null,
  verify: null,
  quickVerify: null,
  prepare: [],
  reviewRounds: 2,
  models: { default: 'sonnet', critical: 'opus' },
  scopes: { fromDir: [], extra: [] },
  commit: {
    types: ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'chore', 'revert'],
    subjectMax: 72,
    bodyMaxLines: 4,
    requireScope: false,
    banned: [],
  },
  comments: {
    warnAddedRatio: 0.25,
    extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.css', '.py'],
  },
  preCommit: [],
  environments: {},
  deploy: null,
  log: '.claude/crew/log.jsonl',
};

// One level deep is all the shape has, and a recursive merge would silently
// fill in half of a `commit` block the project meant to replace wholesale.
const merge = (defaults, given) => {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (key.startsWith('$')) continue;
    const base = defaults[key];
    const mergeable =
      base && typeof base === 'object' && !Array.isArray(base) && value && !Array.isArray(value);
    out[key] = mergeable ? { ...base, ...value } : value;
  }
  return out;
};

const asList = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

/** The statuses of the loop. Six are intrinsic; the rest come from config. */
export const statuses = (cfg) => {
  const out = {
    draft: { waitsOnUser: 'spec needs your approval before anyone starts' },
    approved: {},
    building: { inFlight: true },
    review: { inFlight: true },
    blocked: { waitsOnUser: `${cfg.reviewRounds} review rounds disagreed — needs your call` },
    done: { terminal: true },
  };

  // An environment no agent can reach earns its own status: work that is
  // code-complete but unproven must not be able to call itself done. This is
  // where `pending-tv` comes from, instead of being hardcoded in the board.
  for (const [name, env] of Object.entries(cfg.environments)) {
    if (env.reachableFromAgents === false) {
      out[`pending-${name}`] = {
        waitsOnUser: env.note || `code-complete; only ${name} can prove it`,
        pendingEnv: name,
      };
    }
  }
  return out;
};

/** Load and normalise the config. Throws only if the file is unreadable. */
export const loadConfig = (root) => {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) {
    const error = new Error(`no ${CONFIG_PATH} — run \`npx crew init\``);
    error.crew = true;
    throw error;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = new Error(`${CONFIG_PATH} is not valid JSON: ${cause.message}`);
    error.crew = true;
    throw error;
  }

  const cfg = merge(DEFAULTS, raw);
  cfg.scopes.fromDir = asList(cfg.scopes.fromDir);
  cfg.scopes.extra = asList(cfg.scopes.extra);
  cfg.prepare = asList(cfg.prepare);
  cfg.root = root;
  return cfg;
};

/**
 * Everything wrong with a config, as a list of sentences. Kept separate from
 * loading so `doctor` can report all of it at once and the commands can each
 * fail on only the keys they use.
 */
export const problems = (cfg) => {
  const out = [];
  const need = (value, what) => {
    if (value == null || value === '' || value === 'CHANGE-ME') out.push(what);
  };

  need(cfg.project, '`project` is unset — it names the project in the graph and the board');
  need(cfg.verify, '`verify` is unset — crew has no command to prove a task with');

  if (!Array.isArray(cfg.commit.types) || !cfg.commit.types.length) {
    out.push('`commit.types` is empty — every commit message would be rejected');
  }
  if (!(cfg.commit.subjectMax > 0)) out.push('`commit.subjectMax` must be a positive number');
  if (!(cfg.comments.warnAddedRatio >= 0 && cfg.comments.warnAddedRatio <= 1)) {
    out.push('`comments.warnAddedRatio` is a fraction between 0 and 1');
  }
  if (!(cfg.reviewRounds >= 1)) out.push('`reviewRounds` must be at least 1');

  for (const [name, env] of Object.entries(cfg.environments)) {
    if (!Array.isArray(env.proves) || !env.proves.length) {
      out.push(`environment "${name}" lists nothing under \`proves\` — say what it settles`);
    }
  }
  if (cfg.deploy && !cfg.deploy.command) out.push('`deploy` is set but has no `command`');

  for (const dir of cfg.scopes.fromDir) {
    if (!existsSync(join(cfg.root, dir))) {
      out.push(`\`scopes.fromDir\` names "${dir}", which does not exist`);
    }
  }
  if (!existsSync(join(cfg.root, cfg.tasksDir))) {
    out.push(`\`tasksDir\` "${cfg.tasksDir}" does not exist — run \`npx crew init\``);
  }
  return out;
};
