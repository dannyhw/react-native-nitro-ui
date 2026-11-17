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
(median load 11.9 and 13.9), with identical verdicts. Of the 161 case lines, 129 are identical:

- 3 boxes differ in the last double digit (picker, button-group `scissors`, search-field
  `magnifyingglass`; `h=34.33333333333334` against `34.333333333333314`), about 1e-14 pt, under
  the rule's 0.5 pt tolerance.
- 29 lines of 4 Host-screen cases (hosted-segmented, hosted-picker, hosted-date-picker,
  hosted-progress) sit a few points lower. Fling drags scroll that screen, and where a fling
  stops varies: the three post-change runs put `host-segmented` at y 1072.67, 1079.0 and
  1076.33, where older runs of the unchanged pass put it anywhere from 1066.67 to 1077.33.
- One stability line is new: `case=button-group kind=stability reads=3 settled=true moved=6`,
  with `firstAnchorH=30.999984741210938`, on every post-change run and never before. Its tab
  opens with no drag, so the pass skips the existence wait and its first snapshot comes while
  the group's items are still being laid out. The settle rejects that read, and the settled
  boxes match the baseline.

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
| `check` | **PASS** | 2119 tests / 94 suites | `c8f043f243c9` | 1 m 30 s | start 6.3 / med 6.6 / max 7.8 |
| `harness:ios` | **PASS** | 601 tests / 30 suites + isolated 6 tests / 3 suites | `c8f043f243c9` (harness:ios digest) | 18 m 55 s | start 10.2 / med 5.2 / max 22.0 |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `c8f043f243c9` (harness:android digest) | 18 m 10 s | start 5.0 / med 5.6 / max 20.1 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:ios:--a11y:context-menu` | stale | — | 370f90be2c73 (not this tree) | 1 m 03 s | start 11.8 / med 28.0 / max 70.5 |
| `real-input:ios:--a11y:form` | stale | — | 41014d0ed771 (not this tree) | 1 m 06 s | start 64.6 / med 37.4 / max 64.6 |
| `real-input:ios:--control:button-group` | **PASS** | — | `c8f043f243c9` (real-input:ios digest) | 3 m 11 s | start 7.9 / med 6.3 / max 9.4 |
| `real-input:ios:--control:switch` | **PASS** | — | `c8f043f243c9` (real-input:ios digest) | 1 m 56 s | start 9.3 / med 15.4 / max 26.8 |
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
- `--rerun-failed` on a red `a11y:ios-debt` spends a device run that cannot go green; `planRerunFailed` could refuse it up front, or the report could emit a passing debt check for the cases it re-read.
- `--rerun-failed` on a failed `a11y` parse cannot go green either: the child run reports `a11y:<case>` units, never `a11y`. Refuse it, or leave `rerun` off that check.

## Fix round 1

- Settle: two agreeing reads are at least 1 s apart (`A11yFrameStability.defaultPauseMs`); no
  existence wait without a drag, as before.
- `withLiveReads` checks count, identifier and element type, and on a mismatch the case prints
  `| error |` and no nodes, fails, and the next case is read.
- `AGENTS.md` and the brief skill name `--a11y <case>` and `--tab-targets`.
- Summary comparison corrected; review N4 and N5 are follow-ups.

Final tree: `--control button-group` PASS, 191.0 s, prints
`reads=3 settled=true moved=6 elapsedMs=2342` (first read still mid-layout, the agreeing pair
now a second apart); `--control switch` PASS, 116.5 s, no stability line.
`need --for review` is satisfied.

Red proofs:

- `a11y-frame-stability.test (Swift)` -> `defaultPauseMs` 120 -> `FAIL on the laid-out tree, not two quick reads of the half-built one`.
- `real-input-ios-run.test.js` -> a stability line counts as read -> `✕ a case whose live tree stopped pairing with its settled read fails, and the next case is still read`.
- `a11y:switch` (`--control switch`) -> live index offset by one -> `case=switch | error | element 3 is switch "" live but other "" in the settled read`, then `a11y:switch: failed: no elements were printed`.
