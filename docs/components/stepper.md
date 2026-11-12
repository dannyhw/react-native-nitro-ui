# Stepper

Two halves that move a number by one `step` each. iOS is SwiftUI's own `Stepper`.
**Android has no stepper control**, so its half is composed from two Material 3
tonal icon buttons with an 8 dp gap between them, each disabled at its own bound
— the same statement [icon-button.md](icon-button.md) makes about Material's own
controls, and the reason the two platforms' pictures differ slightly.

It draws **no number**. The value goes to your own text, the way iOS apps do it,
which is also why `accessibilityLabel` is the one prop the control cannot infer:
it announces the value itself, and the name is yours.

```tsx
import { Stepper } from 'react-native-nitro-ui';

<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
  <Text>{quantity}</Text>
  <Stepper
    accessibilityLabel="Quantity"
    value={quantity}
    onValueChange={setQuantity}
    minimumValue={1}
    maximumValue={99}
  />
</View>;
```

## API

| Prop                 | Type                             | Default | Notes                                                              |
| -------------------- | -------------------------------- | ------- | ------------------------------------------------------------------ |
| `value`              | `number \| undefined`            | —       | Present → controlled. Omit it and native owns the displayed value.  |
| `defaultValue`       | `number \| undefined`            | `minimumValue` | Seed for an uncontrolled Stepper. Ignored while `value` is set. |
| `onValueChange`      | `(value: number) => void`        | —       | Once per step, with the value native now displays.                  |
| `minimumValue`       | `number`                         | `0`     | Lower bound.                                                        |
| `maximumValue`       | `number`                         | `100`   | Upper bound.                                                        |
| `step`               | `number`                         | `1`     | Must be greater than `0` — anything else throws in development.     |
| `disabled`           | `boolean`                        | `false` | Both halves take the disabled style; no event fires.                |
| `accessibilityLabel` | `string \| undefined`            | —       | Names the control. The *value* is announced by the control itself.  |
| `testID`             | `string`                         | —       | Forwarded to the native view.                                       |
| `style`              | `StyleProp<ViewStyle>`           | —       | Applied over the control's own `alignSelf: 'flex-start'`.           |

The value names are `Slider`'s, and so is everything the value *means*: clamping,
step snapping and the digits a binary fraction leaves behind are
`NitroUiSliderValue.quantize` on both platforms — imported, not copied, so `0.1`
cannot start meaning two things in one library.

- **Snapping is measured from `minimumValue`**, not from 0, so a `0.5` step on a
  range starting at `0.25` lands on `0.25, 0.75, 1.25`, not on whole halves.
- **The maximum is always reachable.** `0…10` by `3` steps 0 → 3 → 6 → 9 → 10:
  the grid is measured from `minimumValue`, so the stops are the multiples of `3`,
  and the last step is short — the top of the range is a value like any other.
- **A `step` that is not greater than 0 throws in development.** It is not a small
  step, it is no step: the control would sit at one number and report nothing
  while looking like it worked.
- **A value outside the range is clamped**, and a value inside it but off the grid
  is snapped to the grid, before any event and before the control draws.

## Platform mapping

| iOS                                          | Android                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `Stepper(value:in:step:) { Text(label) }` + `.labelsHidden()` | two `FilledTonalIconButton`s in a `Row`, 8 dp apart, sharing one value |
| hold-to-repeat included                       | **no hold-to-repeat**                                              |
| one `.adjustable` element                     | one merged node with `ProgressBarRangeInfo` and a `SetProgress` action |

- **iOS** hands SwiftUI the range and the step, and gets two things for it:
  hold-to-repeat, where **every repeat is one step and so one `onValueChange`**,
  and the half at a bound going inert by itself. The range is handed over with a
  `step:` only when its top is one of the control's own stops; ranges that end
  between stops are drawn without one and snapped here instead, because
  `maximumValue` has to be reachable and SwiftUI's stepped control can stop short
  of it.
- **Android** composes the control. Each half is IconButton's own container at the
  `medium` rung — Material's 48 dp minimum interactive size *outside* the 40 dp
  container token — with IconButton's colours and shapes, so the two halves are
  the same control as the one you get from `<IconButton variant="tonal">`. The
  minus and plus glyphs are the Material Symbols `remove` and `add`, fetched into
  `android/src/main/res/drawable/` by `scripts/icons/fetch-material-symbols.mjs`
  and recorded in its lock (D43).
- **There is no hold-to-repeat on Android.** A tap steps once; press and hold does
  nothing beyond that. It is the one behaviour the two platforms do not share, and
  it is not scheduled.

## Sizing

`intrinsic`, with **one configuration for the whole app**: the two halves are
fixed-width on both platforms, so `minimumValue`, `maximumValue`, `step` and
`disabled` decide which numbers the control steps through and what its halves look
like, never how wide they are. The sizing key is therefore empty, and one cached
size answers every Stepper in the tree.

Measured on both platforms — and the control's declared fallback and its
conformance row are these same numbers, because the fallback is the box and nothing
else (`docs/architecture/sizing.md` §5 says where those tables live):

|            | Width | Height | The box is                                                         |
| ---------- | ----- | ------ | ------------------------------------------------------------------ |
| iOS        | 94 pt | 32 pt  | SwiftUI's own stepper with its label hidden                         |
| Android    | 104 dp| 48 dp  | two 48 dp touch targets and the 8 dp the design puts between them   |

Because the fallback *is* the default box on both platforms, the conformance rule
compares the whole box (`both`), and a warm mount needs no correction. The
poisoned run replaces those numbers with a size no stepper has before a cold
mount, so "the guess was never corrected" still goes red — `Stepper.harness.tsx`
and [conformance](../../example/__tests__/Conformance.harness.tsx) each hold a
line to it.

`Stepper.harness.tsx` measures the claim that the box does not depend on the
range: a `0…2`, a `-500…2000`, a `0…10`-by-`0.5` and a disabled stepper all
measure one number. If a prop that *does* move the box is ever added, that
component has to start naming it in its sizing key, and those cases stop agreeing
first.

## Accessibility

A Stepper is **one adjustable value**, on both platforms — not two buttons. That
is the whole difference between this and a row of two `IconButton`s, and it is why
`accessibilityLabel` matters: the control supplies the value, and you supply the
name.

- **iOS** vends one `.adjustable` element with the value as its own, so VoiceOver
  steps it with a swipe up or down. While `disabled`, the element also carries
  `.notEnabled`, because an inert control a reader can still act on reads as
  broken.
  XCUITest — the tree the real-input sweep reads — has no element type for a
  trait, so that tree calls this element `other` while naming it correctly
  (measured, iOS 27). It is recorded as iOS debt rather than fixed: the harness
  probe reads the trait mask itself and is the witness that the element really is
  adjustable.
- **Android** merges the row into one node that publishes
  `ProgressBarRangeInfo(current, minimum..maximum, steps)` and a `SetProgress`
  action, and each button clears its own semantics away — so TalkBack gets one
  focus stop and no click that a reader could take instead of the value. The
  `steps` it publishes is this control's own grid (`0…10` by `2` → four stops
  between the ends), which is also the number Compose's own delegate divides the
  range by, so one swipe of the reader's is one step of the control's.
- **A reader's step is a step, not a jump.** The action moves the value by one
  `step` of the grid in the direction asked, and past either bound it does nothing
  at all.

Both spell the value without a float's noise — `4`, not `4.0`, and `0.1` stays
`0.1` — so the two platforms announce the same number alike.

## Behaviour notes

- **A tap is painted before React sees it.** The control steps its own value at
  once, reports `(value, eventCount)`, and only accepts a `value` write from React
  once it has seen that many of its own events — the event-count handshake
  `Switch`, `Checkbox`, `Chip` and `Slider` use. A fast tapper is never waiting for
  a render.
- **A step the app refuses snaps back.** Not adopting the value leaves `value`
  unchanged while the event echo still arrives, so the control puts its own number
  back on screen.
- **At a bound the half is disabled and produces no event at all.** Not an event
  with the same value in it: neither the harness seam nor a finger may invent an
  event the control could not have produced. That is one rule with two
  implementations — SwiftUI disables the half itself, and Android hands each button
  the same `canStep` answer the harness reads back.
- **`disabled` sends nothing** in either direction, and follows the flag back on the
  same instance. It also has to look disabled, which the two platforms reach by
  different routes: Android's two Material buttons take the state themselves and paint
  with `onSurface` at 38 %, while SwiftUI's `Stepper` is the one control here that
  `.disabled(_)` leaves undrawn-differently — inert and pixel-for-pixel a live control —
  so iOS states it the way iOS does a control that is off, at half opacity.
- **An uncontrolled Stepper starts at `minimumValue`**, not at a literal `0`, so
  `<Stepper minimumValue={20} />` never displays a number it cannot hold.
- **Recycling resets everything**: the value, the range, the step, the name, the
  disabled flag, the one-shot that applies a default and the handshake's counters.
  A recycled control that kept a previous owner's `0…2` would refuse to step past 2
  under an app that asked for `0…100`.

## Limits

- **No hold-to-repeat on Android**, and no `longPress` repeat either. iOS has it
  because SwiftUI's control does.
- **No value label, no formatting, no suffix.** The control draws two halves and
  nothing else; render the number yourself, which is also how you get `€`, `%` or
  a localized decimal separator.
- **No `step: 0`.** Slider reads `0` as *continuous*; a stepper with no step is a
  bug, so the wrapper throws in development instead.
- **No wrapping, no momentum, no page step** (hold for ten). Each is its own API
  surface and none of them is on the roadmap.
- **The box is not configurable.** No `size`, no `variant`: iOS's control has no
  sizes to offer, and a third of Android's icon-button ladder would then be a lie
  about a control that has two fixed halves.
