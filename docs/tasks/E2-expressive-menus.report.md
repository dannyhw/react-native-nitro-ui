# E2 — Material 3 Expressive, pass 1: menus

**Branch:** `task/E2-expressive-menus` (from `origin/main` at `ee3197ed`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E2-urxpj` (`emulator-5574` + iPhone 17 / iOS 27.0 / Metro `8295`)

## API settled

```ts
interface MenuAction {
  id: string; title: string; disabled?: boolean; destructive?: boolean; systemImage?: string;
  subtitle?: string | null;   // iOS UIAction.subtitle (a second Text) · Android supportingText
  checked?: boolean | null;   // iOS a menu Toggle (UIAction.state) · Android CheckableDropdownMenuItem
}
```

Both are per action, on `Menu` and `ContextMenu` (one `MenuGroup` type). `null`/absent is a plain row; `''`
subtitle draws none. A checked row is still a row: a pick reports `onSelect(id)` and the app sends the next
`checked` (no local toggle, no handshake: a menu has no value). The native struct `NitroUiMenuRow` gains
`subtitle: string | null` and `checked: boolean | null`, always sent.

## Summary

- **Android, one shared menu** (`MenuRows.kt`): `NitroUiMenuPopup` is `DropdownMenuPopup` placed by
  `MenuDefaults.rememberDropdownMenuPopupPositionProvider(Below)`; `MenuGroups` draws each section, each
  submenu (still inline, D29) and each run of top-level actions as a `DropdownMenuGroup`
  (`groupShape(index, count)`, spaced by `GroupSpacing`, labels via `DropdownMenuGroupLabel` as headings) —
  no dividers; `MenuRow` is `DropdownMenuItem(shape = itemShape(…), supportingText)` or
  `CheckableDropdownMenuItem` with a leading check. The column scrolls (the popup does not).
- **Menu**: `ExposedDropdownMenuBox`/`menuAnchor` is gone; the trigger and the popup share a `Box` whose only
  measured child is the unchanged `NitroUiM3Button`, so the popup anchors to the trigger's box. D32's
  `setOpen` funnel, `onSelect` before `onClose`, the witness and the Host layout-move rules are unchanged.
- **ContextMenu**: the same popup and groups on the zero-size box at the finger; its `title` is the first
  group's label. Gesture code (D36/D37) untouched.
- **Picker**: keeps the exposed dropdown (1.5's top-level `ExposedDropdownMenu` extension — the member is
  `HIDDEN` — with no other 1.5 deprecations in use); rows are `SelectableDropdownMenuItem` (selected container,
  leading check, `Role.RadioButton` + `selected`); container is `standaloneGroupShape` +
  `groupStandardContainerColor`. `wheel` untouched.
- **iOS**: Menu rows with `checked` are `Toggle`s, a subtitle is a second `Text`; ContextMenu's `UIAction`s take
  `subtitle:` and `state:`.
- **Witness.** Android now answers `drawn` (Menu, ContextMenu and a new Picker field) from the open popup's
  merged semantics tree (`RootForTest.semanticsOwner`, read on popup layout once a harness has asked), in the
  iOS probe's notation extended with `@subtitle`, `+` checked/selected, `=` unchecked checkbox. iOS's probe
  writes `@` and `+` from `UIAction` (`subtitle` read guarded to iOS 16).
- **One existing test changed:** "comes down when its hosted child leaves the Host" pressed a hosted child's
  `0 × 0` frame (the trigger's corner pixel), which `menuAnchor`'s whole-box pointer input caught; it now
  presses the drawn rect (`pressWitnessed`) like the other hosted cases.
- Docs (`menu.md`, `context-menu.md`, `picker.md`), README usage and table, a `RowDetails` story, minor
  changeset.

Benchmarks: not run (bench host's; the trigger and its sizing are unchanged).

Screenshots: Android `menu` (`RowDetails`), `context-menu` (`Conversation`) and `picker` (`Variants`), each presented, and iOS `menu` (`RowDetails`, the only photographed story that shows `subtitle`/`checked`), by the CONTRIBUTING recipe on the lease's devices (cropped with `sips`; no ImageMagick here). The scratch `initialSelection`, `RCT_jsLocation`, `debug_http_host` and the `tcp:8295` reverse were undone.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1733 tests / 69 suites | `c349c9604719` | 4 m 14 s | start 13.5 / med 51.0 / max 113.2 |
| `harness:ios` | **PASS** | 394 tests / 23 suites + isolated 2 tests / 1 suites | `c349c9604719` (ios tree) | 11 m 28 s | start 120.2 / med 63.6 / max 270.1 |
| `harness:android` | **PASS** | 443 tests / 23 suites + isolated 2 tests / 1 suites | `c349c9604719` (android tree) | 14 m 04 s | start 6.9 / med 7.4 / max 14.0 |
| `real-input:ios` | **PASS** | — | `c349c9604719` (ios tree) | 37 m 53 s | start 23.6 / med 23.3 / max 511.1 |
| `real-input:android` | **PASS** | — | `c349c9604719` (android tree) | 38 m 35 s | start 11.3 / med 9.7 / max 275.4 |
| `harness:android:BottomSheet` | **PASS** | 27 tests / 1 suites | `c349c9604719` (android tree) | 3 m 31 s | start 35.6 / med 101.6 / max 136.8 |
| `harness:android:Menu.harness` | stale | 1 failed of 43 tests / 2 suites | 710347cf60c8 (not this tree) | 1 m 33 s | start 6.0 / med 5.5 / max 6.6 |
| `harness:android:Menu.harness%7CContextMenu` | stale | 4 failed of 43 tests / 2 suites | 804f3892612e (not this tree) | 1 m 27 s | start 9.3 / med 7.1 / max 9.3 |
| `harness:android:Menu%7CContextMenu%7CPicker` | stale | 9 failed of 82 tests / 4 suites | d59a02449626 (not this tree) | 2 m 01 s | start 12.1 / med 19.9 / max 26.0 |
| `harness:ios:Menu%7CContextMenu` | stale | 3 failed of 43 tests / 2 suites | d59a02449626 (not this tree) | 1 m 02 s | start 16.1 / med 9.9 / max 16.1 |
| `harness:ios:Menu%7CContextMenu%7CPicker` | stale | 82 tests / 4 suites | 710347cf60c8 (not this tree) | 1 m 36 s | start 25.8 / med 15.6 / max 25.8 |

`need --for review`: satisfied on code tree `c349c9604719`. The four `stale` filtered rows are the red-proof runs on mutated trees.

## Red proofs

- `MenuRowsTest` (3 cases) -> parse drops `subtitle`/`checked`, sections merged into the loose group -> `3 tests completed, 3 failed` (`MenuRowsTest.kt:50`, `:69`, `:93`)
- Menu "draws groups, subtitles and checks" (Android) -> no `supportingText`/`CheckableDropdownMenuItem` + one group for everything -> `expected '(:Grid,List,Rename,Name,Date~,Delete)' to be '(:Grid@Tiles+,List=,…'`
- Menu "draws every row of an untitled group (G9)" (Android) -> one group for everything -> `expected null to deeply equal [ 'AirDrop', 'Mail' ]`
- ContextMenu "builds the rows Menu builds" (Android) -> one group -> `expected '(:Reply,Copy,Pin~,Archive,Mail,Flag,D…' to be '(:Reply,Copy,Pin~),(More:Archive,Mail…'`
- ContextMenu "carries subtitle and checked" (Android) -> rows without them -> `expected '(:Pin,Mute,Flag)' to be '(:Pin@Keep on top+,Mute=),…'`
- Picker "draws the selected row as a selected row" -> `selected = false` -> `expected 'Small,Medium,Large' to be 'Small,Medium+,Large'`
- Menu "opens once, closes once" + "closes when disabled" + "no old state across a remount" (D32) -> `setOpen` transition guard removed -> `expected [ 'events:open', 'events:close', …(2) ] to deeply equal [ 'events:open', 'events:close' ]`
- Menu "draws groups, subtitles and checks", "takes subtitle and checked away…" + ContextMenu "carries subtitle and checked" (iOS) -> `Button` for a checked row, no second `Text`, `UIAction` without `subtitle`/`state` -> `expected 'Grid,List,Rename,(Sort:Name,Date~),(:…' to be 'Grid@Tiles+,…'`, `expected 'Pin,Mute,(Tools:Flag)' to be 'Pin@Keep on top+,…'`
- Menu "takes subtitle and checked away in place" (Android) -> `groupSignature` ignores both fields -> `Menu report for "e2-reset" never matched … "drawn":"(:Grid@Tiles+,…"`
- ContextMenu recycle (`drawn` reset) -> `ContextMenuModel.reset` keeps `drawn` -> `expected '(:Reply,Copy,Pin~),(More:Archive,Mail…' to be '-1'` (and the E2 case read the previous owner's tree)
- ContextMenu G16 arbitration "opens on a hold, never presses the child…" -> no JS cancel at recognition -> `expected 1 to be +0`
- Real-input: not mutated; the existing checks re-run green on the new popups.

## Files changed

- Android: `MenuRows.kt` (popup, groups, rows, check, semantics witness), `HybridNitroUiMenu.kt`,
  `HybridNitroUiContextMenu.kt`, `HybridNitroUiPicker.kt`; test `MenuRowsTest.kt`.
- iOS: `HybridNitroUiMenu.swift`, `HybridNitroUiContextMenu.swift`, `HybridNitroUiPicker.swift` (report field).
- JS/spec: `MenuRows.ts`, `Menu.nitro.ts`, `Picker.nitro.ts`; `nitrogen/generated/**`.
- Tests: `Menu.harness.tsx`, `ContextMenu.harness.tsx`, `Picker.harness.tsx`.
- Docs: `docs/components/{menu,context-menu,picker}.md`, `README.md`, `example/src/readme-examples.tsx`,
  `example/src/stories/Menu.stories.tsx`, `example/src/MenuScreen.tsx`, screenshots, `.changeset/e2-expressive-menus.md`.

## Follow-ups

- Chip/Menu: the Material check glyph is now written out twice (`HybridNitroUiChip.kt`, `MenuRows.kt`); share it once E1 has merged.
- Menu (iOS): a `checked` row is a `Toggle`, which takes no role, so `destructive` is dropped on a checkable row (documented in Limits).
- Menu (Android): the `drawn` witness reads on popup layout; a check flipped while the popup stays open is only seen through `nuiTestMenuProbe`.

## Merge round

Branch `task/E2-merge`, lease `E2merge-1kxry` (maintainer-mac-1). Merged `origin/main` at `4266abe4` with no conflicts, then the docs-only `8a2e2cd0`. Code tree `5c6f2b0b2b32`; `need --for merge` is satisfied.

- **Checked row under a real tap:** `Checked row` (`checked: true`) in `real-input-menu`. Both suites tap it and assert one `select checked`, the popup closing, and the whole echo.
- **Docs:** iOS ContextMenu keeps destructive with checked, while Menu drops it. The "48 dp" claim is removed.
- **Guard: not changed.** With `#available(iOS 16)` removed, Xcode 27 failed: `'subtitle' is only available in iOS 16.0 or newer` on both files. The iOS 16 guard is correct, so the review's iOS 15 premise is wrong.
- **Re-runs, one each:** `check` (bench-baseline-merge child killed, `status: null`, load 136); `harness:android` (known `BottomSheet · 50 cycles`); `real-input:ios` (known `frozen: 1 edits refused`). Excerpts are in `E2/failures/`.

Red proofs:
- `real-input:android -- --control menu` -> `onCheckedChange = { }` -> `✗ a pick of the checked row to reach JS: 3 real taps … rather than "checked"`
- `real-input:ios -- --control menu` -> `set: { _ in }` -> `the real tap on the row "Checked row": 3 real presses … left it at "alpha"`

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1746 tests / 70 suites | `5c6f2b0b2b32` | 2 m 22 s | start 7.5 / med 14.6 / max 21.6 |
| `harness:ios` | **PASS** | 394 tests / 23 suites + isolated 2 tests / 1 suites | `5c6f2b0b2b32` (ios tree) | 9 m 23 s | start 11.0 / med 7.7 / max 17.7 |
| `harness:android` | **PASS** | 443 tests / 23 suites + isolated 2 tests / 1 suites | `5c6f2b0b2b32` (android tree) | 14 m 12 s | start 19.0 / med 13.8 / max 26.3 |
| `real-input:ios` | **PASS** | — | `5c6f2b0b2b32` (ios tree) | 21 m 18 s | start 7.7 / med 7.2 / max 14.2 |
| `real-input:android` | **PASS** | — | `5c6f2b0b2b32` (android tree) | 36 m 14 s | start 8.4 / med 8.6 / max 75.0 |
