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

<!--GATES-->

## Red proofs

- `scripts/real-input/a11y.mjs` (checkbox box rule) -> ship the glyph style without
  `accessibilityRepresentation` -> `NitroUiCheckbox: "Real-input checkbox" is announced by
  the element at (18, 275, 107, 21.67) while the control is drawn at (16, 273, 109, 26)`.
- `RealInputTests.testRealInputCheckbox` step 7 -> `OptionalAccessibilityValue` returns
  `nil` inside the representation -> `XCTAssertEqual failed: ("Optional("0")") is not equal
  to ("Optional("mixed")")`.
- Same step's one-element claim -> `if glyph && false` (skip the representation) ->
  `("2") is not equal to ("0") - the glyph and the label must be announced as part of the
  control and not as stops of their own`.
- `Checkbox.harness.tsx` styles case -> read the process-wide correction counter instead of
  `settledCorrections` -> Android `expected 4 to be less than 3`.
- `checkbox-glyph.test.swift` -> `style == .circle ? "square" : "circle"` -> `FAIL an
  unchecked circle is the empty box: square(secondary), want circle(secondary)`.
- `checkbox-glyph.test.swift` -> `indeterminate ? "mixed" : nil` -> `FAIL a checked
  indeterminate box announces the state it drew, not the prop`.
- `Checkbox.harness.tsx` disabled case -> the disabled box keeps its checked glyph ->
  `"barrier" never drew symbol=circle - it reports
  "displayed=1;probes=0;merged=none;a11y=none;symbol=checkmark.circle.fill"`.
- The two sizing cases -> expectations replaced with `MEASURE-*` sentinels, which is only a
  measurement probe, not a mutation: they print the box the device measured
  (`bare=26.00x26.00 circle=110.00x26.00 square=109.00x24.00 switch=145.00x28.00`) and say
  the fixture is not empty; no poisoned-fallback mutation was run for them separately.

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

- harness: an app-process exit with no crash log took `Dialog.harness.tsx` down on the
  first iOS run; the same message has hit `Sizing` (E4) and `Recycling` (G19). Worth a
  harness-side retry or a crash-log reader.
- harness: a debug-level `xcrun simctl spawn … log stream` left running writes ~40 MB/min
  and was running during that failure; a gate could refuse while one is open.
- a11y: `.accessibilityHidden(true)` on an image inside a custom `ToggleStyle` is a no-op
  on iOS 27 — a `docs/research/nitro-patterns.md` note, not this component's problem.
- a11y: `a11y.mjs`'s `icon-button` exemption may be fixable the same way
  (`accessibilityRepresentation`), and `.accessibilityElement(children: .ignore)` plus
  `.isToggle` yields XCUITest type 41, not 40 — neither is a Checkbox problem.
- harness: other components' harness cases read the same process-wide sizing-correction
  counter as Checkbox; `settledCorrections` now exists if they flake.
