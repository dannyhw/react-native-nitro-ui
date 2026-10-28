# F1 — Determinism: tap delivery and the known flaky tests

**Worktree / branch:** named in your delegation message (from `main`, after X11 merges, because X11
changes `scripts/real-input/android.mjs`). **Round cap:** 1 implementation round plus at most 2 fix
rounds (D19). **Devices:** `node scripts/lease.mjs acquire --task F1`.

## Why

`real-input:ios` fails `testRealInputSwitch` on this machine. On 2026-10-28 it failed 11 of 11 runs,
including runs against `main`'s own build (X11 report), so it now blocks every merge that owes
real input. `docs/tasks/Q3-flaky-tests.md` has root causes and proposed patches for that test and
two others, and `FOLLOWUPS.md`'s F1 line lists the rest.

## Do

1. **Tap delivery (Q3 §3):** before asserting a control's response, real-input tests wait until the
   OS touch has demonstrably landed, using the `tapUntilValue` approach Q3 proposes (keyed on the
   echoed *value*, retrying a swallowed tap and failing if every tap is swallowed). Apply it on iOS
   (`example/ios/NitroUiExampleUITests/RealInputTests.swift`: the Switch, hosted Switch and
   DatePicker cases, plus any other single-tap assertion) and on Android (`scripts/real-input/android.mjs`
   `CHECKS`: `switch`, `date-picker`, and the same class elsewhere).
   - First reproduce today's `testRealInputSwitch` failure, and record **which** tap fails and why.
     If it isn't a dropped tap (for example the control doesn't respond to a delivered tap), stop:
     that's a product bug. Report it with Questions rather than patching the test around it.
   - Prove it red both ways: one event swallowed must turn green through the retry, and all events
     swallowed must stay red.
2. **iOS Picker wheel test (Q3 §1):** apply `waitForFreshMeasure` (refuse a zero size and any handle
   but the live mount's) to both variant tests. Show it red with Q3's reproduction.
3. **Android hosted DatePicker test (Q3 §2):** apply patches (i) (`sweepOrder` closes every popup
   row) and (ii) (delta assertions against an earned baseline). On Q3's judgement call, a stuck
   window surfacing as a baseline refusal is acceptable; make its message name the leak.
4. **The rest of F1** (`FOLLOWUPS.md` F1 line): replace the two fixed sleeps in `lease.test.js` with
   the suite's `waitFor`, add a Node-major guard for the `gate.test.js` CLI block, add a test that
   `gate.mjs` forwards SIGINT/SIGTERM to its child, and fix X10's flaky `gate.test.js` wait test
   (named in the X10 report's Follow-ups).

**Determinism proof:** 10 consecutive green `real-input:ios` runs, and 10 consecutive green runs of
each patched harness test, recorded through `gate.mjs` (filtered runs are fine for the repeats).
Record the load for each, including some at high load (for example while a build runs).

## Gates

`check`, both harnesses and both real-input runs. A harness test file changes, so run both platforms
(AGENTS.md). Report: `docs/tasks/F1-determinism.report.md` (REPORT-TEMPLATE), with the ledger
exported. Commit on your branch, don't push.
