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
| `variant`              | `'menu' \| 'wheel'`                      | `'menu'` | SwiftUI `.menu` / `.wheel`; on Android both are the M3 menu.      |
| `label`                | `string \| undefined`                    | —        | Android: the field's label. iOS: the `Picker`'s label (a11y).     |
| `disabled`             | `boolean \| undefined`                   | `false`  | SwiftUI `.disabled()` / Compose `enabled = false`.                |
| `tintColor`            | `ColorValue \| undefined`                | platform | iOS: the menu's title. Android: the field's active outline/label. |
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
| Control        | `Picker(selection:) { … }.pickerStyle(.menu \| .wheel)`    | `ExposedDropdownMenuBox` + `OutlinedTextField` + `DropdownMenuItem` |
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

Measured on the devices this library's tests run on (iPhone 17 / iOS 27 in pt;
`nitroui_t01`, API 35 at 420 dpi, in dp), with nothing overridden:

| Configuration                                  | iOS             | Android         |
| ----------------------------------------------- | ----------------- | ----------------- |
| `['One','Two','Three']`, index 0, no label      | 72.00 × 34.67     | 280.00 × 56.00    |
| `['Go']`, index 0                               | 62.67 × 34.67     | 280.00 × 56.00    |
| a 40-character title showing                    | 360.33 × 34.67    | 384.76 × 56.00    |
| `['One','Two','Three']` with `label`            | 72.00 × 34.67     | 280.00 × 64.00    |
| the same list, `disabled`                       | 72.00 × 34.67     | 280.00 × 56.00    |
| `wheel`, `['Small','Medium','Large']`, 330 box  | 330.00 × 216.00   | 330.29 × 56.00    |

Three readings from that table are the platforms talking, not us: iOS sizes a menu
to its title (62.67 pt for `Go`, 360.33 pt for 40 characters) while Android keeps
Material's `MinTextFieldWidth` of **280 dp** as a floor, so a short title still
measures 280 dp; a `label` costs Android 8 dp of height and nothing on iOS, which
draws no caption; and a wheel is a wheel only on iOS — Android answers a `wheel`
with the menu control under the wheel's layout policy (see Limits).

**What the engine starts from.** One declared fallback pair per component:
**72 × 35 pt** (`ios/components/Picker/HybridNitroUiPicker.swift`) and
**280 × 56 dp** (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`) —
the `['One','Two','Three']` row above, height rounded up, because a fallback smaller
than the control is the dead-touch story in `core.md` §7. A `wheel`'s width half
never reaches it: a `fillWidth` shadow node replaces the width with the box's.
Registered at startup through `NitroUiDeclaredFallbacks` (T14), not from the first
view. Every other configuration is a first instance of its own: laid out at the
fallback, corrected the turn it measures (D17).

**What makes a change re-measure.** Three things move a Picker's box, and each is
wired: an `options` change (`options` setter → `noteContentSizeMayHaveChanged()` on
iOS, Compose observation on Android), a **selection** change (a new title in the
button), and a `variant` change. Both platforms reset the host's last-reported size
when `nuiSizingKey` changes, so a new configuration that happens to measure exactly
what the old one did still gets its correcting report through (G2's F1), and D20
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
harness runs a row's own code path) and by the real-input `menu box follows a picked
title` case.

**Over-wide content fits its box** (C1): a menu wider than the caller's box is
measured a second time at the box's width and placed at that width, so the field,
its label and its chevron are all inside the box and still tappable — Material 3
ellipsises the title rather than drawing past the edge
(`docs/tasks/G6-picker/android-light-lower-tint-wheel.png`). Fitting is not
legibility: keep option lists within the width you give the control.

## Tint

`tintColor` reaches something real on both platforms here, which is more than
SegmentedControl can say (G4's F1: a SwiftUI *segmented* `Picker` ignores
`.tint()`):

- **iOS** tints the **menu's title and chevron** — measured visually
  (`docs/tasks/G6-picker/ios-light-lower-tint-wheel.png`: a `#FF3B30` picker paints
  a red title). A **wheel does not take it**: its rows keep the scheme's primary and
  secondary label colours, so a tinted wheel looks untinted.
- **Android** tints the field's **active outline and label** — the `TextFieldColors`
  accent roles (the green `Wheel` caption in
  `docs/tasks/G6-picker/android-light-lower-tint-wheel.png`). Every other role keeps
  the scheme's colours, the same one-role trade the Switch and Button make. The
  colour set is served from a bounded process-wide cache keyed on
  `(colour scheme, tint)`, because `TextFieldDefaults.colors()` allocates and
  rebuilding it per recomposition per mounted field is exactly the cost the
  "Shared objects" rule in `core.md` is about.

## Accessibility

- The control is **a button that opens a list**: iOS gets a menu-style `Picker` with
  `.accessibilityLabel(accessibilityLabel ?? label)`. Android makes the anchor **one**
  semantics node carrying the name, the value, the role and the enabled state
  (`clearAndSetSemantics` on the anchor modifier, `menuAnchor` kept for pointer input),
  because the anchor is the thing the label describes — the rows are in a popup of
  their own.
- **The selected option is announced.** On iOS that is SwiftUI's own menu (it draws
  the check mark too, visible in
  `docs/tasks/G6-picker/ios-light-menu-open.png`). On Android Material 1.4's
  `DropdownMenuItem` has no `selected` argument and a check mark would be an
  affordance iOS does not have, so it is semantics only: `selected = isSelected` on
  the row.
- **Disabled is exposed on the node a screen reader lands on.** Read out of
  `uiautomator dump` on `nitroui_t01`: the control used to appear as two nodes — the
  focusable `android.widget.EditText` showing the title with `content-desc=""`, and a
  separate `android.view.View` carrying the name with `clickable=false` and
  `enabled=true` *even when the picker was disabled*. That second node is the React
  Native host view: `accessibilityLabel` is also an RN base prop, so RN puts it on the
  container as `contentDescription`, and RN knows nothing about `disabled`. (An earlier
  version of this page blamed Compose's unmerged-children rule for that `enabled=true`;
  `ui-android-1.11.4` reports `enabled = !config.contains(Disabled)`, so a Compose node
  carrying `disabled()` cannot say `true`.) After the fix one node carries it all:
  `android.widget.Spinner`, `clickable=true`, the name in `content-desc`, the title as
  its text, and `enabled=false` when disabled — which is what
  `scripts/real-input/android.mjs` now asserts from a dump. Two residuals, both stated
  rather than hidden: the host view still gets RN's `contentDescription` (every control
  with an `accessibilityLabel` prop has the same, so it is a core question, not
  Picker's), and the merged node is not `focusable`. The functional refusal — a real
  tap on a disabled field opens no menu — is measured too.

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
