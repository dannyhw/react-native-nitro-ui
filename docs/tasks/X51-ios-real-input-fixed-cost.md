# X51 — a filtered iOS real-input run costs minutes, not a quarter of an hour

**Kind:** tooling · **Devices:** ios · **Budget:** 4 h for round one (X48 and X49, the two
closest tasks, each fitted one sitting)

## Goal

Nothing changes for people using the library: a contributor proving one control on iOS waits
about 4 minutes in place of 14, and the full iOS run loses most of its fixed cost.

## Why

Owner request. A measured `real-input:ios -- --control switch` run took 822 s: the accessibility
pass over every control 490 s (about 3,400 single element lookups), the build 133 s, the
tab-target pass 93 s, the switch itself 85 s. Past runs fit 12.5 minutes fixed plus 77 s a
control. The test build recompiles 515 of 1,030 C/C++ files after every app build, with no
compiler cache; given the app build's cache settings it recompiled 56 and took 20 to 40 s.

## Behaviour

1. The accessibility pass prints the same lines for every case as before (same elements, roles,
   names, values, boxes, stability lines) and the same verdicts, in well under half the time.
2. A filtered run reads the accessibility cases of the controls it names and no others, and
   reports no result for the rest. A full run still reads every case.
3. A filtered run skips the tab-target pass unless asked for it by a flag. A full run still
   runs it.
4. `--rerun-failed` completes a red full run whose only failures are accessibility cases or the
   tab-target pass, re-reads exactly those, and is still red when they fail again.
5. After `node scripts/build-app.mjs --platform ios`, the test build recompiles under 100 C/C++
   files, and an app build after it does not recompile them all either. A machine without
   ccache still builds.

## Proof

- `node scripts/gate.mjs check` passes; `need --for review` prints nothing missing.
- Line 1: one `-- --control switch` run before the change and one after it, both still reading
  every case; the report gives the two pass times and says the printed case lines are identical
  (or lists each difference and why it is right). Make this change first, before line 2.
- Lines 2 and 3: `node scripts/gate.mjs real-input:ios -- --control switch` on a quiet machine;
  the report gives its total and its phases. Unit tests for what the runner selects and reports.
- Red proofs, each a filtered run: an accessibility name removed from one control turns that
  control's case red; a second mutation of a different rule (a stop inside the control, or its
  box) turns another red; a tab made too small turns the tab-target pass red when asked for.
- Line 4: unit tests on the ledger logic, each shown red.
- Line 5: `CompileC` counts from the build logs for app build, test build, app build, in the
  report.

## Out of scope

- The Android runner and its sweep. The tab-target pass's own speed.
- Building the test bundle inside `build-app.mjs`. The whole-tree build stamp.
- Why iOS touches drop beside another gate.

## Decided already

- A change to the ledger code is allowed for line 4 only. It re-owes every device gate at
  merge, so keep it to what that line needs and say in the report which files it touched.
- Do not run the full `real-input:ios` gate: it runs once, at merge.
- If one case cannot print identical lines from a snapshot, keep single lookups for that case
  and say which and why. Never change a rule, a debt row or a timeout to make lines match.
- Docs that say these passes ride every run are corrected in this branch, as is the line in
  `docs/tasks/FOLLOWUPS.md` that blames the build for the 14 minutes.

## Context

`scripts/real-input/ios.mjs` (selection, build, `reportA11yPass`), `scripts/real-input/a11y.mjs`,
`example/ios/NitroUiExampleUITests/RealInputTests.swift` (`testRealInputA11y`, `measure`,
`describe`, `testRealInputTabTargets`), `scripts/build-app.mjs` and `scripts/build-speed-lib.mjs`
(ccache environment, module cache), `scripts/gate-core.mjs` (`realInputUnitsFromResults`),
`docs/agents/gates.md`, `example/e2e/README.md`.
