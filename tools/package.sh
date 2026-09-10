#!/bin/sh
# Build the .ipk from a clean staging directory.
#
#   npm run package
#
# ares-package's --exclude was silently ignored here, so a straight
# `ares-package .` shipped the git history, the dev harness, the tests and the
# tooling to the TV — 720KB of which about 90KB was the app. Staging what ships
# is not clever, but it cannot be silently wrong: anything not listed below is
# not in the package.
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Everything the app needs at runtime, and nothing else. appinfo.json names
# index.html, icon.png and largeIcon.png; index.html names css/ and js/.
# Build first: what ships is the bundle, not the source tree. The keys are read
# from the environment (or a gitignored .env) and baked in by Vite, so the repo
# never holds one — see js/core/config.js.
bake_env() {
  eval "value=\$$1"
  if [ -z "$value" ] && [ -f "$ROOT/.env" ]; then
    value="$(sed -n "s/^$1=//p" "$ROOT/.env" | tail -1)"
  fi
  if [ -z "$value" ]; then
    echo "  no $1: $3"
    return
  fi
  export "$2=$value"
  echo "  $2 from $1 (...${value#"${value%????}"})"
}

bake_env TMDB_KEY VITE_TMDB_KEY "artwork falls back to plex, discovery rows stay hidden"
bake_env YOUTUBE_KEY VITE_YOUTUBE_KEY "no season recaps on a show page"

(cd "$ROOT" && npx vite build >/dev/null) || {
  echo "  refusing to package: vite build failed" >&2
  exit 1
}

cp "$ROOT/appinfo.json" "$ROOT/icon.png" "$ROOT/largeIcon.png" "$STAGE/"
cp -r "$ROOT/build/." "$STAGE/"

# The guard belongs on the artifact, not on the file that was patched. Baking
# into js/core/config.js and then checking js/core/config.js is exactly how a
# bundled build shipped with both keys empty and every check still passing.
check_baked() {
  eval "want=\$$1"
  [ -z "$want" ] && return
  if ! grep -rqF "$want" "$STAGE/assets"; then
    echo "  refusing to package: $1 is set but is not in the bundle — $2 would be dead" >&2
    exit 1
  fi
}

check_baked VITE_TMDB_KEY "discovery rows and TMDB artwork"
check_baked VITE_YOUTUBE_KEY "season recaps"

# The dev server injects its shim into index.html in memory, never on disk.
# If one ever lands on disk it would ship to the TV, so check. (js/core/config.js
# reading window.REFLEX_CONFIG is the seam itself and belongs here.)
if grep -q "__dev/" "$STAGE/index.html"; then
  echo "  refusing to package: a dev script tag is in index.html on disk" >&2
  grep -n "__dev/" "$STAGE/index.html" >&2
  exit 1
fi


rm -f "$ROOT"/*.ipk
ares-package "$STAGE" -o "$ROOT" >/dev/null

IPK="$(ls "$ROOT"/*.ipk)"
echo "  $(basename "$IPK")  $(du -h "$IPK" | cut -f1)"
echo "  staged: $(find "$STAGE" -type f | wc -l) files"
