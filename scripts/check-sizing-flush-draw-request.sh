#!/usr/bin/env bash
# Static check: Android's sizing flush must request a draw as well as register
# its `OnPreDrawListener`. The listener is only consulted at the next draw, and a
# window that has drawn its last frame (an RN Modal's dialog) schedules no other.
# A grep because the race with the window's last draw cannot be made in a test.
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
