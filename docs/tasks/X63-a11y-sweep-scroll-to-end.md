# X63 — the Android a11y sweep scrolls until its control is on screen or the page ends

**Kind:** tooling · **Devices:** android · **Budget:** 1.5 h for round one (X57, a small tooling
task with one device run)

## Goal

On a slow machine, the Android a11y sweep grades each control while that control is on screen,
instead of grading a control that is still below the window.

## Why

On a GitHub-hosted runner, one sweep run failed the Host screen's `hosted-segmented` and
`hosted-picker` cases. The evidence that the red case kept shows why:

- The page was scrolled only partway. `Hosted segmented` sat at `[42,2329][535,2424]`, on the
  window's bottom edge (the window is 2424 px tall).
- `Hosted picker` was a Spinner at `[0,0][0,0]`, below the window.
- The screenshot shows the same.

`treeShowing` in `scripts/real-input/a11y-sweep.mjs` gives up after a fixed eight swipes of
320 px and grades whatever it has. On the runner, each swipe moves the page less than 320 px, so
eight swipes don't reach the bottom of `HostScreen`. Earlier hosted DatePicker "zero-sized box"
failures are most likely the same cause: that control sits below the Picker.

## Behaviour

1. A case is graded on a dump in which the control's named node has a box wholly inside the
   window. Its bottom edge above the window's bottom counts as inside. A node that only touches
   the bottom edge does not.
2. The sweep keeps scrolling until that holds, or until a swipe leaves the page where it was.
   The page counts as unmoved when the same nodes sit at the same boxes before and after the
   swipe. A fixed swipe count no longer decides that a control is missing.
3. A hard cap stays, so that a page that never stops changing cannot loop forever. It is high
   enough that the deepest example screen can never reach it: state the number and why in a
   comment. Reaching it fails with a message saying so.
4. A control that really is missing or zero-sized still fails exactly as today, once the page
   has ended.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- Unit test, with a stand-in page where each swipe moves the page less than 320 px and the
  control is reached only after more than eight swipes: the case is graded on the dump with the
  control wholly on screen. It goes red with today's `treeShowing`.
- Unit test: a control that touches the bottom edge is scrolled once more before it is graded.
- Unit test: a page that stops moving with the name still absent ends the probe and reports the
  same finding as today.
- `node scripts/gate.mjs real-input:android -- --a11y hosted-segmented --a11y hosted-picker --a11y hosted-date-picker`
  passes on this machine.

## Out of scope

- The a11y rule, its exemptions, and the evidence capture.
- iOS (`real-input-a11y-ios`).
- The CI workflow.
- The dev LogBox toast at the bottom of the window. Note it as a follow-up if it gets in the way.

## Decided already

- Use the same swipe (`scrollPage`) as today. Only the stopping rule changes.
- This is navigation, not an assertion, so a page-end rule is not "raising a timeout to reach
  green". Do not change any assertion.

## Context

`scripts/real-input/a11y-sweep.mjs` (`treeShowing`, `SCROLL_PROBE_LIMIT`, `SCROLL_PROBE_PX`),
`scripts/real-input/a11y-sweep-device.mjs` (`scrollPage`, `size()`),
`scripts/__tests__/real-input-a11y.test.js`. The case order is in `scripts/real-input/a11y.mjs`
(`A11Y_CONTROLS`).
