# X60 — the Android tree checks never press Back on a window that is not the app's

**Kind:** tooling · **Devices:** android · **Budget:** 2 h for round one (X57, a small tooling
task with one device run)

## Goal

The Android real-input gate's tree-check phase reaches its first screen on a slow machine (a
hosted CI runner) as it does on a fast one, instead of closing the app it just launched.

## Why

On a GitHub-hosted runner, in six of six runs, the tree-check phase failed straight after the
a11y sweep with `no tab of the example is in the accessibility tree, so the "Context" tab cannot
be scrolled to`. The state left behind showed the launcher focused with the notification shade
pulled down. The device log showed this sequence:

1. `startFromLaunch` force-stops and starts the app.
2. The runner animates the old task's close transition onto home, which takes about 1 s.
3. `returnToAppWindow` (in `scripts/real-input/android-tree-checks.mjs`) dumps a window that has
   no tab strip and presses Back. That Back closes the app.
4. A second Back lands on the launcher.
5. `scrollToTop`'s swipe then pulls the shade down.

A local machine finishes the transition before the dump, so the local gate never sees this.

## Behaviour

1. After a relaunch, the tree-check phase never presses Back unless the app's own activity is
   the focused window, as `dumpsys window` reports it. When something else is focused (launcher,
   shade, a transition), it waits for the app or brings it to the front, and never sends a key
   that could close it.
2. Back still dismisses something the app itself has on top of its screen (its own popup,
   dialog or keyboard), as today.
3. When the app cannot be brought back within a bounded time, the phase fails with a message
   naming the window that was focused, not with a missing-tab error further on.
4. The a11y sweep gets the same guard if it shares this path (`startFromLaunch`, or any Back it
   sends to reach its screen).

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- A unit test with a stand-in `adbShell` (focus on the launcher, or a dump without the tab strip
  while the app's activity is still settling) shows no Back sent, and the app reached once it is
  focused. It goes red when the old `returnToAppWindow` is put back.
- A unit test for the failure message in Behaviour 3.
- `node scripts/gate.mjs real-input:android -- --control context-menu`: the filtered run reaches
  the context-menu tree check and passes, on this machine.

## Out of scope

- The CI workflow (`.github/workflows/ci.yml`); the trial branch that runs this on CI is separate.
- The e2e suite, the uiautomator dump retries, `revealTab`'s swipe logic.
- Product tests that fail on CI (SearchField, Picker, Slider, Menu): another thread has them.

## Decided already

- Read focus from `adb shell dumpsys window` (`mCurrentFocus` / `mFocusedApp`), which the gate
  already shells out for popups; no new tool.
- `am start -W` is acceptable for the launch if it helps; say in the report whether it did.
- No raised timeouts, retries or sleeps to reach green (AGENTS.md flake rule); the fix is to not
  send the key.

## Context

`scripts/real-input/android-tree-checks.mjs` (`returnToAppWindow`, `runTreeChecksOnDevice`),
`scripts/real-input/a11y-sweep-device.mjs` (`startFromLaunch`, `goToScreen`, `scrollToTop`,
`key`, `popupWindowCount`), `scripts/real-input/android.mjs` (order of e2e, sweep, tree checks).
