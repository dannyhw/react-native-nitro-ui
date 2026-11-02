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
| `style`              | `ViewStyle`                               | none       | Overrides the measured box (see Sizing).                                  |
| `testID`             | `string \| undefined`                      | none       | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.             |
| `accessibilityLabel` | `string \| undefined`                      | `label`    | Label of the control itself.                                              |
| `hybridRef`          | `(view: handle) => void`                  | none       | **Internal.** Read-only handle for this repo's harness.                  |
| `nuiPerfId`          | `number \| null \| undefined`              | `null`     | **Internal.** Instance id for perf marks.                                 |

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
| Icon      | `systemImage` as a leading SF Symbol                              | none (the check mark is the selected filter chip's only icon)   |
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
| "Sized"      | filter, unselected  | 58 × 28     | 66.29 × 48    |
| "Sized"      | filter, selected    | 58 × 28     | 84.19 × 48    |
| "Measured"   | filter or assist    | 88 × 28     | 94.10 × 48    |
| "Re-keyed"   | filter, unselected  | 85.33 × 28  | 89.52 × 48    |
| "Re-keyed"   | filter, selected    | 85.33 × 28  | 107.43 × 48   |

The platforms differ on selection. An iOS chip keeps its size when selected,
since only the fill changes. A Material 3 filter chip grows by its check mark,
17.9 dp here. So on Android the sizing key includes the selection, and each
state of a label has its own measured size. The harness asserts both halves: a
toggled chip settles at the size of a reference chip mounted selected, and a
fresh unselected one needs no correction.

The fallback, the size of the very first frame before anything is measured, is
80 × 28 pt on iOS and 96 × 48 dp on Android (`NitroUiSizing.setFallback` in
`ios/components/Chip/HybridNitroUiChip.swift` and
`android/.../HybridNitroUiChip.kt`). The first instance of a new configuration
can show it for one frame (DECISIONS D17).

A user `style` wins. A `width` smaller than the label truncates it with a
trailing ellipsis instead of painting outside the box (the example's "Long
label" row, 200 wide).

## Accessibility

The control is the platform's, so the accessibility element is too:

- A filter chip is a **toggle button** on iOS: XCUITest reports
  `XCUIElementTypeToggle`, with `value` 1 or 0. On Android it is
  `Role.Checkbox` with a selected state, which reaches the tree as
  `checkable`/`checked`. An assist chip is a button on both.
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
  which is Picker's rule for the same reason.
- **Recycling resets everything.** `NitroUiChip` implements `RecyclableView`: a
  reused instance resets its model and re-seeds `defaultSelected`. The
  conformance suite's two recycle probes cover the default and the
  handshake's counters on both platforms.

## Limits

- Two kinds only. Material's `input` and `suggestion` chips are not in v1, and
  there is no trailing icon, avatar or close button.
- No `tintColor` in v1. Both platforms draw their own selected colours.
- `systemImage` is iOS only, like Button's. Android does not draw it.
- **No check mark slide-in on Android.** Material 3 animates the check mark's
  width as a spring. The host cannot follow an animated intrinsic width: the
  chip stops reporting while it is wider than its box. So the chip always
  passes a leading slot (an empty one when unselected), which makes Material
  skip the animation. The check mark appears at full size, and the chip
  settles at its selected width in one correction.
- On Android the first toggle of a label lays out at the fallback for one
  frame if no chip with that label and state has been measured yet (D17).
- **Not hostable.** A `<Host>` refuses a Chip with an error that names it. No
  round has measured a chip inside a Host yet.
- The iOS harness cannot tap a chip: its HID-less touch reaches no SwiftUI
  button gesture (measured on both kinds). The harness presses through
  `nuiTestPress()`, the same `press()` a tap runs, and real input does the real
  taps.
