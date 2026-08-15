#!/bin/sh
# Read-only access to the memory graph, for briefing a task.
#
# Writes are MCP-only by design, so this is safe to run anywhere and from any
# agent. If the CLI is not installed it says so and exits 0 — the loop must
# never stall because the memory layer is missing (fail open).
#
#   graph.sh prime              the project, its constraints, decisions, tasks
#   graph.sh prefs              how this person wants work done
#   graph.sh traps              known anti-patterns and phantom problems
#   graph.sh find <text>        anything whose name or description mentions <text>
#   graph.sh raw '<sparql>'     passthrough

set -e
ROOT=$(git rev-parse --show-toplevel)
CLI=${CREW_GRAPH_CLI:-claude-memory-graph}
PROJECT=$(node -e "process.stdout.write(require('$ROOT/.claude/crew.config.json').graphProject)")

if ! command -v "$CLI" >/dev/null 2>&1; then
  echo "graph: $CLI not on PATH — no graph context available."
  echo "graph: rely on docs/decisions.md and CLAUDE.md for this task."
  exit 0
fi

q() { "$CLI" query "$1" 2>/dev/null || echo "graph: query failed (store may be empty)"; }

case "${1:-prime}" in
  prime)
    "$CLI" recall Project "$PROJECT" --depth 2 2>/dev/null \
      || echo "graph: no Project named $PROJECT yet — run /crew-close to seed it."
    ;;

  prefs)
    q "SELECT ?label ?desc WHERE {
         GRAPH ?g { ?n rdf:type mem:Preference ;
                       mem:label ?label .
                    OPTIONAL { ?n mem:description ?desc } } }"
    ;;

  traps)
    q "SELECT ?name ?desc WHERE {
         GRAPH ?g { ?n rdf:type mem:Pattern ;
                       mem:name ?name .
                    OPTIONAL { ?n mem:description ?desc } } }"
    ;;

  find)
    [ -n "$2" ] || { echo "usage: graph.sh find <text>"; exit 2; }
    q "SELECT ?type ?name ?desc WHERE {
         GRAPH ?g { ?n rdf:type ?type ; mem:name ?name .
                    OPTIONAL { ?n mem:description ?desc }
                    FILTER( CONTAINS(LCASE(STR(?name)), LCASE('$2'))
                         || CONTAINS(LCASE(STR(COALESCE(?desc,''))), LCASE('$2')) ) } }"
    ;;

  raw)
    [ -n "$2" ] || { echo "usage: graph.sh raw '<sparql>'"; exit 2; }
    q "$2"
    ;;

  *)
    echo "usage: graph.sh {prime|prefs|traps|find <text>|raw <sparql>}"
    exit 2
    ;;
esac
