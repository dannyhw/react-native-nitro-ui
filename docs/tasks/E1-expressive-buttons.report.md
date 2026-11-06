# E1 — Material 3 Expressive, pass 1: buttons

**Branch:** `task/E1-merge`, from `task/E1-expressive-buttons` at `4f7018e3`, which branched from
`main` at `ee3197ed` · **Rounds:** 1, **fix round 1**, **fix round 2** and the **merge round**
below (D19: cap reached) · **Leases:** `E1-uivzs`, `E1-7ojmj`, `E1-jnmeq` — the same pair-a
devices every time (`emulator-5574` + iOS 27 `nitro-ui A` / Metro `8295`)

## API settled

| Surface                | What it ended up as                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ButtonProps.shape`    | `'round' \| 'square' \| null`, default `'round'`. `null`, omission and an unrecognised name all resolve to `'round'`, the rule `variant`/`size` already follow. The wire prop is `shape: string` — never optional (nitro#1184) — so the wrapper always sends it. |
| Android corners        | the `shapes: ButtonShapes` overload of all five buttons, from `ButtonDefaults.shapesFor(height)`: `round` is the height's corner, morphing toward the square one while pressed; `square` rests square and morphs the other way. Cached per (motion scheme, rung, corner). |
| iOS corners            | `.buttonBorderShape` per variant — `round` → `.automatic`, and `.capsule` for `outlined` as before; `square` → `.roundedRectangle(radius: 8)`, with the `outlined` hairline following it. `text` ignores `shape`; static on iOS. The table is in `docs/components/button.md`. |
| Size ladder            | `small`/`medium`/`large` *select* one of Material's XS/S/M container tokens (32/40/56 dp). The rung picks `contentPaddingFor` / `textStyleFor` / `shapesFor`; `ButtonScale.layoutHeight` — the token, never below Material's own 48 dp minimum — is the height the corner is read from. Nothing sets a height on the box, and `small` draws at Material's own 40 dp container floor inside it, so it is the XS token's padding, type and corner, not a 32 dp control. |
| `SegmentedControl`     | public API unchanged. Android: one `Row` spaced by `ButtonGroupDefaults.ConnectedSpaceBetween`, items on the connected leading / middle / trailing shapes, each its own `selectable(role = Role.RadioButton)` node inside `selectableGroup()`.                 |
| `Chip`                 | `FilterChip(shapes = ChipShapes(shape, selectedShape = CircleShape, pressedShape))` — a selected chip has a corner of its own.                                                                                                                              |

## Summary

The three button-shaped Android controls now sit on Material 3 Expressive's own APIs; iOS gained only what the brief asked for: a `shape` prop.

**Button** takes `shape` on both platforms, and Android draws through the `shapes:` overload so a press morphs the corner and releasing springs it back. **The decision to read before the diff:** the brief asks both for "map `size` to the XS/S/M height tokens" and for "the 48 dp minimum touch target", and Material keeps that floor inside `Button` — so the token *selects* padding, label style and corner and never sets a height. `Modifier.height(scale.height)` does reproduce the token exactly (a 32.0 dp `small`, measured) and takes the finger target down with the picture. What ships is the ladder with the floor: 48 / 48 / 56 dp. Width is what moves — 16 dp off `medium`, 19 dp off `large`, which is 5.7 dp taller. `Menu`'s trigger is the same composable and gets it; the popup is untouched (E2).

**SegmentedControl** is a connected group: one `Row`, `ConnectedSpaceBetween`, the connected leading / middle / trailing corners — and not Material's `ToggleButton`, which publishes `Role.Checkbox` where no nested node can outvote it — the control's own radio sentence would go false. The item takes Material's geometry onto `selectable(role = Role.RadioButton)`. The row was dumped before and after: both publish three nodes per segment — the item box carrying `checkable`/`checked`, a `RadioButton` for the role, a `TextView` for the label — so the redraw moved the pixels and left the announcement, and the checks read each where it lives. One line came out as they went: the row's own `Modifier.semantics { selected = isSelected }`, inherited from a `SegmentedButton` with no state of its own. Left in, it wins the semantics merge and the run reads that line rather than the item's selection — the one mutation that stayed green until it came out.

**Chip** got its `ChipShapes`. The always-present leading slot stays: material3 1.5.0-beta02 still wraps it in an `expandHorizontally` spring (re-read, not inherited), and taking it out still costs a width a deselect cannot land on.

**Sizing** (D17): heights unchanged at 48 dp; Android fallbacks moved with the numbers — Button 91 → 75.1 dp wide, SegmentedControl 256 → 187.9 — in `scripts/conformance-core.mjs` and its in-app mirror. Filter chips are 3.81 dp narrower at both states, constant, so a chip still grows by exactly its check mark.

## Gates

The merge tree - code tree `3bb396299e94`, worktree clean at `aa001be` - with all five merge
gates on it:

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1774 tests / 70 suites | `3bb396299e94` | 2 m 39 s | start 9.3 / med 6.9 / max 9.3 |
| `harness:ios` | **PASS** | 444 tests / 25 suites + isolated 4 tests / 2 suites | `3bb396299e94` (ios tree) | 10 m 48 s | start 3.7 / med 4.2 / max 7.2 |
| `harness:android` | **PASS** | 493 tests / 25 suites + isolated 4 tests / 2 suites | `3bb396299e94` (android tree) | 15 m 01 s | start 3.7 / med 2.5 / max 4.5 |
| `real-input:ios` | **PASS** | — | `3bb396299e94` (ios tree) | 27 m 55 s | start 2.5 / med 5.2 / max 16.0 |
| `real-input:android` | **PASS** | — | `3bb396299e94` (android tree) | 41 m 02 s | start 5.8 / med 2.5 / max 5.8 |
| `harness:android:Menu` | stale | 1 failed of 43 tests / 2 suites | dea667423cae (not this tree) | 1 m 22 s | start 3.4 / med 4.7 / max 6.6 |
| `harness:android:Menu:--verbose` | stale | 43 tests / 2 suites | 94893b5e2fa7 (not this tree) | 1 m 21 s | start 6.3 / med 4.3 / max 6.3 |
| `harness:ios:Menu` | stale | 43 tests / 2 suites | 94893b5e2fa7 (not this tree) | 2 m 22 s | start 12.7 / med 8.1 / max 12.7 |

`need --for merge`: need: merge is satisfied on this code tree.

Each ran once and passed; neither known flake appeared (no BottomSheet 50-cycle failure, no
refused iOS edit). The counts are the merged suite's, so E2's, G17's, G18's and X19's own
checks rode along: 1774 unit tests, 444 iOS and 493 Android harness tests, and 41 m of real
touches including `searchfield`, `tooltip` and `tab-targets`.

The three stale rows are this round's own filtered probes, each red or green on a tree it
mutated: `harness:android:Menu` on `dea667423cae` is the fallback-collision proof, and the two
passes on `94893b5e2fa7` are the Menu suites read before anything moved (`--verbose` is a flag
the harness CLI does not forward, so that run is the ordinary green one with a longer name).
The ledger holds two more `harness:android:Menu` fails the table no longer prints: the harvest
red on `0239981d0099` and the same edit refused for a stale app stamp one minute earlier.

### Rounds 1-2, on `1ba96127946f`


`need --for review`: need: review is satisfied on this code tree.

That round’s table is not pasted: the report carries exactly one, the generated one above, and every row it printed on `1ba96127946f` stays in the ledger the export commits. What those rows said: four described the code of that round, and the rest was history the ledger kept, since `table` prints the newest line per gate name. `harness:android:shape` / `harness:ios:shape` are the first two attempts at the `shape` proofs, refused before they ran because no app was stamped yet. `harness:android:Button`, `harness:android:Chip`, `harness:ios:Button` and `--control:segmented-control` are red-proof runs, each on its own mutated tree, so each is stale by its own mutation. The `…:--control:segmented-control:--background` row is a `--background` flag put after the `--`, which the runner read as another `--control` argument and refused in half a second. Every red line in the ledger has its excerpt in `docs/tasks/E1/failures/`.

Two runs in the ledger carry this fix round's own history. The first full `real-input:android` went red on `picker` alone: three cycles into the drop picker's unmount loop, the tap that arms the app's own 2.5 s unmount landed and the tap that opens the menu did not, so the retry re-read the tree after the control had gone — the race the check's own comment names, on a box carrying another task's `real-input:ios`, with the other 19 controls green. The PASS above is the re-run. `real-input:ios` has no green on this tree: its last run was refused because the code tree moved under its own build, mid-way through the round-1 screenshot work. It was not re-run because no iOS source moved since — this round's diff is Android Kotlin, two `scripts/real-input/` files and docs, and only the Android runner imports either — and `harness:ios` is green on this exact tree.

Fix round 2 adds four more rows of its own. `harness:android:SegmentedControl` on `3ad29a4ffdba` is the new row-width test going red against the weighted geometry, and `real-input:android:--control:segmented-control` on `9a0202aabce2` is the corner probe refusing a selected segment; both are filtered runs, so they satisfy nothing and are stale by their own mutation. The two between them on `d6c2e198b679` and `585d9e6900fd`, and the PASS on `3c92ebffc732`, are the same proof being written: the first two placed the tap after `segmentOne` was bound, so the guard never saw the selection, and the pass is what a bare `AbortedCheck` looks like to this runner — a check that stopped reading and a green run. `harness:android:SegmentedControl:--background` is the same `--background` flag put after the `--` as the `segmented-control:--background` row above, made a second time. `real-input:ios` is stale again and still not asked for: this round moved Android Kotlin, one `scripts/real-input/` file, a shared harness test and docs, and `harness:ios` is green on this exact tree because the harness test is shared.

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

Fix round 1 (both in the same data file):

- `ButtonModelTest.onlyTheTextVariantIgnoresTheCornerItWasSent` -> `cornerFor` returns `shape` for every variant -> `java.lang.AssertionError at ButtonModelTest.kt:93` (the `text` + `square` case; 84 tests, 1 failed).
- `scripts/real-input/android.mjs · segment 1 is drawn with its connected corner` -> the three `connected*ButtonShapes(resting)` calls put back -> `… 10dp inside the corner … - rgb(255,255,255) / rgb(255,255,255) vs page rgb(255,255,255)`. Green, those two pixels are the segment's own border, `rgb(93,95,103)`.

Fix round 2:

- `example/__tests__/SegmentedControl.harness.tsx · G4 · is as wide as its own segments added up` -> `ConnectedRow` made to demand n x the widest item and always share the result (what `Modifier.weight(1f, fill = false)` at `width(IntrinsicSize.Max)` does) -> `the row of Hour, Day, Week, Month, Year measures 369.52x48.00 … but its own segments are 62.86 + 56.00 + 66.67 + 72.38 + 60.19 plus 4 gaps of 2 dp = 326.10 dp - off by 43.42 dp`; 1 of 21 failed, and the other 20 stayed green because an equal share is still right for the over-wide cases.
- `scripts/real-input/android.mjs · segment 1 is drawn with its connected corner` -> the pill mutation left in and a tap on segment 1 added before the probe -> `the corner probe will not read segment 1 while it is not plainly unselected (checked=true)`. The run also printed what the probe would have concluded: `onStroke=true`, probe `rgb(255,255,255)` against a reference of `rgb(110,116,136)` — page-against-fill reads as stroke, which is the false green the line now refuses. Its first attempt threw a bare `AbortedCheck` instead and the run reported **PASS** (tree 3c92ebffc732), which is why it goes through `t.log.abort`.

Merge round:

- `Menu.harness.tsx · Menu · G7a · lays each configuration out at the size the control measured` -> the re-measured fallback planted as a *measured* box (`FALLBACK_WIDTH_DP`/`FALLBACK_HEIGHT_DP` := 76.57/48.00, the `filled` `Variant` trigger, with the harness mirror moved to the same pair) -> `expected true to be false` at Menu.harness.tsx:785, the `sameSize(box, DECLARED_FALLBACK)` refusal; 1 failed of 43 (`05-54-01Z`).
- The same test, and this one is a harvest rather than a guard proof: the corrections floor *after* its `console.log` raised to 1000 so Jest prints the suite’s console block at all -> `expected 7 to be greater than or equal to 1000` (Menu.harness.tsx:799), and the line above it is the measurement `docs/components/menu.md` now carries (`cfg-filled=76.57x48.00 … cfg-size-large=88.76x56.00`) (`05-46-06Z`).

Data: `docs/tasks/E1/mutations.json`.

## Files changed

- Shared Expressive button code (Android): `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — the `ButtonScale` token ladder, `ButtonShape`, `buttonShapes` with its per-(scheme, rung, corner) cache, and the helpers `Menu`'s trigger already drew through (`NitroUiM3Button`); its popup untouched.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSegmentedControl.kt` — the connected group, the item's own radio semantics, `FALLBACK_WIDTH_DP` 256 → 187.9, and `ConnectedRow`, the row that lays the group out at the sum of its segments.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiChip.kt` — `ChipShapes` with its own cache, and the leading-slot note re-verified rather than inherited.
- iOS: `ios/components/Button/HybridNitroUiButton.swift` — `shape` → `.buttonBorderShape`, stored, applied in `afterUpdate()`, reset in `prepareForRecycle`; the `outlined` hairline follows the corner.
- Spec + wrapper: `src/components/Button/Button.nitro.ts`, `src/components/Button/Button.tsx`, `src/components/Button/NativeNitroUiButton.ts`, `src/components/Button/NitroUiButtonConfig.ts`, `src/index.ts`, `etc/react-native-nitro-ui.api.md` and the `nitrogen/generated/**` Button files.
- Tests: `android/src/test/java/com/margelo/nitro/nitroui/ButtonModelTest.kt` (new), `example/__tests__/Button.harness.tsx`, `example/__tests__/Chip.harness.tsx`, `example/__tests__/Conformance.harness.tsx`, `scripts/real-input/android.mjs`.
- Sizing: `scripts/conformance-core.mjs` and the in-app mirror in `example/__tests__/Conformance.harness.tsx` (regenerated with `node scripts/conformance/print-shared-table.mjs --write`).
- Docs: `docs/components/{button,segmented-control,chip}.md`, `README.md`, `.changeset/e1-expressive-buttons.md`, and the three retaken Android screenshots `docs/images/components/{button,segmented-control,chip}-android.png`.

## Follow-ups

- SegmentedControl: `ButtonGroupDefaults.connected*ButtonShapes` take the *whole* resting shape as their first argument, and a percentage corner leaves the connected maths nothing to clamp — handing them the height's shape is the trap fix round 1 fell into.
- Chip: the `shapes: ChipShapes` overload lays a filter chip out 3.81 dp narrower than the `shape:` one at both states — constant, but worth an upstream look before anyone writes the old numbers down again.
- Button: `ToggleButton` publishing `Role.Checkbox` from its own semantics lambda means no correct radio group can be built from it upstream.
- Bench: the Button / SegmentedControl / Chip arms were not re-run this round (the brief allows this line); the sizes above are the harness's, not the bench's.
- SegmentedControl: the three states *swap* corners rather than morphing. Material animates its own buttons through `AnimatedShapeState`, which is `internal`, so the group needs its own corner animation to keep up with `Button`'s morph.
- SegmentedControl: `Modifier.selectableGroup()` on the row has no red proof — dropping it leaves the tree these checks read looking the same. Guarding it needs a `CollectionInfo` assertion, not another node-count line.
- SegmentedControl: `example/__tests__/SegmentedControl.harness.tsx` prints its segment sum on both platforms but asserts it on Android, and the iOS runner captures no JS console output into the gate log, so the iOS half of that pairing only reaches the simulator console.
- SegmentedControl: `ConnectedSegment` allocates per recomposition — an interaction source and a `collectIsPressedAsState` per item, on top of `Button`'s cached shapes.
- Button: at `small` the drawn container is Material's own 40 dp floor while the box is laid out at the 48 dp touch target, so the ladder's first rung is a 40 dp picture in a 48 dp box.
- Button / SegmentedControl / Chip: the shape caches key on the `MotionScheme` instance plus the rung (and corner or state); a theme that changed its shape tokens while holding one `MotionScheme` object would read a stale pair, and nothing here detects that.
- SegmentedControl: `ConnectedRow` asks each item for its `maxIntrinsicWidth`, which is the label plus padding only because a segment is one `Text` at `maxLines = 1`; a wrapping or multi-line child would break that and nothing here says so.
- Menu: `FALLBACK_WIDTH_DP`/`HEIGHT` in `HybridNitroUiMenu.kt`, the `DECLARED_FALLBACKS` row and `Menu.harness.tsx`'s `DECLARED_FALLBACK` are three copies of one pair with nothing cross-checking them - this round moved all three by hand.
- Harness: a green suite's `console.log` never reaches the gate log, so a measured table (menu.md's, and any future one) can only be read out of a deliberate red; a knob that kept console output for green runs would retire that trick.
- Bench: not re-run since round 1 (out of this fix round's scope), so the numbers above are still round 1's.

## Fix round 1

Verdict FIX ROUND, four fixes, all the review's.

**The group is connected again.** `connected{Leading,Middle,Trailing}ButtonShapes` are now called
with no arguments: their first parameter is the *whole* resting shape, so round 1's `shapesFor(48 dp)`
rested every item on a full pill. A one-option row keeps the whole corner. A screencap probe
guards it 10 dp inside segment 1's top-right inner corner — a percentage corner is half the *shorter*
side, so on these 38 × 48 dp segments a pill's arc sits 2.3 dp below the top edge where the
connected 8 dp corner still has a straight stroke, and the page reference is that
segment's own transparent interior (the tree's item gap is 0 px). The press claims now say *swap*,
not *morph*: material3's shape animator is `internal`.

**`text` ignores `shape`**, through `cornerFor`, asserted in the JVM table — that variant paints no
container, so no device can see it. `small` selects the XS token's padding, type and corner, not a
32 dp box; the typo and the task ids are out of the user docs; `segmented-control-android.png`
is retaken at 720 px, where `Last 24 hours` spells itself out and `Month` still does not.

## Fix round 2

**The row is its own segments.** `Modifier.weight` is gone. For a weighted child the equal share is
also the ceiling, and a weighted row at `width(IntrinsicSize.Max)` demands n x the widest item, so
the row was measured against the mean of itself: `Month` ellipsized inside a box 43 dp wider than
the row drawn in it. `ConnectedRow` now sums each item's intrinsic width and shares the box
equally *only* when the labels do not fit - the pass `overwide` / `clamped` / `narrowing` need,
which is why a plain `Row` cannot take the weight back. Five options measure 325.71 x 48.00, box
equal to measurement; three short labels 187.81 (fallback now 187.9), four 265.90 - ~27% narrower
than the row replaced, not ~18%. `Month` spells itself out in the retaken 720 px shot.

**The corner probe refuses a selected segment.** Its reference must be the page; given the fill,
its own arithmetic answers `onStroke=true` for a pill. It aborts through `t.log.abort`: a bare
`AbortedCheck` is swallowed and the run read green. Docs, comments, the changeset and
`mutations.json` say what happens now.

## Merge round

`origin/main` (`2c139cf2`: E2, G17, G18, X19 and the 0.7.0 Version Packages commit) merged in as
`9f55064a`. Git found no conflicts in the six files the brief named; each was diffed against both
parents — both sides survived, the shared table, registry and nitrogen regenerate to what is
committed, and E1's SegmentedControl checks now read G17's `ECHO`/`screenTab` maps. E1's
changeset stays a minor: the release commit consumed the older ones.

Menu's trigger *is* `NitroUiM3Button`, so its Android column was re-measured on the combined tree:
`filled`/`tonal`/`outlined`/`elevated` 92.57 → 76.57 dp, `small` 57.90 → 58.67, `large`
108.57 × 50.29 → 88.76 × 56.00, `text` unchanged at 68.95 × 48.00. The declared fallback went
118 × 52 → 75.1 × 52 — Button's own medium width, the 52 height kept off every measured box —
mirrored into `DECLARED_FALLBACKS`, the generated table and the harness's copy; `menu-android.png`
retaken at 720 px. ContextMenu and Picker keep their own triggers (`OutlinedTextField`; none), and
the iOS trigger is SwiftUI's `.buttonStyle`, which E1 never reached — the iOS column stands
un-re-measured.

Lease `E1-jnmeq` (pair-a: `emulator-5574`, iOS 27 `nitro-ui A`, Metro 8295); no device setting was
written.
