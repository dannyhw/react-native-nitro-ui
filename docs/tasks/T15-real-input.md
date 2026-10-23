# T15 — Real-input verification (taps and drags that go through the OS)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T15` (branch `task/T15-real-input`, from `task/G2-button`
so Button is covered; rebased onto main after G2 merges). **Round cap (D19):** 1 + 2 fix rounds.

## Why

Our harness tests drive controls through test hooks / Nitro callbacks. Nobody has verified that a
real touch delivered by the OS reaches a hosted SwiftUI/Compose control inside an RN app (G2 found
SwiftUI `Button` rejects the harness's HID-less touch, and `agent-device` could not tap anything on
the iOS 27 simulator). RN's touch handler cancelling hosted-view touches is a known class of bug
for SwiftUI-in-RN, so this must be proven before 0.1.

## Scope

- **iOS:** a minimal XCUITest UI-test target for the example app (or a standalone UI-test bundle
  driven by `xcodebuild test`), which launches the example, and with real synthesized events:
  taps a Switch (value flips), drags a Slider (value changes, start/complete fire), taps a Button
  (`onPress` count increments), taps a disabled Button (no increment). Assert via on-screen RN
  `Text` echoes (accessibility identifiers), not via test hooks.
- **Android:** same four checks with `adb shell input tap/swipe` + `uiautomator dump` (or a tiny
  instrumentation test) — real input events.
- A `bun run test:real-input:ios|android` script; document in CONTRIBUTING. Not in `bun run check`.
- If any control does **not** respond to real input: stop, report the failing case with evidence
  (video/screenshot + logs) under "Questions for orchestrator" — that is a library bug for its
  component owner, not something to work around in the test.
