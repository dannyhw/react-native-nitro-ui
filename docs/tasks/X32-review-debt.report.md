# X32 — Correctness debt from the Form, Stepper and Checkbox reviews

**Branch:** `task/X32-review-debt` (from `main` at `4aaf24b5`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X32-9xk2j` (pair-a: `iPhone 17` / iOS 27.0 and `emulator-5574` / API 35, Metro 8295)

## Summary

**1 — Form, iOS.** The cell's press recogniser answered `.ended` with a press and never asked
where the finger had been, so a flick beginning on a pressable row scrolled the list *and*
fired `onPress`. ListItem's rule is core's now — `ios/core/NitroUiPressTravel.swift`, 10 pt,
Foundation and CoreGraphics only so it is host-testable — and the Form's cell and ListItem's
row both use it. The device half drags from `form-row`: the list moves, the row presses
nobody, and three taps afterwards still press.

The first full `real-input:ios` was red on that device half itself: the three taps after the
drag expected `form-row-presses` to read 1–3, but the ten taps and the held press before them
leave it at 11 (`it reads "12"`). `assertOnePressPerTap` now takes the count it starts from
(`6ba02df3`); the re-run reads `11 -> 11` across the drag and passes.

**Android did not have the bug.** A vertical flick presses nothing because the list
intercepts and hands the row `ACTION_CANCEL` — green even with the row's slop rule off. A drag
*along* the row is never intercepted, so only `NitroUiFormRowView`'s slop rule decides it. Both
checks go red for a row that honours neither (slop off *and* pressing on cancellation, the iOS
bug in Kotlin); neither is red for slop alone, because on this view the platform answers first.

**3 — Stepper.** A reader's target is compared against `publishedProgress` (the shown value through
the node's `Float`), so asking for the `0.3` on screen no longer steps to `0.4`. `applyDefaultOnce()` moves `displayed` and
`state.displayed` together, so a `defaultValue` and the first controlled write agree about
where the control started. iOS hands SwiftUI bounds tidied the way the shown value is, which
is what disables the plus half at `maximumValue = 0.1 + 0.2`.

**4 — Checkbox.** The recycle case asserts `probes === 0` before probing, so a report reset
that regressed cannot pass on the previous mount's count. iOS's `mixed` is not fixable:
`UIMenuElementStateMixed` is the only public string for that state and it belongs to menus,
so `docs/components/checkbox.md` now says the word is English in every locale.

**2 — Form docs.** Measured, not merged. A pressable row on iOS is **six** elements and none
of them carries a `.button` trait; the row's two texts are each listed twice. Both places in
`docs/components/form.md` now say that, and the merge stays unbuilt, as the brief ruled.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2093 tests / 88 suites | `20bbddbd2c79` | 2 m 48 s | start 19.9 / med 12.1 / max 19.9 |
| `harness:ios` | **PASS** | 628 tests / 32 suites + isolated 6 tests / 3 suites | `20bbddbd2c79` (ios tree) | 15 m 08 s | start 8.0 / med 8.1 / max 20.7 |
| `harness:android` | **PASS** | 684 tests / 32 suites + isolated 6 tests / 3 suites | `b3ac944730b6` (android tree) | 18 m 59 s | start 6.1 / med 5.6 / max 12.1 |
| `real-input:ios` | **PASS** | — | `20bbddbd2c79` (ios tree) | 52 m 08 s | start 9.8 / med 10.6 / max 116.9 |
| `real-input:android` | **PASS** | — | `b3ac944730b6` (android tree) | 72 m 20 s | start 8.0 / med 8.9 / max 183.2 |
| `harness:android:Checkbox` | stale | 1 failed of 15 tests / 1 suites | 06fc809409d7 (not this tree) | 22.2 s | start 10.4 / med 8.8 / max 10.4 |
| `harness:ios:Checkbox` | stale | 1 failed of 15 tests / 1 suites | 06fc809409d7 (not this tree) | 21.3 s | start 10.9 / med 10.9 / max 11.3 |
| `real-input:android:--control:form` | stale | — | 170cfa922853 (not this tree) | 7 m 13 s | start 18.6 / med 7.3 / max 18.6 |
| `real-input:android:--control:form:--background` | stale | — | 06fc809409d7 (not this tree) | 0.4 s | start 7.8 / med 7.8 / max 7.8 |
| `real-input:ios:--control:form` | stale | — | 06fc809409d7 (not this tree) | 17 m 60 s | start 8.0 / med 26.1 / max 80.0 |

`need --for review`: **satisfied** on code tree `20bbddbd2c79` (HEAD `6ba02df3`).

## Red proofs

Same rows with before/after text: `docs/tasks/X32/mutations.json`. Logs are named by the gate log store (`gate.mjs logs --branch task/X32-review-debt`).

- `testRealInputForm` drag check -> Form cell's `.ended` calls `onPressTap` unconditionally -> `RealInputTests.swift:7278 XCTAssertEqual failed: ("12") is not equal to ("11")` (real-input+ios+--control+form-2026-11-13T01-28-24)
- `Checkbox.harness.tsx` recycle case (iOS) -> `clearReports` stops clearing `probes` -> `round b: "recycled" arrived with probes=1` (harness+ios+Checkbox-2026-11-13T01-46-36)
- `Checkbox.harness.tsx` recycle case (Android) -> `reset()` stops clearing `probes` -> `round b: "recycled" arrived with probes=2` (harness+android+Checkbox-2026-11-13T01-47-28)
- `real-input:android` form, the slide along the row -> slop rule off and the press fired from `ACTION_CANCEL` -> `✗ a drag that slides along the row is not a press (10 -> 11)` (real-input+android+--control+form-2026-11-13T02-31-36)
- `real-input:android` form, the flick -> the same mutation -> `✗ a drag that scrolls the list is not a press (10 -> 11)` (…-02-19-32) and `(12 -> 13)` (…-02-31-36)
- `StepperModelTest` -> `publishedProgress` returns the `Double` -> `aReaderAskingForTheValueAlreadyHeldMovesNothing FAILED`, plus the fixture-sanity vector (host run, no log in the store)
- `StepperModelTest` -> `applyDefaultOnce` moves only the drawn value -> `aDefaultMovesTheDrawnValueAndTheHandshakeTogether FAILED` and three more (host run, no log in the store)
- `stepper-binding.test` -> `trackBounds` hands the raw props over -> `FAIL a maximum of 0.1 + 0.2 is handed over as 0.3, the value the control shows` and three more (host run, no log in the store)
- `press-travel.test` -> `travelled` is always false -> `FAIL 40 pt sideways is not a press either, whatever it scrolls` and two more (host run, no log in the store)
- `testRealInputForm` taps after the drag -> no mutation; the absolute 1…3 count was the bug -> `RealInputTests.swift:7312 … should make "form-row-presses" read 1; it reads "12"` (real-input+ios-2026-11-13T03-17-26), green after `6ba02df3`
- not a mutation: the first Android flick stayed green (`10 -> 10`) with the slop rule off (real-input+android+--control+form-2026-11-13T01-47-57), which is why the slide exists

## Files changed

- `ios/core/NitroUiPressTravel.swift`, `ios/components/Form/NitroUiFormViews.swift`,
  `ios/components/ListItem/HybridNitroUiListItem.swift` — the travel rule, once, in core.
- `ios/components/Stepper/{NitroUiStepperBinding,HybridNitroUiStepper}.swift`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiStepper.kt` — the reader's comparison, the default's two copies,
  the tidied bounds.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/android.mjs`,
  `scripts/real-input/a11y.mjs` — the drags, and the measured a11y count.
- `scripts/native-tests/{press-travel,stepper-binding}.test.swift`,
  `android/src/test/java/com/margelo/nitro/nitroui/StepperModelTest.kt`, `example/__tests__/Checkbox.harness.tsx` — the
  vectors and the assertion.
- `docs/components/form.md`, `docs/components/checkbox.md`, `docs/tasks/FOLLOWUPS.md`,
  `.changeset/x32-review-debt.md`, `etc/package-files.txt`.

## Follow-ups

- `SliderModel.accessibilityStepToward` compares the reader's target with the `Double`, the
  same way G25 found in Stepper; untouched, different control.
- The Form row's Android slop rule looks unreachable by a real drag — the container cancels
  the touch first — so what it still owns is the highlight's release. Worth a reader deciding
  whether the rule should stay.
- `HybridNitroUiForm.kt:233` reports `offset=0.00` on Android, so the Form's own geometry echo
  cannot witness a scroll there and the check has to read the row's box instead.
- A `Form.Row`'s box in the uiautomator dump turns unreadable once the list has scrolled it
  (`32,644 → 1049,236`, stable across six reads). Only the Form's rows were seen doing it.
- `scripts/__tests__/bench-baseline-merge.test.js` inherits `EMULATOR_PORT` from the
  environment and dies on "ANDROID_SERIAL and EMULATOR_PORT disagree", so `check` has to run
  from a shell with no lease exported.
- iOS's VoiceOver merge for a pressable `Form.Row` is still debt, now with a number on it.
- `check`'s `ci-workflows.test.js` "the preflight does not wait forever for -accel-check" went red once at load1 ~20 (`asked: false`, 2.2 s) and green on the re-run, same tree.
- `harness:ios` went red once at load max 71 (Conformance IconButton no-leak-on-drop, as X29 saw, plus two Menu cases: "never mounted", a dropped split press), green on the re-run, same tree.
- Incident: the first `real-input:android` (pid 25208, started by the previous session) lost its `gate.mjs` parent at 04:40Z with no ledger line; its orphaned runner (25346) and Metro (25382), both this worktree's, were stopped by pid and the gate re-run. A detached gate's runner outliving its gate deserves a guard.
