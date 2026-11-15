# X44 — Android real-input: e2e for what it can drive, the proven checks for the rest

## Goal
`node scripts/gate.mjs real-input:android` is green, fast and loses no check that has caught a library defect.

## Why
The e2e rewrite brought a passing run from 72 minutes to 16 with one real tap per control (commit `fe0fc720` ran green twice). A review then found checks dropped without an equivalent harness test, and the round that tried to rebuild them on e2e did not reach a green run. The cause is in the driver, not the effort: e2e's node map publishes no `clickable`, `checkable` or `scrollable`; it refuses a swipe whose path leaves the view it starts in; and `uiautomator dump` cannot run while its session holds the device. The previous hand-written driver performs exactly those checks, and it passed on this library today. It is still on `origin/main` as `scripts/real-input/android.mjs`.

## Behaviour when done

1. Phase 1 is the e2e suite: one real tap or natural gesture per control in `scripts/real-input/controls.mjs`, plus the keyboard-avoidance and placement checks that e2e expresses and that were shown red (Form keyboard, Popover under the keyboard, the screen-reader state checks that went red in `button-group`, `dialog`, `chip`). Any e2e test from the last round that is not green on a device, or was never shown red, is removed from phase 1.
2. Phase 2 runs after the suite with the agent-device daemon stopped, the way the accessibility sweep already does: the accessibility sweep (all 24 cases), and for each of the following the previous driver's own check, MOVED from `origin/main:scripts/real-input/android.mjs` with the helpers it needs, not rewritten: the BottomSheet drags and the tap on a `TextInput` inside a sheet; ContextMenu scroll that must not open and hold that must; the DatePicker time drums and the inline calendar's column rule; hosted DatePicker Cancel and Back; hosted Progress width; and the actionable-node facts (role, checked, selected, disabled on the node a person acts on) for the controls the previous driver checked them on.
3. Phase 2 is one small module beside the sweep. It addresses only the leased emulator. Aim for under 1,500 lines including helpers; if it needs more, say what took the space. Everything else of the previous driver stays deleted.
4. Every assertion the previous driver made and this gate no longer makes is listed in the report beside the harness test (file and title) that asserts the same observable. Nothing is dropped without that.
5. Both phases report through the gate's one ledger line and its per-control summary, and a failure names the control and the phase.

## Proof

- The gate green twice in a row on one lease. Both durations, and the split between the phases, in the report. Target: under 30 minutes.
- Each phase-2 check shown red once by breaking what it guards, then restored; one line each in the report as `check -> mutation -> what went red`. Phase-1 red proofs from earlier rounds stand if the test is unchanged; re-run one of them to confirm the suite still bites.
- `node scripts/gate.mjs check`, then exactly what `node scripts/gate.mjs need --for review` asks for, one device gate at a time.
- `manifest:check` unchanged: nothing is added to the published package.

## Out of scope

The iOS driver; any harness test; library code (a check that goes red on what looks like a library defect is reported with its evidence, not fixed); the question of how an Android sheet answers a drag beyond what the previous driver's own check does.

## Decided already

- Driving is e2e where e2e can do it. The moved checks are the exception that exists because e2e cannot do them yet; write one short paragraph in the report naming the three driver limits, so they can be raised with the e2e project.
- The two raw reads in `example/e2e/real-input/device-read.ts` are accepted.
- `retries: 0`, no step that calls a model, no assertion loosened and no wait added to reach green. A red or intermittent gate: read the failure, ONE rerun, a second failure of the same kind stops you; write both down.
- Do not kill a run to ship a fix. Let a run finish or use the gate's own stop; a killed run leaves the app and Metro in a state that reddens the next one.

## Budget

6 hours. Checkpoint at 2 hours: main merged, the app built, and phase 1 green once on the device. If phase 1 is not green by then, stop and report what failed, with the log lines. At 6 hours, commit, write what is and is not done, release the lease, and stop.
