# FIX39 — An iOS Picker files a pick's width only under its own title

**Kind:** bugfix · **Devices:** ios (android for the harness run of a changed test file) ·
**Budget:** 2.5 h for round one (the Android half of this bug took 2.5 h plus one fix round)

## Goal

After a user picks a choice on an iOS `Picker`, the control's measured size is stored only under
the sizing key of the title it measured, so a later Picker showing another title never takes a
wrong cached width.

## Why

Android fixed this: its host holds a pick's size reports until a props batch arrives whose JS
event count has caught up with native's (`docs/DESIGN.md` 3.6). iOS has no hold. Its host reports
a measured size as soon as it has one (`NitroSwiftUIHost.noteContentSizeMayHaveChanged` →
`reportToSizingEngine`), under the key of whatever batch is current. When the user picks, the key
still names the old title until React's next batch, so the new title's size is filed under the old
title's key. The Android task measured the same two-pick sequence on iOS: it costs one
correction. `example/__tests__/Picker.harness.tsx` has the two cases ("files nothing under a key
two … picks have left"), skipped on iOS by `itHoldsPicks`.

## Behaviour

1. First, on main: run the two cases on iOS with the skip removed, and record the reading
   (`corrections`). If iOS does not misfile, stop and report, with no library change.
2. With the fix, both cases pass on iOS, controlled and uncontrolled, menu and wheel where the
   cases cover them. The same cases still pass on Android.
3. A single ordinary pick still re-sizes the control to the new title with no more corrections
   than today. A refused pick, a pick of the row already shown, recycling and drop leave no size
   held.

## Proof

- The two cases run on both platforms (the `itHoldsPicks` gate goes). They are red on iOS on main
  for the reason in item 1, and green with the fix. Show them red with the fix's caught-up check
  removed.
- The existing Picker and Sizing harness cases stay green on both platforms.
- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints nothing
  missing.

## Out of scope

- Chip on iOS (if it has the same gap, one line in the report's follow-ups), other controls.
- Android, except where a shared JS change touches it.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Use the same rule as Android: a size measured after a native pick is filed only for a batch whose
  `jsEvents >= nativeEvents`, and only if what the pick painted is still shown. Put the hold in the
  iOS host so the next control that needs it can use it, as Android's `NitroComposeHost` does.
- `docs/DESIGN.md` 3.6: drop the sentence that says iOS reports at once, and say the hold applies
  on both platforms.
- The uncontrolled Picker's JS echo already exists; reuse it.

## Context

`ios/core/NitroSwiftUIHost.swift` (`noteContentSizeMayHaveChanged`, `commit`,
`reportToSizingEngine`), `ios/components/Picker/HybridNitroUiPicker.swift`,
`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`
(`holdSizingReports`, `releaseSizingReports`) and `HybridNitroUiPicker.kt` (`afterUpdate`) as the
model, `example/__tests__/Picker.harness.tsx` (`itHoldsPicks`, `filesNothingUnderALeftKey`),
`docs/DESIGN.md` 3.5 and 3.6.
