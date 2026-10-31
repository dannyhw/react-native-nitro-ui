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
#
# That default is *per job*, so the job that owns the run has to say so: GitHub Actions
# exports `CI=true` on every step of every job, and an opt-out keyed on CI alone skips
# in the very job it hands off to (X15 review). `NITRO_UI_ANDROID_JVM_TESTS=1` is that
# declaration, and `build-android`'s step sets it. Anyone adding a CI job that runs this
# script sets the same variable; nothing else in CI runs it.
if [ -n "${CI:-}" ] && [ "${CI:-}" != "false" ] &&
  [ "${NITRO_UI_ANDROID_JVM_TESTS:-}" != "1" ]; then
  echo "test:native:android: CI runs this in the build-android job (JDK 17 + warm gradle cache) - skipped here; NITRO_UI_ANDROID_JVM_TESTS=1 runs it in this job"
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

# The daemon stays on on purpose (X15 review 5d, measured here rather than guessed): the warm
# path is 0.9 s with the daemon and 4.4 s with `--no-daemon`, so paying ~5x on every `check` to
# tidy up a process that expires on its own after three idle hours is the wrong trade. A person
# who does want the memory back runs `./gradlew --stop` from `example/android`; this script's
# job is to test the Kotlin, not to reap.

./gradlew :react-native-nitro-ui:testDebugUnitTest --console=plain "-PreactNativeArchitectures=${ARCH}" "$@"
