#!/usr/bin/env bash
# Static check: the callback that puts a measured size into Fabric state must
# capture it by value, because React Native may run a state update later, on
# another thread, after the vector holding the size is freed. A grep because
# `cpp/NitroUiIntrinsic.hpp` cannot be compiled by the native unit tests.
set -euo pipefail

file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/cpp/NitroUiIntrinsic.hpp"

# The call and its callback, up to the `EventQueue::UpdateMode` argument.
region="$(awk '/->updateState\(/ { found = 1 } found { print } found && /UpdateMode/ { exit }' "$file")"

if [ -z "$region" ]; then
  echo "  FAIL: $(basename "$file") no longer has the expected updateState call."
  echo "        The B1 guard cannot see the capture list any more - update this script."
  exit 1
fi

# Drop comment lines: prose about a `[&measured]` capture must not match.
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
