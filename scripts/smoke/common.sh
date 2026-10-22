# shellcheck shell=bash
# Shared helpers for the consumer smoke tests (pack.sh, expo.sh, rn-cli.sh).
# Not executable on its own - sourced by the other scripts.

set -euo pipefail

SMOKE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Temp dir for consumer apps. Outside the repo, and it must contain no
# spaces/#/%/non-ASCII (CocoaPods, nitrogen and Gradle all choke on those).
SMOKE_TMP="${SMOKE_TMP:-/tmp/nitro-ui-smoke}"
case "$SMOKE_TMP" in
  *[[:space:]'#%']* | *[![:print:]]*)
    echo "smoke: SMOKE_TMP ('$SMOKE_TMP') must not contain spaces or # % characters" >&2
    exit 1
    ;;
esac
if LC_ALL=C grep -q '[^ -~]' <<<"$SMOKE_TMP"; then
  echo "smoke: SMOKE_TMP ('$SMOKE_TMP') must be ASCII-only" >&2
  exit 1
fi

TARBALL_DIR="${SMOKE_TARBALL_DIR:-$SMOKE_TMP/tarballs}"
KEEP_TMP="${KEEP_TMP:-0}"
READY_PATTERN="${READY_PATTERN:-NITRO_UI_SMOKE_READY}"
READY_TIMEOUT="${READY_TIMEOUT:-180}"   # seconds to wait for the ready log line
BOOT_TIMEOUT="${BOOT_TIMEOUT:-300}"     # seconds to wait for the emulator to boot

# Devices (see docs/DECISIONS.md): every caller/brief sets these.
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
ANDROID_AVD="${ANDROID_AVD:-${AVD:-}}"
EMULATOR_PORT="${EMULATOR_PORT:-5554}"
EMULATOR_SERIAL="emulator-$EMULATOR_PORT"
# Never steal the human's emulator, no matter what env says.
if [ "$ANDROID_AVD" = "PR1505_Pixel" ] || [ "$EMULATOR_SERIAL" = "emulator-5560" ]; then
  echo "smoke: refusing to use PR1505_Pixel / emulator-5560 (belongs to the human)" >&2
  exit 1
fi

ABI="$(uname -m)"
if [ "$ABI" = "arm64" ]; then ABI=arm64-v8a; IOS_ARCH=arm64; else ABI=x86_64; IOS_ARCH=x86_64; fi

# Per-run artifacts (logs, screenshots, timings) survive app-dir cleanup.
# PID suffix so two scripts started in the same second never share a dir.
ARTIFACTS="${ARTIFACTS:-$SMOKE_TMP/artifacts/$(basename "$0" .sh)-$(date +%Y%m%d-%H%M%S)-$$}"

PIXEL_READY="$SMOKE_ROOT/scripts/smoke/pixel-ready.mjs"

# Decodes a screenshot and prints STARTING | READY | ERROR | BLANK. The smoke
# app paints its background red on success / blue on failure (see
# scripts/smoke/App.tsx); this is the readiness channel that works in iOS
# Release, where JS console output is stripped.
semaphore() { node "$PIXEL_READY" "$1"; }

RUN_START=$(date +%s)
declare -a TIMINGS=()
timer() { # timer <label> <epoch-seconds-start>
  local now; now=$(date +%s)
  local secs=$((now - $2))
  TIMINGS+=("$1: ${secs}s")
  echo "smoke: [time] $1 took ${secs}s"
}

log()  { echo "smoke: $*"; }
fail() {
  echo "smoke: FAILED: $*" >&2
  # Keep everything on failure, even if KEEP_TMP=1 cleanup was requested.
  log "artifacts (logs/screenshots) kept in: $ARTIFACTS"
  exit 1
}

mkdir -p "$ARTIFACTS"
trap 'code=$?; [ $code -ne 0 ] && [ -n "${SCRIPT_NAME:-}" ] && echo "smoke: $SCRIPT_NAME exited with code $code (artifacts: $ARTIFACTS)" || true' EXIT

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }

# Latest build-tools' aapt, for reading the APK's package/launchable activity.
find_aapt() {
  local bt
  bt=$(ls -d "$ANDROID_HOME/build-tools"/*/ 2>/dev/null | sort -V | tail -1)
  [ -n "$bt" ] && [ -x "${bt}aapt" ] || fail "aapt not found under ANDROID_HOME ($ANDROID_HOME)"
  echo "${bt}aapt"
}

pack_lib() {
  [ -d "$SMOKE_ROOT" ] || fail "repo root not found: $SMOKE_ROOT"
  SMOKE_TARBALL_DIR="$TARBALL_DIR" bash "$SMOKE_ROOT/scripts/smoke/pack.sh"
}

latest_tgz() {
  local tgz
  tgz=$(ls -t "$TARBALL_DIR"/react-native-nitro-ui-*.tgz 2>/dev/null | head -1)
  [ -n "$tgz" ] || fail "no packed tarball in $TARBALL_DIR (run scripts/smoke/pack.sh)"
  echo "$tgz"
}

# ---------------------------------------------------------------- Android ---

ensure_avd() {
  require_cmd avdmanager
  if avdmanager list avd -c 2>/dev/null | grep -qx "$ANDROID_AVD"; then
    return 0
  fi
  local img="${ANDROID_SYSTEM_IMAGE:-system-images;android-35;google_apis;arm64-v8a}"
  require_cmd sdkmanager
  sdkmanager --list_installed 2>/dev/null | grep -qF "$img" ||
    sdkmanager "$img" >/dev/null
  log "creating AVD $ANDROID_AVD from $img"
  printf 'no\n' | avdmanager create avd -n "$ANDROID_AVD" -k "$img" -d "${AVD_PROFILE:-pixel_9}" >/dev/null
}

ensure_emulator() {
  require_cmd emulator; require_cmd adb
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
  [ -n "$ANDROID_AVD" ] || fail "ANDROID_AVD is not set (brief assigns one)"
  ensure_avd
  if ! adb devices | awk '{print $1}' | grep -qx "$EMULATOR_SERIAL"; then
    mkdir -p "$ARTIFACTS"
    log "booting emulator $ANDROID_AVD on port $EMULATOR_PORT (headless)"
    nohup emulator -avd "$ANDROID_AVD" -port "$EMULATOR_PORT" \
      -no-window -no-audio -no-boot-anim -no-snapshot-save \
      >"$ARTIFACTS/emulator.log" 2>&1 &
    local waited=0
    until [ "$(adb -s "$EMULATOR_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      sleep 2; waited=$((waited + 2))
      [ $waited -lt "$BOOT_TIMEOUT" ] || fail "emulator $ANDROID_AVD did not boot within ${BOOT_TIMEOUT}s"
    done
    timer "emulator-boot" $(( $(date +%s) - waited ))
    log "emulator $EMULATOR_SERIAL booted"
  else
    log "emulator $EMULATOR_SERIAL already running (not touching it on exit)"
  fi
  # Keep transient "System UI isn't responding" dialogs from covering screenshots.
  adb -s "$EMULATOR_SERIAL" shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
}

build_android_release() { # build_android_release <app-dir>
  local app=$1
  ( cd "$app/android" &&
    ./gradlew :app:assembleRelease \
      "-PreactNativeArchitectures=$ABI" --console=plain \
      >"$ARTIFACTS/android-build.log" 2>&1 ) ||
    fail "Android release build failed, see $ARTIFACTS/android-build.log"
  # Don't leave consumer Gradle daemons running (AGENTS.md).
  ( cd "$app/android" && ./gradlew --stop >/dev/null 2>&1 ) || true
}

install_start_verify_android() { # <app-dir> <screenshot-name>
  local app=$1 shot=$2
  local apk="$app/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$apk" ] || fail "release APK not found: $apk"
  local aapt pkg activity
  aapt=$(find_aapt)
  pkg=$("$aapt" dump badging "$apk" | sed -nE "s/^package: name='([^']+)'.*/\1/p" | head -1)
  activity=$("$aapt" dump badging "$apk" | sed -nE "s/^launchable-activity: name='([^']+)'.*/\1/p" | head -1)
  [ -n "$pkg" ] && [ -n "$activity" ] || fail "could not read package/activity from $apk"

  local logcat="$ARTIFACTS/android-runtime.log"
  adb -s "$EMULATOR_SERIAL" install -r -g "$apk" >/dev/null
  adb -s "$EMULATOR_SERIAL" logcat -c || true
  adb -s "$EMULATOR_SERIAL" logcat -v time >"$logcat" 2>&1 &
  local logcat_pid=$!
  # shellcheck disable=SC2064
  trap "kill $logcat_pid 2>/dev/null || true" RETURN

  adb -s "$EMULATOR_SERIAL" shell am force-stop "$pkg" || true
  adb -s "$EMULATOR_SERIAL" shell am start -n "$pkg/$activity" >/dev/null

  local start ready
  start=$(date +%s); ready=0
  while [ $(( $(date +%s) - start )) -lt "$READY_TIMEOUT" ]; do
    grep -q "$READY_PATTERN" "$logcat" && { ready=1; break; }
    grep -q "FATAL EXCEPTION" "$logcat" && { kill $logcat_pid 2>/dev/null; fail "app crashed (FATAL EXCEPTION), see $logcat"; }
    sleep 1
  done
  [ $ready -eq 1 ] || { kill $logcat_pid 2>/dev/null; fail "no '$READY_PATTERN' within ${READY_TIMEOUT}s, see $logcat"; }
  sleep 1  # let the first frame render before the screenshot
  adb -s "$EMULATOR_SERIAL" exec-out screencap -p >"$ARTIFACTS/$shot"
  kill $logcat_pid 2>/dev/null || true
  # Cross-check the visual semaphore (catches a ready log without a render).
  local pixel; pixel=$(semaphore "$ARTIFACTS/$shot")
  [ "$pixel" = READY ] || fail "ready line seen but screenshot says $pixel: $ARTIFACTS/$shot"
  log "Android OK ($pkg) - ready line seen, screenshot: $ARTIFACTS/$shot"
}

# -------------------------------------------------------------------- iOS ---

ensure_simulator() {
  require_cmd xcrun
  [ -n "$IOS_SIM_UDID" ] || fail "IOS_SIM_UDID is not set (brief assigns one)"
  xcrun simctl list devices available | grep -q "$IOS_SIM_UDID" ||
    fail "simulator $IOS_SIM_UDID not found (create/rename it first)"
  # -b boots if needed and waits until it is booted.
  xcrun simctl bootstatus "$IOS_SIM_UDID" -b >/dev/null
}

build_ios_release() { # build_ios_release <app-dir>  (scheme = xcworkspace name)
  local app=$1
  local ws
  ws=$(find "$app/ios" -maxdepth 1 -name '*.xcworkspace' | head -1)
  [ -n "$ws" ] || fail "no .xcworkspace under $app/ios"
  local scheme; scheme=$(basename "$ws" .xcworkspace)
  ( cd "$app" &&
    xcodebuild -workspace "$ws" -scheme "$scheme" -configuration Release \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath ios/build ARCHS="$IOS_ARCH" CODE_SIGNING_ALLOWED=NO \
      >"$ARTIFACTS/ios-build.log" 2>&1 ) ||
    fail "iOS release build failed, see $ARTIFACTS/ios-build.log"
  echo "$app/ios/build/Build/Products/Release-iphonesimulator/$scheme.app"
}

install_start_verify_ios() { # <app.app-path> <screenshot-name>
  local app_path=$1 shot=$2
  local bundle_id exec
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Info.plist")
  exec=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Info.plist")
  local runtime_log="$ARTIFACTS/ios-runtime.log"

  # In Release, JS console output never surfaces on iOS (neither os_log nor
  # stderr; even fetch to the host is swallowed). So readiness is read from the
  # screen: the app paints itself red when the native core answers (see
  # scripts/smoke/App.tsx + pixel-ready.mjs). We still launch attached to a
  # console to catch fatal logs and crash messages on stderr.
  xcrun simctl install "$IOS_SIM_UDID" "$app_path"
  xcrun simctl terminate "$IOS_SIM_UDID" "$bundle_id" >/dev/null 2>&1 || true
  exec=$(basename "$app_path" .app)
  xcrun simctl launch --console-pty "$IOS_SIM_UDID" "$bundle_id" \
    >"$runtime_log" 2>&1 &
  local launch_pid=$!
  # shellcheck disable=SC2064
  trap "kill -9 $launch_pid 2>/dev/null || true; pkill -9 -f \"$exec\" >/dev/null 2>&1 || true" RETURN

  local start ready
  start=$(date +%s); ready=0
  while [ $(( $(date +%s) - start )) -lt "$READY_TIMEOUT" ]; do
    grep -qiE "Fatal error|RCTFatal|Crashed|failed to launch" "$runtime_log" && {
      kill -9 $launch_pid 2>/dev/null; fail "iOS app crashed, see $runtime_log"; }
    xcrun simctl io "$IOS_SIM_UDID" screenshot "$ARTIFACTS/.probe-$exec.png" 2>/dev/null
    case "$(semaphore "$ARTIFACTS/.probe-$exec.png")" in
      READY) ready=1; break ;;
      ERROR) fail "the smoke app reported a core failure (blue screen); see $runtime_log" ;;
      # BLANK also matches springboard frames captured mid-launch, so it is
      # only conclusive once the wait budget is exhausted (handled below).
      BLANK | STARTING) ;;
    esac
    sleep 1
  done
  [ $ready -eq 1 ] || {
    kill -9 $launch_pid 2>/dev/null
    local final; final=$(semaphore "$ARTIFACTS/.probe-$exec.png")
    fail "no red READY semaphore within ${READY_TIMEOUT}s (last screenshot: $final), see $runtime_log"; }
  xcrun simctl io "$IOS_SIM_UDID" screenshot "$ARTIFACTS/$shot"
  mv "$ARTIFACTS/.probe-$exec.png" "$ARTIFACTS/$shot"
  kill -9 $launch_pid 2>/dev/null || true
  pkill -9 -f "$exec" >/dev/null 2>&1 || true  # detach leaves the app running
  log "iOS OK ($bundle_id) - red semaphore seen, screenshot: $ARTIFACTS/$shot"
}

cleanup_app() { # cleanup_app <app-dir>
  if [ "$KEEP_TMP" = "1" ]; then
    log "keeping temp dir ($1)"
  else
    rm -rf "$1"
  fi
}

print_timings() {
  log "timings: ${TIMINGS[*]:-none}"
}
