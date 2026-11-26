# FIX40 — A Picker whose held size is dropped measures again

**Kind:** bugfix · **Devices:** both ·
**Budget:** 2.5 h for round one (the two Picker size-hold tasks took 2.5 h each)

## Goal

When a pick's held size is thrown away because the batch that caught up no longer shows what
the pick painted (for example, the app changed `options` at the same time), the Picker still
ends at the right size for what it now shows, on both platforms.

## Why

Both hosts hold a pick's size reports until a props batch with `jsEvents >= nativeEvents`
(`docs/DESIGN.md` 3.6). At the release, the held size is filed only if the control still shows
what the pick painted (`pickIsStillShown`). Otherwise it is dropped
(`NitroComposeHost.releaseSizingReports` on Android, `NitroSwiftUIHost.releaseSizingReports` on
iOS), and nothing asks for a new measure. A batch that changes `options` (or `label`, or
`variant` in place) while a pick is held can therefore leave the control at a cached, guessed or
fallback size that is not its own. On iOS a batch with no visual change also returns from
`commit()` before any measure. The PR review and a code-review bot both found this. It is a gap in
the hold that just landed, not in the pick itself.

## Behaviour

1. First, on main: a harness case that picks and, before the pick reaches JS, delivers a batch
   that changes what the pick painted (new `options` with a different width at the picked index
   is the plain case). Read the control's final box against its own measured content. Record the
   reading on both platforms. If neither platform ends wrong, stop and report, with no library
   change.
2. With the fix, the control ends with its box equal to its measured content, on both platforms,
   controlled and uncontrolled.
3. A release that files the held size behaves as today: no extra measure, no extra correction.
   Controls that never hold are unaffected.

## Proof

- The new case is red on main where item 1 finds the gap, and green with the fix. Show it red
  with the new re-measure removed.
- The existing Picker, Chip and Sizing cases stay green on both platforms.
- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints nothing
  missing.

## Out of scope

- iOS Chip and Menu holds (they have none yet), other controls.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- A dropped held size asks the host for a fresh measure that runs after the batch's props have
  applied, even when the batch has no visual change. Any dedupe memory that would swallow an
  equal size is cleared, as the filing path already does.
- Keep the fix in the two hosts' release paths, not in the Picker, so Chip on Android gets it too.

## Context

`ios/core/NitroSwiftUIHost.swift` (`releaseSizingReports`, `commit`, `invalidateContentSize`,
`refreshContentSize`), `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`
(`releaseSizingReports`, `recordMeasuredSize`), both `HybridNitroUiPicker` files (`afterUpdate`,
`pickIsStillShown`), `example/__tests__/Picker.harness.tsx` (`filesNothingUnderALeftKey`),
`docs/DESIGN.md` 3.6, `docs/architecture/core.md` section 7.
