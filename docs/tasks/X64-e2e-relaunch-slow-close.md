# X64 — a test's fresh launch survives a window manager that is slow to let the app go

**Kind:** tooling · **Devices:** android · **Budget:** 2 h for round one (X60, a tooling task
about the relaunch with one device run)

## Goal

On a slow Android machine, a real-input test starts from a fresh launch of the example app
instead of failing before its first step because the previous launch was slow to leave the
screen.

## Why

Two GitHub-hosted runs failed a test before it did anything, with
`ENGINE_FAILURE: open nitroui.example failed: Android app nitroui.example remained foreground after close`
(once in `bottom-sheet.e2e.ts`, once elsewhere). `app.open()` asks the driver for a fresh
launch. The driver (`agent-device`, pinned in `package.json`) closes the app with
`am force-stop` and then allows a fixed 2 s for the window manager to report another window in
front. A slow emulator takes longer than that. The same 2 s is in the newest release, and the
driver is not ours to change.

## Behaviour

1. Before the driver's fresh launch, the app is no longer in front: no process, and the window
   manager's focused window belongs to something else. The fresh launch then finds nothing to
   close.
2. Waiting for the app to leave the front has a stated deadline, long enough for the slowest
   runner. State the number and the reason in a comment. Missing the deadline fails the test
   with a message that names the window still in front.
3. Every real-input test gets this, including a test added later, without its author doing
   anything for it.
4. No assertion, test timeout or retry setting changes.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- A unit test with a stand-in device whose window manager keeps the app focused for longer than
  2 s after the stop: the step waits it out and returns once the focus moves. Show it red with
  the wait removed.
- A unit test: focus that never leaves fails at the deadline and names the focused window.
- `node scripts/gate.mjs real-input:android -- --control bottom-sheet --control button` passes on
  this machine.

## Out of scope

- `agent-device` and `@e2e-dev/mobile` themselves: no patches to either, and no version bump.
- The phase-2 relaunch in `scripts/real-input/a11y-sweep-device.mjs` (`awaitApp`), which
  already works.
- The CI workflow, and any test's own assertions.

## Decided already

- Read the focus with `scripts/real-input/window-focus.mjs` (`readWindowFocus`). Feed it the
  split `dumpsys window displays` and `dumpsys window windows` outputs, never plain
  `dumpsys window`: that output opens with the copy saved at the last ANR.
- The device is reached with the leased serial and adb server port only (`device-read.ts`
  `adbShell`).
- Where the hook lives in `example/e2e` (a shared fixture, a config hook, a wrapper the tests
  import) is your call. It must satisfy Behaviour 3.

## Context

`example/e2e/e2e.config.ts`, `example/e2e/real-input/support.ts`,
`example/e2e/real-input/device-read.ts`, `scripts/real-input/window-focus.mjs`,
`scripts/__tests__/real-input-window-focus.test.js`. The driver's close is in
`node_modules/agent-device/dist/src/app-lifecycle.js`: read it, never change it.
