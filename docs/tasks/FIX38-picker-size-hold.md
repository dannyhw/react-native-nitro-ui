# FIX38 — An Android Picker never stores one title's width under another's

**Kind:** bugfix · **Devices:** android (ios for the harness run of a changed test file) ·
**Budget:** 2.5 h for round one (median of the recent single-control bugfixes FIX27, FIX30, FIX35)

## Goal

After a user picks a choice on an Android `Picker`, the control's measured width is stored
only under the sizing key of the title it measured. An app re-render that is already on its way
with the old choice can no longer leave a later frame sized for the wrong title (clipped or
padded).

## Why

`HybridNitroUiPicker` holds size reports after a pick (`choose` → `holdSizingReports`), and
releases them on the next props batch (`afterUpdate` → `releaseSizingReports(pickIsStillShown)`).
That batch can be one React sent before it saw the pick: it carries the old sizing key (the key
names the shown title), while the native display already shows the new title. If the batch
leaves `displayed` on the new index (for example, the event-count handshake refuses the stale
value), `pickIsStillShown` is true, and the new title's width is filed under the old title's key.
An uncontrolled Picker does not echo its event count, so it cannot tell that batch apart. Chip
had the same design and was fixed. Its `afterUpdate` releases only when
`jsEvents >= nativeEvents`, and an uncontrolled Chip echoes its count. Chip's harness case
"files nothing under a key two quick toggles have already left" proves it.

## Behaviour

1. First, on main: a harness case that picks and then delivers a props batch still carrying the
   pre-pick key (a quick second pick, or an unrelated re-render already in flight) shows the new
   title's width filed under the old key. Record the reading. If main does not misfile, stop and
   report the reading, with no library change.
2. With the fix, no size is filed under a key a pick has already left, for controlled and for
   uncontrolled Pickers, menu and wheel variants.
3. A single ordinary pick still re-sizes the control to the new title, in the same number of
   batches as today. A refused pick and a pick of the row already shown behave as today.

## Proof

- The new harness case (Android; it may skip itself on iOS when the path is Android-only) is red
  on main for the reason in item 1, and green with the fix. Also show it red with the fix's
  caught-up check removed.
- The existing Picker sizing cases stay green.
- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints nothing
  missing.

## Out of scope

- iOS Picker sizing. Chip, and the shared `NitroComposeHost` hold/release API (use it as is).
- The Picker popup-window witness and report fields.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Follow Chip's design: the release waits for a batch whose JS event count has caught up with
  native, and an uncontrolled Picker echoes its count. Don't invent a second mechanism.
- Event-count handshake rules (`docs/DESIGN.md` 3.5) stand.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt` (`choose`,
`afterUpdate`, `PickerPickStamp`, `pickIsStillShown`), `HybridNitroUiChip.kt` (its `afterUpdate`
release and `toggleStamp`), `src/components/Picker/Picker.tsx` (`lastChoice`, `useControlled`),
`src/components/Chip/Chip.tsx` (the uncontrolled echo), `example/__tests__/Chip.harness.tsx:443`,
`example/__tests__/Picker.harness.tsx`, `core/NitroComposeHost.kt` (`holdSizingReports`,
`releaseSizingReports`).
