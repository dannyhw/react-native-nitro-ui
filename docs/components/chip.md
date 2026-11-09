# Chip

A compact, label-sized control in two kinds. A **filter** chip has a selection.
It is a SwiftUI `Toggle` with `.toggleStyle(.button)` on iOS and a Material 3
`FilterChip` on Android. An **assist** chip is an action. It is a bordered
capsule `Button` on iOS and a Material 3 `AssistChip` on Android. Both are hosted
by the core runtime (`docs/architecture/core.md`), so the control is the real
one, with its own press feedback, accessibility element and dynamic-type
handling.

```tsx
import { Chip } from 'react-native-nitro-ui';

const [open, setOpen] = useState(false);
<Chip label="Open now" selected={open} onSelectedChange={setOpen} />
<Chip variant="assist" label="Directions" systemImage="map" onPress={route} />
<Chip
  variant="assist"
  label="Directions"
  systemImage="map"
  androidIcon={require('./icons/map.xml')}
  onPress={route}
/>
```

## API

| Prop                 | Type                                      | Default    | Maps to                                                                   |
| -------------------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `label`              | `string`                                  | required   | The chip's text: SwiftUI `Text`, M3 `label = { Text(…) }`. One line.      |
| `variant`            | `'filter' \| 'assist' \| undefined`        | `'filter'` | `Toggle(.button)` / `FilterChip`, or `Button(.bordered)` / `AssistChip`. |
| `selected`           | `boolean \| undefined`                     | unset      | Filter: controlled selection. Omit it for an uncontrolled chip.          |
| `defaultSelected`    | `boolean \| undefined`                     | `false`    | Filter: initial selection of an uncontrolled chip.                       |
| `onSelectedChange`   | `(selected: boolean) => void`             | none       | Filter: fired after every user toggle, with the value native displays.    |
| `onPress`            | `() => void`                              | none       | Assist: fired once per tap.                                               |
| `disabled`           | `boolean \| undefined`                     | `false`    | SwiftUI `.disabled()` / M3 `enabled = false`. Neither callback fires.     |
| `systemImage`        | `string \| undefined`                      | none       | iOS only: a leading SF Symbol (`Label(_, systemImage:)`). Android ignores it. |
| `androidIcon`        | `AndroidIconProp \| undefined`              | none       | **Android only**: a leading glyph — a `require`'d `.xml` or a drawable name. [Android icons](#android-icons). |
| `style`              | `ViewStyle`                               | none       | Overrides the measured box (see Sizing).                                  |
| `testID`             | `string \| undefined`                      | none       | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.             |
| `accessibilityLabel` | `string \| undefined`                      | `label`    | Label of the control itself.                                              |
| `hybridRef`          | `(view: handle) => void`                  | none       | **Internal.** Read-only handle for this repo's harness.                  |
| `nuiPerfId`          | `number \| null \| undefined`              | `null`     | **Internal.** Instance id for perf marks.                                 |

## Android icons

`androidIcon` is `Button`'s prop, on this chip, with every rule that prop has — the file
format, where Material Symbols come from, the `@expo/material-symbols` option, the
drawable-name form and the failure table are all in `docs/components/button.md`, "Android
icons". What is Chip's own:

- **iOS never draws it.** `systemImage` is iOS's leading glyph; `androidIcon` is accepted,
  stored (so a handle reads back what React sent) and never painted. Name both and one chip
  looks right on both platforms, with no `Platform.select`.
- **The slot is Material's, at 18 dp** — `FilterChipDefaults.IconSize`, which is the same
  18 dp on both kinds (`AssistChipTokens.IconSize` and `FilterChipTokens.IconSize` agree),
  so an assist chip's glyph and a filter chip's are one size.
- **The colour is the chip's own leading-icon colour**, read from `LocalContentColor` as
  the chip draws the glyph. It follows the variant, the selection and `disabled` without
  this file naming a Material role, which is the difference between a glyph that dims with
  a disabled chip and one that sits at full strength on it.
- **A selected filter chip's check takes the slot.** A selected chip means "checked", and a
  glyph beside a check would say it twice. The check is the same 18 dp, so the swap never
  moves the box; a chip with *no* glyph is the one that grows by the check.
- **A glyph that cannot be resolved leaves the chip exactly its no-glyph self**, to the
  dp, on both kinds. In development the wrapper warns once per name, as `Button` does.
- **The sizing key gains a field**: `variant|selected|systemImage|androidIcon|label`. A
  glyph is a different box, so a chip that changed its icon has to be measured again
  rather than laid out at the previous glyph's width.

Measured: `example/__tests__/Chip.harness.tsx` ("draws the imported glyph in the slot, and
leaves nothing else in its colour") samples the chip's own pixels and asserts that the
difference between a chip with a glyph and one without is 18 dp squared at this device's
density, ±12%; the fixture is a filled square so that difference *is* the slot's area.

A prop that belongs to the other kind is ignored: an assist chip never selects,
and a filter chip never calls `onPress`. `Chip` is a `View`, so other
`ViewProps` (`onLayout`, …) work as usual. `hybridRef` and `nuiPerfId` are not
app API (DECISIONS D14).

## Platform mapping

| Concept   | iOS                                                               | Android                                                         |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Filter    | `Toggle(isOn:) { label }.toggleStyle(.button)`                    | `androidx.compose.material3.FilterChip`                         |
| Assist    | `Button(action:) { label }`                                       | `androidx.compose.material3.AssistChip`                         |
| Shape     | `.buttonStyle(.bordered)`, `.buttonBorderShape(.capsule)`, `.controlSize(.small)` | M3 chip shape, 32 dp tall in a 48 dp touch target |
| Selected  | the bordered style's selected fill                                | M3 selected container plus a leading check mark                 |
| Icon      | `systemImage` as a leading SF Symbol                              | `androidIcon` in `FilterChipDefaults.IconSize`, or the selected filter chip's check mark |
| Value     | `NitroUiControlledValue<Bool>` on `ChipModel`                     | `NitroUiControlledValue<Boolean>` on `ChipModel`                |
| Label     | `.accessibilityLabel(_:)` on the control                          | `Modifier.semantics { contentDescription }` on the chip         |
| Host      | `UIHostingController` inside `NitroSwiftUIHost`                   | `NitroComposeHost<M>: AbstractComposeView`                      |

## Sizing

A chip is its label's size (`sizing: "intrinsic"`). The host measures the
control unbounded and Yoga lays the node out at that. These are the sizes
`example/__tests__/Chip.harness.tsx` measured on iPhone 17 / iOS 27 and an
Android 15 emulator at density 2.625:

| Label        | Variant and state   | iOS (pt)    | Android (dp)  |
| ------------ | ------------------- | ----------- | ------------- |
| "Sized"      | filter, unselected  | 58 × 28     | 62.48 × 48    |
| "Sized"      | filter, selected    | 58 × 28     | 80.38 × 48    |
| "Measured"   | filter              | 88 × 28     | 90.29 × 48    |
| "Measured"   | assist              | 88 × 28     | 94.10 × 48    |
| "Re-keyed"   | filter, unselected  | 85.33 × 28  | 85.71 × 48    |
| "Re-keyed"   | filter, selected    | 85.33 × 28  | 103.62 × 48   |

The platforms differ on selection. An iOS chip keeps its size when selected,
since only the fill changes. A Material 3 filter chip grows by its check mark,
17.91 dp here. So on Android the sizing key includes the selection, and each
state of a label has its own measured size.

The filter rows moved with Android's Expressive button tokens and the assist row did not: the `shapes: ChipShapes`
overload `FilterChip` now takes lays a filter chip out 3.81 dp narrower at both
states than the `shape:` one did — a constant offset, so the growth by the check
mark is untouched — and it shows up only on a chip with a leading slot, which an
assist chip has none of. A glyph grows the chip by **17.90 dp** here, which is not
18 + 8: `FilterChip` starts a chip with no leading icon 16 dp in and one with an icon
8 dp in, so `FilterChipDefaults.IconSize` (18 dp) and the 8 dp of spacing before the
label arrive net of the 8 dp the chip stops needing — which is why the number matches
the check mark above, the same slot in the same place. The harness measures that growth
against a chip of the same label with no glyph, logs it and asserts it to the dp, next
to the pixels that measure the slot's area. The harness asserts both halves: a
toggled chip settles at the size of a reference chip mounted selected, and a
fresh unselected one needs no correction.

The fallback, the size of the very first frame before anything is measured, is
80 × 28 pt on iOS and 96 × 48 dp on Android (`NitroUiSizing.setFallback` in
`ios/components/Chip/HybridNitroUiChip.swift` and
`android/.../HybridNitroUiChip.kt`). The first instance of a new configuration
can show it for one frame (DECISIONS D17).

A user `style` wins. A `width` smaller than the label truncates it with a
trailing ellipsis instead of painting outside the box. That was seen on iOS in
the Storybook `Chip/Sizing` story (160 wide: "Only show places…"). Android sets
`maxLines = 1` with `TextOverflow.Ellipsis` on the label, but no screenshot of
it has been taken yet.

## Accessibility

The control is the platform's, so the accessibility element is too:

- A filter chip is an on/off control. On iOS, SwiftUI's toggle trait reaches
  XCUITest as a `switch` element with `value` 0 or 1 (measured; XCUITest has
  no separate type for a toggle button). On Android it is `Role.Checkbox` with
  a selected state, which reaches the tree as `checkable`/`checked`. An assist
  chip is a button on both.
- `accessibilityLabel` goes on the control, not on a wrapper. It defaults to
  `label`.
- `disabled` reaches the tree on both platforms: iOS `isEnabled == false`,
  Android `enabled="false"`.

Android role and state are asserted in-app by `Chip.harness.tsx`. On iOS 27 the
hosting view exposes no element to an in-app probe, so iOS role and state are
asserted by real input (`RealInputTests.testRealInputChip` and the a11y sweep's
`chip` case).

## Behaviour notes

- **Refused toggles revert.** A controlled chip whose `onSelectedChange` does
  not update `selected` snaps back. The event count still changed, so a commit
  happens and native repaints the value React kept. The next tap asks for the
  same value again.
- **Stale writes are dropped.** A `selected` written while a native toggle is in
  flight is ignored rather than undoing what the user just did.
- **Uncontrolled costs a render on Android only.** On iOS an uncontrolled filter
  chip toggles with no React render. On Android the selection is part of the
  sizing key, so the wrapper re-renders once per toggle to send the new key,
  which is Picker's rule for the same reason. That render also echoes the
  toggle's event count, as a controlled chip's does: native holds the toggle's
  size report until a batch has seen every toggle, so two quick toggles cannot
  file one state's width under the other state's key.
- **Recycling resets everything.** `NitroUiChip` implements `RecyclableView`: a
  reused instance resets its model and re-seeds `defaultSelected`. The
  conformance suite's two recycle probes cover the default and the
  handshake's counters on both platforms.

## Limits

- Two kinds only. Material's `input` and `suggestion` chips are not in v1, and
  there is no trailing icon, avatar or close button.
- No `tintColor` in v1. Both platforms draw their own selected colours.
- On iOS a disabled chip draws the same whether or not it is selected:
  SwiftUI's disabled bordered style drops the selected fill (the "Disabled" row
  of the README screenshot).
- `systemImage` is iOS only, like Button's. Android does not draw it — and `androidIcon`
  is Android-only, so a chip that wants a leading glyph on both platforms names both.
- **No check mark slide-in on Android.** Material 3 animates the check mark's
  width as a spring. The host cannot follow an animated intrinsic width: the
  chip stops reporting while it is wider than its box. So the chip always
  passes a leading slot (an empty one when unselected), which makes Material
  skip the animation. The check mark appears at full size, and the chip
  settles at its selected width in one correction.
  This was re-checked rather than inherited: `ChipKt` in material3
  1.5.0-beta02 still names `expandHorizontally`/`shrinkHorizontally` for that
  visibility, and taking the slot back out still costs a width the deselect
  cannot land on — the toggle round trip in `example/__tests__/Chip.harness.tsx` goes red
  on it.
- On Android the first toggle of a label lays out at the fallback for one
  frame if no chip with that label and state has been measured yet (D17).
- **Not hostable.** A `<Host>` refuses a Chip with an error that names it. No
  round has measured a chip inside a Host yet.
- The iOS harness cannot tap a chip: its HID-less touch reaches no SwiftUI
  button gesture (measured on both kinds). The harness presses through
  `nuiTestPress()`, the same `press()` a tap runs, and real input does the real
  taps.
