#!/usr/bin/env bash
# Build the library and create an npm tarball in $SMOKE_TARBALL_DIR (default
# $SMOKE_TMP/tarballs). Note: `bun run prepare` regenerates nitrogen/ via the
# bob custom target - it must come out byte-identical to the committed output.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCRIPT_NAME=pack.sh
START=$(date +%s)
require_cmd bun; require_cmd npm
mkdir -p "$TARBALL_DIR"
rm -f "$TARBALL_DIR"/react-native-nitro-ui-*.tgz

cd "$SMOKE_ROOT"
bun run prepare
npm pack --pack-destination "$TARBALL_DIR" >/dev/null

timer "pack" "$START"
latest_tgz
