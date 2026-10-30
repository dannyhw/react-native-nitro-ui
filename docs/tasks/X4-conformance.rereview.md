# X4 — re-review of fix round 1 (2026-10-29)

**Verdict: FIX ROUND (M1, M2).** The code changes are small; what's missing is evidence, plus one fixture that coincides with the right answer. Unit suites: 188/188 across the five X4 test files.

## Items

- **M1 partly.** The rule is now sound: XCUITest walks the real tree (`testRealInputA11y`), `a11y.mjs:504-588` decides, the wrapper is excluded (`:523`), label, frame (0.5 pt, `:681`) and trait (`:570`) are checked, the 6 hosted cases are measured, and a case that prints nothing fails (`reportA11yPass`). But **no device red proof is recorded anywhere** (report, ledger, failure excerpts or log store; the only failed iOS run is "IOS_UDID not set"). The review's Slider mutation (`:460`) could never go red: VoiceOver reaches `NitroUiSliderAccessibilityElement`, labelled at `HybridNitroUiSlider.swift:582`. The hosted-picker exemption `/no element other than the|announced as/` (`a11y.mjs:388`) matches every problem `iosA11yProblems` returns, so that case can never fail.
- **M2 partly.** iOS residue probes do reach `prepareForRecycle`. But "the two reset lines cover for each other" is a fixture property: the second owner's default equals the reset value (Switch `defaultValue={false}` vs `displayed: false`, `HybridNitroUiSwitch.swift:312`; Slider `0` vs `displayed: 0`, `HybridNitroUiSlider.swift:871`). With `true`/`0.75`, deleting `didApplyDefault = false` alone goes red. The commit's reason for dropping a controlled second owner contradicts the code: a new owner sends `mostRecentEventCount` 0 (`useControlled.ts:56`), the setter assigns it (`HybridNitroUiSwitch.swift:205`), and `reconcile()` drops writes while `jsEvents < nativeEvents`, so a controlled variant makes the state reset observable on its own. Button, Progress and SegmentedControl are `noProbe` yet the coverage matrix says recycle-reset **covered**.
- **M3 resolved** (K=8, `rose === MOUNTS`, baseline compare; Android `host.drop()` red proof credible, but recorded only as prose).
- **M4 resolved** (`task-ready-core.mjs:290-313`); a second invented row for a known gate is skipped by `known.has(gate)`.
- **M5 mostly resolved** (one read before the first poison, `Conformance.harness.tsx:858`/`:1554`); the cross-file half is logged as NOT COLD — acceptable given `checkFallbackTable`.
- **N1–N5, N7–N9 resolved; N6 accepted.**

## New findings

- Medium `a11y.mjs:388`: the hosted-picker exemption swallows every iOS finding.
- Medium, coverage matrix: recycle-reset "covered" for three `noProbe` controls.
- Low `ios.mjs` `reportA11yPass`: a known-debt case prints a ✓ line contradicting the finding above it.
- Low `Conformance.harness.tsx:818-819`: `hasDeclaredFallback`'s comment contradicts M5's finding.
- Low `task-ready-core.mjs:304`: a duplicate invented row for a known gate passes.

## Must-fix for round 2

1. iOS a11y red proof on device — Switch `:109` and Slider `:582` — from runs that leave evidence (a failed gate run in the ledger/excerpts).
2. Second owner's default differs from the reset value (and a controlled variant if it holds); prove each reset line red on its own, or measure why one can't be.
3. Narrow the hosted-picker regex to the doubled-name finding.
4. Correct the recycle column of the coverage matrix (`failing` with a FOLLOWUPS row, or n/a).
