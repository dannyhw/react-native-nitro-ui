#!/usr/bin/env bash
# Consumer smoke test: fresh React Native CLI app (RN=$RN, default 0.88.0;
# also tested: 0.86.3), installed with npm from the packed tarball, Release
# build, launched, ready-line + screenshot. PLATFORM=ios|android|both.
SCRIPT_NAME=rn-cli.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PLATFORM="${PLATFORM:-both}"
RN="${RN:-0.88.0}"
CLI_VERSION="${RN_CLI_VERSION:-20.2.0}"
START=$(date +%s)
require_cmd npx; require_cmd npm

TGZ=$(latest_tgz)
WORK="$SMOKE_TMP/rn-cli-$RN"
APP="$WORK/RnConsumer"
rm -rf "$WORK"; mkdir -p "$WORK"

log "creating RN CLI consumer (RN $RN, cli $CLI_VERSION) in $APP"
( cd "$WORK" && npx -y "@react-native-community/cli@$CLI_VERSION" init RnConsumer \
    --version "$RN" --skip-install --skip-git-init --install-pods false )
timer "rn-init" "$START"

START=$(date +%s)
( cd "$APP" && npm install --no-audit --no-fund \
    && npm install --no-audit --no-fund "$TGZ" 'react-native-nitro-modules@^0.37.1' )
cp "$SMOKE_ROOT/scripts/smoke/App.tsx" "$APP/App.tsx"
timer "npm-install" "$START"

case "$PLATFORM" in
  both | ios | android) ;;
  *) fail "PLATFORM must be ios|android|both (got $PLATFORM)" ;;
esac

if [ "$PLATFORM" != android ]; then
  START=$(date +%s)
  ( cd "$APP/ios" && pod install )
  timer "pod-install" "$START"

  START=$(date +%s)
  APP_PATH=$(build_ios_release "$APP")
  timer "ios-build" "$START"

  ensure_simulator
  START=$(date +%s)
  install_start_verify_ios "$APP_PATH" "rncli-$RN-ios.png"
  timer "ios-run" "$START"
fi

if [ "$PLATFORM" != ios ]; then
  ensure_emulator
  START=$(date +%s)
  build_android_release "$APP"
  timer "android-build" "$START"

  START=$(date +%s)
  install_start_verify_android "$APP" "rncli-$RN-android.png"
  timer "android-run" "$START"
fi

cleanup_app "$WORK"
log "RN CLI consumer smoke test PASSED (RN $RN, PLATFORM $PLATFORM)"
print_timings
