#!/usr/bin/env bash
# Static guard for review T14/1: a queued sizing correction must ask for the draw
# it needs.
#
# Android's flush is a `ViewTreeObserver.OnPreDrawListener`
# (`NitroComposeHost.scheduleSizingFlush`). That listener is a request to be
# *consulted* at the next draw, not a request *for* one - and a window that has
# already drawn its last frame does not schedule another. A size measured after
# that moment (measured: a control inside an RN `Modal`, whose dialog stops
# drawing once it has been presented) leaves its correction queued in the engine
# until some unrelated redraw comes along. So registering the listener and
# requesting the traversal belong together: `postInvalidateOnAnimation()` on the
# host, whose observer is the window the correction has to reach.
#
# Why a grep and not a test: whether the correction lands is a race between the
# report and the window's last traversal, and the race cannot be produced from
# JS. Every report a real control produces comes out of a Compose measure (the
# only caller of `reportToSizingEngine`), and the traversal that runs that
# measure is always followed by at least one more in an RN dialog - instrumented
# on `nitroui_t01`: report at t, next dialog traversal at t+4 ms and t+11 ms; the
# harness's own Modal test passed 9 runs out of 9 with the draw request removed.
# The on-device test (`example/__tests__/Sizing.harness.tsx`
# `Sizing › sizes a control inside a Modal`) therefore asserts the *behaviour* -
# a correction made against a presented dialog reaches the tree, and a lost one
# fails it - and this guard asserts the *mechanism*, which is the half no device
# can pin. It costs 5 ms of a gate that already runs 3 of them.
#
# Scoped to the one function body rather than the file: `invalidate()` is the
# right call for other reasons elsewhere, and the kdoc here names both candidates
# while explaining the choice - so comments are stripped before matching.
set -euo pipefail

file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt"

# The function body: from its signature to the first line closing at its own
# indentation (nested blocks close deeper).
body="$(awk '/private fun scheduleSizingFlush\(/ { found = 1 } found { print } found && /^  \}$/ { exit }' "$file")"

if [ -z "$body" ]; then
  echo "  FAIL: $(basename "$file") no longer has the expected scheduleSizingFlush function."
  echo "        The draw-request guard cannot see the flush any more - update this script."
  exit 1
fi

if ! printf '%s\n' "$body" | grep -q 'addOnPreDrawListener'; then
  echo "  FAIL: scheduleSizingFlush no longer registers an OnPreDrawListener."
  echo "        The draw-request guard cannot tell what needs the draw - update this script."
  exit 1
fi

# Drop comment lines, then look only at what comes after the registration: a draw
# requested *before* the listener exists is a frame the listener may not be in.
code="$(printf '%s\n' "$body" | sed -e 's://.*::' | awk '/^[[:space:]]*\*/ { next } { print }')"
after_registration="$(printf '%s\n' "$code" | awk '/addOnPreDrawListener/ { found = 1 } found { print }')"

if ! printf '%s\n' "$after_registration" | grep -qE '(postInvalidateOnAnimation(Delayed)?\(|[^a-zA-Z]invalidate\()'; then
  echo "  FAIL: scheduleSizingFlush registers a pre-draw listener without requesting a draw."
  echo "        A pre-draw listener is a request to be consulted at the next draw, not a"
  echo "        request for one: a report that arrives after a quiet window's last draw"
  echo "        (an RN Modal's dialog) would stay queued. Request the traversal too -"
  echo "        postInvalidateOnAnimation() on this host."
  exit 1
fi
