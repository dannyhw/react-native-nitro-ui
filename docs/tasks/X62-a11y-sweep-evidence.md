# X62 — a red Android a11y sweep case keeps the tree and screen it was graded on

**Kind:** tooling · **Devices:** android · **Budget:** 1.5 h for round one (X57, a small tooling
task with one device run)

## Goal

When the Android a11y sweep fails a case, the run's evidence holds what the sweep saw at its final
read. That lets a reader tell a real library fault from a read taken at the wrong moment, without
having to reproduce the failure.

## Why

The hosted DatePicker case has failed three times with `1 node(s) carry the name "Hosted date
picker" and every one of them has a zero-sized box`. The product side cannot tell a real zero box
from a mid-layout read. What would decide it is the sweep's final dump, showing the DatePicker's
Host box and its neighbours' boxes beside the zero node. Today the sweep logs only the message,
and the dump is overwritten on the device.

## Behaviour

1. When a sweep case fails, including a failure the deadline cuts short, the run's output
   folder (the `out` directory `scripts/real-input/android.mjs` already writes `metro.log`
   into) holds two files for that case:
   - the final `uiautomator` XML the verdict was made on
   - a screenshot taken straight after
2. The case's log line names both files by their paths relative to the output folder.
3. For a zero-sized-box finding, the log also prints the bounds of the named node's nearest
   ancestor that has a non-zero box, and that ancestor's class and resource id. A reader then
   knows from the log alone whether the control's Host was drawn.
4. A passing case writes nothing, and a green run's output is unchanged.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- Unit test, using a stand-in device and an XML fixture with a zero-box named node inside a
  drawn Host: a failed case writes the XML and asks for a screenshot, and the log line carries
  the ancestor's bounds. It goes red when the evidence write is removed.
- Unit test: a passing case writes no file. It goes red when files are written unconditionally.
- `node scripts/gate.mjs real-input:android -- --a11y hosted-date-picker` passes on this machine
  and leaves no evidence files. Before you start it, check the lease list: while any lease's
  note says `in use (real-input:ios)`, wait.

## Out of scope

- The verdict rule itself, the sweep's 40 s deadline, and the zero-box rule. They change nothing
  about what passes.
- The e2e suite and the tree checks.
- The CI workflow. It already uploads the output folder.

## Decided already

- Capture the screenshot with `adb exec-out screencap -p`, through the same `adbShell` route
  the sweep uses for everything else.
- Evidence files are never committed. The folder is already ignored; check that it is.

## Context

`scripts/real-input/a11y-sweep-device.mjs` (`runA11ySweepOnDevice`, `SweepDevice.hierarchy`),
`scripts/real-input/a11y-sweep.mjs` (`runA11ySweep`, where a case is graded),
`scripts/real-input/a11y.mjs` (the zero-box rule), `scripts/real-input/android.mjs` (`out`).
