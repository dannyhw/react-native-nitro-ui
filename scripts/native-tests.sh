#!/usr/bin/env bash
# Host-side native unit tests (bun run test:native).
#
# These compile the shipping core headers/sources with the host toolchain and run
# them as plain binaries - no simulator, no Gradle, no app. They exist because the
# parts of the core that must never be wrong (the D1 clock base, the perf ring, the
# event-count handshake) are pure logic that an on-device test would only catch by
# accident, and because all three are duplicated across C++/Swift/Kotlin.
#
# Android's Kotlin twin of the handshake is a JVM unit test instead, because that
# is where Kotlin compiles here: `bun run test:native:android`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/nitro-ui-native-tests-$$"
mkdir -p "$OUT"
trap 'rm -rf "$OUT"' EXIT

if [ "$(uname)" != "Darwin" ]; then
  echo "test:native: macOS-only (needs clang + the Swift toolchain) - skipped"
  exit 0
fi

status=0

run_case() {
  local name="$1"
  shift
  echo "── $name"
  if "$@"; then
    return
  fi
  status=1
}

# The B1 guard: the sizing state-update callback must capture its size by value
# (scripts/check-sizing-capture.sh explains why that is a grep and not a test).
run_case "sizing state-update captures by value" \
  bash "$ROOT/scripts/check-sizing-capture.sh"

# Review T14/1: Android's flush registers a pre-draw listener, which is a request
# to be consulted at the next draw and not a request for one - so it must ask for
# the draw too, or a size measured against a window that has stopped drawing (an
# RN `Modal`) stays queued. The reason is the same as B1's: the race is between
# a report and a window's last traversal, and no on-device test can produce it
# on demand. See scripts/check-sizing-flush-draw-request.sh.
run_case "sizing flush requests its draw" \
  bash "$ROOT/scripts/check-sizing-flush-draw-request.sh"

echo "compiling (host clang/swiftc, into $OUT)"

# The clock + perf ring: the shipping C++ headers, compiled as-is.
run_case "clock.test (C++ / Objective-C++)" \
  env CC_OK=1 bash -c "
    clang++ -std=c++20 -Wall -Werror -fobjc-arc \
      -I '$ROOT/cpp' \
      -framework Foundation -framework QuartzCore \
      '$ROOT/scripts/native-tests/clock.test.mm' -o '$OUT/clock' && '$OUT/clock'
  "

# The handshake: the shipping Swift file plus the test vectors.
run_case "handshake.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/core/NitroUiModel.swift' \
      '$ROOT/scripts/native-tests/handshake.test.swift' \
      -o '$OUT/handshake' && '$OUT/handshake'
  "

# The intrinsic-sizing engine: cache, ledger and push decisions (T11). It links
# the shipping C++ unchanged - `measureContent` is allowed to be a pure C++
# lookup (core-architecture §1.4), which is what makes it testable here instead
# of only on a device.
run_case "sizing.test (C++)" \
  bash -c "
    clang++ -std=c++20 -Wall -Werror \
      -I '$ROOT/cpp' \
      -framework CoreFoundation \
      '$ROOT/scripts/native-tests/sizing.test.cpp' \
      '$ROOT/cpp/NitroUiSizingEngine.cpp' -o '$OUT/sizing' && '$OUT/sizing'
  "

# The Slider's value rule: clamping, step snapping and the float tidying that
# keeps native's displayed value bit-for-bit equal to React's. Same reason the
# handshake is here rather than only on a device - it is pure arithmetic that an
# on-device test would only catch by accident, and it is duplicated in Kotlin.
run_case "slider-value.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/Slider/NitroUiSliderValue.swift' \
      '$ROOT/scripts/native-tests/slider-value.test.swift' \
      -o '$OUT/slider-value' && '$OUT/slider-value'
  "

# The accessibility pass's re-read rule (X16 item 4): the bounded "read until two
# reads agree" wait that `RealInputTests.measure` runs before it prints a control's
# boxes. It is here rather than only on a device because the three things worth
# proving are a stuck loop, a wait that chases the answer it wants, and a tree that
# never holds still - none of which a device run produces on demand, and all of
# which would turn an accessibility rule into a coin flip. It compiles the shipping
# UI-test file itself, so the host proves the code that runs on the simulator.
run_case "a11y-frame-stability.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/example/ios/NitroUiExampleUITests/A11yFrameStability.swift' \
      '$ROOT/scripts/native-tests/a11y-frame-stability.test.swift' \
      -o '$OUT/a11y-frame-stability' && '$OUT/a11y-frame-stability'
  "

# The same test again under the sanitizers, because the properties worth checking
# here are lifetime and UB rather than arithmetic: a correction is handed to a
# push that may run it later, and the engine's maps are walked while being
# mutated (`forget`, a re-entrant `measure` from a push, and the expired registry
# sweep - and the sweep is only really covered because
# `testExpiredStatesAreSweptWithoutForget` measures its dead instances under a key
# nothing reports, the only way to arrive here with entries left to walk. Review
# F1 found a use-after-free in exactly that sweep, hidden until the test reached
# it.)
# The suite is milliseconds of work, so this costs seconds and stays in the gate.
#
# Leak checking is off deliberately: the engine is a leaked singleton on purpose
# (review N3 - the run-loop observer outlives static destruction), so a leak
# report would be a false positive by design.
run_case "sizing.test (C++ / ASan + UBSan)" \
  bash -c "
    ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=print_stacktrace=1 \
    clang++ -std=c++20 -Wall -Werror -g -O1 -fno-omit-frame-pointer \
      -fsanitize=address,undefined -fno-sanitize-recover=all \
      -I '$ROOT/cpp' \
      -framework CoreFoundation \
      '$ROOT/scripts/native-tests/sizing.test.cpp' \
      '$ROOT/cpp/NitroUiSizingEngine.cpp' -o '$OUT/sizing-asan' && '$OUT/sizing-asan'
  "

if [ "$status" -eq 0 ]; then
  echo "test:native: PASS"
else
  echo "test:native: FAIL"
fi
exit "$status"
