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
cp "$ROOT/appinfo.json" "$ROOT/index.html" "$ROOT/icon.png" "$ROOT/largeIcon.png" "$STAGE/"
cp -r "$ROOT/css" "$ROOT/js" "$STAGE/"

# The dev server injects its shim into index.html in memory, never on disk.
# If one ever lands on disk it would ship to the TV, so check. (js/config.js
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
