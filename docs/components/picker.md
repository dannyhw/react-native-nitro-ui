# Picker

The platform choice control: SwiftUI `Picker` with `.pickerStyle(.menu)` or
`.wheel` on iOS, Material 3 `ExposedDropdownMenuBox` on Android. Both are hosted by
the core runtime (`docs/architecture/core.md`), so menu presentation, press
feedback, a11y behaviour, dynamic type and Material's own field metrics belong to
the control, not to us.

```tsx
import { Picker } from 'react-native-nitro-ui';

const [index, setIndex] = useState(0);
<Picker
  options={['Small', 'Medium', 'Large']}
  selectedIndex={index}
  onChange={(event) => setIndex(event.index)}
/>;
```

The value is an **index** into `options`, never the label: two options may carry the
same text, and an index is what both platforms' controls store. Options are plain
strings — no icons, no per-option colours. The data model, the clamps and the
sizing key are `SegmentedControl`'s (`docs/components/segmented-control.md`),
reused rather than forked; what is new here is a control that *presents* UI.

## API

| Prop                   | Type                                     | Default  | Maps to                                                          |
| ---------------------- | ---------------------------------------- | -------- | ---------------------------------------------------------------- |
| `options`              | `string[]`                               | required | The choices — and, with the selected one, the width of a menu.    |
| `selectedIndex`        | `number \| undefined`                    | —        | Controlled index. `undefined` makes the picker uncontrolled.      |
| `defaultSelectedIndex` | `number \| undefined`                    | `0`      | Seed for an uncontrolled picker; ignored while `selectedIndex` is set. |
| `onChange`             | `((e: {index, value}) => void) \| undefined` | —    | One call per user choice, with the new index and its label.       |
| `variant`              | `'menu' \| 'wheel' \| 'radio'`           | `'menu'` | SwiftUI `.menu` / `.wheel`; Android the M3 menu or a radio group. |
| `label`                | `string \| undefined`                    | —        | Android: the field's label. iOS: the `Picker`'s label (a11y). `radio`: the group's a11y name, never drawn. |
| `disabled`             | `boolean \| undefined`                   | `false`  | SwiftUI `.disabled()` / Compose `enabled = false`.                |
| `tintColor`            | `ColorValue \| undefined`                | platform | iOS: the menu's title. Android: the field's outline, label and chevron accents. |
| `style`                | `ViewStyle`                              | —        | Overrides the measured box (see Sizing).                          |
| `testID`               | `string \| undefined`                    | —        | iOS: RN's `accessibilityIdentifier`. Android: the host `View.tag`. |
| `accessibilityLabel`   | `string \| undefined`                    | —        | Names the control that opens the list; the options keep their own labels. |
| `hybridRef`            | `(view: handle) => void`                 | —        | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`            | `number \| null \| undefined`            | `null`   | **Internal.** Instance id for perf marks; `null` disables marks.  |

`Picker` is a `View`, so any other `ViewProps` (`onLayout`, …) work as usual.
`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14): the handle is read-only
plus `measureContent()`, and it runs once, when the view mounts. There is no
`isExpanded` on purpose — a SwiftUI `Picker` keeps its menu's open state to itself,
so such a prop would be answerable on Android and not on iOS.

## Platform mapping

| Concept        | iOS                                                     | Android                                                |
| -------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Control        | `Picker(selection:) { … }.pickerStyle(.menu \| .wheel)`; `radio` renders the `.menu` one    | `ExposedDropdownMenuBox` + `OutlinedTextField` + `ExposedDropdownMenu` (Expressive standalone-group shape and colour) of `SelectableDropdownMenuItem` rows; `radio` is a `Column(selectableGroup())` of `RadioButton` rows |
| Host           | `UIHostingController` inside `NitroSwiftUIHost`            | `NitroComposeHost<M>: AbstractComposeView`                |
| Containment    | **required** (`needsContainment`) — the first control here that presents a view controller | n/a — the popup is a Compose `Popup`              |
| Theme          | system traits                                              | `MaterialTheme` + dynamic colour on Android 12+           |
| Popup          | SwiftUI's own menu (a list over the app)                   | its own `PopupWindow`, anchored under the field           |
| Label          | passed as the `Picker`'s label; `.menu` draws no caption   | the outlined field's label, inside the field's box        |
| Test id        | RN's `testID` → `accessibilityIdentifier`                  | `host.tag` (Compose has no test id)                       |
| Recycle        | hosting controller reused                                  | objects reused; composition disposed and rebuilt (`core.md` §6) |

## Selection

The selection is a number, so it goes through the event-count handshake
(`docs/architecture/core.md` §4) exactly like `Switch`, `Slider` and
`SegmentedControl`:

- A choice paints the new title **at once** and reports `(index, eventCount)` to JS.
- If the parent moves `selectedIndex` to what was asked, the handshake accepts it;
  if it does not, native rolls the displayed index back — the snap-back, with no
  second frame of animation to make it look right.
- `onChange` carries the label from the `options` of the render the event landed in;
  `index` is the part that cannot be stale.
- **Opening and closing the menu is not a choice** and reports nothing, on either
  platform. Neither does picking the option that is already selected — SwiftUI's
  binding only writes when the selection moves, and Material 1.4 fires `onClick` for
  every press, so the Android implementation suppresses the no-op. That symmetry is
  what makes a refused choice observable at all.
- `disabled` is native: the field draws its disabled colours, JS gets no event, and
  a disabled anchor never opens a menu — even if the picker is disabled *while* its
  popup is showing.

### Clamping

Identical to `SegmentedControl`'s (`docs/components/segmented-control.md`), on both
platforms and in the JS wrapper, because `options` and the selection arrive in one
Nitro batch in no guaranteed order (`core.md` §3) and neither can be read against
the other in a setter:

| Situation                                     | Result                                                       |
| --------------------------------------------- | --------------------------------------------------------------- |
| `selectedIndex` past the end                  | the last option                                                 |
| negative, `NaN`, `null`-ish junk              | the first option                                                |
| `options` shrinks under the selection         | the last remaining option (clamped, never cleared)              |
| `options` grows                               | the selection stays on the same option                          |
| `options` empty                               | nothing to pick; the index reads `0` and no choice can report   |
| `defaultSelectedIndex` out of range           | clamped the same way, applied once, in the first batch          |
| a write straight to the Hybrid View           | clamped too — reading `selectedIndex` back gives the clamped index |
| options change while the popup is open        | the list rebuilds, and a selection past the new end is clamped  |

## The popup

This is the library's first control that shows UI of its own, so it is also the
first with a popup lifecycle. The rule it is held to (B1): nothing a popup registers
on the activity, window or a `ViewTreeObserver` may outlive the view.

- **iOS** needs view-controller containment (`needsContainment`) because SwiftUI
  presents its menu through a view controller; the host owns that containment for
  the life of the view, not per presentation.
- **Android**'s menu is a Compose `Popup` — a real `PopupWindow` in the window list.
  It is a child of the composition, so ending the composition ends it. That is what
  makes recycling, dropping and unmounting safe: `onDropView` and the recycle reset
  dispose the composition, and the popup goes with it. `expanded` is model state, so
  a recycled host starts closed and can never hang a previous row's list over the
  next one.
- **Back dismisses it** on Android (`onDismissRequest` fires for the back gesture,
  for an outside tap and for the composition going away); tapping outside dismisses
  on both platforms.
- **Moving the view dismisses it too** on Android. When the picker's own React Native
  view is moved by layout — a sibling above it resizes, content is inserted, a hosted
  `<Host>`'s column reflows — the open menu closes rather than stay where it opened:
  the anchor is no longer over the row the menu belongs to, and a menu floating on the
  wrong control is the worse answer. This is a behaviour change for an **unhosted**
  `Picker`, made in the same release that made Pickers hostable, because the anchor's
  screen box now has one source for both cases (`docs/components/host.md`, "Popups and
  dialogs"). It costs nothing to mount, update or leak memory — those bench cells hold —
  and it does not fire on a scroll: scrolling changes neither layout nor the anchor's
  box, and a menu open across a scroll stays open.
- **Unmounting while open** is a tested case on both platforms — but no harness
  test can be that case. The harness can press an anchor open, yet it only observes
  its own view tree, so a popup that outlived its view would pass anything it could
  assert. What covers it is the counting kind of check: the `scripts/real-input`
  cycles that compare the window list before and after (opening adds one popup,
  unmounting leaves none, three cycles on each platform), and the Android `MountChurn`
  Picker case in `example/__tests__/MountChurn.harness.tsx`, which presses one anchor
  of 200 mounted Pickers open, unmounts them and asserts the post-GC heap floor stays
  flat across cycles. The in-app test (`does not treat opening as a choice, and the
  next mount sizes normally after going away mid-menu` in
  `example/__tests__/Picker.harness.tsx`) is named for what it can assert, which is
  those two things and not the popup.

## The radio variant (`variant="radio"`)

Every option visible at once, on the platform that has a control for it. Android
draws Material 3's documented radio group: a `Column(Modifier.selectableGroup())`
of rows, each row `selectable(selected, enabled, Role.RadioButton)` around a
`RadioButton(onClick = null)` and the label, 48 dp tall, the whole row the press
target. iOS **renders the menu**, because SwiftUI's radio-group style —
`RadioGroupPickerStyle` — is `@available(iOS, unavailable)`: there is nothing to
host, and DECISIONS D38 rules that a missing control falls back to the platform's
real one rather than to an imitation drawn by us. The same rule is why `wheel` is
the menu on Android.

That is a decision the JS wrapper makes, not something it leaves to SwiftUI, and
the reason is the cache: `Picker.tsx` resolves the variant before it sends the
prop, so on iOS `radio` is spelled `menu` in the prop **and** in `nuiSizingKey`
(see Sizing). A key that named a `radio` configuration whose width follows its
title would file a menu's title-dependent width under a key with no selection in
it — the poisoned-cache bug G6 review M1 is about, wearing a different name.
`HybridNitroUiPicker.swift` guards again through `NitroUiPickerVariant.resolved`,
so a `radio` that arrived by another road would still draw a menu — and because a
device run can never reach that guard (the wrapper resolves first), its vectors run
on the host: `scripts/native-tests/picker-variant.test.swift` in
`bun run test:native`, with the Kotlin twin in `PickerModelTest`.

**An iOS app that wants every option visible** should use
`docs/components/segmented-control.md` for up to about five options — that is the
control iOS does have for "choose one of these, all shown" — or a `Menu` for more.

- **`label` is not drawn**, on either platform. A radio group has no field to
  float a caption inside, and the group is named by its rows; `label` (or
  `accessibilityLabel`, which wins, as elsewhere) names the **group** for a screen
  reader. A layout that counted on a caption therefore gets nothing, which is the
  same difference `menu` already has between the platforms, in a new shape.
- **`tintColor` paints the selected dot** on Android, through
  `RadioButtonDefaults.colors(selectedColor = tint)` from a bounded cache keyed on
  `(scheme, tint)` — this variant's analogue of the menu's field accent. The
  unselected outline keeps the scheme's colour, and since iOS draws a menu, its
  tint there is the menu's (the title and chevron).
- **Picking the row already chosen reports nothing**, and a disabled group reports
  nothing at all: `applyUserSelection` is the one place a pick is applied, so a
  radio row and a popup row cannot disagree about what a choice means.
- **Nothing about it presents**, so the whole popup story above — windows,
  `expanded`, back, dismiss-on-move, containment — does not apply, and
  `nuiTestMenuReport()` answers `-1` for every box and `rows=0`.

## Sizing

`menu` is `intrinsic`; `wheel` is `fillWidth` with a platform height — the same
two-policy switch Progress makes between its linear and circular shapes, taken with the
remount that makes the switch work: the native view is keyed on the variant and the
sizing id is taken per variant (`key={variant}` with `useSizingId(variant)`, exactly as
`src/components/Progress/Progress.tsx` does). Android needs that because its host
decides which measure question to ask when the composition is built and never re-asks,
so a menu that became a wheel in place would go on answering the unbounded one. A
variant change is therefore a fresh mount — an uncontrolled picker re-seeds from
`defaultSelectedIndex`. A menu is
as wide as **the title it is showing**, which is the one thing that makes this key
different from `SegmentedControl`'s: a segment row is the same width whichever
segment is chosen, a menu button is not, so the selected label is in the key.

The key is `variant|count|label|…|sel:<title>|lbl:<label>`
(`src/components/Picker/Picker.tsx`), with the option count first and every label
escaped the way SegmentedControl escapes (`\` → `\\`, `|` → `\|`) so a label cannot
forge a separator and share another configuration's cached size. `disabled` and
`tintColor` repaint, they do not resize; text size, density and OS control size come
in through the epoch (`docs/architecture/sizing.md`).

`radio` is `intrinsic` too, and its key is `radio|count|labels…` — both of the last
two fields are gone. `sel:` because a group paints every label at once, so its box is
the widest row by the option count and *which* row is chosen decides nothing about it:
`SegmentedControl`'s rule from the other direction, and what makes a pick in a group
**not** a cold configuration (0 corrections, no frame at the declared fallback).
`lbl:` because a group never draws `label` — on Android that prop is the group's
accessibility name — so a field that moves no box has no business in its key: a rename
on a warm group would otherwise cost a fallback frame and a correction. On iOS the
variant is resolved to `menu` before the key is built (see The radio variant), so
iOS files its radio sizes under a menu key with both fields, where they belong.

Measured on the devices this library's tests run on (iPhone 17 / iOS 27 in pt;
an API 35 emulator at 420 dpi, in dp), with nothing overridden:

| Configuration                                  | iOS             | Android         |
| ----------------------------------------------- | ----------------- | ----------------- |
| `['One','Two','Three']`, index 0, no label      | 72.00 × 34.67     | 280.00 × 56.00    |
| `['Go']`, index 0                               | 62.67 × 34.67     | 280.00 × 56.00    |
| a 40-character title showing                    | 360.33 × 34.67    | 384.76 × 56.00    |
| `['One','Two','Three']` with `label`            | 72.00 × 34.67     | 280.00 × 64.00    |
| the same list, `disabled`                       | 72.00 × 34.67     | 280.00 × 56.00    |
| `wheel`, `['Small','Medium','Large']`, 330 box  | 330.00 × 216.00   | 330.29 × 56.00    |
| `radio`, `['One','Two','Three']`, index 0       | the menu row above  | 114.67 × 144.00   |
| `radio`, `['Small','Medium','Large']`, index 0  | the menu row above  | 133.33 × 144.00   |
| `radio`, five options, index 0                  | the menu row above  | 114.67 × 240.00   |

The three `radio` rows are Android's, and the first of them is the same option list as
the table's first row: a menu is 280 dp wide by Material's own field floor and 56 dp
tall, a group of the same three options is **narrower** than that floor and three
48 dp rows tall, because it has no field and no popup at all. The height is the option
count exactly — 144 and 240 — which the harness asserts at ±1 dp from a poisoned
fallback; the width is the widest row, so `One/Two/Three` (114.67) is narrower than
`Small/Medium/Large` (133.33). On iOS those rows say "the menu row above" because that
is what the variant is there: `Picker.tsx` resolves `radio` to `menu` before the key is
built, so it files its size under the menu's key and measures what the menu measures,
and the harness asserts one control tall rather than three rows.

Three readings from that table are the platforms talking, not us: iOS sizes a menu
to its title (62.67 pt for `Go`, 360.33 pt for 40 characters) while Android keeps
Material's `MinTextFieldWidth` of **280 dp** as a floor, so a short title still
measures 280 dp; a `label` costs Android 8 dp of height and nothing on iOS, which
draws no caption; and a wheel is a wheel only on iOS — Android answers a `wheel`
with the menu control under the wheel's layout policy (see Limits).

**The radio group's box.** The height is one row per option and the row is
Material's own minimum touch target — 48 dp, which the `RadioButton` inside already
asks for through `minimumInteractiveComponentSize()` — so three options are 144 dp
tall and five are 240, measured on the test emulator and asserted there at ±1 dp
(`Picker.harness.tsx`, "measures a radio group as its option count"). The width is
the widest row, measured unbounded like every other `intrinsic` box, with each
label on one line with an ellipsis so a narrower box truncates the label instead of
growing the row; `alignSelf: 'stretch'` remains the opt-in that makes the rows take
the box's width. The rows and the numbers are Android's: on iOS the variant is a
menu and measures like one.

**What the engine starts from.** One declared fallback pair per component:
**72 × 35 pt** (`ios/components/Picker/HybridNitroUiPicker.swift`) and
**280 × 56 dp** (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`) —
the `['One','Two','Three']` row above, height rounded up, because a fallback smaller
than the control is the dead-touch story in `core.md` §7. A `wheel`'s width half
never reaches it: a `fillWidth` shadow node replaces the width with the box's.
Registered at startup through `NitroUiDeclaredFallbacks`, not from the first
view. Every other configuration is a first instance of its own: laid out at the
fallback, corrected the turn it measures (D17).

**The first frame of a cold radio group is therefore the menu's box** — 280 × 56 dp
on Android — because the engine holds one declared fallback per component, not one
per variant. A three-option group is 144 dp tall, so that first frame is wrong in
both axes and gets corrected the turn the control measures, the same cost a cold
iOS `wheel` pays in height. Per-variant fallbacks are what the engine has no room
for; `prewarm` is the way to make a known group mount exact, and the harness mounts
every radio case from a *poisoned* entry so the correction is required rather than
decorative.

**What makes a change re-measure.** Three things move a Picker's box, and each is
wired (for a `radio` group, only the first and the third: its box has no title
term): an `options` change (`options` setter → `noteContentSizeMayHaveChanged()` on
iOS, Compose observation on Android), a **selection** change (a new title in the
button), and a `variant` change. Both platforms reset the host's last-reported size
when `nuiSizingKey` changes, so a new configuration that happens to measure exactly
what the old one did still gets its correcting report through, and D20
keeps a corrected instance re-measuring on later props turns.

There is one measure point no props batch can provide: a **pick** paints a new title
before any render, so the `nuiSizingKey` that names it has not arrived yet — and a
report filed in that moment would be filed under the title that is no longer drawn,
which is how a cache entry ends up holding another configuration's width. Two rules keep
the key and the pixels together:

- **The wrapper knows which title is shown.** `shownIndex` is the controlled value where
  there is one, and otherwise the last index native reported, held in wrapper state. An
  uncontrolled pick costs one React render — what a discrete control costs everywhere
  else — and the key names the title the control is painting.
- **A pick's report waits for the key that names it.** Android arms
  `holdSizingReports()` in the row's `onClick`: the composition still measures, but the
  host keeps that size until `afterUpdate()` — the batch that carries the new key —
  and files it there (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`).
  iOS needs no hold and no longer asks for that measure at all: the echo batch re-keys,
  and the key change is what re-measures. A *refused* pick still re-measures at once,
  under the key that did not change, for the content that key names.

The `update` benchmark cell drives `selectedIndex` from JS, so it exercises the props
path rather than a pick; the pick path is exercised by the `nuiTestSelect` hook (the
harness runs a row's own code path) and by the real-input Picker check, which
picks a longer title with a real tap and asserts the box followed it.

**Over-wide content fits its box** (C1): a menu wider than the caller's box is
measured a second time at the box's width and placed at that width, so the field,
its label and its chevron are all inside the box and still tappable — Material 3
ellipsises the title rather than drawing past the edge
(`docs/tasks/G6-picker/android-light-lower-tint-wheel.png`). Fitting is not
legibility: keep option lists within the width you give the control.

## Tint

`tintColor` reaches something real on both platforms here, which is more than
SegmentedControl can say (a SwiftUI *segmented* `Picker` ignores `.tint()`):

- **iOS** tints the **menu's title and chevron** — measured visually
  (`docs/tasks/G6-picker/ios-light-lower-tint-wheel.png`: a `#FF3B30` picker paints
  a red title). A **wheel does not take it**: its rows keep the scheme's primary and
  secondary label colours, so a tinted wheel looks untinted.
- **Android** tints the field's **focused outline, focused label, focused trailing
  icon and unfocused label** — `OutlinedTextFieldDefaults.colors(focusedBorderColor,
  focusedLabelColor, focusedTrailingIconColor, unfocusedLabelColor)` (the green `Wheel` caption in
  `docs/tasks/G6-picker/android-light-lower-tint-wheel.png`). Every other role keeps
  the scheme's colours, the same one-role trade the Switch and Button make. The
  colour set is served from a bounded process-wide cache keyed on
  `(colour scheme, tint)`, because `OutlinedTextFieldDefaults.colors()` allocates and
  rebuilding it per recomposition per mounted field is exactly the cost the
  "Shared objects" rule in `core.md` is about.

## Accessibility

- **A radio group is one node per row, inside a named group** — what a dump proves,
  and what `scripts/real-input/android.mjs` reads from one it has just tapped: the
  group carries its name once (`label` / `accessibilityLabel`), exactly one row says
  `checked`, the one the finger chose, and the rows of a disabled group say
  `enabled=false`. `selectable(role = Role.RadioButton)` on each row is what gives it
  that role and selected state, and the `RadioButton` inside is drawn, not focusable,
  because its `onClick` is `null` — one press target per option, not two.
  `selectableGroup()` on the column is there for the group semantics a screen reader
  wants, including a spoken position ("2 of 3"); no test in this repo reads that
  position, because `uiautomator` does not print collection info — see the automation
  gap recorded in `docs/tasks/G26-picker-radio.report.md`.
- The control is **a button that opens a list**: iOS gets a menu-style `Picker` with
  `.accessibilityLabel(accessibilityLabel ?? label)`. Android makes the anchor **one**
  semantics node carrying the name, the value, the role and the enabled state
  (`clearAndSetSemantics` on the anchor modifier, `menuAnchor` kept for pointer input),
  because the anchor is the thing the label describes — the rows are in a popup of
  their own.
- **The selected option is drawn and announced.** On iOS that is SwiftUI's own menu (it
  draws the check mark too, visible in
  `docs/tasks/G6-picker/ios-light-menu-open.png`). On Android, since E2, the row is
  Material 3 Expressive's `SelectableDropdownMenuItem`: the selected row draws the
  selected container and shape with a leading check — the same affordance iOS's check
  is — and says `Role.RadioButton` plus `selected` in the semantics tree, which
  `Picker.harness.tsx` reads out of the open popup ("draws the selected row as a
  selected row"). Before E2 it was a `selected` flag on a plain row, with nothing drawn.
- **Disabled is exposed on the node a screen reader lands on.** Read out of
  `uiautomator dump` on an API 35 emulator: the control used to appear as two nodes — the
  focusable `android.widget.EditText` showing the title with `content-desc=""`, and a
  separate `android.view.View` carrying the name with `clickable=false` and
  `enabled=true` *even when the picker was disabled*. That second node is a **Compose
  semantics node of the anchor**: the pre-fix dumps nest it *inside* the `EditText`, and
  the React Native host container would be an *ancestor* of the field, not a child of it.
  (An earlier version of this page called it the RN host container, and before that
  blamed Compose's unmerged-children rule for the `enabled=true`; neither holds —
  `ui-android-1.11.4` reports `enabled = !config.contains(Disabled)`, so a Compose node
  carrying `disabled()` cannot say `true`, and a container cannot nest inside what it
  contains.) *Why* that node answered `enabled=true` was never established, and the fix
  does not need to know: one node cannot disagree with itself. After the fix one node
  carries it all:
  `android.widget.Spinner`, `clickable=true`, the name in `content-desc`, the title as
  its text, and `enabled=false` when disabled — which is what
  `scripts/real-input/android.mjs` now asserts from a dump. Two residuals, both stated
  rather than hidden: the old second node's `enabled=true` is unexplained (nothing in
  this control depends on it now, and step 8 counts the nodes so a second one cannot
  come back unnoticed), and the merged node is not `focusable`. The functional refusal —
  a real tap on a disabled field opens no menu — is measured too.

## Behaviour notes

- **One callback per change.** `onValueChange` is a Nitro callback prop that is
  *always* sent, with a stable no-op when the caller passed nothing (D7b): Nitro
  reads `undefined` as "unset", and a prop that disappeared would leave a recycled
  view holding the previous mount's handler.
- **Every prop is always sent** (D7): `options` is `[]` rather than absent — a
  recycled view would otherwise keep the previous row's choices — and the rest use
  `null` for "not set".
- **Recycling is safe.** `NitroUiPicker` implements `RecyclableView` on both
  platforms: model reset (options, selection, default-seed flag, variant, label,
  tint, sizing key, callback), `expanded` back to closed, and on Android the
  composition disposed before reuse so its popup dies with it. One batched commit per
  JS update; the hosting view is never recreated per update.
- **A picker's options live in a popup, and the harness cannot reach into it**:
  `@react-native-harness/ui` dispatches input into the app's own window, which on
  Android can press the anchor but never a row of the popup. Choosing an option, a
  refused choice snapping back, dismissal on back/outside-tap and what a screen
  reader hears are therefore **real-input** cases with platform UI evidence, not
  in-app assertions that could pass without ever opening a menu.
- **Real taps are proven, not assumed.** `scripts/real-input` opens the menu from
  outside the app (`XCUIDevice` / `adb shell input`) and asserts only on text the app
  renders: a real tap on a row moves the index echo, a refused choice reports twice,
  an unmount while open leaves no popup window behind, and a disabled field opened
  by nothing while the field beside it opened by the same tap.

## Limits

- **`radio` is Android's.** iOS has no radio-group picker style
  (`RadioGroupPickerStyle` is `@available(iOS, unavailable)`), so the variant
  renders the menu there and shows no rows (see The radio variant); use
  `SegmentedControl` on iOS for up to about five visible choices. Android's radio
  group is a plain Material radio group — no per-row icons, no grouping, no
  per-row enabled state.
- Strings only — no icons, no per-option colours, no grouped or disabled rows.
- **No wheel on Android.** Material 3 has no wheel; `variant='wheel'` renders the
  menu control under the wheel's layout policy (fills the box, Material's field
  height) rather than a faked wheel. Ask for `'wheel'` only where iOS-only is
  acceptable, and expect a menu there.
- **Android has a 280 dp field floor**, so a menu with short options is much wider
  than its title. The width follows the title only above that floor.
- The menu is the platform's, so its look is the platform's: an iOS 26+ menu is a
  floating list, Android's is a Material popup, and neither is ours to restyle.
  Beyond `tintColor` there is no row styling, no per-option colour, and no way to
  place the popup.
- A `label` is drawn on Android and not on iOS (iOS uses it as the `Picker`'s label
  for accessibility). A layout that depends on the caption therefore differs.
- Android has no `testID` inside the Compose view: the id lands on the host
  `View.tag`, which is what the harness reads.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
- One declared fallback pair per component, so the first instance of a long-title
  list starts from a 72 pt / 280 dp box and is corrected the turn it measures (D17).
  A cold iOS `wheel` pays the same cost in the other axis — its first frame is the
  menu's 35 pt height against its own 216 — while Android is accurate for both
  variants because both are 56 dp tall.
