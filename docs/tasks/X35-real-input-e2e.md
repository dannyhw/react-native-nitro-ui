# X35 — Android real-input runs on e2e

## Goal
Real touches on Android are driven by e2e (https://github.com/e2e-inc/e2e, package `@e2e-dev/mobile`, built on agent-device) instead of the hand-written driver, and the suite asserts only what the on-device harness cannot.

## Why
`scripts/real-input/android.mjs` is 11,135 lines of `adb shell input` plus polling `uiautomator dump`. A passing run takes 72 minutes. Of 389 red real-input runs, 31 showed a library defect, and every one was of four kinds: hit-testing or gesture arbitration, the screen-reader tree, keyboard avoidance, drawn press feedback. The rest of what it asserts (refused or disabled controls, counts per tap, event order) the harness suites in `example/__tests__` already assert. The project's rule from now on: device driving outside the harness uses e2e or agent-device, never a driver of our own.

## Behaviour when done
1. `node scripts/gate.mjs real-input:android` runs an e2e suite against the example app on the leased emulator, addressed only through the lease (`ANDROID_SERIAL`, `ANDROID_ADB_SERVER_PORT`, its Metro port). It never addresses another device.
2. The suite has, for every control in `scripts/real-input/controls.mjs`: one real tap (or the control's natural gesture) that must change what is on screen, proving the touch arrived. Beyond that it keeps only checks of the four kinds above that the audit's section A ties to a real defect or that no harness test covers: the Form-row flick that must not press, the Slider drag, screen-reader tree facts (role, label, value, checked or disabled state on the node a person acts on), keyboard avoidance for the text controls, and drawn press feedback where it was checked.
3. Every assertion that was dropped is listed in the report beside the harness test that covers it (file and test name). An assertion with no harness cover is kept or moved, not dropped.
4. Where e2e cannot express a check, use the `agent-device` CLI for that step, or keep the smallest existing helper, and say which and why.
5. `scripts/real-input/android.mjs` and every helper that only it used are deleted, with their tests. The iOS driver (`example/ios/NitroUiExampleUITests`, `scripts/real-input/ios.mjs`) is untouched and still passes its unit tests.
6. A passing Android run takes under 20 minutes on the leased emulator.

## Proof
- `real-input:android` green twice in a row on one lease, with both durations in the report.
- One mutation per kind, shown red then restored: make a hosted control ignore touches; make the Form row press on a flick; change an accessibility label or state; break keyboard avoidance. Name the test and the line that went red.
- `node scripts/gate.mjs check` green, and whatever `node scripts/gate.mjs need --for review` asks for.
- `manifest:check` unchanged: the published package gains no file and no dependency.

## Out of scope
The iOS driver; any harness test; the accessibility exemption table's contents; the open Menu question in docs/tasks/FOLLOWUPS.md (keep Menu's check as it is in substance); performance of the library itself.

## Decided already
- e2e's deterministic API only (`screen.getByTestId`, `tap`, `swipe`, `expect(...)`, `boundingBox`). No `agent.act`, `agent.assert` or any step that calls a model: a gate must not depend on one.
- e2e is a dev dependency of the example app or of a private workspace beside it, pinned to an exact version. Never a dependency of the library package.
- `retries: 0`. A flaky check is fixed or reported, never retried to green (`.claude/skills/flake/SKILL.md`).
- Tests live under `example/e2e/`. Results keep going through the gate ledger; e2e's JUnit or JSON report is an artifact, not a second ledger.
- If a control has no stable `testID`, add one in the example app, not in the library.

## Budget
8 hours. Checkpoint at 90 minutes: e2e installed, one real tap on one hosted Compose control green on the leased emulator through the gate's environment. If by then e2e cannot deliver a real touch to a hosted control, or cannot be pointed at the leased serial and adb server port, stop and report what you tried, with the exact errors. At 8 hours, commit, write the report with what is and is not done, and stop.
