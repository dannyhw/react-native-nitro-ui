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

# In CI this belongs to the `build-android` job, which is the one that sets up JDK 17,
# accepts the SDK licences and warms the gradle cache with a real build. The `checks`
# job has an SDK but no JDK of its own and an empty gradle cache, so running it there
# too would pay a cold dependency download to prove the same thing twice. Named, not
# silent: a green `check` row that ran no Kotlin tests has to say who did.
if [ -n "${CI:-}" ] && [ "${CI:-}" != "false" ]; then
  echo "test:native:android: CI runs this in the build-android job (JDK 17 + warm gradle cache) - skipped here"
  exit 0
fi

cd "${ROOT}/example/android"

# The JVM tests do not run native code, so one ABI is all the library's CMake
# needs to configure - this machine's own (X6-build-speed). CI and other hosts
# override it with NITRO_UI_ANDROID_ARCH.
ARCH="${NITRO_UI_ANDROID_ARCH:-}"
if [ -z "${ARCH}" ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x86_64 ;;
    *) ARCH=arm64-v8a ;;
  esac
fi

./gradlew :react-native-nitro-ui:testDebugUnitTest --console=plain "-PreactNativeArchitectures=${ARCH}" "$@"
