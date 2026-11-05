# E1 — Material 3 Expressive, pass 1: buttons

**Branch:** `task/E1-expressive-buttons` (from `main` at `ee3197ed`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E1-uivzs` (`emulator-5574` + iOS 27 `nitro-ui A` / Metro `8295`)

## API settled

| Surface                | What it ended up as                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ButtonProps.shape`    | `'round' \| 'square' \| null`, default `'round'`. `null`, omission and an unrecognised name all resolve to `'round'`, the rule `variant`/`size` already follow. The wire prop is `shape: string` — never optional (nitro#1184) — so the wrapper always sends it. |
| Android corners        | the `shapes: ButtonShapes` overload of all five buttons, from `ButtonDefaults.shapesFor(height)`: `round` is the height's corner, morphing toward the square one while pressed; `square` rests square and morphs the other way. Cached per (motion scheme, rung, corner). |
| iOS corners            | `.buttonBorderShape` per variant — `round` → `.automatic`, and `.capsule` for `outlined` as before; `square` → `.roundedRectangle(radius: 8)`, with the `outlined` hairline following it. `text` ignores `shape`; static on iOS. The table is in `docs/components/button.md`. |
| Size ladder            | `small`/`medium`/`large` = Material's XS/S/M container heights (32/40/56 dp). The rung selects `contentPaddingFor` / `textStyleFor` / `shapesFor`; `ButtonScale.layoutHeight` — the token, never below Material's own 48 dp minimum — is the height the corner is read from. Nothing sets a height on the box. |
| `SegmentedControl`     | public API unchanged. Android: one `Row` spaced by `ButtonGroupDefaults.ConnectedSpaceBetween`, items on the connected leading / middle / trailing shapes, each its own `selectable(role = Role.RadioButton)` node inside `selectableGroup()`.                 |
| `Chip`                 | `FilterChip(shapes = ChipShapes(shape, selectedShape = CircleShape, pressedShape))` — a selected chip has a corner of its own.                                                                                                                              |

## Summary

The three button-shaped Android controls now sit on Material 3 Expressive's own APIs; iOS gained only what the brief asked for: a `shape` prop.

**Button** takes `shape` on both platforms, and Android draws through the `shapes:` overload so a press morphs the corner and releasing springs it back. **The decision to read before the diff:** the brief asks both for "map `size` to the XS/S/M height tokens" and for "the 48 dp minimum touch target", and Material keeps that floor inside `Button` — so the token *selects* padding, label style and corner and never sets a height. `Modifier.height(scale.height)` does reproduce the token exactly (a 32.0 dp `small`, measured) and takes the finger target down with the picture. What ships is the ladder with the floor: 48 / 48 / 56 dp. Width is what moves — 16 dp off `medium`, 19 dp off `large`, which is 5.7 dp taller. `Menu`'s trigger is the same composable and gets it; the popup is untouched (E2).

**SegmentedControl** is a connected group: one `Row`, `ConnectedSpaceBetween`, the connected leading / middle / trailing corners — and not Material's `ToggleButton`, which publishes `Role.Checkbox` where no nested node can outvote it — the control's own radio sentence would go false. The item takes Material's geometry onto `selectable(role = Role.RadioButton)`. The row was dumped before and after: both publish three nodes per segment — the item box carrying `checkable`/`checked`, a `RadioButton` for the role, a `TextView` for the label — so the redraw moved the pixels and left the announcement, and the checks read each where it lives. One line came out as they went: the row's own `Modifier.semantics { selected = isSelected }`, inherited from a `SegmentedButton` with no state of its own. Left in, it wins the semantics merge and the run reads that line rather than the item's selection — the one mutation that stayed green until it came out.

**Chip** got its `ChipShapes`. The always-present leading slot stays: material3 1.5.0-beta02 still wraps it in an `expandHorizontally` spring (re-read, not inherited), and taking it out still costs a width a deselect cannot land on.

**Sizing** (D17): heights unchanged at 48 dp; Android fallbacks moved with the numbers — Button 91 → 75.1 dp wide, SegmentedControl 256 → 208.4 — in `scripts/conformance-core.mjs` and its in-app mirror. Filter chips are 3.81 dp narrower at both states, constant, so a chip still grows by exactly its check mark.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1733 tests / 69 suites | `0e1f210573c6` | 2 m 39 s | start 5.7 / med 5.2 / max 6.7 |
| `harness:ios` | **PASS** | 393 tests / 23 suites + isolated 2 tests / 1 suites | `0e1f210573c6` (ios tree) | 11 m 23 s | start 3.8 / med 3.5 / max 6.2 |
| `harness:android` | **PASS** | 442 tests / 23 suites + isolated 2 tests / 1 suites | `0e1f210573c6` (android tree) | 13 m 41 s | start 4.4 / med 2.7 / max 5.1 |
| `real-input:ios` | **PASS** | — | `0e1f210573c6` (ios tree) | 22 m 03 s | start 5.5 / med 5.3 / max 60.9 |
| `real-input:android` | **PASS** | — | `0e1f210573c6` (android tree) | 35 m 29 s | start 5.0 / med 2.7 / max 10.0 |
| `harness:android:Button` | stale | 1 failed of 14 tests / 1 suites | 8e41cf8df99b (not this tree) | 18.0 s | start 4.8 / med 5.1 / max 5.2 |
| `harness:android:Chip` | stale | 2 failed of 12 tests / 1 suites | 8f9c2aafabc2 (not this tree) | 28.9 s | start 3.3 / med 3.3 / max 3.3 |
| `harness:android:shape` | stale | — | df06f455351b (not this tree) | 1.4 s | start 7.1 / med 7.1 / max 7.1 |
| `harness:ios:Button` | stale | 1 failed of 14 tests / 1 suites | 8e41cf8df99b (not this tree) | 17.5 s | start 4.6 / med 4.6 / max 4.7 |
| `harness:ios:shape` | stale | — | df06f455351b (not this tree) | 0.7 s | start 7.3 / med 7.3 / max 7.3 |
| `real-input:android:--control:segmented-control` | **PASS** | — | `0e1f210573c6` (android tree) | 7 m 36 s | start 3.6 / med 2.9 / max 8.3 |
| `real-input:android:--control:segmented-control:--background` | **FAIL** | — | `0e1f210573c6` (android tree) | 0.2 s | start 3.1 / med 3.1 / max 3.1 |


`need --for review`: need: review is satisfied on this code tree.

Two rows are this round's own noise, not the code's. `harness:android:shape` / `harness:ios:shape` are the first attempts at the `shape` proofs, refused before they ran because no app was stamped yet; the `:--background` row is a `--background` flag put after the `--`, which the runner read as another `--control` argument and refused in 0.2 s — the same command with the flag in front is the PASS above it. Every other red row in the exported ledger is a red proof from this report; the excerpts are in `docs/tasks/E1/failures/`.

One hygiene incident: reading the emulator's night mode with `cmd uimode night` turned out to be a setter, so `night yes` went to `emulator-5574` for about five seconds during the final `real-input:android` run and came straight back (`night no`, `ui_night_mode=1`, verified after). Nothing in that window asserted a colour and the run is green, but it was a write to a leased device made blind.

## Red proofs

- `example/__tests__/Button.harness.tsx · shape · reaches the control` -> `Button.tsx` sent `shape={'round'}` for every mount -> `expected 'round' to be 'square'` (Button.harness.tsx:1178), Android and iOS.
- `Button.harness.tsx · repaints a mounted corner without opening a new configuration` -> the same mutation -> `expected 'round' to be 'square'` (Button.harness.tsx:1233), Android and iOS.
- `Button.harness.tsx · repaints a mounted corner` -> `shape` added to `nuiSizingKey` -> `a corner change cost 1 size correction(s): expected 1 to be +0`, Android and iOS.
- `ButtonModelTest.aRecycledModelForgetsTheCornerAndEverythingElseSentWithIt` -> `shape = ButtonShape.Round` dropped from `ButtonModel.reset()` -> `java.lang.AssertionError at ButtonModelTest.kt:42`.
- `ButtonModelTest.theBoxMaterialLaysOutNeverGoesBelowTheTouchTarget` -> the `MinTouchTargetHeight` floor dropped from `ButtonScale.layoutHeight` -> `java.lang.AssertionError at ButtonModelTest.kt:69`.
- `example/__tests__/Chip.harness.tsx · chip · a toggle round trip (E1)` -> the leading slot taken back out (`else null`, on the theory that 1.5 dropped the spring) -> `selecting left the chip at 112.38x48.00 where a chip mounted selected is 110.86x48.00`; the older `Chip · G12 · re-keys a toggle` went red beside it.
- `scripts/real-input/android.mjs · segmented control · one radio node per option` -> `role = Role.RadioButton` dropped from the item's `selectable` -> `the group publishes one radio node per option — expected 3, saw 0` plus `segment 1/2/3 … expected true, saw false`, with `role MISSING` in the note.
- `… · segment 2 reports the selection the control has` -> `selected = false` on the item -> `expected true, saw false` (and it only goes red because the row's own extra `selected` write came out; before that the dump was reading that line).
- `… · segment N is within the connected gap of its neighbour` -> `Arrangement.spacedBy(12.dp)` instead of `ConnectedSpaceBetween` -> `segment 2 / 3 … (=11px, at most 6px = 2dp)`.
- Not a mutation, and the row the report leans on: the same E1 block run against `ee3197ed`'s `SingleChoiceSegmentedButtonRow` — PASS, and the temporary node dump shows the same three nodes per segment, which is what `docs/components/segmented-control.md` now claims.
- Not mutated: the iOS recycle reset. `Button`'s props are all re-sent on every mount and every setter is equality-guarded, so a recycled iOS view cannot be shown from JS to keep a corner; the reset is asserted where it is observable (the JVM row above), and the `noProbe` note in `example/__tests__/Conformance.harness.tsx` now names `shape` among the re-sent props.

Data: `docs/tasks/E1/mutations.json`.

## Files changed

- Shared Expressive button code (Android): `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — the `ButtonScale` token ladder, `ButtonShape`, `buttonShapes` with its per-(scheme, rung, corner) cache, and the helpers `Menu`'s trigger already drew through (`NitroUiM3Button`); its popup untouched.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSegmentedControl.kt` — the connected group, the item's own radio semantics, `FALLBACK_WIDTH_DP` 256 → 208.4.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiChip.kt` — `ChipShapes` with its own cache, and the leading-slot note re-verified rather than inherited.
- iOS: `ios/components/Button/HybridNitroUiButton.swift` — `shape` → `.buttonBorderShape`, stored, applied in `afterUpdate()`, reset in `prepareForRecycle`; the `outlined` hairline follows the corner.
- Spec + wrapper: `src/components/Button/Button.nitro.ts`, `src/components/Button/Button.tsx`, `src/components/Button/NativeNitroUiButton.ts`, `src/components/Button/NitroUiButtonConfig.ts`, `src/index.ts`, `etc/react-native-nitro-ui.api.md` and the `nitrogen/generated/**` Button files.
- Tests: `android/src/test/java/com/margelo/nitro/nitroui/ButtonModelTest.kt` (new), `example/__tests__/Button.harness.tsx`, `example/__tests__/Chip.harness.tsx`, `example/__tests__/Conformance.harness.tsx`, `scripts/real-input/android.mjs`.
- Sizing: `scripts/conformance-core.mjs` and the in-app mirror in `example/__tests__/Conformance.harness.tsx` (regenerated with `node scripts/conformance/print-shared-table.mjs --write`).
- Docs: `docs/components/{button,segmented-control,chip}.md`, `README.md`, `.changeset/e1-expressive-buttons.md`, and the three retaken Android screenshots `docs/images/components/{button,segmented-control,chip}-android.png`.

## Follow-ups

- SegmentedControl: `ButtonGroupDefaults.connectedLeading/Middle/TrailingButtonShapes(CircleShape)` return the stadium unchanged, so a "connected" pill group is a row of pills 2 dp apart — the connected-corner maths has nothing to clamp on a percentage corner.
- Chip: the `shapes: ChipShapes` overload lays a filter chip out 3.81 dp narrower than the `shape:` one at both states — constant, but worth an upstream look before anyone writes the old numbers down again.
- Button: `ToggleButton` publishing `Role.Checkbox` from its own semantics lambda means no correct radio group can be built from it upstream.
- Bench: the Button / SegmentedControl / Chip arms were not re-run this round (the brief allows this line); the sizes above are the harness's, not the bench's.
