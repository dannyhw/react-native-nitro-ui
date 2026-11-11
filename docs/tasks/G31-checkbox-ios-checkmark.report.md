# G31 — Checkbox on iOS: a checkmark, not a switch

**Branch:** `task/G31-checkbox-ios-checkmark` (from `main` at `404eaad3`) · **Round:** 1 of
up to 3 (D19) · **Lease:** `G31-5oft1` (iPhone Air / iOS 27 `3AE7EE8D…`, `nitroui_b` /
`emulator-5570`, adb server 5041 / Metro `8293`)

## Summary

iOS drew a switch, so a `Checkbox` and a `Switch` were the same picture. DECISIONS D47
settled it: iOS now wears a `ToggleStyle` of ours that draws Apple's own checklist symbols
— `checkmark.circle.fill` over `circle`, or the square pair — with `minus.circle.fill` /
`minus.square.fill` for the third state. It is still Apple's `Toggle` in all three styles,
so nothing is imitated (D38 item 1); `'switch'` is `iosStyle`'s third value and draws the
old look untouched.

- **The row's one tap target did not move.** The `overlay` calling `press()` that G15 added
  — a `Toggle` claims the row for hit testing and answers touches on its glyph only — is
  now the target for the glyph styles too, installing no gesture of their own. One
  target for three styles: one press is one `onCheckedChange` wherever it lands.
- **D47 ended the shared fallback row.** A Checkbox on iOS no longer *is* a Switch, so it no
  longer declares the Switch's 61x28; its fallback is its own bare glyph box,
  `SHARED_FALLBACK_ROWS` is down to Android's Material pair, and the iOS
  `DECLARED_FALLBACK_EXCEPTIONS` row that only explained that number is gone. `iosStyle` is
  in iOS's sizing key and not Android's, where the prop is stored, ignored and never marked
  dirty — the harness asserts zero corrections and one box there.
- **A custom style has to be told what to say.** A `ToggleStyle` does not get the
  accessibility SwiftUI's built-in styles get: the a11y sweep read a glyph row as **three**
  stops — the `Toggle` (named, valued, inset to 107 × 21.67 pt inside a control laid out at
  109 × 26), the symbol as an image named "Circle", the label as static text.
  `.accessibilityHidden(true)` did not remove the image, and
  `.accessibilityElement(children: .ignore)` added an element and lost the toggle trait, so
  the glyph styles carry an `accessibilityRepresentation`: a `Toggle` represented rather
  than drawn, `.disabled` restated inside (without it a disabled box reported itself
  enabled).

One element is left, named `accessibilityLabel ?? label`, on the row's own box, valued
`0`/`1`/`"mixed"`. What a reader gets is read off the tree, not listened to
`trait=switch label="Real-input mixed checkbox" value="mixed"`
for the dash on iPhone Air / iOS 27; nobody has confirmed aloud what VoiceOver says. The
bare case gained most: its element used to *be* the symbol, listed as "Circle" at 21.67 pt.
`checked` outranks `indeterminate` on both platforms, and
`checkbox-glyph.test.swift` runs all eight state/style pairs.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2018 tests / 85 suites | `29657bd5481b` | 2 m 45 s | start 5.8 / med 7.5 / max 11.4 |
| `harness:ios` | **PASS** | 597 tests / 31 suites + isolated 6 tests / 3 suites | `29657bd5481b` (ios tree) | 14 m 42 s | start 14.1 / med 6.4 / max 18.2 |
| `harness:android` | **PASS** | 653 tests / 31 suites + isolated 6 tests / 3 suites | `29657bd5481b` (android tree) | 18 m 22 s | start 4.8 / med 5.2 / max 12.0 |
| `real-input:ios` | **PASS** | — | `29657bd5481b` (ios tree) | 42 m 13 s | start 4.7 / med 8.1 / max 43.4 |
| `real-input:android` | **PASS** | — | `29657bd5481b` (android tree) | 62 m 39 s | start 6.8 / med 5.8 / max 28.3 |
| `harness:android:-t:re-measures%20for%20a%20new%20style:Checkbox` | stale | 14 tests / 1 suites | c20a3642a266 (not this tree) | 9.9 s | start 6.4 / med 6.5 / max 6.6 |
| `harness:android:re-measures%20for%20a%20new%20style` | stale | — | c20a3642a266 (not this tree) | 1.4 s | start 7.6 / med 7.6 / max 7.6 |
| `harness:ios:Checkbox` | stale | 2 failed of 14 tests / 1 suites | b557915fd23c (not this tree) | 17.6 s | start 12.3 / med 10.6 / max 12.3 |
| `real-input:ios:--control:checkbox` | stale | — | c998e9b10783 (not this tree) | 14 m 38 s | start 9.8 / med 23.5 / max 200.8 |
| `real-input:ios:Checkbox` | stale | — | 56a02e6c9d00 (not this tree) | 0.6 s | start 16.9 / med 16.9 / max 16.9 |

`need --for review`: `need: review is satisfied on this code tree.` · `need --for merge`:
`need: merge is satisfied on this code tree.`

Two runs are not in that table because the tree they ran on is gone: the first two
`harness:ios` attempts, both red with `The app process exited, but no crash log lines were
found.` (one suite each, `Dialog` then `Tooltip`, ~10 min into the app's life, RSS flat at
~540 MB when they went). The third attempt and this tree's run are clean; the Android
`expected 4 to be less than 3` in between was the assertion's own fault, not the device's.
## Red proofs

- `scripts/real-input/a11y.mjs` (the checkbox box rule) -> ship the glyph style without
  `accessibilityRepresentation` -> `NitroUiCheckbox: "Real-input checkbox" is announced by
  the element at (18, 275, 107, 21.67) while the control is drawn at (16, 273, 109, 26)`.
- `RealInputTests.testRealInputCheckbox` step 7 -> `OptionalAccessibilityValue` answers
  `nil` inside the representation -> `XCTAssertEqual failed: ("Optional("0")") is not equal
  to ("Optional("mixed")")`.
- The same step's one-stop claim -> `if glyph && false` (skip the representation) ->
  `("2") is not equal to ("0") - the glyph and the label must be announced as part of the
  control and not as stops of their own`.
- `checkbox-glyph.test.swift` -> `style == .circle ? "square" : "circle"` -> `FAIL an
  unchecked circle is the empty box: square(secondary), want circle(secondary)`.
- `checkbox-glyph.test.swift` -> `indeterminate ? "mixed" : nil` -> `FAIL a checked
  indeterminate box announces the state it drew, not the prop`.
- `src/__tests__/checkbox.test.tsx` -> push `iosStyle` into Android's key in
  `sizingVariantFor` -> `Expected: "0|K" / Received: "0|circle|K"`.
- `Checkbox.harness.tsx` disabled case -> the disabled box keeps the checked glyph ->
  `"barrier" never drew symbol=circle - it reports
  "displayed=1;probes=0;merged=none;a11y=none;symbol=checkmark.circle.fill"`.
- Not mutation-proven, said plainly: the iOS sizing expectations were read with the
  expectation replaced by a `MEASURE-*` sentinel, which shows the fixture is not empty and
  prints the boxes (`bare=26.00x26.00 circle=110.00x26.00 square=109.00x24.00
  switch=145.00x28.00`) but is a measurement probe, not a mutation. The poisoned-fallback
  bound (`made >= STYLES.length`) was never separately mutated red.
- The Android bound this round deleted was itself red twice (`expected 4 to be less than
  3`). That was the assertion being wrong, not the code: the engine counts one correction
  per *instance* laid out at a wrong size, so four mounted boxes cost four corrections
  whatever the key holds - measured both ways, 4 on Android from one configuration and the
  same 4 on iOS from four. With `iosStyle` pushed into Android's key the "never re-measures
  on Android" case still costs 0, because the view is already on screen at the size the new
  key would answer with and a confirmation is not a correction. Hence: boxes on the device,
  key strings in the unit test.

## Files changed

- iOS glyph: `ios/components/Checkbox/NitroUiCheckboxGlyph.swift` (style + symbol + value
  table, no SwiftUI), `ios/components/Checkbox/HybridNitroUiCheckbox.swift` (the
  `ToggleStyle`, the `accessibilityRepresentation`, dirty-batched apply).
- Spec/JS: `src/components/Checkbox/Checkbox.tsx`, `Checkbox.nitro.ts`,
  `NitroUiCheckboxConfig.ts`, `NativeNitroUiCheckbox.ts`, `src/index.ts`, the generated
  Nitro spec bindings under `nitrogen/generated/`, `etc/react-native-nitro-ui.api.md`.
- Android: `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiCheckbox.kt`
  stores `iosStyle` and ignores it; both Android gates assert that.
- Tests: `example/__tests__/Checkbox.harness.tsx`, `scripts/native-tests/checkbox-glyph.test.swift`,
  `scripts/native-tests.sh`, `example/ios/NitroUiExampleUITests/RealInputTests.swift`,
  `example/src/CheckboxScreen.tsx`, `src/__tests__/checkbox.test.tsx`,
  `scripts/__tests__/conformance.test.js`, `scripts/conformance-core.mjs`,
  `scripts/real-input/a11y.mjs`.
- Docs: `docs/components/checkbox.md`, `README.md`, `docs/images/components/checkbox-ios.png`,
  `.changeset/g31-checkbox-ios-glyph.md`, `etc/package-files.txt`.

## Follow-ups

- harness: an app-process exit with no crash log killed one suite per run on two of three
  iOS attempts (Dialog, then Tooltip, at ~10 min both times), from different suites. Same
  message in `G22-popover`'s stored log (2026-11-08) and in E4's and G19's committed
  excerpts, so it predates this task; the third attempt was clean. Worth a retry, or a
  crash-log reader that says *why* the process went.
- harness: a debug-level `xcrun simctl spawn … log stream` left running writes ~40 MB/min
  and was open during the first failure; a gate could refuse or slow down while one is.
- harness: `sizingStats()` corrections count *instances*, not configurations, so any case
  that reads them as "how many cold configurations" is reading the wrong thing … which is
  how this task's Android bound was written. Worth a grep across the other harnesses.
- a11y: `.accessibilityHidden(true)` on an image inside a custom `ToggleStyle` is a no-op
  on iOS 27 — a `docs/research/nitro-patterns.md` note, not this component's problem.
- a11y: `a11y.mjs`'s `icon-button` exemption may be fixable the same way
  (`accessibilityRepresentation`), and `.accessibilityElement(children: .ignore)` plus
  `.isToggle` yields XCUITest type 41, not 40 — neither is a Checkbox problem.
- harness: other components' harness cases read the same process-wide sizing-correction
  counter as Checkbox; `settledCorrections` now exists if they flake.
