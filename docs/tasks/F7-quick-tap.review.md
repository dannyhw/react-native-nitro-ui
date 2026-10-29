# F7 — review (2026-10-29)

**Verdict: MERGE WITH FIXES.** The library is untouched (`git diff --stat 3dfe041...f7dc3f3 -- src ios android cpp` is empty) and the example changes are inert (`NitroUiProbe` only under `NUI_PROBE_UI`/`NUI_PROBE_WATCHDOG`; `SWITCH_SCREEN_VARIANT=0`, `PROBE_CONTROLS=false`). "Not ours" holds narrowly: RN's own `Switch` (`RCTSwitchComponentView`) drops a 50 ms press on the busy screen just as ours does (pair cells, same launch, same JS-count witness, 0/12 each); variant 5 (200 RN Switches, ~7 hosted) drops, variant 3 (same ~7 hosted, no list) lands 12/12.

## Measured vs inferred

- "The drop is real" (report:9) is measured for XCUITest presses on a simulator only — nothing with a finger or on a device.
- "No accessibility traffic enters the app between presses" (report:13) is false: `--quiet` stops witness polling, but each press still resolves its element (`coordinate(withNormalizedOffset:)`) and XCTest waits for idle, so an accessibility query of a 200-control tree runs on the app's main thread right before every press. That fits every result (Pressable survives; UISwitch-type controls need the touch to span a main-thread pass; the stall arm drops Toggle but not UIButton or a tap recogniser). An XCUITest artefact is still the cheaper explanation.
- "The mechanism, reproduced" (report:27) overclaims: the stall arm shows *a* way to lose a Toggle press; the watchdog (no-RN 398 ms vs busy 85 ms, yet 12/12) says it isn't this screen's way.
- RN vs platform isn't separated: the no-RN arm uses 200 SwiftUI Toggles in `UIHostingController`s — no 200-UISwitch cell, no RN wrappers, no `RCTSurfaceTouchHandler`, a different a11y tree.
- The "loaded" column holds cells at load1 2.99–4.87.

## Must-fix

- **M1** `RealInputTests.swift:274`, `:328`: `before = nativeSwitchState(...) ?? ""` then `nativeSwitchState(...) != before` compares `String?` with `String`, so a nil read counts as delivered. A Toggle that stops publishing `value`, or `exists` briefly false, makes all 12 "land". Fail if `before` is nil; count only a non-nil reading that differs. Re-run `real-input:ios`.
- **M2** The precondition at `RealInputTests.swift:262` was never shown red. It checks testIDs, so variant 6 (plain boxes with `switch-list-*` IDs) would pass it. Show it red (e.g. `SWITCH_SCREEN_VARIANT=3`) and make it check Switches, not IDs.
- **M3** Correct the report: line 9, line 13, line 27, the "loaded" header, Q1(a), and drop "app authors keep presses above ~100 ms" (not advice an app can follow).

## Nits

- N1 `SwitchScreen.tsx:336` hard-codes `'#666'` instead of `ink.muted` (dark mode).
- N2 `RealInputTests.swift:244-245`: two doc summaries run together.
- N3 `dwell-probe.mjs:119` says >40 ms; the code's threshold is 8 ms.
- N4 The watchdog "median" is the median of logged gaps ≥ 8 ms (a long block logs many times) — not main-queue latency.
- N5 Per-cell JSONs omit target/variant/quiet/witness/stall; `probe-calm-stall-120-uikit-in-scroller.json` still holds the superseded wrong-witness 0/12 with no note.
- N6 The guard's failure message prints `pressDwell` even when the press was mutated.

## Questions

1. Ship nothing in the library now; RN upstream only after a reproduction outside XCUITest (a finger on a device, or presses with no element lookup) plus a no-RN 200-UISwitch arm.
2. Keep the guard at the shipped dwell; no asserting 50 ms case.
3. Keep 0.15; if lowered at all, not below 0.12.
