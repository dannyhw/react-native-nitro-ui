#!/usr/bin/env bash
# JVM unit tests for the Android core (bun run test:native:android).
#
# The Kotlin twin of the event-count handshake is pure logic, so it runs on the
# JVM through the library's own `testDebugUnitTest` task - no emulator, no app.
# The example app is what includes this library as a Gradle project, so that is
# where the task lives.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${ANDROID_HOME:-}" ] && [ ! -f "${ROOT}/example/android/local.properties" ]; then
  echo "test:native:android: no Android SDK (ANDROID_HOME unset and no local.properties) - skipped"
  exit 0
fi

cd "${ROOT}/example/android"
./gradlew :react-native-nitro-ui:testDebugUnitTest --console=plain -PreactNativeArchitectures=arm64-v8a "$@"
