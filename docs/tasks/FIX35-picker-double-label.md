# FIX35 — VoiceOver says an iOS Picker's name once

**Kind:** bugfix · **Devices:** ios (android only for the harness run of a changed test file) ·
**Budget:** 2.5 h for round one (median of the recent single-control bugfixes FIX27, FIX29, FIX30)

## Goal

A VoiceOver user hears an iOS `Picker`'s name once, whichever of `label` and
`accessibilityLabel` the app sets, hosted or not.

## Why

The real-input accessibility sweep measured (2026-10-30) that the hosted Picker on the Host
screen (`label="Hosted picker"`, `accessibilityLabel="Hosted picker"`, `selectedIndex={1}`)
announces "Hosted picker, Hosted picker". The `hosted-picker` case in
`scripts/real-input/a11y.mjs` carries no `iosTrait` because of it. The unhosted real-input
Picker sets `accessibilityLabel` only and reads correctly. The Picker's iOS code has not
changed in a way that touches accessibility since. The recorded explanation ("SwiftUI
concatenates the label prop and `accessibilityLabel`") is a guess, not a measurement. The
code applies one string (`accessibilityLabel ?? label`), so do not trust it.

## Behaviour

1. **Measure first, on main, before any change.** Record what the Picker's element announces
   (label, value, traits, from the accessibility tree XCUITest reads) for: `label` only;
   `accessibilityLabel` only; both, equal; both, different. Measure each hosted and unhosted.
   If none of them doubles the name, stop. Report the readings and make no library change.
2. Where it doubles, the element announces the name once, and the selected choice stays
   announced as its value.
3. A Picker with neither prop is unchanged, and so is Android.

## Proof

- The readings from item 1, before and after, in a table in the report. Get them with a
  filtered `node scripts/gate.mjs real-input:ios -- --a11y hosted-picker` run, plus whatever
  throwaway screen or harness case the other combinations need. That code is not committed.
- A harness test on iOS that reads the Picker element's accessibility label and value. Read
  them through a test-only native read on the Picker (`@internal`, like `nuiTestMenuReport`;
  Android answers a fixed "no reading"). Assert one name for each doubling combination
  measured in item 1. Show it red with the fix reverted.
- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints
  nothing missing.

## Out of scope

- `scripts/` (including `a11y.mjs`'s missing `iosTrait`: put the line to add in your report),
  `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.
- Other controls' announcements (Slider and Stepper announced as "other", the Form row name).
- Android Picker accessibility.

## Decided already

- If the doubling comes from SwiftUI itself and no modifier on our side removes it without
  losing the label or the value, stop. Report the readings and what you tried. No workaround
  that hides the value or the control's button trait.
- Keep `label`'s documented fallback ("used as the accessibility label when the caller did
  not give a better one").

## Context

`ios/components/Picker/HybridNitroUiPicker.swift` (`OptionalPickerAccessibility`, `optionsPicker`),
`src/components/Picker/`, `example/src/HostScreen.tsx` (the hosted Picker),
`example/src/PickerScreen.tsx` (the real-input Picker), `example/__tests__/Picker.harness.tsx`,
`docs/components/picker.md`.
