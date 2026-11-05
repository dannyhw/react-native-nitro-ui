# Q8 — Material 3 Expressive per component, and everything held back for old RN

**Branch:** `task/Q8-expressive-and-holdbacks` (from `origin/main` at `69be3bc6`) · **Round:** 1 of up to 2 (brief: 1
round plus at most 1 fix round) · **Lease:** none (read-only research, no devices)

Methods note: nothing was built or run. All sources were read-only:
- **material3-android 1.5.0-beta02.** The AAR and POM came from Google's Maven; the Gradle cache holds only 1.4.0 and
  1.5.0-beta01. I read them with `javap -v` and diffed them against 1.4.0 from the cache.
  - Opt-in status is each member's and class's `RuntimeInvisibleAnnotations`.
  - Parameter names come from the Compose compiler's source-information strings (`C(Name)N(params)`), so the
    signatures below carry real names.
  - Dimensions come from the `tokens` classes.
- **`@expo/ui`.** Version 58.0.22 in the main checkout's `node_modules`, plus Expo's public GitHub (`main` and
  `sdk-58`). npm `latest` is **58.0.26**.
- **This repo** at `69be3bc6`, plus ContextMenu on `origin/task/G16-contextmenu` and the local G18 Tooltip worktree.
- **Xcode 27's iPhoneOS SDK** `SwiftUI.swiftinterface`, for the iOS counterparts.
- **npm.** Downloads for the week 2026-10-27 to 11-02, and the registry for Nitro's dist-tags.

Prefixes:
- `m3:` is a class in material3 1.5.0-beta02.
- `expo:` is a path under `@expo/ui`'s `android/src/main/java/expo/modules/ui/` (58.0.22 unless marked).
- `swiftui:` is a line in the interface.
- Android sources are under `android/src/main/java/com/margelo/nitro/nitroui/` and are cited by file name.
- *(reading)* marks a claim I could not check in a source.

## Summary

**Most of Expressive is stable API in 1.5.0-beta02.** Only 15 public members still carry
`@ExperimentalMaterial3ExpressiveApi`: `LoadingIndicator`/`ContainedLoadingIndicator` (and pull-to-refresh's),
`MaterialShapes`, one `SliderDefaults.Thumb` and two deprecated menu-item names. `ButtonGroup`, `ToggleButton`, `SplitButtonLayout`, the
Expressive menus, the wavy indicators, `ScrollField` and `MaterialExpressiveTheme` need no opt-in. None of them is in
1.4.0, so every component pass waits for X18.

**On its own, X18's theme changes motion only.** `MaterialExpressiveTheme` is `MaterialTheme` plus
`MotionScheme.expressive()` plus a flag that no beta02 component reads, and X18 keeps our colours, shapes and type. So
springs change and static screenshots should not (Appendix B).

**1.5 deprecates calls we make**, which X18 must migrate:
- the value-based `Slider`;
- `rememberModalBottomSheetState`;
- `ListItem(headlineContent…)`.

G17's `DockedSearchBar` and its old `InputField` are deprecated too. The replacement `InputField` takes
`keyboardOptions`, which lifts D38's "SearchField has no keyboard props".

**Per component (Appendix A):**
- Button gains press-morph `shapes` and the official 32/40/56 dp sizes.
- SegmentedControl becomes connected `ToggleButton`s.
- Menu and ContextMenu move to `DropdownMenuPopup` with groups and group labels; Picker rows become
  `SelectableDropdownMenuItem`.
- Progress gains LoadingIndicator and wavy; Chip gains `ChipShapes`.
- Picker and DatePicker get a real Android wheel (`ScrollField`, `TimeScroll`).
- Switch, Checkbox, TextField, Tooltip and Host change through the theme only.

**New (Appendix C):**
1. ButtonGroup, on iOS `ControlGroup`.
2. SplitButton, as Menu's `primaryAction` on Android.
3. LoadingIndicator, as a Progress variant.
4. Android wheels.

IconButton waits on question A. FAB, FAB menu, toolbars and navigation chrome are skipped. Expo UI 58.0.26 has none
of ButtonGroup, checkable menu rows, button shapes or sizes, or `ScrollField`.

**Held back (Appendix D):** beyond X18's list:
- the RN 0.84–0.86 branch of `cpp/NitroUiPropsCompat.hpp`;
- seven workarounds for material3 1.4;
- stale docs and two dead branches.

No iOS `#available` is below RN 0.88's 15.1 floor, and nothing in Host or sizing serves an old RN.

**Order (Appendix E):** X18 first. Then, one machine each:
1. buttons | menus;
2. ButtonGroup and SplitButton | Progress and Slider;
3. wheels | Dialog/BottomSheet and SearchField v2.

The compat-header lift and ButtonGroup's iOS check can run beside X18.

## Gates

No code changed. `node scripts/gate.mjs table` (Node 24) prints `table: nothing recorded yet - run a gate first.` for
code tree `2fdf4edd941e`. This commit is docs-only, so that tree does not change. The brief asks for no gate.

`need --for review`: `need: 3 gate(s) missing for review: check, harness:ios, harness:android`. That is expected and
deliberate: the task is read-only, and nothing in the code tree changed.

## Red proofs

None. No test or gate was added.

## Files changed

- `docs/tasks/Q8-expressive-and-holdbacks.report.md` (new): this file.

## Follow-ups

- X18: expect no README screenshot to change from the theme alone (Appendix B). Retake only what a pass changes.
- X18: under expressive motion the sheet springs. Check that BottomSheet's detent reporting never reports a
  mid-spring offset as a detent.
- G17: if it merges before X18, X18 moves it to `SearchBar(state, inputField)`. Otherwise G17 builds on the new API
  after rebasing.
- The bench app should already resolve material3 1.5.0-beta01 through `@expo/ui`'s pin *(inferred from Gradle's
  highest-version rule, not from a dependency report)*. X18 can confirm it.
- `docs/research/setup-decisions.md` still states the RN 0.86 floor. AGENTS.md forbids editing it, so the orchestrator
  should annotate it.
- `example/android/gradle.properties` `newArchEnabled=true`: check it against RN 0.88's template.
- `docs/tasks/FOLLOWUPS.md:18` still carries a stale "(D8)" tag.
- The N1 props workaround stays until react-native-nitro-modules 0.37.2 is stable. `latest` was 0.37.1 on 2026-11-03.

## Questions for orchestrator

- **A. Icons on Android (owner: an API convention that several components share).**
  - The problem:
    - `systemImage` is an SF Symbol, and Android ignores it on Button, Menu and Chip.
    - IconButton, icon-only ButtonGroup items, menu row icons and any FAB need an Android icon.
    - The library ships no icon set. Chip builds its one glyph from Material's path data (`HybridNitroUiChip.kt:175-181`).
  - Options:
    - (a) `androidIcon?: string` names a drawable resource the app ships, usually an XML vector exported from Material
      Symbols. Native looks it up with `getIdentifier`. Nothing is bundled.
    - (b) Bundle a Material Symbols font and take a symbol name.
    - (c) Leave icons out, so components that need them stay text-only on Android.
  - **Recommend (a).** It is what an Android app already does with its own icons, it adds no size to the library, and
    it pairs with `systemImage` as one prop per platform.
  - Nothing in passes 1–3 is blocked by this question. IconButton (rank 6) is.
- **Decisions already taken in this report.** The orchestrator can override any of them; none needs the owner.
  - SegmentedControl draws as connected toggle buttons on Android, with no API change (A3).
  - Button `size` maps to M3's XS/S/M tokens, and a new `shape: 'round' | 'square'` works on both platforms (A2).
  - Menu sections become Material groups, and two new optional props come with them: `subtitle` and `checked` per
    action (A5).
  - Picker keeps the exposed dropdown, because Expressive did not replace it. Only its rows and container change
    (A7).
  - LoadingIndicator is `Progress variant="loading"` and wavy is `appearance="wavy"`; neither is a new component (A10).
  - SplitButton is Menu's `primaryAction` on Android, not a new component (C2).
  - FAB, FAB menu, floating toolbars and navigation chrome are skipped (Appendix C).

---

## Appendix A — Each Android control and its Expressive counterpart

"Theme alone" is what X18's theme switch changes in that control with no code change (Appendix B explains why).

Effort:
- **0** means X18's gates only;
- **S** is half a round;
- **M** is one round;
- **L** is more than a round, or a spike.

| # | Control | Android today | Expressive counterpart in 1.5.0-beta02 (opt-in) | Theme alone | Public API change | Risk | Effort |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | Host | `NitroUiTheme` → `MaterialTheme(colorScheme)` (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:1447-1451`) | `MaterialExpressiveTheme(colorScheme, motionScheme, shapes, typography, content)` (stable) | — | X18's app-level opt-out only | low | X18 |
| 2 | Button | Five M3 buttons through the `shape` overload. Hand-rolled padding and type per size (`HybridNitroUiButton.kt:326-344`), plus `heightIn(min = 48.dp)` for large (`:418`) | The same five through the `shapes: ButtonShapes` overload. `ButtonDefaults.shapesFor(buttonHeight)` morphs round to square on press, and `contentPaddingFor`/`textStyleFor`/`iconSizeFor(buttonHeight)` follow the height. Heights: XS 32, S 40, M 56, L 96, XL 136 dp (`m3:ButtonXSmallTokens`…`ButtonXLargeTokens`). Also `ButtonDefaults.squareShape`. All stable | none visible: motion only drives the `shapes` morph | `size` keeps its three names, mapped to XS/S/M. New `shape: 'round' \| 'square'` (iOS `.buttonBorderShape`, iOS 15) | low. Boxes move (token arithmetic, to measure): `small` 40 → 32 dp, `large` about 50 → 56 dp, and `medium` stays 40 dp but loses 8 dp of side padding per side. Fallbacks and screenshots change, and Menu's trigger follows through the shared helpers | S |
| 3 | SegmentedControl | `SingleChoiceSegmentedButtonRow` + `SegmentedButton(selected, onClick, shape = itemShape, …, icon = {})` (`HybridNitroUiSegmentedControl.kt:394-439`). `SegmentedButton` is unchanged and not deprecated in 1.5 | A connected button group: a `Row(spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween))` (2 dp) of `ToggleButton(checked, onCheckedChange, modifier, buttonSize, enabled, icon, shapes = ButtonGroupDefaults.connectedLeading/Middle/TrailingButtonShapes(shape, pressedShape, checkedShape), colors, …)`. 40 dp tall (`m3:ConnectedButtonGroupSmallTokens`), the same height as today. Stable. That connected groups replace segmented buttons in Expressive is *(reading)* | none (`icon = {}` hides the animated check) | none. `tintColor` → `ToggleButtonDefaults.colors(…)`'s checked container | medium. `ToggleButton` is toggleable, not selectable, so `Role.RadioButton` + `selected` semantics must keep TalkBack's "1 of 3". The pixel-probe harness and today's width rule must carry over | M |
| 4 | Chip | `FilterChip`/`AssistChip` (`HybridNitroUiChip.kt:316-325`), with an always-present leading slot that stops 1.4's width spring (`:211-224`) | `FilterChip(selected, onClick, label, shapes: ChipShapes, …, horizontalArrangement, contentPadding, …)`: `FilterChipDefaults.shapes(shape, selectedShape, pressedShape)` gives a selected chip its own corner. Also `tonalFilterChipColors()`. Our named-argument call already resolves to the new overload, because the old one is `HIDDEN`. Stable | ChipKt reads the motion scheme (the check-mark spring the slot suppresses) | none | low–medium. The slot reasoning names 1.4's `AnimatingChipContent`, so re-measure the toggle on 1.5 | S |
| 5 | Menu | `ExposedDropdownMenuBox` + `menuAnchor` + `ExposedDropdownMenu` + `DropdownMenuItem`, with `HorizontalDivider` between sections (`HybridNitroUiMenu.kt:638-758`) | `DropdownMenuPopup(expanded, onDismissRequest, modifier, popupPositionProvider = MenuDefaults.rememberDropdownMenuPopupPositionProvider(dropdownMenuAnchorPosition, offset), properties, content)`. Each section is a `DropdownMenuGroup(shapes = MenuDefaults.groupShape(index, count), …)` spaced by `MenuDefaults.GroupSpacing` (no dividers), titled with `MenuDefaults.DropdownMenuGroupLabel`. Rows are `DropdownMenuItem(onClick, text, shape = MenuDefaults.itemShape(index, count), leadingIcon, trailingContent, supportingText, enabled, colors, …)`, or `CheckableDropdownMenuItem(checked, onCheckedChange, text, shapes, …)`. Stable. 1.5 has **no** submenu composable | popup open/close (MenuKt) | none needed. Add per-action `subtitle` (Android `supportingText`; iOS a second `Text` in the row *(reading)*) and `checked` (Android `CheckableDropdownMenuItem`; iOS a `Toggle` in the `Menu` *(reading)*), which lifts "No checkmarks". `primaryAction` on Android → C2 | medium–high. Leaving `ExposedDropdownMenuBox` redoes G7b's anchoring work (`HybridNitroUiMenu.kt:617-622` reasons from 1.4.0) and H2b's popups in a Host | M–L |
| 6 | ContextMenu (G16, in merge) | `DropdownMenu` anchored at the press point through a zero-size offset `Box` (`origin/task/G16-contextmenu:…/HybridNitroUiContextMenu.kt:355-366`) | The same `DropdownMenuPopup` + groups as Menu, sharing one section/row composable with it | popup motion | none | medium: the anchor is a point | S, after Menu |
| 7 | Picker | `ExposedDropdownMenuBox` + a read-only `OutlinedTextField` + `ExposedDropdownMenu` + `DropdownMenuItem`. The selected row is semantics-only (`HybridNitroUiPicker.kt:844-847`). `wheel` is iOS-only | `ExposedDropdownMenu` is now a top-level extension; the member is `HIDDEN`, so source still compiles. The box no longer needs `@OptIn(ExperimentalMaterial3Api)`. Rows become `SelectableDropdownMenuItem(selected, onClick, text, shapes, selectedLeadingIcon, …)`. The container takes `MenuDefaults.standaloneGroupShape`/`groupStandardContainerColor`, since the exposed dropdown has no Expressive replacement. **`wheel` → `ScrollField(state = rememberScrollFieldState(itemCount, index), contentDescription, modifier, enabled, colors, fieldAccessibilityDescription, interactionSource, field)`**, a real wheel. Stable | popup motion | none. `wheel` stops being iOS-only (its Limits line goes) | medium. `ScrollField` is new in this beta: its height, semantics and settle are unmeasured, and the value commits on settle | M |
| 8 | DatePicker | `DatePicker`, `DatePickerDialog`, `TimePicker`, `TimePickerDialog` | `TimePicker(state, shapes, modifier, colors, layoutType)`. **`TimePickerDisplayMode.Scroll` and `TimeScroll(state, shapes, [toggle,] modifier, colors)`, a time wheel.** `VibrantTimePickerDialog(…)` + `TimePickerDialogDefaults.ScrollDisplayModeToggle`. `DatePicker` gains only `focusRequester`. Stable | calendar and clock motion | `variant="wheel"` with `mode="time"` becomes a real Android wheel. A date wheel stays the inline calendar (documented) | low–medium | S–M |
| 9 | Slider | The value overload `Slider(value, onValueChange, …, valueRange, steps, onValueChangeFinished, colors)` (`HybridNitroUiSlider.kt:575-585`), **deprecated in 1.5** ("Use the Slider overload that accepts SliderState…") | `Slider(state = rememberSliderState(value, steps, trackRange), onValueChange, modifier, enabled, onValueChangeFinished, colors, interactionSource, thumb, track)`, stable (an opt-in in 1.4). Also `SliderDefaults.CenteredTrack`, `VerticalSlider(…, topToBottom, …)`, `SliderState.isDragging` | none (SliderKt reads no motion) | none. `onSlidingStart` can then come from a real drag start instead of the first value change (a Limit) | medium. `SliderState` owns the value, so a JS write must go through `state.value` without being reported back | S (the move is X18's) |
| 10 | Progress | `LinearProgressIndicator` / `CircularProgressIndicator`, unchanged in 1.5 | `LinearWavyProgressIndicator(progress, modifier, color, trackColor, stroke, trackStroke, gapSize, stopSize, amplitude, wavelength, waveSpeed)` and `CircularWavyProgressIndicator(…)` (+ indeterminate), stable. `LoadingIndicator(progress?, modifier, color, polygons)` and `ContainedLoadingIndicator(progress?, modifier, containerColor, indicatorColor, containerShape, polygons)` **still `@ExperimentalMaterial3ExpressiveApi`**. Boxes: wavy bar 10 dp (flat 4), wavy ring 48 dp (flat 40), loading 48 dp around a 38 dp shape | none | `appearance: 'flat' \| 'wavy'` (Android; iOS draws flat) and `variant: 'loading'` with `contained` (C3) | medium. Experimental API can still change at 1.5.0 (*(reading)* AndroidX's beta API freeze excludes it), and each variant has a new box | M |
| 11 | Switch | `Switch(checked, onCheckedChange, modifier, thumbContent, enabled, colors, interactionSource)`, unchanged | none | thumb motion | none | low | 0 |
| 12 | Checkbox | `Checkbox` / `TriStateCheckbox`, unchanged. `StyleableCheckbox(…, style: CheckboxStyle)` is new, but it is the Styles API, not Expressive | none | check motion | none | low | 0 |
| 13 | TextField | Undecorated `BasicTextField(TextFieldState)` | none | none: no motion, and the scheme is unchanged | none | low. Expo forces `MotionScheme.standard()` on its *decorated* field against a label jiggle (`expo:textfield/TextField.kt:279`); ours has no label | 0 |
| 14 | SearchField (G17, in build on 1.4) | The design: `DockedSearchBar` + `SearchBarDefaults.InputField(TextFieldState, onSearch, expanded, onExpandedChange, …)`. **Both deprecated in 1.5** ("Use SearchBar with SearchBarState…") | `SearchBar(state = rememberSearchBarState(), inputField = { SearchBarDefaults.InputField(textFieldState, searchBarState, onSearch, modifier, enabled, readOnly, textStyle, placeholder, leadingIcon, trailingIcon, prefix, suffix, inputTransformation, outputTransformation, scrollState, shape, colors, interactionSource, **keyboardOptions**, lineLimits) }, …)`. Stable | expand/collapse motion (held collapsed) | v2 may add `keyboardType`/`autoCapitalize`/`autoCorrect` on both platforms (D38 item 2 was held back by 1.4) | low | S |
| 15 | Tooltip (G18, in build) | `TooltipBox` + `PlainTooltip`/`RichTooltip`, `TooltipAnchorPosition.Above/Below` | No Expressive counterpart. Still `@ExperimentalMaterial3Api`, the same in 1.4 and 1.5. `Left/Right/Start/End` positions exist in both | show/hide motion | none (sides are a later option) | low | 0 |
| 16 | AlertDialog / ConfirmationDialog | `AlertDialog`. The confirmation sheet is a `ModalBottomSheet` of `ListItem(headlineContent, …)` rows, hand-coloured when disabled (`HybridNitroUiDialog.kt:505-526`). `rememberModalBottomSheetState` (`:460`) | `AlertDialog` is unchanged. Rows: `ListItem(onClick, modifier, enabled, …, content)` (interactive, with a real disabled state) or the Expressive `SegmentedListItem(onClick, shapes = ListItemDefaults.segmentedShapes(index, count), …)`. The sheet state moves to `rememberBottomSheetState(initialValue, enabledValues, confirmValueChange)`. The old `ListItem` and sheet-state calls are **deprecated** | sheet and list motion. AlertDialog: none | none | low | S (the migration is X18's) |
| 17 | BottomSheet | `ModalBottomSheet` + `rememberModalBottomSheetState(skipPartiallyExpanded, confirmValueChange)` (`HybridNitroUiBottomSheet.kt:543`), **deprecated** | `rememberBottomSheetState(initialValue = Hidden, enabledValues, confirmValueChange)` (still `@ExperimentalMaterial3Api`). No Expressive sheet. 1.5 adds predictive-back scaling and a non-modal `BottomSheet` | sheet spring | none | low–medium: detent reporting under a spring (Follow-ups) | S (X18) |

## Appendix B — What X18 changes before any component pass

**The theme.** `MaterialExpressiveTheme` calls `MaterialTheme(colorScheme, motionScheme, shapes, typography)` and
provides `LocalUsingExpressiveTheme = true` (`m3:MaterialThemeKt`). Its defaults are `expressiveLightColorScheme()`
and `MotionScheme.expressive()`; shapes and typography default to the baseline ones.

In beta02 **no class except `MaterialThemeKt` reads `LocalUsingExpressiveTheme`** (constant-pool search). X18 keeps
our dynamic/default colour schemes. So the only theme-level difference is the motion scheme.

These classes reference the motion scheme:
- `ButtonKt`, `CheckboxKt`, `ChipKt`, `DatePickerKt`, `IconButtonKt`, `ListItemKt`, `MenuKt`, `ModalBottomSheetKt`;
- `SearchBarKt`, `SegmentedButtonKt`, `SwitchKt`, `TimePickerKt`, `ToggleButtonKt`, `TooltipKt`;
- the FAB, toolbar and navigation classes.

`SliderKt`, `ProgressIndicatorKt` and `AlertDialogKt` do not, and TextField is foundation-only. The opt-out is
`MaterialTheme(colorScheme, motionScheme = MotionScheme.standard())`.

**Deprecations X18 meets** (X18's brief: "Fix every deprecation or behaviour change the bump surfaces"):

| Call | Where | Replacement |
| --- | --- | --- |
| value `Slider(value, onValueChange, …)` | `HybridNitroUiSlider.kt:575` | `Slider(state = rememberSliderState(value, steps, trackRange), onValueChange, …)` |
| `rememberModalBottomSheetState(…)` | `HybridNitroUiBottomSheet.kt:543`, `HybridNitroUiDialog.kt:460` | `rememberBottomSheetState(initialValue = SheetValue.Hidden, enabledValues, confirmValueChange)` (the deprecation's own `replaceWith`) |
| `ListItem(headlineContent, …)` | `HybridNitroUiDialog.kt:518` | `ListItem(modifier, …, content)`, or the `onClick` overload with `enabled` |
| `ExposedDropdownMenuBoxScope.ExposedDropdownMenu` member (`HIDDEN`) | `HybridNitroUiMenu.kt:688`, `HybridNitroUiPicker.kt:823` | the top-level extension, which is source-compatible. Nothing to change |
| `@OptIn(ExperimentalMaterial3Api)` held only for `ExposedDropdownMenuBox` | Menu, Picker | no longer needed |
| G17: `DockedSearchBar`, `SearchBarDefaults.InputField(…, expanded, onExpandedChange, …)` | G17's branch | `SearchBar(state, inputField)` + `InputField(textFieldState, searchBarState, …)` |

`FilterChip`, `AssistChip` and `SegmentedButton` keep compiling: the old overloads are `HIDDEN` or still current.

## Appendix C — New components and capabilities Expressive makes possible

Scored as in Q5/Q7: 1 (poor) to 5 (strong). In "Risk / effort", 5 means cheap and safe. Demand is npm weekly
downloads, 2026-10-27 to 11-02.

| # | Candidate | Native counterpart (Android / iOS) | Fit | Demand | Risk / effort, reuse | Expo UI 58.0.26 | Platform call |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | **ButtonGroup**: a row of actions, standard or connected, with overflow into a menu | **4**: `ButtonGroup(overflowIndicator, modifier, expandedRatio, horizontalArrangement, verticalAlignment) { clickableItem(onClick, label, icon, weight, enabled); toggleableItem(…) }` + `ButtonGroupDefaults.OverflowIndicator(menuState, …)`, connected shapes (stable) / `ControlGroup` (iOS 15, `swiftui:19560`) | **4**: data items, inline, measured. Overflow reuses the menus pass's popup | **2**: no package leads (Paper's `SegmentedButtons` is the nearest) | **3**: a new view. How iOS draws `ControlGroup` outside a toolbar is unmeasured, so check that first (E, pass 0). Icon-only items need question A | none | both native |
| 2 | **SplitButton** = Menu's `primaryAction` on Android | **5**: `SplitButtonLayout(leadingButton, trailingButton, modifier, spacing)` + `SplitButtonDefaults.{,Tonal,Outlined,Elevated}LeadingButton(onClick, …)` / `…TrailingButton(checked, onCheckedChange, …)` (stable) / `Menu(primaryAction:)`, already built | **5**: Menu's model unchanged | **2** | **4**: the trailing button opens the menus pass's popup, and the chevron is built like Chip's check. `variant="text"` has no split button, so it maps to outlined | `SplitButtonLayout`, filled only (58.0.26) | both native. Lifts "`primaryAction` is iOS-only" |
| 3 | **LoadingIndicator** = `Progress variant="loading"` | **4**: `LoadingIndicator` / `ContainedLoadingIndicator` (**experimental**) / `ProgressView()` circular | **5** | **3**: react-native-indicators 33 k, loading-spinner-overlay 20 k | **3**: experimental API, 48 dp box | yes | both native |
| 4 | **Android wheels**: Picker `wheel`, DatePicker time `wheel` | **4**: `ScrollField`, `TimeScroll` (stable) / `.wheel`, already built | **5**: Picker's model; commit on settle | **3**: @quidone/react-native-wheel-picker 118 k, wheely 21 k, wheel-pick 9 k | **3**: new beta composables, unmeasured | none (no match in 58.0.22's Kotlin) | both native. The date wheel stays a calendar on Android |
| 5 | Wavy progress = `Progress appearance="wavy"` | **3**: wavy indicators (stable) / none | **5** | **1** | **4** | yes | an Android-only option; iOS draws flat |
| 6 | IconButton | **4**: `IconButton(onClick, shapes, …)`, XS–XL sizes, narrow/wide widths / `Button` + `Label` `.iconOnly` | **5** | **3** | blocked on question A | classic only | both native, after A |
| 7 | ToggleButton | **3**: `ToggleButton` family / `Toggle(.button)`, which Chip's filter kind already is | **5** | **1** | **4** | yes (filled only) | not standalone: it ships as ButtonGroup's `toggleableItem` and SegmentedControl's segments |
| 8 | FAB, FAB menu, `ToggleFloatingActionButton` | **1**: Android only / none | **3** | **1**: floating-action 7 k, action-button 6 k | **3** | FAB, no menu | skip (Q7's verdict). On iOS it would be a layout, not a control |
| 9 | Floating toolbar | **2**: `Horizontal/VerticalFloatingToolbar` / toolbars belong to a navigation container | **2**: an overlay with icons | **1** | **2** | horizontal only | skip for now |
| 10 | Vertical and centred slider | **2**: `VerticalSlider`, `CenteredTrack` / none | **5** | **1** | **4** | `VerticalSlider` | skip unless asked; a Slider option |
| 11 | Expressive lists (`SegmentedListItem`, interactive `ListItem`) | **4** / `List` | **1**: Q7's Form/List architecture spike | **3** | **1** | `ListItem` | used inside ConfirmationDialog only (A16) |
| 12 | App bars with search, flexible app bars, `ShortNavigationBar`, `WideNavigationRail`, carousel | — | **1** | — | — | partly | skip: navigation libraries and RN-content containers |

**Going past Expo.** Expo's Expressive set is LoadingIndicator, wavy, ToggleButton, a horizontal toolbar,
VerticalSlider, the menus and a filled `SplitButtonLayout`. Its `Host` already wraps `MaterialExpressiveTheme`
(`expo:HostView.kt:171`).

It has none of the following, and passes 1–3 build each of them:
- ButtonGroup and connected groups;
- Expressive button shapes and sizes;
- `CheckableDropdownMenuItem`;
- `ScrollField` / `TimeScroll` wheels;
- tonal, outlined and elevated split buttons.

Expo's components are Compose-only, so they also lack iOS halves, which ours have.

## Appendix D — Everything held back for an older RN, SDK or library version

RN 0.88 requires iOS **15.1** (`min_ios_version_supported`), minSdk **24**, compileSdk **37** and AGP 9.2.1. Expo
SDK 58 requires iOS 16.4 (D39 keeps RN's floor). The example app is already on RN 0.88.0, and the bench app on RN
0.88.0 with Expo 58.

Tags:
- **X18**: in X18's brief.
- **lift**: lift it, outside X18.
- **pass**: lifted by the component pass named.
- **keep**: not held back.

| Tag | What | Where | What lifting it buys |
| --- | --- | --- | --- |
| X18 | Compose BOM pinned at 2026.06.01 (Compose 1.11.4, material3 1.4.0) for RN 0.86 (D8) | `android/build.gradle:115-116` | material3 1.5 and Expressive |
| X18 | Library fallback `compileSdkVersion: 36` (also the bench probe) | `android/build.gradle:13`, `bench/modules/bench-probe/android/build.gradle:11` | matches RN 0.88's 37 |
| X18 | Peer `react-native >= 0.86`; README requirements and the "RN 0.86 on iOS" limit | `README.md:69-71`, `README.md:825-827` | the floor as D39 states it |
| X18 | Smoke matrix's RN 0.86.3 row, its D8 comment and its iOS exclude | `.github/workflows/smoke.yml:165-174`, `scripts/smoke/rn-cli.sh:2-3` | a shorter matrix |
| X18 | CONTRIBUTING smoke examples and the 0.86.3 results row and paragraph | `CONTRIBUTING.md:1085-1086`, `CONTRIBUTING.md:1137-1144` | — |
| X18 | Deprecations the bump surfaces (Appendix B) | Slider, BottomSheet, Dialog | no deprecated calls |
| lift | The RN 0.84–0.86 branch of the props-compat header (feature-flag include and the `#elif`). The rest stays: it waits for a stable Nitro 0.37.2, and npm `latest` is still 0.37.1 | `cpp/NitroUiPropsCompat.hpp:7-10`, `cpp/NitroUiPropsCompat.hpp:19-25` | one unconditional call. Shipped C++, so it needs `check` plus Android's base-props harness. It can run beside X18 |
| lift | Docs reasoning from the 0.86 floor | `docs/upstream.md:508-510`, `docs/upstream.md:536-540`, `docs/ci-runner-images.md:75-80`, `docs/tasks/FOLLOWUPS.md:81` (last two sentences) | accurate docs. X18's "other RN < 0.88 notes" may take these |
| lift | Dead branches: `compileSdk >= 37` naming, and `SDK_INT >= N` when minSdk is 24 | `scripts/doctor.mjs:399-400`, `bench/modules/bench-probe/android/src/main/java/com/margelo/nitro/benchprobe/HybridBenchProbe.kt:276` | trivial; a tooling sweep |
| pass (Dialog) | Disabled action rows hand-coloured: "M3 1.4's `ListItem` has no `enabled`" | `HybridNitroUiDialog.kt:508-510` | a real disabled state, ripple and semantics |
| pass (menus) | Picker's selected row is semantics-only: "Material 1.4's `DropdownMenuItem` has no `selected`" | `HybridNitroUiPicker.kt:844-847`, `docs/components/picker.md:261-264` | Material's selected row |
| pass (menus) | `menuAnchor` kept on reasoning from "this Material version (1.4.0)" | `HybridNitroUiMenu.kt:617-622`, `docs/components/host.md:279-280` | moot once Menu uses `DropdownMenuPopup`; otherwise re-verify |
| pass (buttons) | `SegmentedButton` overload chosen around 1.4's deprecated 11-parameter one | `HybridNitroUiSegmentedControl.kt:428-431` | moot after A3 |
| pass (buttons) | Chip's always-present leading slot, against 1.4's `AnimatingChipContent` width spring | `HybridNitroUiChip.kt:211-224` | re-measure on 1.5; drop it if the spring is gone |
| pass (Slider) | The state-based `Slider` was `@ExperimentalMaterial3Api` in 1.4, so `onSlidingStart` is inferred | `HybridNitroUiSlider.kt:575-585` | a real drag start |
| pass (SearchField v2) | "v1 has no keyboard props", because 1.4's `InputField` took no `KeyboardOptions` | D38 item 2 | keyboard props on both platforms |
| lift | Docs and comments that name 1.4.0 or Compose 1.11.4 | `HybridNitroUiCheckbox.kt:420`, `docs/components/picker.md:77`, `docs/components/picker.md:274`, `docs/architecture/core.md:283-285` | accurate. Each pass fixes the ones in its own files |
| keep | iOS `#available` for 16.0 / 16.4 / 17.4, with fallbacks for 15.1–16.3 | e.g. `ios/core/NitroSwiftUIHost.swift:171`, and the sweep's list (BottomSheet detents, Menu `.menuStyle`, TextField sizing) | not held back: RN 0.88 still supports iOS 15.1 (D39 item 4) |
| keep | `SDK_INT >= S` for dynamic colour | `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:1535` | API 31 is above minSdk 24 |
| keep | minSdk 24 and the podspec's `min_ios_version_supported` | `android/build.gradle:12`, `NitroUi.podspec:13` | already RN 0.88's |
| keep | Nitro `^0.37.1` everywhere, and nitrogen's generated `REACT_NATIVE_VERSION_MINOR` guards | `package.json` | no old-RN reason. They move with N1 |
| keep | `docs/research/*` stating the 0.86 floor | `docs/research/setup-decisions.md` | historical, and not ours to edit (Follow-ups) |

Nothing in the sizing engine, the Host or `src/` branches on an RN version.

## Appendix E — Build order

Every component pass needs material3 1.5, so all of them wait for **X18 to merge**. Two machines, at most two
device tasks each (D13). Each pass retakes the Android README screenshots of what it changes.

**Pass 0: now, beside X18.**
- X18 itself.
- G17 SearchField and G18 Tooltip, already in flight. G17 lands on the new SearchBar API, through X18 or its own
  rebase (Follow-ups).
- The compat-header lift: C++ only, and it shares no files with X18.
- ButtonGroup's iOS check. It is iOS-only and needs no material3: one `ControlGroup` of three buttons in plain
  content, one screenshot, and its sizing measured. Go if it draws as a connected row on iOS 15–27; otherwise iOS
  falls back to a row of bordered `Button`s (D38 item 1).

**Pass 1: after X18. The two lanes share no file.**
- **Machine A — buttons.** Button (A2), and Menu's trigger with it, through the shared helpers. SegmentedControl → connected
  `ToggleButton`s (A3). Chip `shapes` (A4). These three share the `ToggleButton`/`ButtonGroupDefaults` code and the
  size tokens.
- **Machine B — menus.** Menu (A5), ContextMenu (A6, once G16 has merged) and Picker's rows and container (A7). They
  share one popup, group and row composable.

**Pass 2.**
- **A — ButtonGroup** (C1). It reuses pass 1's connected shapes and the menus pass's popup for overflow.
- **B — SplitButton** (C2, Menu's `primaryAction` on Android). It needs both pass-1 lanes. Then Progress `loading`
  and `wavy` (A10), and Slider's real drag start (A9). Progress and Slider share nothing with the rest, so either
  machine can take them as soon as X18 lands.

**Pass 3.**
- **A — wheels.** Picker `wheel` (`ScrollField`) and DatePicker's time wheel (`TimeScroll`) share the settle and
  commit code. D38's Picker `radio` also edits Picker, so it goes on this machine before or after, never beside.
- **B — the rest.** ConfirmationDialog rows → `SegmentedListItem` (A16). SearchField v2 keyboard props, after G17.
  Stepper's Android half: icon buttons, after pass 1 and question A.

Switch, Checkbox, TextField, Tooltip and Host need nothing beyond X18's gates.

## Appendix F — Method notes

- Opt-in counts are for `androidx.compose.material3.*` members and classes in beta02. The only opt-in annotations in
  the jar are `ExperimentalMaterial3Api` and `ExperimentalMaterial3ExpressiveApi`.
- 1.4.0 has **zero** members with the Expressive annotation, and none of `ButtonGroupKt`, `SplitButtonKt`,
  `ToggleButtonKt`, `LoadingIndicatorKt`, `FloatingToolbarKt`, `FloatingActionButtonMenuKt` or
  `WavyProgressIndicatorKt`. Expressive is absent from the version we build on, not just experimental in it.
- beta02 depends on Compose **1.12.0** (its POM), matching D39's "Compose 1.12+".
- Expo UI pins `material3` 1.5.0-beta01 with no Compose BOM (its `android/build.gradle`, read in the main checkout's
  `node_modules`), on 58.0.22, `main` and `sdk-58` alike. Its menus (expo/expo#52598) and `SplitButtonLayout` (#52464)
  shipped in 58.0.26.
