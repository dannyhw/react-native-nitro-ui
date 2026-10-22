#!/usr/bin/env bash
# Build the library and create an npm tarball in $SMOKE_TARBALL_DIR (default
# $SMOKE_TMP/tarballs) and print its path. The tarball name is version-locked,
# so a re-pack overwrites it - no wiping of the shared dir (that would race with
# a concurrent run). `<tarball>.gitsha` records the built commit so consumer
# runs can refuse a stale tarball.
# Note: `bun run prepare` regenerates nitrogen/ via the bob custom target - it
# must come out byte-identical to the committed output.
SCRIPT_NAME=pack.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

START=$(date +%s)
require_cmd bun; require_cmd npm
mkdir -p "$TARBALL_DIR"

cd "$SMOKE_ROOT"
bun run prepare
npm pack --pack-destination "$TARBALL_DIR" >/dev/null

TGZ=$(latest_tgz)
git -C "$SMOKE_ROOT" rev-parse HEAD >"$TGZ.gitsha" 2>/dev/null || rm -f "$TGZ.gitsha"

timer "pack" "$START"
echo "$TGZ"
