# X19 — An example-app navigation that scales with the component count

**Branch:** `task/X19-example-tab-bar` (from `main` at `8d27e8cf`) · **Round:** 1 of up to 2 (brief) ·
**Lease:** `X19-rlies` (`iPhone 17` F08675D3 + `nitroui_t03` / `emulator-5574`, Metro `8295`); the device runs
recorded before it were on `X19-b247f`, the same pair

## Summary

The example tab bar is now a horizontal `ScrollView` instead of one row shared between the tabs (`example/src/App.tsx`). Each
tab keeps its natural width with `minWidth`/`minHeight` of 48 dp on Android and 44 pt on iOS (`TAB_MIN`). The bar is
exactly one tab tall, and the old row's 4 pt top pad is gone, so the body loses no height. That matters because G5's
`DatePicker` popover-anchoring check is sensitive to body height. `keyboardShouldPersistTaps="handled"` keeps a tab
tappable while a text field's keyboard is up, as the plain row was.

Measured on the leased devices (real-input, code tree `21a3e2b4`), every tab now meets the minimum, up from about
23 × 28:

| | narrowest | widest | height | old row |
| --- | --- | --- | --- | --- |
| Android (Pixel 9) | Text 51.0 dp | Segments 87.2 dp | 48 dp | 22.9–23.2 × 28.2 dp |
| iOS (iPhone 17) | Text 51.3 pt | Segments 89 pt | 44 pt | 23–23.3 × 26 pt |

**Navigators.** On iOS, `goToTab` in `RealInputTests.swift` scrolls a tab wholly into the window before tapping it.
That covers every real-input control, the a11y sweep, and the dwell probe and F7 matrix that drive it through
`NUI_PROBE_TAB`. On Android, `revealTab` in `scripts/real-input/android.mjs` does the same through uiautomator,
swiping in the direction a tab lies. The harness tests and Storybook screenshots tap no tab (`git grep "tab-"`
finds none in `example/__tests__`), so they needed no change.

**The check (brief item 3).** A new `tab-targets` auxiliary check runs in both `real-input:*` gates. Its rule is in
`scripts/real-input/tab-targets.mjs` (`TAB_TARGET_MIN` = 48 dp / 44 pt, one device pixel of slack). It reads the tab
list from `App.tsx`, so a tab that is never measured, cannot be scrolled fully on screen, or is drawn without being
listed also fails. Each platform measures every tab after revealing it: XCUITest frames on iOS, uiautomator bounds
on Android.

**Codegen (brief item 4).** The tab list is still the registry's generated `TABS` region. A unit test regenerates
that region with extra manifests and checks the rule picks the new tabs up, so SearchField and Tooltip need no edit
here. The registry's `label` description now says a label sets its tab's width.

**One test fix along the way** (`dc4165e7`). The bar moved the controlled Switch 10 pt down, across y = 256. There,
XCUITest's float32 frame reads 2⁻¹⁶ pt short on one read and exact on the next. The bit-for-bit "still drawn where
it started" assertion therefore failed (`real-input:ios:--control:switch` on `8bd815cb`) for a switch that had not
moved. It failed the same way in the full run at 00:17 on `51096cd0`. It now allows 0.01 pt of drift, a thirtieth of a pixel at @3x.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1742 tests / 69 suites | `21a3e2b44639` | 2 m 18 s | start 5.3 / med 15.2 / max 23.6 |
| `harness:ios` | **PASS** | 381 tests / 22 suites + isolated 2 tests / 1 suites | `21a3e2b44639` (ios tree) | 9 m 14 s | start 3.5 / med 6.0 / max 10.0 |
| `harness:android` | **PASS** | 430 tests / 22 suites + isolated 2 tests / 1 suites | `51096cd05f9c` (android tree) | 12 m 54 s | start 3.5 / med 4.3 / max 6.9 |
| `real-input:ios` | **PASS** | — | `21a3e2b44639` (ios tree) | 21 m 20 s | start 8.2 / med 10.8 / max 67.5 |
| `real-input:android` | **PASS** | — | `51096cd05f9c` (android tree) | 35 m 47 s | start 17.9 / med 5.6 / max 17.9 |
| `real-input:android:--control:switch` | stale | — | de02c4f439ca (not this tree) | 6 m 54 s | start 25.2 / med 7.0 / max 25.2 |
| `real-input:ios:--control:switch` | stale | — | 8bd815cbe829 (not this tree) | 5 m 08 s | start 4.1 / med 6.0 / max 7.4 |

`need --for review`: `need: review is satisfied on this code tree.` The two `stale` rows are the red proofs below,
which were deliberately run on older trees.

## Red proofs

- `real-input:android` `tab-targets` -> the new check run on the old shared row (`55ab93d2`, tree `de02c4f4`) -> `tab "Picker" (tab-picker) is 23.2 × 28.2 dp — too narrow and too short for the 48 dp minimum touch target` (15/15 tabs red, gate FAIL)
- `real-input:ios` `tab-targets` -> the same old row (`55ab93d2`) -> `tab "Picker" (tab-picker) is 23 × 26 pt — too narrow and too short for the 44 pt minimum touch target` (15/15 tabs red, gate FAIL)
- `scripts/__tests__/real-input-tab-targets.test.js` -> `checkTabTargets` stops checking height -> `✕ fails every tab of the old shared row (23 x 28 dp on a Pixel 9)`, plus 2 more (3 of 13 failed; 13/13 pass once restored)
- `RealInputTests.swift` frame-drift tolerance -> the bit-for-bit `XCTAssertEqual` it replaced, on the new bar (`8bd815cb`) -> `XCUITest reported "failed" for testRealInputSwitch` (27.999984741 vs 28.0)

## Files changed

- Example app: `example/src/App.tsx` (scrolling bar, `TAB_MIN`).
- Rule: `scripts/real-input/tab-targets.mjs`, `scripts/__tests__/real-input-tab-targets.test.js`.
- Navigators and measurement: `example/ios/NitroUiExampleUITests/RealInputTests.swift` (`goToTab`, `revealTab`,
  tab measurement, frame tolerance), `scripts/real-input/android.mjs` (`revealTab`, `tab-targets`),
  `scripts/real-input/uiautomator.mjs`, `scripts/real-input/ios.mjs` (parses the Swift pass's lines).
- Registry: `scripts/registry-core.mjs` (the `label` field's description).

## Follow-ups

- Branch: 10 commits behind `origin/main`. It needs a rebase or merge before landing, and `need --for merge` will then re-owe the full device set.
- TextField real-input (iOS): one run on the final tree (`21a3e2b4`, 01:00 Nov 4) read `frozen: 1 edits refused` instead of 2 (`RealInputTests.swift:3541`). The next run on the same tree passed 20/20, so it looks like a flake; the excerpt is in `docs/tasks/X19/failures/`.
- Example app: the active tab is not scrolled into view on launch or on a programmatic screen change. That is harmless today (the default tab is first), but a deep link to a later tab would leave it off screen.
