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

if [ "$status" -eq 0 ]; then
  echo "test:native: PASS"
else
  echo "test:native: FAIL"
fi
exit "$status"
