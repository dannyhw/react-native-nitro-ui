# X54 — one failed Android accessibility case reruns alone, and a stalled iOS run fails fast

**Kind:** tooling · **Devices:** both · **Budget:** 4 h for round one (X51 and X52, the last two
tasks that changed the real-input runners, took about 4 h each)

## Goal

Nothing changes for people using the library: a red Android accessibility case costs minutes to
rerun in place of a full 40-minute gate, and an iOS real-input run that never starts a test fails
in minutes with the cause named.

## Why

Owner request. A flaky read of the hosted DatePicker cost a full Android rerun because
`--rerun-failed` refused: no filter names an accessibility case. The same day `real-input:ios`
sat 58 minutes printing nothing, because `xcodebuild` could not reach the simulator's test
service and nothing notices a run with no test started.

## Behaviour

1. `node scripts/gate.mjs real-input:android -- --a11y <case>` runs the named accessibility
   case and nothing else; the flag repeats and combines with `--control`, as it does on iOS. An
   unknown case is refused before the device is touched, naming the known ones.
2. `real-input:android --rerun-failed`, after a full run whose only failures are accessibility
   cases, reruns those cases and completes the run; it no longer answers "Run the full gate".
   A failed e2e control still reruns as it does today.
3. `real-input:ios` fails when no test case has started within a fixed time of `xcodebuild`
   starting the tests. It stops the `xcodebuild` it started and the test runner that
   `xcodebuild` launched, exits non-zero, and its message says no test started, that the
   simulator's test service is not answering, and that restarting that simulator is the fix.
4. A run in which test cases are starting is never cut short by that timer.
5. `docs/agents/gates.md` and CONTRIBUTING name the Android `--a11y` filter where they name
   the iOS one.

## Proof

- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints nothing
  missing.
- Filtered device runs, green: `node scripts/gate.mjs real-input:android -- --a11y
  hosted-date-picker`, and `node scripts/gate.mjs real-input:ios -- --control switch` to show a
  healthy run is untouched by the timer.
- Red proofs, one line each: the Android filter (a mutation that makes it run every case, or
  none), the rerun (a fixture run with one failed case reruns that case only), the stall (a
  stand-in `xcodebuild` that prints nothing fails the run at the limit; a variant with the real
  limit, not a shortened one), and line 4 (a stand-in that starts a case late is not stopped).

## Out of scope

- Why the hosted DatePicker read is sometimes a zero-sized box.
- Restarting or repairing a simulator from the gate. The gate reports; it does not restart.
- A per-case filter for the `uiautomator` tree checks, and anything in the e2e suite.

## Decided already

- The stall limit is 5 minutes from the moment the tests are started. A healthy run starts its
  first case within 30 seconds of that.
- The Android flag is spelled `--a11y`, the same as on iOS, and takes the case id printed in
  the run's log after `a11y:`.
- Stopping follows AGENTS.md: only processes this run started, by pid, or the tool's own
  shutdown (`xcrun simctl terminate` for the runner).

## Context

`scripts/real-input/android.mjs`, `scripts/real-input/a11y-sweep.mjs`,
`scripts/real-input/a11y-sweep-device.mjs`, `scripts/real-input/ios.mjs` (how `--a11y` is read
there, and where `xcodebuild test-without-building` is started), `scripts/gate-core.mjs`
(`--rerun-failed`: search "is not one a filter can name"), `docs/agents/gates.md`.
