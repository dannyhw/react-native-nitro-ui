#!/usr/bin/env bash
# Static guard for review B1 (use-after-free on the batched-correction path).
#
# The callback that puts a measured size into Fabric state must capture the size
# **by value**. React Native documents a state update as runnable "from any
# thread any moment later" (react/renderer/components/view/ConcreteState.h), and
# for a sizing correction past the immediate budget it always does: it runs on
# the JS thread, after `applyReports` has returned and freed the vector the size
# lives in. A reference capture is then a use-after-free on every one of those
# corrections - 198 of 200 in a cold batch.
#
# Why a grep and not a test: `cpp/NitroUiIntrinsic.hpp` includes React Native
# headers, so `scripts/native-tests.sh` cannot compile it at all. The deferred
# push in `sizing.test.cpp`, run under ASan, pins the engine side of the same
# contract; this is the only check that can see the host line. It is scoped to
# the `updateState` call rather than the whole file, because a reference capture
# is perfectly right everywhere else in it.
set -euo pipefail

file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/cpp/NitroUiIntrinsic.hpp"

# The call and its callback, up to the `EventQueue::UpdateMode` argument.
region="$(awk '/->updateState\(/ { found = 1 } found { print } found && /UpdateMode/ { exit }' "$file")"

if [ -z "$region" ]; then
  echo "  FAIL: $(basename "$file") no longer has the expected updateState call."
  echo "        The B1 guard cannot see the capture list any more - update this script."
  exit 1
fi

# Drop comment lines: the code documents the bug, and prose about a
# `[&measured]` capture must not trip the guard.
code="$(printf '%s\n' "$region" | sed -e 's://.*::' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\*/d')"
code="$(printf '%s\n' "$code" | awk '/^ *[[:space:]]*\*/ { next } { print }')"

if printf '%s\n' "$code" | grep -qE '\[\s*&'; then
  echo "  FAIL: the sizing state-update callback captures by reference."
  echo "        It must capture [measured] by value - review B1."
  exit 1
fi

if ! printf '%s\n' "$code" | grep -qE '\[\s*measured\s*\]'; then
  echo "  FAIL: the sizing state-update callback no longer captures [measured] by value."
  echo "        Review B1: RN runs it after the engine has freed the size."
  exit 1
fi
