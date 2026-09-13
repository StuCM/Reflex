// Read-only access to the memory graph, for briefing a task.
//
// Writes are MCP-only and orchestrator-only by design, so this is safe to run
// anywhere. If the CLI is not installed it says so and exits 0 — the loop must
// never stall because the memory layer is missing.

import { execFileSync } from 'node:child_process';
import { onPath } from './preflight.js';

const CLI = process.env.CREW_GRAPH_CLI || 'claude-memory-graph';

const call = (args) => {
  try {
    process.stdout.write(
      execFileSync(CLI, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
    return 0;
  } catch {
    console.log('graph: query failed (the store may be empty)');
    return 0;
  }
};

const TYPE_QUERY = (type) => `SELECT ?name ?desc WHERE {
  GRAPH ?g { ?n rdf:type mem:${type} ; mem:name ?name .
             OPTIONAL { ?n mem:description ?desc } } }`;

// The shell script this replaces interpolated the search text straight into a
// FILTER, where a quote broke the query and a well-chosen one rewrote it. The
// text is still the only way to ask the question, so it is escaped as a SPARQL
// string literal rather than trusted.
const literal = (text) =>
  `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]/g, ' ')}'`;

const FIND_QUERY = (text) => `SELECT ?type ?name ?desc WHERE {
  GRAPH ?g { ?n rdf:type ?type ; mem:name ?name .
             OPTIONAL { ?n mem:description ?desc }
             FILTER( CONTAINS(LCASE(STR(?name)), LCASE(${literal(text)}))
                  || CONTAINS(LCASE(STR(COALESCE(?desc,''))), LCASE(${literal(text)})) ) } }`;

export const run = (cfg, [command = 'prime', ...rest]) => {
  if (!onPath(CLI)) {
    console.log(`graph: ${CLI} is not on PATH — no graph context available.`);
    if (cfg.decisionsFile)
      console.log(`graph: rely on ${cfg.decisionsFile} and CLAUDE.md for this task.`);
    return 0;
  }

  const project = cfg.graphProject || cfg.project;

  switch (command) {
    case 'prime':
      return call(['recall', 'Project', project, '--depth', '2']);
    case 'prefs':
      return call(['query', TYPE_QUERY('Preference')]);
    case 'traps':
      return call(['query', TYPE_QUERY('Pattern')]);
    case 'find': {
      const text = rest.join(' ');
      if (!text) {
        console.error('usage: crew graph find <text>');
        return 2;
      }
      return call(['query', FIND_QUERY(text)]);
    }
    case 'raw': {
      if (!rest.length) {
        console.error('usage: crew graph raw <sparql>');
        return 2;
      }
      return call(['query', rest.join(' ')]);
    }
    default:
      console.error('usage: crew graph {prime|prefs|traps|find <text>|raw <sparql>}');
      return 2;
  }
};
