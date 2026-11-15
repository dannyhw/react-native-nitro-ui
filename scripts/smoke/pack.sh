#!/usr/bin/env bash
# Builds the library, packs an npm tarball into $SMOKE_TARBALL_DIR (default
# $SMOKE_TMP/tarballs) and prints its path. `<tarball>.gitsha` records the commit.
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
