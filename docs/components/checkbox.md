# Checkbox

A checkbox: Material 3's `Checkbox` on Android, and on iOS SwiftUI's `Toggle(isOn:)` with a style
that draws Apple's checklist glyph, `checkmark.circle.fill` over `circle`. iOS has no checkbox
control: `CheckboxToggleStyle` is `@available(iOS, unavailable)`, so the control is the `Toggle`
and only its drawing changes. `iosStyle` chooses the picture there: `'circle'` (the default),
`'square'`, or `'switch'`. Android ignores it.

The value, the label, the events and the accessibility element are the same in all three styles.

A press does the same thing wherever it lands on the control, on both platforms: the control asks
for the opposite of what it shows and reports one `onCheckedChange`. Android keeps Material's
ripple. On iOS the row answers touches through a tap target of its own (see [Sizing](#sizing)),
so the `Toggle` does not dim under the finger; a press shows the box changing state.

```tsx
import { Checkbox } from 'react-native-nitro-ui';

const [terms, setTerms] = useState(false);
<Checkbox label="I accept the terms" checked={terms} onCheckedChange={setTerms} />
<Checkbox label="Email me offers" defaultChecked />
```

## API

| Prop                 | Type                               | Default    | Maps to                                                                                                                                                                                         |
| -------------------- | ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`              | `string \| undefined`              | none       | Text beside the box: SwiftUI `Text`, Compose `Text`. Part of the control and of its size. `''` is treated as no label at all, on both platforms. On iOS the glyph is on its left.               |
| `checked`            | `boolean \| undefined`             | unset      | Controlled value. Omit it for an uncontrolled checkbox.                                                                                                                                         |
| `defaultChecked`     | `boolean \| undefined`             | `false`    | Initial value of an uncontrolled checkbox.                                                                                                                                                      |
| `onCheckedChange`    | `(checked: boolean) => void`       | none       | Fired after every user toggle, with the value native now shows.                                                                                                                                 |
| `indeterminate`      | `boolean \| undefined`             | `false`    | The third state: Material's `TriStateCheckbox` dash on Android, `minus.circle.fill` / `minus.square.fill` on iOS. A display, not a value, and `checked` outranks it on both.                    |
| `disabled`           | `boolean \| undefined`             | `false`    | SwiftUI `.disabled()` / Material 3 `enabled = false`. No event fires.                                                                                                                           |
| `tintColor`          | `ColorValue \| undefined`          | none       | The "on" accent: SwiftUI `.tint()` / `CheckboxDefaults.colors(checkedColor:)`. On iOS it colours the filled glyph; the empty box stays the system's secondary label colour.                     |
| `iosStyle`           | `'circle' \| 'square' \| 'switch'` | `'circle'` | iOS only. Which picture to draw: the checklist circle, the square pair, or a `.switch` `Toggle`. Anything unrecognised is `'circle'`. Android ignores it, and its sizing key does not carry it. |
| `style`              | `ViewStyle`                        | none       | Overrides the measured box (see Sizing).                                                                                                                                                        |
| `testID`             | `string \| undefined`              | none       | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.                                                                                                                                   |
| `accessibilityLabel` | `string \| undefined`              | `label`    | Name of the control itself.                                                                                                                                                                     |
| `hybridRef`          | `(view: handle) => void`           | none       | Internal. Read-only handle for this repo's harness.                                                                                                                                             |
| `nuiPerfId`          | `number \| null \| undefined`      | `null`     | Internal. Instance id for perf marks.                                                                                                                                                           |

`Checkbox` is a `View`, so other `ViewProps` (`onLayout`, …) work as usual. `hybridRef` and
`nuiPerfId` are not app API.

## Platform mapping

| Concept     | iOS                                                                                         | Android                                                                |
| ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Control     | `Toggle(isOn:) { label }`, in all three styles                                              | `androidx.compose.material3.Checkbox`                                  |
| Picture     | `iosStyle`: `checkmark.circle.fill` / `.square.fill`, or `.switch`                          | one Material 3 box; the prop is stored and never read                  |
| Third state | `minus.circle.fill` / `minus.square.fill`; `'switch'` has two positions and reads it as off | `androidx.compose.material3.TriStateCheckbox`                          |
| Label       | the `Toggle`'s label, beside the glyph; the row is one tap target                           | a `Row` of box + `Text`, both tappable                                 |
| Value       | `NitroUiControlledValue<Bool>` on `CheckboxModel`                                           | `NitroUiControlledValue<Boolean>` on `CheckboxModel`                   |
| Role        | SwiftUI's toggle trait                                                                      | `Role.Checkbox` with its `ToggleableState`, published by Material 3    |
| Name        | `.accessibilityLabel(_:)` on the element (glyph styles: on its representation)              | `contentDescription` on the merged row only; the box is presentational |
| Host        | `UIHostingController` inside `NitroSwiftUIHost`                                             | `NitroComposeHost<M>: AbstractComposeView`                             |

### Why `indeterminate` is a prop and not a third `checked` value

`checked` is `boolean | null` on both platforms, the same type a `Switch` takes. `indeterminate`
is a display: it picks the third picture (`TriStateCheckbox` on Android, `minus.circle.fill` /
`minus.square.fill` on iOS), and `onCheckedChange` never carries a third value.

`iosStyle='switch'` has two positions, so that style reads `indeterminate` as off and draws
nothing for it.

### What a tap reports, from every state

A press reports the opposite of what the box is showing.

| What the box shows | `indeterminate` | Tap reports | And then the box shows |
| ------------------ | --------------- | ----------- | ---------------------- |
| empty box          | `false`         | `true`      | check mark             |
| check mark         | `false`         | `false`     | empty box              |
| dash               | `true`          | `true`      | check mark             |
| check mark         | `true`          | `false`     | dash                   |

`checked` outranks `indeterminate` on both platforms, so the dash only shows while the value is
off.

The last row needs handling by the caller: a box that is `indeterminate` while `checked` is true
draws a check mark, so the press that empties it reports `false`. Nothing clears `indeterminate`
for you, so a caller that uses the third state for "some of them are selected" drops it when the
user resolves it:

```tsx
const [all, setAll] = useState(false);
const [mixed, setMixed] = useState(false);
<Checkbox
  label="Select all"
  checked={all}
  indeterminate={mixed}
  onCheckedChange={(next) => {
    setAll(next);
    setMixed(false); // the press answered the question the dash was asking
  }}
/>;
```

If it stays set, the box falls back to the dash on the next render (check mark → `false` → dash).
`iosStyle='switch'` does not follow the table: it draws the empty box for the dash row and its
press reports `!checked`.

## Sizing

A checkbox is its box plus its label (`sizing: "intrinsic"`). The host measures the control
unbounded and Yoga lays out that box. The sizing key is `0|iosStyle|label` on iOS and
`indeterminate|label` on Android. A field is in the key only where it changes the box:

- `label` is content. A bare box and a labelled one are different widths, so a new label is a new
  configuration.
- `iosStyle` is in iOS's key and not Android's. iOS draws three pictures that measure apart (the
  table below); Android never reads the prop.
- `indeterminate` is in Android's key and not iOS's. On Android it selects `TriStateCheckbox`, a
  composable of its own. On iOS the dash is painted in the same symbol box, so the row does not
  change size and the field is written `0`. Flipping `indeterminate` on a mounted row costs zero
  size corrections on iOS and one on Android.
- `checked` is in neither key, because neither platform's box moves between states.

Measured on an iPhone Air / iOS 27 simulator and an API 35 `pixel_9` emulator:

| Configuration                         | iOS               | Android           |
| ------------------------------------- | ----------------- | ----------------- |
| no label (default `circle`)           | 26.00 × 26.00 pt  | 48.00 × 48.00 dp  |
| `label="Measured"`, `circle`          | 110.00 × 26.00 pt | 131.05 × 48.00 dp |
| `label="Measured"`, `square`          | 109.00 × 24.00 pt | 131.05 × 48.00 dp |
| `label="Measured"`, `switch`          | 145.00 × 28.00 pt | 131.05 × 48.00 dp |
| `indeterminate`, `label="Select all"` | 103.00 × 26.00 pt | 124.95 × 48.00 dp |

Android draws one box for every `iosStyle`, and Material's dash shares that box. iOS draws three:
the square is 2 pt shorter than the circle, and the switch is 145.00 × 28.00 pt. The dash row is
narrower only because its label is `"Select all"`: the label decides the width, and a dash and an
unchecked box of the same label are the same size.

The declared fallback is 26 × 26 pt on iOS and 48 × 48 dp on Android (`NitroUiSizing.setFallback`
in `ios/components/Checkbox/HybridNitroUiCheckbox.swift` and
`android/.../HybridNitroUiCheckbox.kt`): a bare checkbox in the default style. On Android every
configuration is 48 dp tall, because `minimumInteractiveComponentSize` publishes no smaller
target. The width is a bare box's on both platforms; a labelled Checkbox is wider by its label
(48 against 131.05 dp, and 26 against 110 pt), so the first instance of a new configuration can
show the fallback for one frame.

A user `style` wins. A `width` narrower than the control truncates the label with a trailing
ellipsis on both platforms.

Where a tap lands. Both platforms make the whole control one target. On Android the merged row
node carries the toggle, the box beside it is presentational (`Checkbox.clearAndSetSemantics`)
and the label is inside the row. On iOS a switch-style `Toggle` answers touches on its glyph
only, and the two glyph styles install no gesture of their own, so the row carries an `overlay`
that calls `press()`. It must be an overlay: a `Toggle` claims the whole row for hit testing, so
a `background` layer behind it is never asked. The overlay costs SwiftUI's own press feedback and
the switch thumb's drag. One press is one `onCheckedChange`.

The label is centred against the box. The Android row is 48 dp tall because the box asks for a
48 dp touch target, and the row uses `verticalAlignment = Alignment.CenterVertically`.

## Accessibility

- Android is a checkbox. Material publishes `Role.Checkbox` with its `ToggleableState`, and a
  labelled checkbox merges the box and the text into one node (`mergeDescendants = true`), so
  TalkBack gets one focus stop: "checkbox, checked, Email me offers".
- iOS is one element, in all three styles. A custom `ToggleStyle` does not get the accessibility
  SwiftUI's built-in styles get, so the glyph styles carry an `accessibilityRepresentation`: a
  `Toggle` that is represented, not drawn, with `.disabled` restated inside it. The element is
  XCUITest's `switch` type (SwiftUI's toggle trait), named by `accessibilityLabel ?? label`,
  valued `0`/`1`, on the row's own box. On iOS 27 the hosting view exposes no element to an
  in-app probe, so iOS role and state are checked from outside the app by the real-input tests.
- The third state is announced, in a different word per platform. Android publishes
  `ToggleableState.Indeterminate`, which Compose renders as "Partially checked"
  (`R.string.indeterminate`, `androidx.compose.ui`), localised wherever Compose is. iOS sets
  `.accessibilityValue(Text("mixed"))` only while the dash is showing, so the element reads
  `value="mixed"` where it otherwise reads `0` or `1`. On iOS the word is English in every
  locale: iOS has no public localised string for a checkbox in a mixed state.
- `accessibilityLabel` goes on the control, never on a wrapper, and defaults to `label`. A bare
  Android checkbox has no name of its own: pass `accessibilityLabel` when there is no `label`.
- An empty name is no name. `''` is read as unset for `accessibilityLabel` and for `label`, on
  both platforms. For sizing, `label=""` and no `label` share one sizing key.

## Behaviour notes

- Refused toggles revert. A controlled checkbox whose `onCheckedChange` does not pass the value
  back snaps back: the event count still advances, so a commit happens and native repaints the
  value React kept. The next tap asks for the same value again.
- Stale writes are dropped. A `checked` written while a toggle is in flight is ignored
  ([DESIGN.md](../DESIGN.md), section 3.5).
- A press asks for the opposite of what is showing, whichever path it takes: Material's own
  `onCheckedChange` on Android's bare box, the merged row's `clickable` beside a label, the
  `Toggle` binding and the row's tap target on iOS. Each ends in the model's `press()`.
- Uncontrolled costs no render on either platform, because neither state of a label is a
  different size.
- `NitroUiCheckbox` implements `RecyclableView`: a reused instance resets its model and its event
  counts and re-seeds `defaultChecked`.

## Limits

- iOS has no checkbox control. A Checkbox is a `Toggle` with a style that draws Apple's symbols.
  It is not a system checklist row: no swipe-to-complete, no list separators, and no list-inset
  alignment with the system's tables.
- `iosStyle` does nothing on Android.
- A label is one line, tail-truncated, in the platform's body type. No multiline label and no
  `numberOfLines`.
- A checkbox without a label is unnamed on Android unless `accessibilityLabel` is given.
- Not hostable. A `<Host>` refuses a `Checkbox` with an error that names it.
- The in-app harness cannot tap a checkbox on iOS: its synthesised touch reaches no SwiftUI
  gesture. The harness presses through `nuiTestToggle()`, and `real-input:ios` does the real
  taps.
- No benchmark: `component.json` says `bench: false`.
