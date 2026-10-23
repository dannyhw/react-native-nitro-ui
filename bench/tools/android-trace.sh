#!/usr/bin/env bash
# Record what the app UI thread is doing while one bench cell runs.
#
# The bench reports *how long* a cell took; this says *where*. It traces one
# scenario on one arm, launched straight into the cell so the trace covers
# exactly the iterations the bench would have measured.
#
#   ./android-trace.sh <scenario>:<implementation>:<n> <out-name>
#   ANDROID_ADB_SERVER_PORT=5042 ./android-trace.sh mount:nitro-ui:50 mount-nitro-50
#
# Writes <out-name>.atrace and, for a memory cell, <out-name>-mem-{empty,full}.txt
# into ./android-trace/ next to this script. The device is only read, never
# configured, and the app is force-stopped first so every run starts cold.
set -euo pipefail

CELL=$1
NAME=$2
PKG=com.nitroui.bench
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/android-trace"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL=${SERIAL:-emulator-5572}
# atrace's own categories plus the two the app writes marks into.
CATS="view gfx input webview am wm dalvik bm pm ss power sched freq idle"

mkdir -p "$OUT_DIR"

$ADB -s "$SERIAL" shell am force-stop "$PKG"
sleep 2

# async_start survives the shell, `atrace --async_stop` collects it later.
$ADB -s "$SERIAL" shell "atrace --async_start -b 16384 -c - $CATS" > /dev/null

$ADB -s "$SERIAL" shell am start -n "$PKG/.MainActivity" --es benchPlan "$CELL" > /dev/null

# The memory scenario samples itself between t+1s and t+3.2s, so that is the
# window the deltas below have to match.
case "$CELL" in
  memory:*)
    sleep 1.1
    $ADB -s "$SERIAL" shell dumpsys meminfo "$PKG" > "$OUT_DIR/$NAME-mem-empty.txt"
    sleep 2.3
    $ADB -s "$SERIAL" shell dumpsys meminfo "$PKG" > "$OUT_DIR/$NAME-mem-full.txt"
    ;;
  *) sleep 9 ;;
esac

$ADB -s "$SERIAL" shell atrace --async_stop -z > "$OUT_DIR/$NAME.atrace"
$ADB -s "$SERIAL" shell atrace --async_stop > /dev/null
echo "$OUT_DIR/$NAME.atrace"
