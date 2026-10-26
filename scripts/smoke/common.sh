# shellcheck shell=bash
# Shared helpers for the consumer smoke tests (pack.sh, expo.sh, rn-cli.sh).
# Not executable on its own - sourced by the other scripts.

set -euo pipefail

SMOKE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Base temp dir for consumer apps. Outside the repo, and it must contain no
# spaces/#/%/non-ASCII (CocoaPods, nitrogen and Gradle all choke on those).
# Every run creates its own unique sub directory under it (mk_run_dir), so
# concurrent runs - another worktree, or ios + android in parallel - can never
# delete or read each other's app or tarball.
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
# The app's own "the core answered, but a control still has no box" line. Seeing
# it fails the run immediately instead of waiting out READY_TIMEOUT.
PENDING_PATTERN="${PENDING_PATTERN:-NITRO_UI_SMOKE_PENDING}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-300}"     # seconds to wait for the emulator to boot
SKIP_PACK="${SKIP_PACK:-0}"             # 1 = reuse a tarball instead of packing
# Shut down devices this run booted when it finishes (AGENTS.md). Set 0 to keep
# a warm device while iterating.
SHUTDOWN_DEVICES="${SHUTDOWN_DEVICES:-1}"

# Devices (see docs/DECISIONS.md): every caller/brief sets these.
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
ANDROID_AVD="${ANDROID_AVD:-${AVD:-}}"
EMULATOR_PORT="${EMULATOR_PORT:-5554}"
EMULATOR_SERIAL="emulator-$EMULATOR_PORT"
# Never steal the human's emulator, no matter what env says.
if [ "$EMULATOR_SERIAL" = "emulator-5560" ]; then
  echo "smoke: refusing to use emulator-5560 (reserved on the maintainer machine)" >&2
  exit 1
fi

ABI="$(uname -m)"
if [ "$ABI" = "arm64" ]; then ABI=arm64-v8a; IOS_ARCH=arm64; else ABI=x86_64; IOS_ARCH=x86_64; fi

# The Nitro Modules peer range, read from package.json (single source of truth).
NITRO_MODULES_SPEC=$(node -e \
  'process.stdout.write(require(process.argv[1]).peerDependencies["react-native-nitro-modules"])' \
  "$SMOKE_ROOT/package.json")

# Per-run artifacts (logs, screenshots, timings) survive app-dir cleanup.
# PID suffix so two scripts started in the same second never share a dir.
ARTIFACTS="${ARTIFACTS:-$SMOKE_TMP/artifacts/$(basename "$0" .sh)-$(date +%Y%m%d-%H%M%S)-$$}"
mkdir -p "$ARTIFACTS"

# Full stdout+stderr of the whole run goes to the artifacts, so npm, prebuild
# and pod logs are available after a failure too.
if [ -z "${SMOKE_PACK_IN_PROGRESS:-}" ]; then
  exec > >(tee -a "$ARTIFACTS/run.log") 2>&1
fi

# ---------------------------------------------------------------- cleanup ---

declare -a BG_PIDS=()     # background processes this run started
declare -a GRADLE_DIRS=() # consumer android dirs whose daemons must be stopped
IOS_SIM_BOOTED_BY_US=0
EMULATOR_BOOTED_BY_US=0
GRADLE_STOPPED=0

track_pid() { BG_PIDS+=("$1"); }

# Background `logcat`/`log stream` processes and Gradle daemons must die on
# every exit path, including `set -e` and fail() (RETURN traps do not run on
# exit). SMOKE_TMP is validated space-free, so word splitting is safe here.
cleanup_all() {
  local pid dir
  for pid in ${BG_PIDS[@]+"${BG_PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
    # Reap, so bash does not print "Terminated: 15" job messages on exit.
    wait "$pid" 2>/dev/null || true
  done
  BG_PIDS=()
  if [ "$GRADLE_STOPPED" = 0 ]; then
    GRADLE_STOPPED=1
    for dir in ${GRADLE_DIRS[@]+"${GRADLE_DIRS[@]}"}; do
      # The success path deletes the app dir first; daemons are already stopped.
      [ -d "$dir" ] || continue
      ( cd "$dir" && ./gradlew --stop >/dev/null 2>&1 ) || true
    done
  fi
  if [ "$SHUTDOWN_DEVICES" = 1 ]; then
    if [ "$EMULATOR_BOOTED_BY_US" = 1 ]; then
      adb -s "$EMULATOR_SERIAL" emu kill >/dev/null 2>&1 || true
    fi
    if [ "$IOS_SIM_BOOTED_BY_US" = 1 ]; then
      xcrun simctl shutdown "$IOS_SIM_UDID" >/dev/null 2>&1 || true
    fi
  fi
}

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

trap 'code=$?; cleanup_all; [ $code -ne 0 ] && [ -n "${SCRIPT_NAME:-}" ] && echo "smoke: $SCRIPT_NAME exited with code $code (artifacts: $ARTIFACTS)" || true' EXIT

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }

# The readiness assertion, shared by BOTH platform paths (never grep the ready
# pattern inline - that is how the gate ended up asserting nothing about
# layout). `scripts/smoke/lib.mjs` owns the contract: the ready line must carry
# one `name=WxH` box per control, each greater than zero, and
# `scripts/__tests__/smoke-ready-line.test.js` proves that assertion can fail.
# Called once the app has printed either signal, so it runs in both the pass
# case and the fast-fail case; it exits non-zero - one line per problem, plus
# the app's own PENDING line - when a control has no box.
verify_ready_line() { # <logfile> <platform-label>
  local log=$1 platform=$2 out
  require_cmd node
  if out=$(node "$SMOKE_ROOT/scripts/smoke/ready-line.mjs" "$log" 2>&1); then
    log "$platform ready line: $out"
  else
    fail "$platform ready line failed the layout contract:
$out"
  fi
}

# Fresh unique working dir for one consumer app (labelled, easy to spot).
mk_run_dir() { # mk_run_dir <label>  -> echoes the path
  local base="$SMOKE_TMP/$1"
  mkdir -p "$SMOKE_TMP"
  mktemp -d "$base.XXXXXX"
}

# Latest build-tools' aapt, for reading the APK's package/launchable activity.
find_aapt() {
  local bt
  bt=$(ls -d "$ANDROID_HOME/build-tools"/*/ 2>/dev/null | sort -V | tail -1)
  [ -n "$bt" ] && [ -x "${bt}aapt" ] || fail "aapt not found under ANDROID_HOME ($ANDROID_HOME)"
  echo "${bt}aapt"
}

# ---------------------------------------------------------------- tarballs ---

# Build + npm pack the library into a unique dir and set SMOKE_TARBALL to the
# exact resulting path. The build always comes from this checkout's working
# tree, so a smoke run can never silently test a stale tarball.
pack_lib() {
  [ -d "$SMOKE_ROOT" ] || fail "repo root not found: $SMOKE_ROOT"
  local out="$TARBALL_DIR/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$out"
  PACK_DIR="$out"
  SMOKE_TARBALL_DIR="$out" SMOKE_PACK_IN_PROGRESS=1 bash "$SMOKE_ROOT/scripts/smoke/pack.sh"
  local tgz
  tgz=$(ls -t "$out"/react-native-nitro-ui-*.tgz 2>/dev/null | head -1)
  [ -n "$tgz" ] || fail "pack.sh produced no tarball in $out"
  SMOKE_TARBALL="$tgz"
}

# Per-run tarball dir created by pack_lib (removed with the app dir on success).
PACK_DIR=""

# Pick the tarball to install:
#   SMOKE_TARBALL=<path>  use it (CI: the pack job's artifact); HEAD-checked
#   SKIP_PACK=1           newest tarball in $TARBALL_DIR (may be stale: warned)
#   otherwise             pack fresh from this checkout
resolve_tarball() {
  if [ -n "${SMOKE_TARBALL:-}" ]; then
    [ -f "$SMOKE_TARBALL" ] || fail "SMOKE_TARBALL not found: $SMOKE_TARBALL"
    assert_tarball_head "$SMOKE_TARBALL"
    log "using provided tarball: $SMOKE_TARBALL"
  elif [ "$SKIP_PACK" = "1" ]; then
    SMOKE_TARBALL=$(latest_tgz)
    log "SKIP_PACK=1: reusing $SMOKE_TARBALL (it may not match this working tree)"
  else
    pack_lib
    log "packed fresh: $SMOKE_TARBALL"
  fi
  export SMOKE_TARBALL
}

# A tarball packed by pack.sh records the HEAD it was built from. Refuse a
# provided tarball that came from a different commit (CI pack job != run job).
assert_tarball_head() {
  local tgz=$1 head marker
  head=$(git -C "$SMOKE_ROOT" rev-parse HEAD 2>/dev/null) || return 0
  marker="$tgz.gitsha"
  [ -f "$marker" ] || { log "note: $marker missing, cannot verify tarball commit"; return 0; }
  [ "$(cat "$marker")" = "$head" ] || fail "tarball $tgz was packed from $(cat "$marker"), not HEAD $head"
}

# Newest tarball under $TARBALL_DIR (pack.sh writes per-run sub dirs, CI
# downloads a flat artifact dir, so search recursively).
latest_tgz() {
  local tgz
  tgz=$(find "$TARBALL_DIR" -name 'react-native-nitro-ui-*.tgz' -type f 2>/dev/null |
    xargs ls -t 2>/dev/null | head -1)
  [ -n "$tgz" ] || fail "no packed tarball in $TARBALL_DIR (run scripts/smoke/pack.sh)"
  echo "$tgz"
}

# ---------------------------------------------------------------- Android ---

ensure_avd() {
  require_cmd avdmanager
  if avdmanager list avd -c 2>/dev/null | grep -qx "$ANDROID_AVD"; then
    return 0
  fi
  # x86_64 on Intel/CI hosts, arm64-v8a on Apple Silicon.
  local img="${ANDROID_SYSTEM_IMAGE:-system-images;android-35;google_apis;$ABI}"
  require_cmd sdkmanager
  # Capture first: piping sdkmanager straight into `grep -q` can SIGPIPE under
  # pipefail and trigger a pointless reinstall.
  local installed
  installed=$(sdkmanager --list_installed 2>/dev/null || true)
  [[ "$installed" == *"$img"* ]] || sdkmanager "$img" >/dev/null
  log "creating AVD $ANDROID_AVD from $img"
  printf 'no\n' | avdmanager create avd -n "$ANDROID_AVD" -k "$img" -d "${AVD_PROFILE:-pixel_9}" >/dev/null
}

ensure_emulator() {
  # ANDROID_HOME/PATH first: `emulator` and `adb` are not on PATH on hosted
  # runners until these dirs are exported.
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
  require_cmd emulator; require_cmd adb
  [ -n "$ANDROID_AVD" ] || fail "ANDROID_AVD is not set (brief assigns one)"
  ensure_avd
  if ! adb devices | awk '{print $1}' | grep -qx "$EMULATOR_SERIAL"; then
    mkdir -p "$ARTIFACTS"
    log "booting emulator $ANDROID_AVD on port $EMULATOR_PORT (headless)"
    nohup emulator -avd "$ANDROID_AVD" -port "$EMULATOR_PORT" \
      -no-window -no-audio -no-boot-anim -no-snapshot-save \
      >"$ARTIFACTS/emulator.log" 2>&1 &
    local emu_pid=$!
    local waited=0
    until [ "$(adb -s "$EMULATOR_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      # An emulator that died during boot must fail fast, not burn BOOT_TIMEOUT.
      kill -0 "$emu_pid" 2>/dev/null ||
        fail "emulator $ANDROID_AVD exited during boot, see $ARTIFACTS/emulator.log"
      sleep 2; waited=$((waited + 2))
      [ $waited -lt "$BOOT_TIMEOUT" ] || fail "emulator $ANDROID_AVD did not boot within ${BOOT_TIMEOUT}s, see $ARTIFACTS/emulator.log"
    done
    EMULATOR_BOOTED_BY_US=1
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
  GRADLE_DIRS+=("$app/android")
  # --no-daemon + in-process Kotlin compilation keeps Gradle/Kotlin JVMs from
  # outliving the run (as in ci.yml); ./gradlew --stop stays as the backstop.
  ( cd "$app/android" &&
    ./gradlew :app:assembleRelease \
      "-PreactNativeArchitectures=$ABI" --console=plain \
      --no-daemon -Pkotlin.compiler.execution.strategy=in-process \
      >"$ARTIFACTS/android-build.log" 2>&1 ) ||
    fail "Android release build failed, see $ARTIFACTS/android-build.log"
  ( cd "$app/android" && ./gradlew --stop >/dev/null 2>&1 ) || true
}

# Crash lines that belong to the app under test (Java fatals print
# `Process: <pkg>, PID:`; native ones name the process in the libc/DEBUG line).
app_crash_seen() { # app_crash_seen <logfile> <package>
  local log=$1 pkg=$2 re
  re=$(printf '%s' "$pkg" | sed 's/\./\\./g')
  local block
  # A Java/Kotlin fatal only counts when the block names our package (other
  # processes crash on every emulator too).
  block=$(grep -A4 "FATAL EXCEPTION" "$log" 2>/dev/null || true)
  [ -n "$block" ] && [[ "$block" == *"$pkg"* ]] && return 0
  # Native crashes (tombstone / libc) name the process.
  grep -qE "Fatal signal [0-9]+.*\($re\)|>>> $re <<<" "$log" 2>/dev/null && return 0
  return 1
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
  : > "$logcat"
  adb -s "$EMULATOR_SERIAL" install -r -g "$apk" >/dev/null
  adb -s "$EMULATOR_SERIAL" logcat -c || true
  adb -s "$EMULATOR_SERIAL" logcat -v time >"$logcat" 2>&1 &
  track_pid $!

  adb -s "$EMULATOR_SERIAL" shell am force-stop "$pkg" || true
  adb -s "$EMULATOR_SERIAL" shell am start -n "$pkg/$activity" >/dev/null

  local start ready
  start=$(date +%s); ready=0
  while [ $(( $(date +%s) - start )) -lt "$READY_TIMEOUT" ]; do
    if grep -qE "$READY_PATTERN|$PENDING_PATTERN" "$logcat"; then
      # Passes only when every control reported a non-zero box. A PENDING line
      # (or a malformed READY line) fails here, with the sizes in the message.
      verify_ready_line "$logcat" Android
      ready=1
      break
    fi
    app_crash_seen "$logcat" "$pkg" &&
      fail "app crashed, see $logcat"
    sleep 1
  done
  [ $ready -eq 1 ] || fail "no '$READY_PATTERN' within ${READY_TIMEOUT}s, see $logcat"
  sleep 1  # let the first frame render before the screenshot
  adb -s "$EMULATOR_SERIAL" exec-out screencap -p >"$ARTIFACTS/$shot"
  # A crash can also land after the ready line - check once more before passing.
  app_crash_seen "$logcat" "$pkg" && fail "app crashed after the ready line, see $logcat"
  log "Android OK ($pkg) - all controls laid out, screenshot: $ARTIFACTS/$shot"
}

# -------------------------------------------------------------------- iOS ---

ensure_simulator() {
  require_cmd xcrun
  [ -n "$IOS_SIM_UDID" ] || fail "IOS_SIM_UDID is not set (brief assigns one)"
  xcrun simctl list devices available | grep -q "$IOS_SIM_UDID" ||
    fail "simulator $IOS_SIM_UDID not found (create/rename it first)"
  xcrun simctl list devices booted | grep -q "$IOS_SIM_UDID" || IOS_SIM_BOOTED_BY_US=1
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
  local bundle_id
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Info.plist")
  local runtime_log="$ARTIFACTS/ios-runtime.log"

  # RN installs `nativeLoggingHook` in every build configuration and routes it
  # to os_log (subsystem com.facebook.react.log, category javascript);
  # console.log maps to INFO, so `log stream` needs --level info to show it.
  # The stream is started BEFORE launch so no early lines are lost, and it
  # also gives deterministic fail-fast on JS fatals (category native logs
  # "Unhandled JS Exception"), which a screenshot-only check would miss.
  xcrun simctl install "$IOS_SIM_UDID" "$app_path"
  xcrun simctl terminate "$IOS_SIM_UDID" "$bundle_id" >/dev/null 2>&1 || true
  : > "$runtime_log"
  xcrun simctl spawn "$IOS_SIM_UDID" log stream --level info --style compact \
    --predicate 'subsystem == "com.facebook.react.log"' >"$runtime_log" 2>&1 &
  track_pid $!
  sleep 2  # let the stream attach before launching

  xcrun simctl launch "$IOS_SIM_UDID" "$bundle_id" >/dev/null

  local start ready fatal
  start=$(date +%s); ready=0; fatal=0
  while [ $(( $(date +%s) - start )) -lt "$READY_TIMEOUT" ]; do
    if grep -qE "$READY_PATTERN|$PENDING_PATTERN" "$runtime_log"; then
      # The same assertion as Android - see verify_ready_line.
      verify_ready_line "$runtime_log" iOS
      ready=1
      break
    fi
    if grep -qE "Unhandled JS Exception|RCTFatal|Fatal error" "$runtime_log"; then
      fatal=1; break
    fi
    sleep 1
  done
  # Screenshot as evidence, on success and on timeout alike.
  xcrun simctl io "$IOS_SIM_UDID" screenshot "$ARTIFACTS/$shot" 2>/dev/null || true
  xcrun simctl terminate "$IOS_SIM_UDID" "$bundle_id" >/dev/null 2>&1 || true
  [ $fatal -eq 1 ] && fail "iOS app hit a fatal JS error, see $runtime_log"
  [ $ready -eq 1 ] ||
    fail "no '$READY_PATTERN' in os_log within ${READY_TIMEOUT}s (screenshot: $ARTIFACTS/$shot), see $runtime_log"
  log "iOS OK ($bundle_id) - all controls laid out in os_log, screenshot: $ARTIFACTS/$shot"
}

cleanup_app() { # cleanup_app <app-dir>
  if [ "$KEEP_TMP" = "1" ]; then
    log "keeping temp dir ($1)"
  else
    rm -rf "$1"
  fi
  if [ -n "$PACK_DIR" ]; then
    [ "$KEEP_TMP" = "1" ] || rm -rf "$PACK_DIR"
  fi
}

print_timings() {
  timer "total" "$RUN_START"
  log "timings: ${TIMINGS[*]:-none}"
}
