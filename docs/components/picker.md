# Picker

The platform choice control: SwiftUI `Picker` with `.pickerStyle(.menu)` or `.wheel` on iOS; on
Android the `menu` variant is Material 3 `ExposedDropdownMenuBox`, `wheel` is Material 3's
`ScrollField` and `radio` a radio group. Menu presentation, press feedback, accessibility
behaviour, dynamic type and Material's field metrics belong to the control.

```tsx
import { Picker } from 'react-native-nitro-ui';

const [index, setIndex] = useState(0);
<Picker
  options={['Small', 'Medium', 'Large']}
  selectedIndex={index}
  onChange={(event) => setIndex(event.index)}
/>;
```

The value is an index into `options`, never the label: two options may carry the same text, and
an index is what both platforms' controls store. Options are plain strings, with no icons and no
per-option colours. The data model and the clamps are the same as
[SegmentedControl](segmented-control.md)'s.

## API

| Prop                   | Type                                         | Default  | Maps to                                                                                                    |
| ---------------------- | -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `options`              | `string[]`                                   | required | The choices and, with the selected one, the width of a menu.                                               |
| `selectedIndex`        | `number \| undefined`                        | —        | Controlled index. `undefined` makes the picker uncontrolled.                                               |
| `defaultSelectedIndex` | `number \| undefined`                        | `0`      | Seed for an uncontrolled picker; ignored while `selectedIndex` is set.                                     |
| `onChange`             | `((e: {index, value}) => void) \| undefined` | —        | One call per user choice, with the new index and its label.                                                |
| `variant`              | `'menu' \| 'wheel' \| 'radio'`               | `'menu'` | SwiftUI `.menu` / `.wheel`; Android the Material 3 menu, a `ScrollField` drum or a radio group.            |
| `label`                | `string \| undefined`                        | —        | Android: the field's label. iOS: the `Picker`'s label (a11y). `radio`: the group's a11y name, never drawn. |
| `disabled`             | `boolean \| undefined`                       | `false`  | SwiftUI `.disabled()` / Compose `enabled = false`.                                                         |
| `tintColor`            | `ColorValue \| undefined`                    | platform | iOS: the menu's title. Android: the field's outline, label and chevron accents.                            |
| `style`                | `ViewStyle`                                  | —        | Overrides the measured box (see Sizing).                                                                   |
| `testID`               | `string \| undefined`                        | —        | iOS: RN's `accessibilityIdentifier`. Android: the host `View.tag`.                                         |
| `accessibilityLabel`   | `string \| undefined`                        | —        | Names the control that opens the list; the options keep their own labels.                                  |
| `hybridRef`            | `(view: handle) => void`                     | —        | Internal. Read-only handle for this repo's harness and benchmarks.                                         |
| `nuiPerfId`            | `number \| null \| undefined`                | `null`   | Internal. Instance id for perf marks; `null` disables marks.                                               |

`Picker` is a `View`, so any other `ViewProps` (`onLayout`, …) work as usual. `hybridRef` and
`nuiPerfId` are not app API: the handle is read-only plus `measureContent()`, and it runs once,
when the view mounts. There is no `isExpanded` prop, because a SwiftUI `Picker` keeps its menu's
open state to itself.

## Platform mapping

| Concept     | iOS                                                                                      | Android                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control     | `Picker(selection:) { … }.pickerStyle(.menu \| .wheel)`; `radio` renders the `.menu` one | `ExposedDropdownMenuBox` + `OutlinedTextField` + `ExposedDropdownMenu` (Expressive standalone-group shape and colour) of `SelectableDropdownMenuItem` rows; `wheel` is `ScrollField` (one drum of the options, the centre one lit); `radio` is a `Column(selectableGroup())` of `RadioButton` rows |
| Host        | `UIHostingController` inside `NitroSwiftUIHost`                                          | `NitroComposeHost<M>: AbstractComposeView`                                                                                                                                                                                                                                                         |
| Containment | required (`needsContainment`): SwiftUI presents the menu through a view controller       | n/a: the popup is a Compose `Popup`                                                                                                                                                                                                                                                                |
| Theme       | system traits                                                                            | `MaterialTheme` + dynamic colour on Android 12+                                                                                                                                                                                                                                                    |
| Popup       | SwiftUI's own menu (a list over the app)                                                 | its own `PopupWindow`, anchored under the field                                                                                                                                                                                                                                                    |
| Label       | passed as the `Picker`'s label; `.menu` draws no caption                                 | the outlined field's label, inside the field's box                                                                                                                                                                                                                                                 |
| Test id     | RN's `testID` → `accessibilityIdentifier`                                                | `host.tag` (Compose has no test id)                                                                                                                                                                                                                                                                |
| Recycle     | hosting controller reused                                                                | objects reused; composition disposed and rebuilt                                                                                                                                                                                                                                                   |

## Selection

The selection is a controlled value and uses the event count, like `Switch`, `Slider` and
`SegmentedControl` ([DESIGN.md](../DESIGN.md), section 3.5):

- A choice paints the new title at once and reports `(index, eventCount)` to JS.
- If the parent moves `selectedIndex` to what was asked, native accepts it; if it does not,
  native rolls the displayed index back.
- `onChange` carries the label from the `options` of the render the event landed in; `index` is
  the part that cannot be stale.
- Opening and closing the menu is not a choice and reports nothing, on either platform. Neither
  does picking the option that is already selected.
- `disabled` is native: the field draws its disabled colours, JS gets no event, and a disabled
  anchor never opens a menu, even if the picker is disabled while its popup is showing.

### Clamping

The same as [SegmentedControl](segmented-control.md)'s, on both platforms and in the JS wrapper.
`options` and the selection arrive in one batch in no guaranteed order, so neither is read
against the other in a setter:

| Situation                              | Result                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| `selectedIndex` past the end           | the last option                                                   |
| negative, `NaN`, `null`-ish junk       | the first option                                                  |
| `options` shrinks under the selection  | the last remaining option (clamped, never cleared)                |
| `options` grows                        | the selection stays on the same option                            |
| `options` empty                        | nothing to pick; the index reads `0` and no choice can report     |
| `defaultSelectedIndex` out of range    | clamped the same way, applied once, in the first batch            |
| a write straight to the Hybrid View    | clamped too; reading `selectedIndex` back gives the clamped index |
| options change while the popup is open | the list rebuilds, and a selection past the new end is clamped    |

## The popup

Nothing a popup registers on the activity, the window or a `ViewTreeObserver` outlives the view.

- iOS needs view-controller containment (`needsContainment`) because SwiftUI presents its menu
  through a view controller. The host owns that containment for the life of the view, not per
  presentation.
- Android's menu is a Compose `Popup`, a real `PopupWindow` in the window list. It is a child of
  the composition, so ending the composition ends it: `onDropView` and the recycle reset dispose
  the composition, and the popup goes with it. `expanded` is model state, so a recycled host
  starts closed.
- Back dismisses it on Android (`onDismissRequest` fires for the back gesture, an outside tap
  and the composition going away). Tapping outside dismisses on both platforms.
- Moving the view dismisses it on Android. When the picker's React Native view is moved by
  layout (a sibling above it resizes, content is inserted, a `<Host>`'s column reflows) the open
  menu closes, hosted or not, because the anchor is no longer where the menu opened
  ([host.md](host.md), "Popups and dialogs"). A scroll changes neither layout nor the anchor's
  box, so a menu open across a scroll stays open.
- Unmounting while open leaves no popup window behind, on either platform.

## The radio variant (`variant="radio"`)

Every option visible at once, on the platform that has a control for it. Android draws Material
3's radio group: a `Column(Modifier.selectableGroup())` of rows, each row
`selectable(selected, enabled, Role.RadioButton)` around a `RadioButton(onClick = null)` and the
label, 48 dp tall, the whole row the press target. iOS renders the menu, because SwiftUI's
`RadioGroupPickerStyle` is `@available(iOS, unavailable)` and a missing control falls back to the
platform's real one, never to an imitation.

`Picker.tsx` resolves the variant before it sends the prop, so on iOS `radio` is `menu` in the
prop and in `nuiSizingKey` (see Sizing). `HybridNitroUiPicker.swift` resolves it again through
`NitroUiPickerVariant.resolved`, tested in `scripts/native-tests/picker-variant.test.swift` with
a Kotlin twin in `PickerModelTest`.

An iOS app that wants every option visible should use
[SegmentedControl](segmented-control.md) for up to about five options, or a `Menu` for more.

- `label` is not drawn, on either platform. `label` (or `accessibilityLabel`, which wins) names
  the group for a screen reader.
- `tintColor` paints the selected dot on Android, through
  `RadioButtonDefaults.colors(selectedColor = tint)` from a bounded cache keyed on
  `(scheme, tint)`. The unselected outline keeps the scheme's colour. On iOS the tint is the
  menu's.
- Picking the row already chosen reports nothing, and a disabled group reports nothing at all.
- Nothing presents, so the popup rules above (windows, `expanded`, back, dismiss on move,
  containment) do not apply.

## The wheel variant (`variant="wheel"`)

On iOS this is SwiftUI's `.wheel` style. On Android it is Material 3's `ScrollField`: one drum of
the options, the row under the centre line lit, rolled with a finger. Both platforms have the
real control and nothing falls back.

A wheel's choice is a scroll that comes to rest. While the drum moves, the row under the centre
line changes once per row it crosses; Picker reports only the settle, so a roll from row 0 to
row 4 is one `onChange`.

- A refused pick moves the drum back. The drum is not painted from the displayed index but keeps
  the page its pager scrolled to, so `afterUpdate()` writes the pager directly
  (`PickerHost.syncWheelRow`). It does so only for a batch that moved the displayed index and
  never while a roll is in flight: writing the pager stops the scroll in progress, so an
  unrelated prop change must not cancel a fling.
- Empty `options` draws no drum. `disabled` swallows the gesture and replaces the semantics with
  one disabled node, so a disabled wheel reports nothing.
- `tintColor` paints the row under the centre line on Android, through `selectedContentColor`;
  the other rows keep the scheme's colours. On iOS a wheel takes no tint (see Tint).
- Nothing presents, so the popup rules above do not apply.
- A variant change is a new mount (`Picker.tsx` keys the view on `variant`). The drum's state is
  cleared on the recycle reset and when the view is dropped. Going `wheel → menu → wheel`
  re-seeds an uncontrolled picker at `defaultSelectedIndex`, as it does for `radio`.
- A vertical drag that begins on the drum rolls the drum. A `ScrollField` is a pager, and a
  React Native scroll view above it would claim a vertical drag as soon as it passes touch slop.
  `Modifier.nuiOwnVerticalDrags` asks the parents to stop intercepting while a gesture that
  started inside the drum is in progress, and withdraws that as soon as the first move past
  touch slop is sideways, so a horizontal drag still reaches a pager, a drawer or a swipeable
  row. Scroll a page with a wheel in it from outside the wheel.
- Accessibility: the drum is one named node whose value is the row under the centre line. See
  Accessibility and Limits.

## Sizing

`menu` and `radio` are `intrinsic`; `wheel` is `fillWidth` with a platform height. The native
view is keyed on the variant and the sizing id is taken per variant (`key={variant}` with
`useSizingId(variant)`), because the Android host decides which measure question to ask when the
composition is built. A variant change is therefore a fresh mount, and an uncontrolled picker
re-seeds from `defaultSelectedIndex`.

A menu is as wide as the title it is showing, so the selected label is in the key. The key is
`variant|count|label|…|sel:<title>|lbl:<label>` (`src/components/Picker/Picker.tsx`), with the
option count first and every label escaped (`\` → `\\`, `|` → `\|`) so a label cannot forge a
separator. `disabled` and `tintColor` repaint without resizing; text size, density and OS control
size come in through the environment epoch ([DESIGN.md](../DESIGN.md), section 3.6).

The `radio` key is `radio|count|labels…`, without the last two fields. A group paints every label
at once, so its box is the widest row by the option count and the chosen row does not change it;
and a group never draws `label`. On iOS the variant is resolved to `menu` before the key is
built, so a radio's size is cached under a menu key with both fields.

Measured on iPhone 17 / iOS 27 in pt and an API 35 emulator at 420 dpi in dp, with nothing
overridden:

| Configuration                                  | iOS                | Android         |
| ---------------------------------------------- | ------------------ | --------------- |
| `['One','Two','Three']`, index 0, no label     | 72.00 × 34.67      | 280.00 × 56.00  |
| `['Go']`, index 0                              | 62.67 × 34.67      | 280.00 × 56.00  |
| a 40-character title showing                   | 360.33 × 34.67     | 384.76 × 56.00  |
| `['One','Two','Three']` with `label`           | 72.00 × 34.67      | 280.00 × 64.00  |
| the same list, `disabled`                      | 72.00 × 34.67      | 280.00 × 56.00  |
| `wheel`, `['Small','Medium','Large']`, 330 box | 330.00 × 216.00    | 330.29 × 200.00 |
| `radio`, `['One','Two','Three']`, index 0      | the menu row above | 114.67 × 144.00 |
| `radio`, `['Small','Medium','Large']`, index 0 | the menu row above | 133.33 × 144.00 |
| `radio`, five options, index 0                 | the menu row above | 114.67 × 240.00 |

- iOS sizes a menu to its title (62.67 pt for `Go`, 360.33 pt for 40 characters). Android keeps
  Material's `MinTextFieldWidth` of 280 dp as a floor, so a short title still measures 280 dp.
- A `label` costs Android 8 dp of height and nothing on iOS, which draws no caption.
- Both wheels are as wide as their box. Material's `ScrollFieldHeight` is 200 dp (330.29 × 200.00
  in a 330 dp box, 300.19 × 200.00 in a 300 dp one); SwiftUI's wheel is 216 pt.
- An Android radio group is one 48 dp row per option, Material's minimum touch target, so three
  options are 144 dp tall and five are 240. Its width is the widest row, measured unbounded, with
  each label on one line with an ellipsis, so a narrower box truncates the label.
  `alignSelf: 'stretch'` makes the rows take the box's width. On iOS the variant is a menu and
  measures like one.

The declared fallback is one pair per component: 72 × 35 pt
(`ios/components/Picker/HybridNitroUiPicker.swift`) and 280 × 56 dp
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`), the
`['One','Two','Three']` row above with the height rounded up. A `wheel`'s width never comes from
it: a `fillWidth` shadow node uses the box's width. Any other configuration is laid out at the
fallback when first seen and corrected the turn it measures. A cold Android radio group therefore
starts at the menu's 280 × 56 dp box and is corrected on both axes.

Three things move a Picker's box (for a `radio` group only the first and third): an `options`
change, a selection change (a new title in the button) and a `variant` change. Both platforms
reset the host's last-reported size when `nuiSizingKey` changes.

A pick paints a new title before any render, so the key that names it has not arrived yet. Two
rules keep the key and the pixels together:

- The wrapper knows which title is shown. `shownIndex` is the controlled value where there is
  one, and otherwise the last index native reported, held in wrapper state. An uncontrolled pick
  therefore costs one React render.
- A pick's size report waits for the key that names it. Android arms `holdSizingReports()` in
  the row's `onClick`: the host keeps the measured size until `afterUpdate()` of the batch that
  carries the new key and files it there
  (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`). iOS needs no
  hold: the key change is what re-measures. A refused pick re-measures at once, under the
  unchanged key.

Content wider than its box fits the box: a menu wider than the caller's box is measured a second
time at the box's width and placed at that width, so the field, its label and its chevron stay
inside the box and tappable, and Material 3 ellipsises the title. Keep option lists within the
width you give the control.

## Tint

- iOS tints the menu's title and chevron. A wheel does not take it: its rows keep the system's
  primary and secondary label colours.
- Android tints the field's focused outline, focused label, focused trailing icon and unfocused
  label, through `OutlinedTextFieldDefaults.colors` (`focusedBorderColor`, `focusedLabelColor`,
  `focusedTrailingIconColor`, `unfocusedLabelColor`). Every other role keeps the scheme's
  colours. The colour set comes from a bounded process-wide cache keyed on
  `(colour scheme, tint)`.

## Accessibility

- The menu is a button that opens a list. iOS gets a menu-style `Picker` with
  `.accessibilityLabel(accessibilityLabel ?? label)`. Android makes the anchor one semantics node
  carrying the name, the value, the role and the enabled state (`clearAndSetSemantics` on the
  anchor modifier, `menuAnchor` kept for pointer input). In a `uiautomator dump` on an API 35
  emulator it is an `android.widget.Spinner`, `clickable=true`, the name in `content-desc`, the
  title as its text, and `enabled=false` when disabled. The node is not `focusable`.
- The selected option is drawn and announced. On iOS SwiftUI's menu draws the check mark. On
  Android the row is Material 3 Expressive's `SelectableDropdownMenuItem`: the selected row draws
  the selected container and shape with a leading check, and says `Role.RadioButton` plus
  `selected`.
- A radio group is one node per row inside a named group. The group carries its name once
  (`label` / `accessibilityLabel`), exactly one row says `checked`, and the rows of a disabled
  group say `enabled=false`. `selectable(role = Role.RadioButton)` gives each row its role and
  selected state; the `RadioButton` inside is drawn, not focusable, so there is one press target
  per option. `selectableGroup()` on the column provides the group semantics, including a spoken
  position ("2 of 3").
- The Android wheel is one node. `ScrollField` publishes a single semantics node for the whole
  drum, so `accessibilityLabel` lands on the drum. Its state description is the option under the
  centre line, taken from `options`. In a dump on the API 35 emulator it is an
  `android.widget.SeekBar` with the name in `content-desc` and `enabled=false` when the picker is
  disabled. It reports `scrollable=false` and has no row nodes (see Limits).

## Behaviour notes

- The value callback is always sent, with a stable no-op when the caller passes no `onChange`,
  and every other prop is always sent too: `options` is `[]` when absent and the rest use `null`
  for "not set", so a recycled view never keeps a previous mount's handler or choices.
- `NitroUiPicker` implements `RecyclableView` on both platforms: the model resets (options,
  selection, default-seed flag, variant, label, tint, sizing key, callback), `expanded` goes back
  to closed, and on Android the composition is disposed before reuse so its popup goes with it.
- A picker's options live in a popup that the in-app harness cannot reach: on Android it can
  press the anchor but never a row. Choosing an option, a refused choice snapping back and
  dismissal are covered by the real-input checks (`scripts/real-input`), which drive the menu
  from outside the app.

## Limits

- `radio` is Android's. On iOS the variant renders the menu and shows no rows; use
  `SegmentedControl` there for up to about five visible choices. Android's radio group has no
  per-row icons, no grouping and no per-row enabled state.
- Strings only: no icons, no per-option colours, no grouped or disabled rows.
- The Android wheel is 200 dp tall, so it shows a handful of the options at a time and every
  choice is a roll. It is as wide as its box, and a `wheel` with empty `options` draws nothing.
- The Android wheel can be heard by a screen reader but not moved. The drum's node is not
  `scrollable` and its rows are not in the tree, so TalkBack offers no scroll or row-activation
  actions on it. This is `ScrollField`'s tree. iOS's `UIPickerView` answers VoiceOver's own
  scroll. A layout where the wheel is the only way to choose needs an alternative (a `menu` or
  `radio` Picker) beside it.
- A drum inside a scroller takes the vertical drag (see The wheel variant): scroll the page from
  beside it.
- Android has a 280 dp field floor, so a menu with short options is much wider than its title.
- The menu's look is the platform's: an iOS 26+ menu is a floating list, Android's is a Material
  popup. Beyond `tintColor` there is no row styling, no per-option colour, and no way to place
  the popup.
- A `label` is drawn on Android and not on iOS, so a layout that depends on the caption differs.
- Android has no `testID` inside the Compose view: the id lands on the host `View.tag`.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
- One declared fallback pair per component, so the first instance of a long-title list starts
  from a 72 pt / 280 dp box and is corrected the turn it measures. A cold iOS `wheel` starts at
  the menu's 35 pt height against its own 216. On Android a cold `wheel` is laid out 144 dp too
  short and corrected the turn it measures, and a `radio` group is corrected on both axes.
