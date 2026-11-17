# X51 — a filtered iOS real-input run costs minutes, not a quarter of an hour

**Branch:** `task/X51-ios-real-input-fixed-cost` (from `main` at `589733b6`) · **Round:** 1 of up
to 3 · **Lease:** `X51-kix7v`, then `X51-nmvp8` for both platforms (`iPhone 17` / Metro `8295`)

## Summary

A `real-input:ios -- --control switch` run went from 854 s to 138 s. The library is unchanged.

**Accessibility pass (line 1).** Each case reads its subtree with one `XCUIElement.snapshot()`
per settle read, walked level by level, which is the order `descendants(matching:)` returns.
Two values a snapshot cannot give are read live, once, after the tree settles: `isHittable`,
and the value of a text-entry element (an empty field's live value is its placeholder). Without
a scroll drag, the pass skips the one-second `waitForExistence`. No case kept single lookups. Same run before and after, both reading every case: the pass took 511 s, then 216 s
(median load 11.9 and 13.9), with identical verdicts. Of the 161 case lines, 152 are
identical:

- 4 boxes differ in the last double digit (`h=34.33333333333334` against
  `34.333333333333314`), about 1e-14 pt, under the rule's 0.5 pt tolerance.
- The 5 Host-screen cases read 3.7 pt lower. Fling drags scroll that screen, and where a
  fling stops varies: older runs of the unchanged pass put `host-segmented` anywhere from
  y 1066.67 to 1077.33.

**Filtered runs (lines 2 and 3).** `scripts/real-input/ios-run.mjs` turns the arguments into a
plan:

- No arguments: every control, every a11y case and the tab bar.
- `--control <id>`: that control and its own a11y case.
- `--a11y <case>`: one a11y case.
- `--tab-targets`: the tab bar.

The Swift pass gets the cases through `TEST_RUNNER_NITRO_UI_A11Y_CASES`. The final-tree proof
run took 138 s at median load 8.7 (the machine was never quiet): about 29 s of build
(56 compiles), then 104 s of tests, the switch's a11y case 10.8 s and the switch 86.7 s.

**Completion (line 4).** Each a11y case and the tab-bar check records the arguments that
re-run it. `--rerun-failed` re-runs those checks with those arguments, and the completion
stays red when one fails again. Ledger code touched: `scripts/gate-core.mjs` only
(`realInputUnitsFromResults`, `planRerunFailed`, new `realInputFilterArgs`).

**Build (line 5).** The test build uses `build-app.mjs`'s ccache environment and module cache.
That setup moved to `scripts/ccache-setup.mjs`; without ccache both builds compile plainly into
the default module cache. `CompileC` counts in one derived data:

- App build: 688 (first build after an old-style test build).
- Test build: 56.
- App build: 112.
- Test build: 56.

The app build's 112 is those 56 files for arm64 and x86_64. Before, the test build compiled 515.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2118 tests / 94 suites | `7304be20133a` | 1 m 34 s | start 3.9 / med 15.9 / max 23.3 |
| `harness:ios` | **PASS** | 601 tests / 30 suites + isolated 6 tests / 3 suites | `7304be20133a` (harness:ios digest) | 16 m 37 s | start 22.4 / med 8.3 / max 26.6 |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `7304be20133a` (harness:android digest) | 18 m 18 s | start 20.9 / med 8.1 / max 25.4 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:ios:--a11y:context-menu` | stale | — | 370f90be2c73 (not this tree) | 1 m 03 s | start 11.8 / med 28.0 / max 70.5 |
| `real-input:ios:--a11y:form` | stale | — | 41014d0ed771 (not this tree) | 1 m 06 s | start 64.6 / med 37.4 / max 64.6 |
| `real-input:ios:--control:switch` | **PASS** | — | `7304be20133a` (real-input:ios digest) | 2 m 18 s | start 14.6 / med 8.7 / max 14.6 |
| `real-input:ios:--tab-targets` | stale | — | 1b2828b96fd1 (not this tree) | 2 m 07 s | start 17.1 / med 8.2 / max 17.1 |

`need --for review`: `need: review is satisfied on this code tree.` The full `real-input` gates are left for merge.

## Red proofs

- `a11y:switch` (filtered run `--control switch`) -> `accessibilityLabel="Controlled switch"` removed from `example/src/SwitchScreen.tsx` -> `a11y:switch: failed: NitroUiSwitch: no element other than the React Native wrapper is announced as "Controlled switch"` (the switch's touch case still passed).
- `a11y:form` (filtered run `--a11y form`) -> the row's name put on its inner "Notifications" `Text` in `example/src/FormScreen.tsx` -> `a11y:form: failed: NitroUiForm: 2 elements under "form-row" are announced as "Row with onPress" … | "Row with onPress" is announced by the element at (44, 259.00, 96, 20.33) while the control is drawn at (32, 247.33, 338, 44.00)`.
- Not a proof: the `--a11y context-menu` row above is a first try at the second mutation, an extra `Text` labelled "Message from Grace" inside the context menu. The case passed, because React Native then publishes the menu as one element, and only `a11y:ios-debt` went red. The `a11y:form` mutation replaced it.
- `tab-targets` (filtered run `--tab-targets`) -> `height: 30` on the Slider tab in `example/src/App.tsx` -> `tab-targets: failed: tab "Slider" (tab-slider) is 61 × 30 pt — too short for the 44 pt minimum touch target`.
- `real-input-ios-run.test.js` -> a filtered plan reads every case -> `✕ a --control run reads that control and its own a11y case, and no tab bar`.
- `real-input-ios-run.test.js` -> a filtered plan always measures the tab bar -> the same test red.
- `real-input-ios-run.test.js` -> the report covers every case, not the ones read -> `✕ reports the cases the run read and no others, each with what re-reads it`.
- `real-input-ios-run.test.js` -> an a11y check records no re-run arguments -> the same test red.
- `gate-rerun.test.js` -> `realInputUnitsFromResults` ignores `rerun` -> `✕ an auxiliary check that records what re-runs it is a unit of its own` and `✕ completes a red run whose only failures are a11y cases and the tab bar, and stays red when they fail again`.
- `gate-rerun.test.js` -> every unit re-run as `--control <id>` -> `✕ re-reads failed a11y cases and the tab bar by what their checks recorded`, `✕ fails when a re-read a11y case or the tab bar fails again`, and the end-to-end test red.
- `gate-rerun.test.js` -> a shared argument group passed twice -> `✕ re-reads failed a11y cases and the tab bar by what their checks recorded`.
- `gate-rerun.test.js` -> `completeRerun` ignores a re-run unit that failed again -> `✕ fails when a re-read a11y case or the tab bar fails again`.
- `build-speed.test.js` -> `ccacheSetup` sets an environment without ccache -> `✕ without ccache, every build compiles plainly into the default module cache`.
- `build-speed.test.js` -> `ios.mjs` back to `ccache: false` -> `✕ is decided by whether the build set the ccache env, at each call site`.

## Files changed

- Swift pass: `example/ios/NitroUiExampleUITests/RealInputTests.swift`.
- iOS runner: `scripts/real-input/ios.mjs`, `scripts/real-input/ios-run.mjs` (new), `scripts/real-input/report.mjs`.
- Ledger: `scripts/gate-core.mjs`.
- Build: `scripts/ccache-setup.mjs` (new), `scripts/build-app.mjs`.
- Tests: `scripts/__tests__/real-input-ios-run.test.js` (new), `scripts/__tests__/gate-rerun.test.js`, `scripts/__tests__/build-speed.test.js`, `scripts/__tests__/real-input-a11y-ios.test.js`.
- Docs: `CONTRIBUTING.md`, `docs/agents/gates.md`, `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- iOS a11y pass: the Host cases below the fold are measured after fling drags that end in a different place each run; a hold before lifting would make their boxes repeatable.
- iOS builds: the generic-simulator app build compiles x86_64 as well as arm64, which the test build never uses.
- An iOS a11y case that prints no lines is still read again by a completion; a stale-debt failure can only clear on a full run.
