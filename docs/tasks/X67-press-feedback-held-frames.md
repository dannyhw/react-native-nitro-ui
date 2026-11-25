# X67 — the press-feedback check reads the row while the finger is down, however slow the driver

**Kind:** tooling · **Devices:** android · **Budget:** 1.5 h for round one (X66, a real-input
tooling task with one filtered device run)

## Goal

On a slow Android machine, "a held press on a ListItem draws its ink" reads a frame taken while
the finger is down, instead of one taken before the touch landed.

## Why

On GitHub-hosted runs the case failed twice in about 36 runs, each time with the held frame
exactly equal to the frame at rest (0.9700 against 0.9700). `pressPaintsFeedback`
(`example/e2e/real-input/press-feedback.ts`) asks for one frame 450 ms after it issues the
press. In the failing run the 1800 ms press took 2777 ms from request to answer, while the other
1800 ms presses in that run took 2000 to 2200 ms. So the driver took about 980 ms to put the
finger down, after the frame was taken. Evidence: run 45602779544, job "Real input (Android) 2",
artifact `real-input-android-2`, the session log under `.real-input/android/agent-device`.

## Behaviour

1. Frames are read from 450 ms after the press is issued until one shows ink or the press ends.
2. A frame counts only if its read finished less than the hold time after the press was issued.
   The finger cannot have lifted before then, so a counted frame was taken while it was down.
3. The minimum drop, the hold time, and the check that the ink clears after the lift do not
   change.

## Proof

- A unit test over frame timings taken from the failing run: it fails when only the first frame
  counts, and it fails when a frame finished after the press is counted.
- `node scripts/gate.mjs real-input:android -- --control list-item` passes on this machine.
- The same run goes red when the held control is a plain text node that draws no ink.

## Out of scope

The ListItem's own ink, the driver's latency, and the other press-feedback callers' screens.
