#!/usr/bin/env bash
# Host-side native unit tests (bun run test:native): compiles the shipping core sources with
# the host toolchain and runs them as plain binaries. No simulator, no Gradle, no app.
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

run_case "sizing state-update captures by value" \
  bash "$ROOT/scripts/check-sizing-capture.sh"

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

# The intrinsic-sizing engine: cache, ledger and push decisions.
run_case "sizing.test (C++)" \
  bash -c "
    clang++ -std=c++20 -Wall -Werror \
      -I '$ROOT/cpp' \
      -framework CoreFoundation \
      '$ROOT/scripts/native-tests/sizing.test.cpp' \
      '$ROOT/cpp/NitroUiSizingEngine.cpp' -o '$OUT/sizing' && '$OUT/sizing'
  "

# The Slider's value rule: clamping, step snapping and float tidying.
run_case "slider-value.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/Slider/NitroUiSliderValue.swift' \
      '$ROOT/scripts/native-tests/slider-value.test.swift' \
      -o '$OUT/slider-value' && '$OUT/slider-value'
  "

# The iOS Picker's variant rule: `radio` is Android's control and resolves to the menu here.
run_case "picker-variant.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/Picker/NitroUiPickerVariant.swift' \
      '$ROOT/scripts/native-tests/picker-variant.test.swift' \
      -o '$OUT/picker-variant' && '$OUT/picker-variant'
  "

# The iOS Checkbox's glyph table: which style a name means, and which SF Symbol each state draws.
run_case "checkbox-glyph.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/Checkbox/NitroUiCheckboxGlyph.swift' \
      '$ROOT/scripts/native-tests/checkbox-glyph.test.swift' \
      -o '$OUT/checkbox-glyph' && '$OUT/checkbox-glyph'
  "

# The TextField's `maxLength` cut and text equality, including insertions in mid-text.
run_case "text-limit.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/TextField/NitroUiTextLimit.swift' \
      '$ROOT/scripts/native-tests/text-limit.test.swift' \
      -o '$OUT/text-limit' && '$OUT/text-limit'
  "

# What a Form's shadow node reads out of `nuiContentOffsetY`, including unset, null and NaN.
run_case "scroll-offset.test (C++)" \
  bash -c "
    clang++ -std=c++20 -Wall -Werror \
      -I '$ROOT/cpp' \
      -I '$ROOT/node_modules/react-native-nitro-modules/cpp/core' \
      -I '$ROOT/node_modules/react-native-nitro-modules/cpp/utils' \
      '$ROOT/scripts/native-tests/scroll-offset.test.cpp' -o '$OUT/scroll-offset' && '$OUT/scroll-offset'
  "

# The Stepper's binding rule: what a write from SwiftUI's control may do with its own stride.
run_case "stepper-binding.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/components/Slider/NitroUiSliderValue.swift' \
      '$ROOT/ios/components/Stepper/NitroUiStepperBinding.swift' \
      '$ROOT/scripts/native-tests/stepper-binding.test.swift' \
      -o '$OUT/stepper-binding' && '$OUT/stepper-binding'
  "

# How far a finger may travel over a pressable row before the touch stops being a press.
run_case "press-travel.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/ios/core/NitroUiPressTravel.swift' \
      '$ROOT/scripts/native-tests/press-travel.test.swift' \
      -o '$OUT/press-travel' && '$OUT/press-travel'
  "

# The UI tests' bounded gesture waits (a tab-bar scroll, a popover anchor tap). Compiles the
# shipping UI-test file itself, so the host proves the code that runs on the simulator.
run_case "gesture-settlement.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/example/ios/NitroUiExampleUITests/GestureSettlement.swift' \
      '$ROOT/scripts/native-tests/gesture-settlement.test.swift' \
      -o '$OUT/gesture-settlement' && '$OUT/gesture-settlement'
  "

# The UI-test target's sources, parsed only: `-frontend -parse` resolves no imports and needs
# no simulator, so a syntax error costs about a second instead of a device build.
run_case "ui-test sources parse (Swift)" \
  bash -c "
    xcrun swiftc -frontend -parse \
      '$ROOT/example/ios/NitroUiExampleUITests/A11yFrameStability.swift' \
      '$ROOT/example/ios/NitroUiExampleUITests/GestureSettlement.swift' \
      '$ROOT/example/ios/NitroUiExampleUITests/RealInputTests.swift'
  "

run_case "a11y-frame-stability.test (Swift)" \
  bash -c "
    swiftc -Onone \
      '$ROOT/example/ios/NitroUiExampleUITests/A11yFrameStability.swift' \
      '$ROOT/scripts/native-tests/a11y-frame-stability.test.swift' \
      -o '$OUT/a11y-frame-stability' && '$OUT/a11y-frame-stability'
  "

# The sizing test again under the sanitizers: its risks are lifetime and UB, not arithmetic.
# Leak checking is off because the engine is a deliberately leaked singleton.
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

# The scroll-offset test again under the sanitizers.
run_case "scroll-offset.test (C++ / ASan + UBSan)" \
  bash -c "
    ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=print_stacktrace=1 \
    clang++ -std=c++20 -Wall -Werror -g -O1 -fno-omit-frame-pointer \
      -fsanitize=address,undefined -fno-sanitize-recover=all \
      -I '$ROOT/cpp' \
      -I '$ROOT/node_modules/react-native-nitro-modules/cpp/core' \
      -I '$ROOT/node_modules/react-native-nitro-modules/cpp/utils' \
      '$ROOT/scripts/native-tests/scroll-offset.test.cpp' -o '$OUT/scroll-offset-asan' && '$OUT/scroll-offset-asan'
  "

if [ "$status" -eq 0 ]; then
  echo "test:native: PASS"
else
  echo "test:native: FAIL"
fi
exit "$status"
