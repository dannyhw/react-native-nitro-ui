#!/usr/bin/env bash
# Consumer smoke test: fresh Expo app (SDK=$SDK, default 58), installed with
# npm from the packed tarball, Release build, launched, ready-line + screenshot.
# PLATFORM=ios|android|both. See docs/research/setup-decisions.md §2/§4.
SCRIPT_NAME=expo.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PLATFORM="${PLATFORM:-both}"
SDK="${SDK:-58}"
START=$(date +%s)
require_cmd npx; require_cmd npm

TGZ=$(latest_tgz)
WORK="$SMOKE_TMP/expo-$SDK"
APP="$WORK/expo-consumer"
rm -rf "$WORK"; mkdir -p "$WORK"

log "creating Expo consumer (SDK $SDK) in $APP"
( cd "$WORK" && npx -y create-expo-app@latest expo-consumer \
    --template "blank-typescript@sdk-$SDK" --no-install )
timer "create-expo-app" "$START"

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
  ( cd "$APP" && CI=1 npx expo prebuild --no-install )
  ( cd "$APP/ios" && pod install )
  timer "prebuild+pod-install" "$START"

  START=$(date +%s)
  APP_PATH=$(build_ios_release "$APP")
  timer "ios-build" "$START"

  ensure_simulator
  START=$(date +%s)
  install_start_verify_ios "$APP_PATH" expo-$SDK-ios.png
  timer "ios-run" "$START"
fi

if [ "$PLATFORM" != ios ]; then
  # Android needs the native project too (prebuild) if iOS didn't run it.
  if [ "$PLATFORM" = android ]; then
    ( cd "$APP" && CI=1 npx expo prebuild --no-install )
  fi
  ensure_emulator
  START=$(date +%s)
  build_android_release "$APP"
  timer "android-build" "$START"

  START=$(date +%s)
  install_start_verify_android "$APP" "expo-$SDK-android.png"
  timer "android-run" "$START"
fi

cleanup_app "$WORK"
log "Expo consumer smoke test PASSED (SDK $SDK, PLATFORM $PLATFORM)"
print_timings
