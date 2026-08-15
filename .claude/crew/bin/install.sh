#!/bin/sh
# Copy the crew loop into another project.
#
#   .claude/crew/bin/install.sh /path/to/project
#
# Everything copied is project-agnostic. The one file you then edit is
# .claude/crew.config.json.

set -e

TARGET="$1"
[ -n "$TARGET" ] || { echo "usage: install.sh <target-project>"; exit 2; }
[ -d "$TARGET" ] || { echo "no such directory: $TARGET"; exit 2; }

SRC=$(cd "$(dirname "$0")/../../.." && pwd)

mkdir -p "$TARGET/.claude/agents" "$TARGET/.claude/skills" "$TARGET/.claude/tasks"

cp -r "$SRC/.claude/crew"            "$TARGET/.claude/"
cp    "$SRC/.claude/agents/crew-"*.md "$TARGET/.claude/agents/"
cp -r "$SRC/.claude/skills/crew-"*    "$TARGET/.claude/skills/"

if [ -f "$TARGET/.claude/crew.config.json" ]; then
  echo "kept existing .claude/crew.config.json"
else
  cat > "$TARGET/.claude/crew.config.json" <<'JSON'
{
  "project": "CHANGE-ME",
  "graphProject": "CHANGE-ME",

  "verify": "CHANGE-ME",
  "quickVerify": "CHANGE-ME",

  "scopes": {
    "fromDir": "src",
    "extra": ["docs", "ci", "deps", "crew"]
  },

  "commit": {
    "types": ["feat", "fix", "docs", "refactor", "perf", "test", "build", "chore", "revert"],
    "subjectMax": 72,
    "bodyMaxLines": 4,
    "requireScope": false,
    "banned": [
      "Co-Authored-By:",
      "Co-authored-by:",
      "Generated with [Claude Code]",
      "Claude-Session:",
      "🤖 Generated"
    ]
  },

  "comments": { "warnAddedRatio": 0.25 },

  "environments": {
    "laptop": { "proves": ["everything the test suite covers"], "command": "CHANGE-ME" }
  },

  "deploy": { "command": "CHANGE-ME", "orchestratorOnly": true, "requires": [] }
}
JSON
  echo "wrote .claude/crew.config.json — edit verify, scopes and environments"
fi

cat <<EOF

installed into $TARGET

next:
  1. edit $TARGET/.claude/crew.config.json
  2. cd $TARGET && git config core.hooksPath .claude/crew/githooks
  3. make sure .gitignore does not exclude .claude/agents, .claude/skills,
     .claude/crew and .claude/tasks
EOF
