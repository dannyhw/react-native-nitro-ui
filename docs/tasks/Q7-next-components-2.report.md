# Q7 — The next components after ContextMenu, and their designs

**Branch:** `task/Q7-next-components-2` (from `origin/main` at `cd96030d`) · **Round:** 1 of up to 2 (brief: 1 round
plus at most 1 fix round) · **Lease:** none (research and design only, no devices)

Methods note: nothing was built or run. Sources, all read-only:
- this repo at `cd96030d`, plus the Checkbox and ContextMenu docs on `origin/task/G15-checkbox` and
  `origin/task/G16-contextmenu` (not on `main` yet);
- Xcode 27's iPhoneOS 27.1 SDK: `SwiftUI.swiftinterface`, `TipKit.swiftinterface` and UIKit's `Headers/`;
- `javap` on `material3-android` 1.4.0 from the Gradle cache (the version BOM 2026.06.01 resolves to);
- `@expo/ui` 58.0.22 in the main checkout's `node_modules` (no local reference clone of Expo was found);
- npm's public downloads API, week 2026-10-27 to 11-02.

Prefixes: `swiftui:` and `tipkit:` are line numbers in those interfaces, `uikit:` is a header in UIKit's `Headers/`,
`m3:` is a class in material3 1.4.0, `expo-ui:` is a path in `@expo/ui`. A claim I could not check in a source is
marked *(reading)*.

## Summary

**Ranked list** (Appendix A has the scores):

1. **SearchField.** A real control on both platforms: UIKit `UISearchTextField` and Material 3's search-bar input
   field. Both are text fields that TextField already drives, so the handshake, the IME guard, `maxLength` and focus
   are reused.
2. **Tooltip.** An anchored tip with a message, an optional title and up to two actions, presented by the app.
   Material 3 `PlainTooltip`/`RichTooltip` on Android; a UIKit popover on iOS, which has no tooltip.
3. **Popover** with React Native content. A real popover on iOS. Android has none, so it would be a Material surface
   in a popup. Spike first.
4. **Picker `variant="radio"`.** Material 3 radio rows on Android; iOS falls back to `menu`.
5. **Stepper.** SwiftUI `Stepper`; on Android, composed from Material 3 icon buttons if the owner allows that
   (question A).

After those: Toast/Snackbar (question A), Gauge, ColorPicker, Collapsible, RangeSlider, SwipeActions,
Form/List/Section and multi-select segmented. Rating, Badge, Divider, top Tabs and FAB are skipped.

**Order.** SearchField and Tooltip are built now, one per machine. Neither depends on G15, G16 or the other. Picker
`radio` goes to whichever machine frees up first, Stepper waits for question A, and the Popover spike starts once
Tooltip has merged.

**SearchField (Appendix B).** It gets its own Hybrid View because declared fallbacks are keyed by component. That
gives it an exact first frame, 56 dp on Android and a measured iOS height, and it shares TextField's model and
delegate code. Android composes `DockedSearchBar` around `SearchBarDefaults.InputField(TextFieldState, …)`, held
collapsed. M3's search input takes no keyboard options, so v1 has no `keyboardType`, `autoCapitalize` or
`autoCorrect` on either platform. No spike, but the build checks three things first.

**Tooltip (Appendix C).** The native view has **no children**. The wrapper is a plain React Native `View` around the
anchor, and the native view fills it absolutely, behind the children, and never takes a touch. Its box *is* the
anchor:
- iOS uses it as the popover's `sourceView`, through DatePicker's popover code and Dialog's presenter;
- Android uses it as the content of `TooltipBox`.

So there is no children mechanism, no gesture arbitration and no sizing. It is controlled the way Dialog is, and it
stays up until it is dismissed, on both platforms. No spike, but three checks can stop the build early.

**Spike.** Only Popover needs one (Appendix F).

## Gates

No code changed. `node scripts/gate.mjs table` (Node 24) prints `table: nothing recorded yet - run a gate first.` for
code tree `7598adaee392` at `cd96030`. This commit is docs-only, so the code tree stays the same. The brief asks for
no gate (read-only, no devices).

`need --for review` (run by `bun run task-ready`): `need: 1 gate(s) missing for review: check`. That is expected and
deliberate: the brief asks for no gate, and nothing in the code tree changed. `task-ready`'s other checks pass: the
registry, conformance coverage, no TODO/FIXME, every cited repo path exists, and the gate table is the generated one.

## Red proofs

None. No test or gate was added. Every test planned in Appendices B–E names the mutation that has to turn it red.

## Files changed

- `docs/tasks/Q7-next-components-2.report.md` (new): this file.

## Follow-ups

- `docs/PLAN.md` "Later" still says "None of these is built yet" for Menu, Dialog, BottomSheet and TextField (Q5's
  follow-up, still open).
- Bench: there is still no `present.*` scenario (`bench/src/plan.ts` has `mount` and `update` only). Tooltip and
  Popover need one, as Dialog and BottomSheet did.
- Button: an iOS 26 glass style (`.buttonStyle(.glass)`/`.glassProminent`) is still unbuilt (`docs/PLAN.md` G2 line).
  It is cheap, but it is a Button option, not a new component.
- SearchField v2: tokens (`uikit:UISearchTextField.h:34`), suggestions (iOS 16, `:78`), a Cancel button, keyboard
  options, and Material's expanded search view with React Native results (it needs BottomSheet's content mechanism).
- Tooltip v2: Android's own long-press trigger (it needs ContextMenu's arbitration), and iPad/Mac pointer hover via
  `UIToolTipInteraction` (iOS 15, `uikit:UIToolTipInteraction.h:16`).

## Questions for orchestrator

- **A. When one platform has no control (owner).** This decides Stepper's Android half, Popover's Android half and
  Toast's iOS half.
  - Options:
    - (a) skip the component;
    - (b) compose it from that platform's real controls and say so in the docs: Stepper as two Material 3 icon buttons,
      Popover as a Material 3 `Surface` in a Compose `Popup`;
    - (c) draw our own: a toast on iOS (and, later, RangeSlider and ColorPicker on Android).
  - **Recommend allowing (b) and refusing (c).** In (b) every pixel is still drawn by a platform control; (c) breaks
    PLAN principle 1. Toast then stays out despite having the most demand: about 1.8 M downloads a week across six
    packages. An Android-only toast is little use to a cross-platform app, which would need a second library for iOS
    anyway.
- **Decisions already taken in the designs** (the orchestrator can override any of them; none of them needs the
  owner):
  - SearchField is its own native view, not a TextField variant (B4);
  - SearchField v1 has no keyboard props (B1);
  - Tooltip is named `Tooltip` (data content), and the name `Popover` is kept for the React Native content version
    (C1);
  - Tooltip v1 is opened by the app only, with no long-press or hover trigger (C1);
  - Picker `radio` on iOS falls back to `menu` (D1).

---

## Appendix A — Ranking

Scores are 1 (poor) to 5 (strong). For "Risk / effort", 5 means cheap and safe. Demand figures are npm downloads per
week, 2026-10-27 to 11-02.

| # | Candidate | Native counterpart (iOS / Android) | Fit with the Hybrid View model | Demand | Risk / effort, reuse | Expo UI 58.0.22 ships | Platform-only call |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | SearchField | **5**: `UISearchTextField` (iOS 13, `uikit:UISearchTextField.h:29`) / M3 `DockedSearchBar` + `SearchBarDefaults.InputField(TextFieldState, …)` (`m3:SearchBarDefaults`) | **5**: inline, `fillWidth`, the same shape as TextField | **3**: every list screen searches. No package leads, because apps style a `TextInput` or use the native-stack header search (`react-native-search-bar` 894) | **4**: TextField's model, handshake, IME guard, `maxLength`, focus `ref`; Chip's built glyphs | Android `SearchBar`, `DockedSearchBar`; iOS only the `searchable` modifier, which needs a navigation container | both native |
| 2 | Tooltip | **3**: no tooltip on iPhone. A UIKit popover with `.none` adaptation is the anchored surface DatePicker already presents / M3 `TooltipBox` + `PlainTooltip`/`RichTooltip` (`m3:TooltipKt`) | **4**: data content; the anchor is the native view's own box (C1), so no children mechanism | **3**: walkthrough-tooltip 132 k, copilot 22 k, rn-tooltip 19 k | **4**: Dialog's presenter and D35's own-window rule, DatePicker's popover sizing, H2b's popup lifecycle, the layout-move rule | Android `Tooltip`; iOS `Popover` | ship both: a popover stands in for iOS's missing tooltip, as a `Toggle` stands in for its missing checkbox |
| 3 | Popover (React Native content) | **3**: `UIPopoverPresentationController` / none (a Material surface in a Compose `Popup`, or the rich tooltip's shape) | **2**: React Native children in a presented window, plus an anchor | **3**: react-native-popover-view 126 k, and the RN-content half of walkthrough-tooltip | **2**: Tooltip's anchor plus BottomSheet's presented-content mechanism; two-axis `fit` is new | iOS `Popover` | iOS native, Android composed: question A (b). Spike first (Appendix F) |
| 4 | Picker `variant="radio"` | **3**: none on iOS (`RadioGroupPickerStyle` is iOS-unavailable, `swiftui:6912-6917`) / M3 `RadioButton` rows (`m3:RadioButtonKt`) | **5**: Picker's model, clamps and handshake | **2**: radio-buttons-group 27 k, simple-radio-button 14 k (plus react-native-paper's) | **5**: one variant in one component | Android `RadioButton` | Android native; iOS draws `menu`, as Android draws `menu` for `wheel` |
| 5 | Stepper | **2**: SwiftUI `Stepper` (iOS 13, `swiftui:26374`) / none | **5**: inline, `intrinsic`, handshake | **1**: input-spinner 1.8 k, numeric-input 1.4 k | **5**: Slider's value rule, Switch's handshake | iOS only | iOS native; Android composed of M3 icon buttons if question A allows (b), else skip |
| 6 | Toast/Snackbar | **2**: none / M3 `Snackbar` + `SnackbarHostState` | **2**: an imperative HybridObject and an overlay, not a view | **5**: toast-message 883 k, sonner-native 478 k, burnt 274 k, flash-message 61 k, react-native-snackbar 49 k, toast-notifications 42 k | **3** | Android `Snackbar` | the iOS half would be our own drawing: question A (c). Recommend no |
| 7 | Gauge | **2**: SwiftUI `Gauge` (iOS 16, `swiftui:25298`) / none | **4**: display only, but its own box | **2**: circular-progress 246 k is mostly a ring with a centre label | **4** | iOS only | skip for now. Progress built and rejected it as a variant (58 pt circle, iOS 16 against the 15.1 floor; `docs/components/progress.md`, Limits) |
| 8 | ColorPicker | **2**: SwiftUI `ColorPicker` (iOS 14, `swiftui:31340`) / none | **4**: a swatch plus a system presentation | **2**: reanimated-color-picker 111 k (JavaScript) | **3** | iOS only | skip: an Android half would be our own drawing |
| 9 | Collapsible | **2**: SwiftUI `DisclosureGroup` (`swiftui:18070`) / none | **2**: React Native children whose height a native animation would drive, against Yoga | **3**: react-native-collapsible 234 k | **2** | iOS `DisclosureGroup`, universal `Collapsible` | skip |
| 10 | RangeSlider | **2**: none / M3 `RangeSlider` | **5** | **2**: multi-slider 84 k, rn-range-slider 34 k | **4** | none | skip: the iOS half would be ours |
| 11 | SwipeActions | **1**: only inside `List` / `UICollectionView` cells / M3 `SwipeToDismissBox` dismisses, it has no actions | **2**: in-place children and scroll arbitration | **4**: swipe-list-view 66 k, plus gesture-handler's `Swipeable` | **1** | iOS `SwipeActions` (in a `List`) | skip until a List exists |
| 12 | Form/List/Section | **4**: SwiftUI `Form`/`List` / `LazyColumn` + `ListItem` | **1**: the container architecture, and D23 | **3** | **1** | iOS `Form`/`List`/`Section`, universal `List` | an architecture spike, not a G task (Q5's verdict stands) |
| 13 | Multi-select segmented | **2**: none (`UISegmentedControl` selects one) / M3 `MultiChoiceSegmentedButtonRow` (`m3:SegmentedButtonKt`) | **5** | **1** | **4** | Android `MultiChoiceSegmentedButtonRow`, `ToggleButton` | skip: a SegmentedControl option later, if ever |

**Skipped without a rank.**
- **Rating.** No control on either platform (react-native-ratings 148 k is drawn).
- **Badge.** iOS has only `.badge` on tab items and list rows, nothing that stands alone.
- **Divider and section headers.** A hairline `View` does the job; they belong to Form/List.
- **Top Tabs (M3 `PrimaryTabRow`).** iOS's idiom for this is a segmented control, which ships already. Navigation tabs
  belong to navigation libraries.
- **FAB.** Android only, and it is a Button style rather than a component.

**How the scores turn into a rank** (Q5's rule):
- A native counterpart on both platforms, and demand, weigh most.
- Risk gates a candidate behind a spike instead of demoting it.

SearchField has the only two-platform native counterpart left, and it reuses the most. Tooltip and Popover are the
anchored-surface family, the second-largest demand after Toast. Toast has the most demand, but it is blocked on a
principle (question A), not on effort.

**What exists now that changes Q5's picture.**
- DatePicker's popover gives iOS an anchored surface: `UIHostingController` content, `.none` adaptation, a measured
  `preferredContentSize` (`ios/components/DatePicker/HybridNitroUiDatePicker.swift:785-967`).
- `NitroUiPresentation` presents from a plain view, in the screen's chain or in its own window
  (`ios/core/NitroUiPresentation.swift:141`, `:188`).
- BottomSheet carries React Native content in a presented window. That is Popover's other half.
- TextField's `TextFieldState` model is exactly what M3's search input takes.
- ContextMenu's children-in-place mechanism and gesture arbitration are **not** needed by the next two. Tooltip
  avoids both by design (C1).

**Order to start (two machines; D13 allows two device tasks per machine).**
1. **Machine 1: the SearchField build.** It needs only TextField, which is on `main`. It moves shared code out of
   TextField's files, so TextField's harness and real input re-run on both platforms in the same round.
2. **Machine 2: the Tooltip build.** It needs only Dialog, DatePicker and the Compose host, all on `main`. It touches
   none of SearchField's files, so the two can run at the same time.
3. **Picker `radio`**, on whichever machine finishes first. It is half a round, and it touches Picker only.
4. **Stepper**, after question A, on either machine.
5. **The Popover spike**, after Tooltip merges: it builds on Tooltip's anchor and BottomSheet's content root.

G15 and G16, still in review or merge, share no code with any of these. The only overlaps are the README's
Components table and import block, which are routine merge conflicts.

## Appendix B — SearchField

### B1. Public API

```tsx
const [query, setQuery] = useState('');
<SearchField value={query} onChangeText={setQuery} onSubmitEditing={run} placeholder="Search recipes" />;
```

```ts
export interface SearchFieldProps extends ViewProps {
  value?: string;                            // controlled; omit for uncontrolled
  defaultValue?: string;                     // default ''
  onChangeText?: (text: string) => void;     // every user edit, the clear button included
  placeholder?: string;                      // default: the platform's own localized "Search"
  onSubmitEditing?: (text: string) => void;  // the keyboard's Search key; then the field blurs
  maxLength?: number | null;                 // TextField's rule, UTF-16 units
  editable?: boolean;                        // default true
  onFocus?: () => void;
  onBlur?: () => void;
  ref?: Ref<SearchFieldHandle>;              // = TextFieldHandle: focus(), blur()
  accessibilityLabel?: string;
}
```

The names are TextField's, which are React Native `TextInput`'s (`docs/components/text-field.md`). The spec is
TextField's with the following removed:
- `multiline` (always one line);
- `secureTextEntry`;
- `returnKeyType` (always Search);
- the three keyboard props, `keyboardType`, `autoCapitalize` and `autoCorrect`.

Every prop is `T | null`, the callbacks are `fn?`, and every prop is always passed (D7, D7b).

**Why the keyboard props are not there.** None of M3 1.4.0's non-deprecated `InputField` overloads takes
`KeyboardOptions`. They take the state, `onSearch`, the slots, transformations, shape and colours, and fix the IME
action to Search (`m3:SearchBarDefaults`, the 33- and 35-argument overloads). So Android can only give a search field
a text keyboard, no auto-capitalisation and autocorrect on. iOS is set to the same, so the two platforms agree:
- `autocapitalizationType = .none`, since a query is not a sentence;
- `autocorrectionType = .default`;
- `keyboardType = .default`.

A field with other keyboard options is a TextField. Adding them to SearchField would mean drawing our own decorator
around `BasicTextField` instead of Material's input, so it is a v2 question (Follow-ups).

**Events.** TextField's handshake applies unchanged (`docs/architecture/core.md` §4):
- a refused edit reverts;
- a stale write is dropped;
- a JS write is never reported back.

Beyond that:
- **The clear button is an edit.** It reports `onChangeText('')` once, and focus stays.
- **The Search key** calls `onSubmitEditing(text)`, then the field blurs. That is TextField's single-line rule
  (`ios/components/TextField/HybridNitroUiTextField.swift:298-304`).
- **An empty field cannot submit, on either platform.** iOS disables the key (`enablesReturnKeyAutomatically = true`).
  Android drops an `onSearch` with empty text and keeps focus. Parity is by construction rather than left to each
  platform's defaults.

### B2. iOS: UIKit `UISearchTextField` in the core host

**The control.** `NitroUiSearchTextField: UISearchTextField, UITextFieldDelegate, NitroUiTextControl`. It is a
sibling of TextField's `NitroUiSingleLineField` (`ios/components/TextField/HybridNitroUiTextField.swift:156`), and
both implement the `NitroUiTextControl` protocol (`:81`).
- `UISearchTextField` subclasses `UITextField` (`uikit:UISearchTextField.h:29`). So `markedTextRange`, the delegate's
  `shouldChangeCharactersIn` (where `NitroUiTextLimit` runs), `editingChanged`, `editingDidBegin`/`End` and
  `textFieldShouldReturn` are the same calls TextField already handles (`:258-304`).
- **The build moves those delegate bodies into one shared type that both classes call,** so the two cannot drift. It
  also turns `TextFieldModel.owner` (`:68`, typed `HybridNitroUiTextField?`) into a protocol that both Hybrid Views
  adopt.
- Configuration in `nuiApply()`:
  - `returnKeyType = .search`;
  - `enablesReturnKeyAutomatically = true`;
  - `clearButtonMode = .whileEditing`, set explicitly *(reading: UIKit's default for this class)*;
  - `font = .preferredFont(forTextStyle: .body)` with `adjustsFontForContentSizeCategory = true`, TextField's font
    rule (`NitroUiTextTraits.font`).
- **The placeholder.** UIKit's own default placeholder is read once at init and kept. A `null` placeholder writes it
  back, so a recycled field never keeps the previous row's prompt.
- **Clear.** `textFieldShouldClear` returns `model.editable`. UIKit then sends `editingChanged`, which reports the
  empty text as an edit.

**Hosting.** A `SearchBox: UIViewRepresentable` inside `NitroSwiftUIHost<SearchFieldContent>`, built exactly like
TextField's `SingleLineBox` (`:465`). The init is TextField's: `needsContainment = false`, `wantsContentSize = true`,
`sizingPolicy = .fillWidth` (`:574-577`).

**Why not UISearchBar.**
- It is the delegate of its own text field and reports through `UISearchBarDelegate`, so TextField's delegate path
  would have to be rewritten rather than reused.
- Its extras are a bar's chrome: Cancel, scope and bookmark buttons, and bar padding.
- Its `searchTextField` is this same class, so the field looks identical.
- Cancel is listed in Follow-ups.

**Why not SwiftUI.** SwiftUI has no standalone search field. `searchable(text:placement:prompt:)` is a modifier that
needs a navigation container (`swiftui:7091`).

**OS floor.** `UISearchTextField` is iOS 13, below the 15.1 floor. Nothing in v1 needs more.

### B3. Android: Material 3 `DockedSearchBar` around `SearchBarDefaults.InputField(TextFieldState)`

**The host.** `SearchFieldHost : NitroComposeHost<TextFieldModel>`. It uses TextField's model
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTextField.kt:70`), which already owns the
`TextFieldState`, the `snapshotFlow` that reports edits, the `afterUpdate()` catch-up and `NitroUiTextLimit`
(`:258`). Only the composable differs from TextField's (`:487-500`):

```kotlin
DockedSearchBar(
  inputField = {
    SearchBarDefaults.InputField(
      state = model.state,                       // TextField's TextFieldState
      onSearch = { text -> if (text.isNotEmpty()) model.submit(text) },  // then clearFocus(), TextField's rule
      expanded = false, onExpandedChange = {},   // held collapsed: v1 has no results view
      modifier = Modifier.focusRequester(model.focus).onFocusChanged(model::focusMoved),
      enabled = model.editable,                  // TextField's mapping of editable decides enabled vs readOnly
      placeholder = { Text(model.placeholder ?: defaultHint) },
      leadingIcon = { Icon(SearchGlyph, contentDescription = null) },
      trailingIcon = if (model.hasText) { { IconButton(onClick = model::clear) { Icon(CloseGlyph, clearLabel) } } } else null,
      inputTransformation = model.limit,         // NitroUiTextLimit
      colors = SearchFieldColorsCache.get(scheme),
    )
  },
  expanded = false, onExpandedChange = {},
) {}
```

**Signatures** (1.4.0, all `@ExperimentalMaterial3Api`, which the library already opts into for Picker, Menu,
DatePicker and Dialog):
- `DockedSearchBar(inputField, expanded, onExpandedChange, modifier, shape, colors, tonalElevation, shadowElevation,
  content)`;
- `SearchBarDefaults.InputField(TextFieldState, onSearch, expanded, onExpandedChange, modifier, enabled, readOnly,
  textStyle, placeholder, leadingIcon, trailingIcon, prefix, suffix, inputTransformation, outputTransformation,
  scrollState, shape, colors, interactionSource)`.

Neither is deprecated. The `String`-query overloads are (`m3:SearchBarKt`, "Use overload which takes inputField as a
parameter").

**Why the docked bar, held collapsed.**
- The docked variant has no window-inset padding and no full-screen transform, so its box is predictable.
- Expo uses 1.4's newer `SearchBar(state, inputField)` with an `ExpandedFullScreenSearchBar`
  (`expo-ui:android/src/main/java/expo/modules/ui/SearchBarView.kt`). In that API, `InputField` animates its
  `SearchBarState` to expanded when it gains focus. Whether the collapsed bar then hides itself without an expanded
  partner is unverified, so build check 1 measures both and picks.

**Clear.** `model.state.clearText()`. The existing `snapshotFlow` reports it as an edit, and focus stays.

**Glyphs.** The search and close icons are `ImageVector`s built once per process from Material's geometry. That is
Chip's precedent for its check mark (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiChip.kt:181`):
no `material-icons` dependency for two glyphs.

**Strings.** The default placeholder is AppCompat's localized `abc_search_hint`, and the clear button's label is
`abc_searchview_description_clear`. AppCompat ships with `react-android` *(reading; the build confirms both resources
resolve)*. That avoids an English literal in the library.

**Colours.** `SearchBarDefaults.colors()`/`inputFieldColors()` are served from a process-wide cache keyed on the colour
scheme. Building them inside the composable would break the "Shared objects" rule in `docs/architecture/core.md`.

**Width.** M3 bounds the input to a minimum of 360 dp and a maximum of 720 dp *(reading)*.
- A narrower `fillWidth` box still wins, because `sizeIn` coerces to the incoming constraints.
- In a box wider than 720 dp the field is centred, as every single control's drawing is
  (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:487`). That goes in the docs' Limits.

**Hosting.** Not hostable, like TextField.

### B4. Sizing

**Policy.** `sizing: "fillWidth"`: the width is the parent's, and the height is the control's.
- On iOS the height is `UISearchTextField`'s intrinsic height at the current content-size category: about 36 pt on
  iOS 13–18 *(reading)*, and measured by the build on iOS 26 and 27.
- On Android it is `SearchBarDefaults.InputFieldHeight`, 56 dp at font scale 1 (`m3:SearchBarDefaults`,
  `getInputFieldHeight`).

**Key.** A constant. Nothing the app sets changes the height: the field is always one line, and has no label and no
multiline mode. Text size and font scale reach it through the environment epoch (`docs/architecture/sizing.md`).

**Why its own Hybrid View, and not `variant="search"` on TextField.** Declared fallbacks are "keyed by component only"
(`docs/architecture/sizing.md:42`).
- As a TextField variant, every cold SearchField would lay out at TextField's single-line height for one frame, then
  correct. That is a visible jump at the top of a search screen, the one place users look first.
- As its own view it declares its own fallback per OS, so D17's "a correct declaration costs 0 corrections" holds for
  every instance.
- The cost is one more spec and one more nitrogen output. The shared Swift and Kotlin types keep the logic in one
  place (D36 item 4 did the same for Menu's rows).

**Fixture rule** (AGENTS). The harness poisons the cache with a height that is neither platform's (for example 11.5),
then asserts that the correction lands on the measured height. It also measures a SearchField and a single-line
TextField side by side and asserts their heights differ, so a SearchField that composed TextField's control fails.

### B5. Accessibility

- **iOS.** `UISearchTextField` carries the search-field trait *(reading; the real-input a11y sweep asserts it)*.
  `accessibilityLabel` names the field; with none, VoiceOver reads the placeholder. The clear button is UIKit's own
  element.
- **Android.** One editable node (the `BasicTextField` inside `InputField`). The leading glyph is decorative
  (`contentDescription = null`). The clear button is its own node, with the localized label. `editable=false` follows
  TextField's mapping.
- **Test ids.** `testID` follows TextField: RN's `accessibilityIdentifier` on iOS, `View.tag` on Android.
- **The sweep.** `scripts/real-input/a11y.mjs` gains a `search-field` case.

### B6. Recycling and drop

TextField's reset, plus the iOS placeholder going back to UIKit's default:
- `prepareForRecycle()` resigns first responder, resets the model and both event counts, clears the text and re-seeds
  `defaultValue`;
- Android disposes the composition and clears the `TextFieldState`;
- `onDropView()` resigns and drops the callbacks.

`RecyclableView` is implemented on both platforms. The conformance suite's recycle probes cover the default and the
handshake's counters.

### B7. Harness and real-input plans

**Harness: a new `SearchField.harness.tsx`,** modelled on `example/__tests__/TextField.harness.tsx`.

1. Typed text round-trips, one event per keystroke. A refused edit reverts.
2. `maxLength` holds in UTF-16 units and never splits an emoji. This is the shared `NitroUiTextLimit`, asserted again
   because the Android input path is new.
3. `nuiTestClear()` runs the clear button's own handler → exactly one `onChangeText('')`, and focus stays.
4. Submit: `nuiTestSubmit()` → `onSubmitEditing(text)`, then blur. With empty text → nothing (barrier twin).
5. Sizing:
   - the field is laid out at its parent's width and at the measured height, after one correction from a poisoned
     fallback;
   - a SearchField and a TextField differ in height (the B4 pair).
6. Focus from a parent's mount effect, through `ref`, as TextField does.
7. Recycle: a reused view keeps none of the previous owner's text or placeholder. On iOS it reads UIKit's default
   placeholder.
8. Android only: after focus, the state report reads `expanded=false`, and the box height has not changed. That
   catches an expanding bar.

**Real input.** iOS: `testRealInputSearchField` in `example/ios/NitroUiExampleUITests/RealInputTests.swift`. Android:
`CHECKS.searchfield` in `scripts/real-input/android.mjs`.
- Real keystrokes reach JS, and a refused edit reverts.
- A real tap on the clear button echoes `''`.
- The keyboard's Search key echoes `submit:<text>` and dismisses the keyboard.
- A tap focuses the field.
- The dump shows the editable node and the clear button's label.

**Red proofs to run.**
- Drop `enablesReturnKeyAutomatically` and the Android empty-text guard → test 4's empty case.
- Report the clear outside the edit path → test 3.
- Register TextField's fallback for SearchField → test 5's first-frame assertion.
- Let `onExpandedChange` set `expanded` → test 8.

**Registry.** `component.json`: `sizing: "fillWidth"`, `hostable: false`, `bench: true`, `smoke: true`,
`realInput: true`. The README gets a Components row, the import, a Usage section and both screenshots (D4,
`scripts/__tests__/readme-components.test.js`).

### B8. Bench arms

- `mount.search-field`, `update.search-field` (JS writes to `value`), `memory.search-field` and `leak.search-field`,
  at N = 1/50/200.
- `rn-core` is a real peer here: a `TextInput`, which is what apps use for search today.
- `expo-ui-*`:
  - Android: `@expo/ui/jetpack-compose`'s `SearchBar`;
  - iOS: Expo has no standalone search field (`searchable` needs a `NavigationStack`), so the report records it as
    `n/a` rather than comparing it with a different control.
- D15's target applies.
- Typing latency uses the keystroke measurement TextField's own perf gate does (D34 item 1).

### B9. Risks, and what the build checks first (no spike)

1. **Android collapsed bar.**
   - Does `InputField` with `expanded = false` keep 56 dp and draw no expanded chrome when it gains focus?
   - Does 1.4's `SearchBar(state, inputField)` collapse cleanly without an expanded partner?
   - Pick the docked bar unless the state API is measured clean.
2. **iOS height per OS.** Measure `UISearchTextField`'s intrinsic height on iOS 26 and 27 and on the oldest runtime
   installable, and declare the fallback per OS (D14).
3. **Shared-code extraction.** TextField's harness and real input re-run on both platforms in the same round (the
   AGENTS rule for a changed harness file applies to TextField's suite as well).

None of these can fail the component outright. Each one picks between two known implementations, so a separate spike
would cost a round to learn what the build's first day learns anyway.

## Appendix C — Tooltip

### C1. Public API, and the anchor that needs no children

```tsx
const [tip, setTip] = useState(true);
<Tooltip
  isPresented={tip}
  onIsPresentedChange={setTip}
  title="Saved searches"
  message="Tap the star to keep this search."
  actions={[{ id: 'ok', title: 'Got it' }]}
  onAction={() => setTip(false)}
>
  <IconButton name="star" onPress={save} />
</Tooltip>
```

```ts
export interface TooltipAction { id: string; title: string }
export interface TooltipProps extends ViewProps {
  isPresented: boolean;                                  // controlled only, as Dialog and BottomSheet
  onIsPresentedChange?: (isPresented: boolean) => void;  // every native close
  message: string;
  title?: string;                                        // with title or actions: rich; otherwise plain
  actions?: TooltipAction[];                             // at most two (dev throw otherwise)
  onAction?: (id: string) => void;                       // fires before onIsPresentedChange(false) (D32)
  placement?: 'auto' | 'above' | 'below';                // default 'auto'
  children?: React.ReactNode;                            // the anchor, laid out in place
}
// NitroUiTooltip spec: presented, mostRecentEventCount, message, title: string | null,
// actions: NitroUiTooltipAction[], placement: string, testID, nuiPerfId;
// onPresentedChange(presented, eventCount), onAction(id);
// methods nuiTestStateReport(): string, nuiTestPerformAction(id), nuiTestDismiss()
```

**The structure is the design.** The JS wrapper renders:

```tsx
<View style={[{ alignSelf: 'flex-start' }, style]} {...viewProps}>
  <NativeNitroUiTooltip style={StyleSheet.absoluteFill} pointerEvents="none" {...nativeProps} />
  {children}
</View>
```

- **The native view has no children.** Its box is the wrapper's box, which is the anchor.
  - So it needs none of the children work: no `.mm` patch, no `ViewGroupManager`, no touch root, no gesture
    arbitration.
  - That is why Tooltip does not depend on G16.
  - It also matches what each platform wants: iOS needs a `sourceView` whose bounds are the anchor (DatePicker's
    popover, `ios/components/DatePicker/HybridNitroUiDatePicker.swift:916-917`), and M3's `TooltipBox` positions
    against its own `content`'s bounds.
- **It is the first child,** so it sits behind the children, and it never takes a touch:
  - iOS sets `isUserInteractionEnabled = false`;
  - Android composes no pointer input (C3).
- **The base style `alignSelf: 'flex-start'`** makes the wrapper hug its anchor. Without it, RN's default `alignItems:
  'stretch'` would widen a wrapper around an icon to the whole row, and the arrow would point at the row's middle. That
  is Button's base style for the same reason. An app `style` wins.
- **Data content only.** The message, title and actions are data, mapped one-to-one onto M3 `RichTooltip`'s slots
  (title, text, action) and onto a SwiftUI stack on iOS. React Native content is Popover's job (Appendix F).
- **Plain or rich.** With no title and no actions, Android draws `PlainTooltip`; otherwise `RichTooltip`. iOS draws one
  popover either way.

**Why the app opens it.** v1 has no long-press or hover trigger, for three reasons:
- iOS has no touch idiom for a tooltip, so a long press on iPhone would be our own invention;
- Android's own long-press trigger lives on `TooltipBox`'s Compose content, and the anchor here is React Native, so it
  would need ContextMenu's arbitration;
- the coach-mark use, which is what the top two packages are for, is always opened by the app.

Both triggers are in Follow-ups.

**Events.** These are Dialog's rules (`docs/components/dialog.md`, "Presenting and dismissing") and its handshake.
- **A native close** fires `onIsPresentedChange(false)`. That covers:
  - a tap outside;
  - Back (Android, actionable tooltips only, C3);
  - the anchor leaving its window;
  - on Android, the anchor moving (Picker's rule, C3).
- **An action tap** fires `onAction(id)`, then `onIsPresentedChange(false)`.
- **JS writes `false`:** it closes with its animation and emits nothing.
- **`isPresented` true at mount:** it presents once, when the view has a window.
- **A refused dismissal:** it presents again, with one dev warning (D33).
- **It never closes itself.** Material's plain tooltip normally hides after a timeout. Here
  `TooltipState(isPersistent = true)` keeps both kinds up, so a tooltip means the same thing on both platforms: it stays
  until the user or the app closes it. An app that wants a transient tip sets a timer.

**`placement`.**
- iOS `permittedArrowDirections`: `auto` → `[.up, .down]` (DatePicker's choice, `:927`), `above` → `.down`,
  `below` → `.up`.
- Android `TooltipAnchorPosition`: `auto` and `above` → `Above`, `below` → `Below`. M3 flips to the other side when
  there is no room *(reading)*.
- Leading and trailing placements exist on both platforms but are out of v1.

**The name.** `Tooltip`, Material's word, for the data-content component; `Popover`, iOS's word, is kept for the React
Native content one. That pairing follows the AlertDialog (data) / BottomSheet (React Native content) split the library
already has.

### C2. iOS: a UIKit popover with SwiftUI content, presented by the core helper

**The view.** `HybridNitroUiTooltip: HybridNitroUiTooltipSpec, RecyclableView`. Its `view` is a plain `UIView` with
`isUserInteractionEnabled = false` that is not an accessibility element. There is no `NitroSwiftUIHost`, so a closed
tooltip in every row costs a view, which is Dialog's B2 rule.

**The content.** `UIHostingController(rootView: TooltipContent(model))`. It is built on the first present and reused
while the view is mounted, as DatePicker does (`:902`).
- `TooltipContent` is `VStack(alignment: .leading, spacing: 4)`:
  - the title in `.headline`;
  - the message, in `.subheadline` alone or `.body` under a title;
  - an `HStack` of `Button`s, one per action.
- The stack has 12 pt padding.

**The presentation.** DatePicker's sequence (`:906-929`):
- `modalPresentationStyle = .popover`;
- `preferredContentSize` from `sizeThatFits(in: CGSize(width: maxWidth, height: .infinity))`, where `maxWidth =
  min(320, window width − 32)`. 320 is Material's rich-tooltip maximum *(reading)*, so the two platforms wrap at
  about the same width;
- `sourceView = view` and `sourceRect = view.bounds`;
- `permittedArrowDirections` from `placement`;
- delegate `adaptivePresentationStyle → .none`, so it stays a popover on a phone (`:953`);
- `presentationControllerDidDismiss` → a native close (`:963`).

**The presenter.** `NitroUiPresentation` (`ios/core/NitroUiPresentation.swift:79`).
- It presents in the screen's chain by default.
- It presents from its own window (`presentInOwnWindow`, `:188`) only when the top presented controller is an RN
  `Modal` host. That is D35's rule, as BottomSheet applies it
  (`ios/components/BottomSheet/HybridNitroUiBottomSheet.swift:902-912`).
- Tooltip is the second component to need that rule, so the build moves `isModalHost` and `topPresentedClass`
  (`:1151`) into `ios/core`.
- Teardown during the entry transition goes through `dismissForTeardown` (`:286`), the case DatePicker's harness found.

**Live updates.**
- The title, message and actions update the SwiftUI content in place.
- `preferredContentSize` is recomputed after each, and UIKit resizes the popover *(reading)*.

**Rejected.**
- **SwiftUI `.popover`.** DatePicker measured both of its failures inside an RN view: the wrong size and the wrong
  anchor (`:785-800`).
- **TipKit's `popoverTip`** (iOS 17; the `isPresented:` overload is iOS 26, `tipkit:258`).
  - It is the closest Apple idiom.
  - But it needs the app-wide datastore `Tips.configure()`, which a library cannot own: a second `configure` throws.
  - TipKit's display rules decide eligibility.
  - The iOS 17 floor would need a second code path.
- **`UIToolTipInteraction`** (iOS 15, `uikit:UIToolTipInteraction.h:16`). Pointer hover only, with no programmatic
  show. It is in Follow-ups for iPad and Mac.

**iOS 26 and later.** The popover's Liquid Glass background is the system's.

### C3. Android: Material 3 `TooltipBox` anchored to the overlay's own box

**The host.** `TooltipHost : NitroComposeHost<TooltipModel>`.
- `wantsContentSize = false`: there is nothing to measure.
- `importantForAccessibility = NO` on the host view.
- Its `Component(model)`:

```kotlin
if (model.composing) {                       // from a present until the exit transition has finished
  TooltipBox(
    positionProvider = TooltipDefaults.rememberTooltipPositionProvider(model.anchorPosition, spacing),
    tooltip = {
      if (model.isRich) RichTooltip(title = model.titleSlot, action = model.actionsSlot) { Text(model.message) }
      else PlainTooltip { Text(model.message) }
    },
    state = tooltipState,                    // TooltipState(isPersistent = true)
    onDismissRequest = { model.userDismiss() },
    focusable = model.hasActions,            // Back and TalkBack reach the buttons; a plain tip keeps the IME's focus
    enableUserInput = false,                 // no trigger in v1 (C1)
    hasAction = model.hasActions,
  ) { Box(Modifier.fillMaxSize()) }          // the anchor: the overlay, i.e. the wrapper's box
  TooltipWitness(model)                      // process-wide live count, as Dialog's DialogWitness
}
LaunchedEffect(model.presented) { if (model.presented) tooltipState.show() else tooltipState.dismiss() }
```

**Signatures** (1.4.0, `@ExperimentalMaterial3Api`; the two older overloads are deprecated in favour of this one):
- `TooltipBox(positionProvider, tooltip, state, modifier, onDismissRequest, focusable, enableUserInput, hasAction,
  content)` (`m3:TooltipKt`);
- `rememberTooltipPositionProvider(TooltipAnchorPosition, spacing)`, where `TooltipAnchorPosition` is
  `Above`/`Below`/`Left`/`Right`/`Start`/`End` (`m3:TooltipDefaults`, `m3:TooltipAnchorPosition`);
- `TooltipState(initialIsVisible, isPersistent, mutatorMutex)`.

**Dismissal.** `onDismissRequest` covers an outside tap, and Back when the tooltip is focusable. It calls
`model.userDismiss()`, which emits and then calls `state.dismiss()`.

**A layout move closes it.** That is Picker's rule, carried out by the host's anchor-box tracking
(`docs/components/host.md`, "Popups and dialogs"). The overlay *is* the host view, so the mechanism applies unchanged:
a tooltip cannot float over a row it no longer points at.

**Detach.** A screen push on top closes it and reports it, as for Dialog.

**A closed tooltip composes nothing.** `composing` is false until the first present, which is Q5's "compose lazily"
applied from the start. It stays true until the exit transition has finished, so the hide still animates. The
200-row bench decides whether even that is worth more work.

**Touches.** The overlay is behind the children and has no pointer input, so a tap reaches the children: an
`AbstractComposeView` with no pointer modifier does not consume `ACTION_DOWN` *(reading; build check 1)*.

### C4. Sizing

`sizing: null` (`scripts/registry-core.mjs:115-128`):
- no row in `nitro-ui.sizing.json`;
- no key;
- no fallback;
- no `measureContent`.

The wrapper's box is Yoga's, and the native view fills it. D17 does not apply. The popup sizes itself: Material's
maximum widths on Android (plain 200 dp, rich 320 dp *(reading)*), and the measured SwiftUI stack up to 320 pt on iOS.

### C5. Accessibility

- **The overlay** is hidden on both platforms, by Dialog's B5 means (`isAccessibilityElement = false`;
  `importantForAccessibility = NO` and an empty composition's semantics cleared).
- **The anchor keeps its own semantics.** An icon button inside is still the button. The tooltip does not become its
  accessibility hint, because the app opens it, not the user.
- **iOS.** The popover is a presented controller. On present the build posts `.screenChanged` with the content, so
  VoiceOver reads the title and message *(reading)*. The actions are SwiftUI buttons.
- **Android.** The tooltip content carries `semantics { liveRegion = LiveRegionMode.Polite }`, so TalkBack announces it
  when it shows. An actionable tooltip is focusable, so TalkBack can reach its buttons.
- **Automation only** (D37 item 4). The real-input dumps assert the tree; what VoiceOver and TalkBack say is not
  exercised on a device, and the docs say so.

### C6. Recycling and drop

Dialog's sequence:
- **`prepareForRecycle()`:** close without animation (`dismissForTeardown` on iOS; on Android, dispose the
  composition), then reset every prop, both event counts and the per-mount flags.
- **`onDropView()`:** close, then drop the callbacks.

The iOS completion closures do not capture `self`.

### C7. Harness and real-input plans

**Harness: a new `Tooltip.harness.tsx`,** using `example/__tests__/Dialog.harness.tsx`'s oracles:
`nuiTestStateReport()` is read from what each platform actually built.

1. JS presents → `presented=1;live=1;kind=rich;actions=1;title=…`. JS dismisses → `live=0`, with no event: proved by a
   barrier twin whose `nuiTestDismiss()` does fire.
2. `nuiTestPerformAction('ok')` → exactly `action:ok`, then `presented:false`, and `live=0`.
3. Kind: no title and no actions → `kind=plain` on Android. iOS reports `kind=popover` for both.
4. **It never closes itself.** Presented, then wait 3 s, twice M3's plain timeout *(reading: 1.5 s)* → still `live=1`.
5. **Anchor geometry.**
   - The native view's frame equals the wrapper's for a 40 × 40 anchor and for a 120 × 40 anchor. The pair means one
     fixed size cannot pass both.
   - The wrapper is 40 wide, not the row's width (the `alignSelf` base style).
   - iOS reads `sourceRect == bounds` and the arrow direction back from the built popover. Android reports the tooltip
     window's position against the anchor, within 1 dp of M3's spacing.
6. **Touches reach the children.** A `Pressable` inside the closed tooltip's wrapper receives a harness tap exactly
   once, on both platforms.
7. Refusal: the parent keeps `true` → the tooltip presents again after the echo, with one dev warning.
8. Presented at mount → exactly one presentation, after the view gets its window.
9. Drop while open, and drop 50–150 ms after presenting (the entry transition) → a fresh mount reads `live=0`, and on
   iOS `topPresented` is not a popover.
10. Recycle while open (`example/__tests__/Recycling.harness.tsx`'s pattern) → `presented=0`, with no old message.
11. Inside an RN `Modal` → presents, and on iOS `presenter=ownWindow`. Dismissal returns the count to 0. The
    stranded-Modal hazard case runs in its own app instance (D35 item 5).
12. Android: a sibling above grows, so the anchor moves → `presented:false` once.
13. A message change while presented is reflected in place, on both platforms.

**Real input.** iOS: `testRealInputTooltip`. Android: `CHECKS.tooltip`.
- An RN button opens the tooltip, and its text appears in the window dump.
- A real tap outside echoes `presented:false`.
- A real tap on the action echoes `action:ok,presented:false`.
- On Android, Back closes an actionable tooltip.
- With the tooltip closed, a real tap on the inner `Pressable` fires once.

**Red proofs to run.**
- Close before the action → test 2.
- `isPersistent = false` → test 4.
- The overlay last, with a pointer modifier → test 6.
- Drop the own-window rule → test 11, run in its isolated app.
- Drop `dismissForTeardown` → test 9.

**Registry and conformance.**
- `component.json`: `sizing: null`, `hostable: false`, `realInput: true`.
- It is an `A11Y_PRESENTATIONS` case: a component with no box whose presented window only real input reads
  (`scripts/conformance-core.mjs:425-429`).
- The README gets its row, the import, a Usage section and both screenshots (D4), the screenshots with the tooltip
  open.

### C8. Bench arms

- `mount.tooltip`, `memory.tooltip`, `leak.tooltip`, at N = 1/50/200 **closed** tooltips. A tooltip on every icon in a
  list is the realistic case.
- `rn-core` is a floor: a bare `View` wrapping the same anchor. React Native has no tooltip.
- `expo-ui-*`: `@expo/ui/jetpack-compose`'s `Tooltip` and `@expo/ui/swift-ui`'s `Popover`, each closed around an
  empty anchor.
- D15's target applies. A closed iOS tooltip is one plain `UIView`, and an Android one an empty composition, so both
  should clear it easily.
- `present.tooltip` waits for the `present.*` scenario in Follow-ups.

### C9. Risks, and three checks that can stop the build early (no spike)

1. **Android touch pass-through.** Does a Compose host that fills the wrapper, behind the children and with no pointer
   modifier, leave every tap to them (test 6)?
   - Fallback within the round: ContextMenu's 0 × 0 host at the wrapper's origin, with a position provider that
     substitutes the wrapper's rect for the 0 × 0 anchor before calling M3's
     (`origin/task/G16-contextmenu:docs/components/context-menu.md`).
2. **Android anchoring.** Does `TooltipBox`'s popup sit within 1 dp of M3's spacing above and below the overlay box?
   Does it close on a layout move, and stay put or close on a scroll, but never point at nothing?
3. **iOS in its own window.** When D35's rule presents from the tooltip's own window, the `sourceView` is in the app's
   window. Does the arrow land on the anchor? Dialog converts its iPad action-sheet anchor the same way, but that has
   never run on a device (`docs/tasks/FOLLOWUPS.md`, the G11 review lines).

**Go/no-go.**
- Checks 1 and 2 must pass on Android (1 by its fallback if need be), and check 3 on iOS, before the rest of the round
  is spent.
- If check 3 fails, the build stops and reports (D19). Presenting in the chain over an RN `Modal` has the stranded-Modal
  hazard D35 measured, and no answer to that should be improvised mid-round.

## Appendix D — Picker `variant="radio"` (build-ready, short)

### D1. API and mapping

**API.** `variant: 'menu' | 'wheel' | 'radio'`. Nothing else changes in `docs/components/picker.md`'s API:
- the value is still an index, with the same clamps and the same handshake;
- `onChange` is unchanged;
- `label`, `disabled` and `tintColor` keep their meanings.

**Android.** Material's documented radio-group pattern. A `Column(Modifier.selectableGroup())` holds one row per
option:

```kotlin
Row(
  Modifier.fillMaxWidth().heightIn(min = 48.dp)
    .selectable(selected = i == shown, enabled = !disabled, role = Role.RadioButton, onClick = { pick(i) })
    .padding(horizontal = 16.dp),
  verticalAlignment = Alignment.CenterVertically,
) { RadioButton(selected = i == shown, onClick = null, enabled = !disabled, colors = tinted); Spacer(16.dp); Text(label) }
```

- `onClick = null` on the `RadioButton` makes the row the one target.
- `RadioButton(selected, onClick, modifier, enabled, colors, interactionSource)` is `m3:RadioButtonKt`.
- The tint is `RadioButtonDefaults.colors(selectedColor = tint)`, from a bounded cache keyed on `(scheme, tint)`, like
  `PickerColorsCache` (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt:531`).
- `label` is not drawn. It names the group for accessibility; the menu's `label` stays the field label.
- Picking the selected row reports nothing. That is the menu's no-op suppression, carried over.

**iOS.** `radio` renders `menu`, and the docs say so, as `wheel` on Android renders the menu (`docs/components/picker.md`,
Limits).
- `RadioGroupPickerStyle` is `@available(iOS, unavailable)` (`swiftui:6912-6917`).
- `.inline` outside a `List` is not a radio group *(reading)*.
- An iOS app that wants every option visible can use SegmentedControl for up to about five options; the docs say that
  too.

### D2. Sizing

`radio` is `intrinsic` on Android.
- **Width.** The widest row, measured unbounded. Rows fill a stretched box, since `alignSelf: 'stretch'` is the D16
  opt-in.
- **Height.** The option count × 48 dp at font scale 1.
- **Key.** `radio|count|labels…`, with **no `sel:` term**. A radio group is the same size whichever row is selected,
  unlike a menu, which is as wide as its title (`src/components/Picker/Picker.tsx:192`). So a pick is never a cold
  configuration.
- **Labels.** One line with an ellipsis, so the box cannot grow with the width (C1's over-wide rule fits the rows to a
  narrower box).
- **Variant changes remount,** through the existing `key={variantKey}` (`:348`).
- **The fallback.** The component's single declared fallback (280 × 56 dp) is the first frame of a cold radio group,
  which is then corrected (D17). That is documented, like the iOS wheel's cold frame. Exact first frames would need
  per-variant fallbacks, which the engine does not have.

### D3. Accessibility and tests

**Accessibility.**
- Each row is one node with `Role.RadioButton` and its selected state.
- `selectableGroup()` gives TalkBack the "1 of 3" collection info.
- Real input asserts in a dump that only the selected row is `checked`, and that disabled rows are `enabled="false"`.

**Harness** (in `example/__tests__/Picker.harness.tsx`):
1. Three options measure 144 ± 1 dp tall and five options 240 ± 1, from a poisoned fallback. A fixed height cannot pass
   the pair.
2. A pick from row 0 to row 2 costs **0 corrections**. Red proof: put `sel:` back in the key.
3. `nuiTestSelect(2)` → `onChange(2)`. A refused pick snaps back.
4. Picking the selected row reports nothing (barrier twin).
5. Disabled → no event.
6. iOS: `radio` reports `style=menu`.
7. Recycling from `radio` to `menu` resets.

**Real input.** A real tap on row 2 echoes it, and the dump's checked state follows.

**Docs.** No new export, so there is no new README row. A screenshot of the `radio` variant goes in `picker.md`.

**Effort.** About half a G round. It touches Picker only.

## Appendix E — Stepper (build-ready, short)

### E1. API and mapping

```ts
export interface StepperProps extends ViewProps {
  value?: number;               // controlled; omit for uncontrolled
  defaultValue?: number;        // default minimumValue
  onValueChange?: (value: number) => void;  // once per step
  minimumValue?: number;        // default 0
  maximumValue?: number;        // default 100
  step?: number;                // default 1; must be > 0 (dev throw otherwise)
  disabled?: boolean;
  accessibilityLabel?: string;  // names it; the value is announced by the control
}
```

The names are Slider's (`docs/components/slider.md`). The value goes through the handshake. Clamping and step
snapping are Slider's rule, `NitroUiSliderValue.quantize` (`ios/components/Slider/NitroUiSliderValue.swift:103` and
its Kotlin twin, `android/src/main/java/com/margelo/nitro/nitroui/NitroUiSliderValue.kt`). Reusing it is what keeps
`0.1 + 0.2` from snapping back.

The stepper shows no number. The app renders the value next to it, as iOS apps do.

**iOS.** `Stepper(value: binding, in: min...max, step: step) { Text(label) }.labelsHidden()` (iOS 13,
`swiftui:26374`), with `.accessibilityValue(Text(value))`.
- SwiftUI's own hold-to-repeat applies, and each repeat is one step event.
- At the minimum or maximum, SwiftUI disables that half itself.

**Android** (if question A allows (b)). Material has no stepper. The control is
`Row { FilledTonalIconButton(minus); Spacer(8.dp); FilledTonalIconButton(plus) }`, where each button is disabled at
its bound.
- The minus and plus glyphs are built `ImageVector`s, Chip's precedent.
- There is no hold-to-repeat in v1, and the docs say so.
- The docs and the README row say "Android: composed from Material 3 icon buttons".

### E2. Sizing, accessibility, tests

**Sizing.** `intrinsic`, with a constant key: nothing the app sets moves the box.
- iOS is measured per OS by the build. It is about 94 × 32 pt on iOS 15–18 *(reading)*; iOS 26 and 27 are measured.
- Android is 2 × 48 dp + 8 dp = 104 × 48 dp, because each icon button is 40 dp inside a 48 dp touch target.
- The declared fallbacks are therefore exact, and there are 0 corrections after the first configuration.

**Accessibility.**
- **iOS.** SwiftUI's stepper is one adjustable element: VoiceOver swipes up and down to step.
- **Android, matching it.** The row is one node with `progressBarRangeInfo(value, min..max, steps)` and a `setProgress`
  action, so TalkBack adjusts it by swiping, and the buttons are `clearAndSetSemantics {}`. No hard-coded
  "Increase"/"Decrease" strings are needed.
- Real input asserts iOS's adjustable trait and Android's range info.

**Harness** (a new `Stepper.harness.tsx`):
1. From 0 with `maximumValue={2}`, three increments report 1, then 2, then nothing, because the plus half is disabled
   at the maximum (barrier twin).
2. Steps of 0.1 from 0 report 0.1, 0.2, 0.3 exactly. Red proof: drop `quantize`.
3. A refused value snaps back.
4. Disabled → no events.
5. Sizes are asserted from a poisoned fallback.
6. Recycling resets the value.

**Real input.** Taps on both halves, and an iOS long-press repeat.

**Bench.** `mount.stepper`; `rn-core` floor `View`; Expo's iOS `Stepper`.

**Effort.** One G round.

## Appendix F — Popover with React Native content (spike first)

**Shape.** Tooltip's anchor (C1) plus BottomSheet's content (`docs/components/bottom-sheet.md`):

```tsx
<Popover isPresented={open} onIsPresentedChange={setOpen} anchor={<Button title="Filters" onPress={show} />}>
  <FilterForm />
</Popover>
```

- **The anchor** renders in place, inside the wrapper `View`, next to Tooltip's untouchable overlay.
- **The children** are the content, presented in a window. They use BottomSheet's mechanism:
  - the presented-container shadow node sized from native state;
  - the iOS content-children patch and an `RCTSurfaceTouchHandler`;
  - the Android `ViewGroupManager` and its root view group with `JSTouchDispatcher`.
- **iOS.** A `UIViewController` holding the children, presented `.popover` with `.none` adaptation and D35's
  own-window rule.
- **Android.** A Compose `Popup` holding an M3 `Surface` (`shapes.medium`, tonal elevation 3 dp) that contains the root
  through `AndroidView`. Material has no popover, so this is question A (b), documented as composed.

**Spike questions** (one round, both platforms, prototype never merged, D19):
1. **Two-axis `fit`.** The width is the content's own, up to a maximum (320 pt / dp), and the height is Yoga's. Does
   the first frame show at its final size? On iOS that means `preferredContentSize` set from the state commit before
   presenting; on Android, the popup measured after the root reports its size. A visible resize fails the question.
   D35 already lists "`fit` inside an own window" as BottomSheet's gap, so iOS in its own window is the hard case.
2. **Touches in a `PopupWindow`.** An RN `Pressable` inside the popup takes a real tap exactly once. BottomSheet proved
   this in a dialog window, not a popup window.
3. **A `TextInput` in the popup.** Focusing it brings up the keyboard, which needs a focusable popup, and the popup
   either moves above the keyboard or is documented as covered.
4. **Inside an RN `Modal`, and nested.** It presents over the Modal (iOS: own window) and closes cleanly, and the Modal
   is never stranded.
5. **Lifetime.** 50 present/dismiss cycles, a drop during the entry transition and a recycle while open each leave
   `live=0`, and Android shows no `LifecycleRegistry` growth (B1's rule).

**Go** means 1, 2 and 5 pass on both platforms with real input, 10 of 10. Questions 3 and 4 inform the build's scope
(keyboard handling can ship documented). **No-go** on 1 means a popover that visibly resizes, which is not shippable.
The fallback is then a Tooltip with richer data content, not this component.

## Appendix G — The rest, one paragraph each

**Toast/Snackbar.**
- Android: M3 `Snackbar` through `SnackbarHostState.showSnackbar`, which suspends and returns `ActionPerformed` or
  `Dismissed`.
- It would be an imperative HybridObject (`docs/research/nitro-patterns.md` pattern 11) owning an overlay composition.
- iOS 27.1 has no system toast: nothing in UIKit's headers or SwiftUI's interface.
- So the iOS half is our own drawing: question A (c), recommended no.
- If the owner chooses (c), the design is an overlay window with a SwiftUI capsule on system materials (`.glassEffect`
  on iOS 26 and later), queued in native code, and called `showToast()` on both platforms rather than pretending iOS
  has a Snackbar.

**Gauge.** SwiftUI `Gauge` (iOS 16, `swiftui:25298`); nothing on Android. Progress already built and rejected it as a
variant: a 58 pt ring, and a floor above iOS 15.1 (`docs/components/progress.md`, Limits). As its own component it
would be iOS 16+ with nothing native on Android. Not now.

**ColorPicker.** SwiftUI `ColorPicker` (iOS 14, `swiftui:31340`): a swatch that opens the system picker. Android has
no Material colour picker, so the Android half would be our own drawing (question A (c)). Not now.

**Collapsible.** SwiftUI `DisclosureGroup` (`swiftui:18070`); nothing on Android. Its content is React Native, and a
native expand animation would drive a height that Yoga owns. Not now.

**RangeSlider.** M3 `RangeSlider`; nothing on iOS (SwiftUI's and UIKit's sliders have one thumb). The iOS half would be
our own drawing. Not now.

**SwipeActions.**
- iOS has `.swipeActions` only inside a `List`, and contextual actions only in `UITableView`/`UICollectionView` cells.
- Material's `SwipeToDismissBox` dismisses; it has no actions.
- It belongs with a List.

**Form/List/Section.** Q5's verdict stands: it is the container architecture of `docs/research/core-architecture.md`
§6, behind D23's iOS result, and it calls for an architecture spike, not a G task. BottomSheet's and ContextMenu's
children mechanisms are pieces of it, not the whole.

**Multi-select segmented.** M3 `MultiChoiceSegmentedButtonRow` (`m3:SegmentedButtonKt`); `UISegmentedControl` selects
one. If it is ever built, it is a SegmentedControl option. Demand is low.
