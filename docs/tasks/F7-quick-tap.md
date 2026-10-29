# F7 — Quick taps on a hosted control in a busy screen are dropped (iOS)

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 implementation
round plus at most 2 fix rounds (D19). **Devices:** your lease (`lease.mjs acquire --task F7 --boot`).
Product code may change here, unlike F1.

## What F1 found

`docs/tasks/F1/dwell-probe.md` (read it all; `scripts/real-input/dwell-probe.mjs` is the tool) pressed the
uncontrolled Switch with XCUITest presses of fixed length and read the control's own native value:

- On the Switch screen (~200 controls in a `ScrollView`), presses of 0–50 ms land 0–1 times in 12, and
  80 ms lands 6–7 in 12. Presses of 120 ms land 12/12.
- On the Host screen (a dozen controls), 30 ms already lands 12/12.
- RN's own `Pressable` on the Switch screen takes every zero-length press.
- A person's quick tap is roughly 40–120 ms, so real taps can be lost. The harness presses for 0.15 s
  (`RealInputTests.swift:115`) so that its other checks stay meaningful. That is a workaround, not the
  contract.

The probe's footer names two candidate mechanisms and a one-line experiment for each: `ScrollView`
touch delay (`delaysContentTouches`) and hit-test cost with many mounted rows. Neither has been run.

## Do

1. **Find the mechanism, by measurement.**
   - Run the probe's two experiments at a fixed 50 ms press, plus any others you need.
   - State which change moves the busy screen to 12/12, and why: name the UIKit/SwiftUI/RN line or
     behaviour responsible.
   - Check whether other hosted controls show it too (at least SegmentedControl and Button, on the busy
     screen and in a `<Host>`). Check whether a plain SwiftUI `Toggle` in a `UIHostingController` inside
     a bare `UIScrollView`, with no RN involved, shows it. That tells you whether it is ours, RN's or
     the platform's.
   - Check Android once at the same press lengths with the Android real-input tooling. Say "not
     affected" only with numbers.
2. **If it's ours, fix it in the library**, not the example, so apps get the fix. Keep the perf
   contract (AGENTS.md). Don't change scroll behaviour app-wide: a fix that makes scrolling start
   late, or makes a control fire on a scroll that started on it, is worse than the bug. Show with a
   measurement that both still behave.
   - If it's RN's or the platform's, don't patch around it blind. Write down what an app can do, and
     ask (Questions) whether the library should apply that itself.
3. **Guard it.** Add a real-input case that presses for 50 ms on the busy screen. Show it red before the
   fix and green after. If the fix lands, lower `pressDwell` toward human tap length. Pick a value the
   probe shows lands 12/12 on both the calm and the loaded machine.

## Not in scope

Anything F1 already fixed: the retry witness and the counters. Other F-group follow-ups.

## Gates

`check`, both `harness:*`, both `real-input:*`, then `need --for review`. The probe tables go in your
report: before and after, calm and loaded, with `load1`. Report: `docs/tasks/F7-quick-tap.report.md`,
with the ledger exported.
