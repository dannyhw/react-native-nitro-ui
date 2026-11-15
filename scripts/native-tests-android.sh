#!/usr/bin/env bash
# JVM unit tests for the Android core (bun run test:native:android). Runs the library's
# `testDebugUnitTest` task through the example app's Gradle project; no emulator needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${ANDROID_HOME:-}" ] && [ ! -f "${ROOT}/example/android/local.properties" ]; then
  echo "test:native:android: no Android SDK (ANDROID_HOME unset and no local.properties) - skipped"
  exit 0
fi

# CI sets CI=true in every job, so the one job that owns this run opts in with
# NITRO_UI_ANDROID_JVM_TESTS=1 and every other CI job skips it.
if [ -n "${CI:-}" ] && [ "${CI:-}" != "false" ] &&
  [ "${NITRO_UI_ANDROID_JVM_TESTS:-}" != "1" ]; then
  echo "test:native:android: CI runs this in the build-android job (JDK 17 + warm gradle cache) - skipped here; NITRO_UI_ANDROID_JVM_TESTS=1 runs it in this job"
  exit 0
fi

cd "${ROOT}/example/android"

# The JVM tests run no native code, so CMake needs only one ABI: this machine's, unless
# NITRO_UI_ANDROID_ARCH overrides it.
ARCH="${NITRO_UI_ANDROID_ARCH:-}"
if [ -z "${ARCH}" ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x86_64 ;;
    *) ARCH=arm64-v8a ;;
  esac
fi

./gradlew :react-native-nitro-ui:testDebugUnitTest --console=plain "-PreactNativeArchitectures=${ARCH}" "$@"
