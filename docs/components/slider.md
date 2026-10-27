# Slider

The platform slider: SwiftUI `Slider` on iOS, Material 3 `Slider` on Android.
Both are hosted by the core runtime (`docs/architecture/core.md`), so the control
is the real one — its own animation, haptics, a11y behaviour and
dynamic-type/locale handling.

```tsx
import { Slider } from 'react-native-nitro-ui';

const [volume, setVolume] = useState(0.5);
<Slider value={volume} onValueChange={setVolume} />;
```

Naming follows `@react-native-community/slider`, the de-facto API for this
control (`value`/`defaultValue`/`minimumValue`/`maximumValue`/`step`/
`onValueChange`/`onSlidingStart`/`onSlidingComplete`); `tintColor` follows our own
`Switch`. RN core's `Slider` was removed from the framework in 0.80, so there is
no core component to mirror.

## API

| Prop                 | Type                          | Default      | Maps to                                                        |
| -------------------- | ----------------------------- | ------------ | -------------------------------------------------------------- |
| `value`              | `number \| undefined`         | unset        | Controlled value. Omit it for an uncontrolled Slider.           |
| `defaultValue`       | `number \| undefined`         | `minimumValue` | Initial value of an uncontrolled Slider.                       |
| `minimumValue`       | `number \| undefined`         | `0`          | `ClosedRange` lower bound / `valueRange` start.                 |
| `maximumValue`       | `number \| undefined`         | `1`          | `ClosedRange` upper bound / `valueRange` endInclusive.          |
| `step`               | `number \| undefined`         | `0`          | `0` = continuous. Else SwiftUI `step:` / M3 `steps` tick count. |
| `disabled`           | `boolean \| undefined`        | `false`      | SwiftUI `.disabled()` / Compose `enabled = false`.              |
| `tintColor`          | `ColorValue \| undefined`     | platform     | SwiftUI `.tint()` / `SliderDefaults.colors(thumb, activeTrack)`. |
| `onValueChange`      | `(value: number) => void`     | —            | During a drag, **at most once per frame**, with the value native shows. |
| `onSlidingStart`     | `(value: number) => void`     | —            | When a drag begins, with the value it began at.                 |
| `onSlidingComplete`  | `(value: number) => void`     | —            | When a drag ends, **always** with the final value.              |
| `style`              | `ViewStyle`                   | —            | Overrides the default box (see Sizing).                         |
| `testID`             | `string \| undefined`         | —            | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.    |
| `accessibilityLabel` | `string \| undefined`         | —            | Label of the control itself.                                    |
| `hybridRef`          | `(view: handle) => void`      | —            | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`          | `number \| null \| undefined` | `null`       | **Internal.** Instance id for perf marks; `null` disables marks.   |

`Slider` is a `View`, so any other `ViewProps` work as usual.

`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14): the package publishes no
Hybrid View types and no way to write a prop from outside React. The handle is
read-only (plus `measureContent()`, and the test-only `nuiTestDrag`,
accessibility-step and frame-pump probes), it is
invoked once when the view mounts, and a new function does not re-run it.

## Platform mapping

| Concept        | iOS                                                        | Android                                                          |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Control        | `Slider(value:in:[step:]onEditingChanged:)`                 | `androidx.compose.material3.Slider`                              |
| Host           | `UIHostingController` inside `NitroSwiftUIHost`             | `NitroComposeHost<M>: AbstractComposeView`                        |
| Range          | `ClosedRange<Double>`                                       | `ClosedFloatingPointRange<Float>`                                |
| Stepped        | `step:` when the range ends on a step, else continuous      | `steps = wholeSteps - 1` when it does, else continuous            |
| Value          | `NitroUiControlledValue<Double>` on `SliderModel`           | `NitroUiControlledValue<Double>` on `SliderModel`                 |
| Drag start     | `onEditingChanged(true)`, or the first `Binding` write      | the first value change (Compose has no start callback)            |
| Drag end       | `onEditingChanged(false)`                                   | `onValueChangeFinished`                                           |
| Events per frame | one `onValueChange` per `CADisplayLink` tick              | one per `Choreographer` frame callback                            |
| Test id        | RN's `testID` → `accessibilityIdentifier`                   | `host.tag` (Compose has no test id)                               |
| Label          | `.accessibilityLabel(_:)` on the Slider                     | `Modifier.semantics { contentDescription }` on the Slider          |
| Recycle        | hosting controller reused                                   | objects reused; composition rebuilt (`core.md` §6)                |

### Why stepped mode is chosen natively

`step` and the two bounds arrive as one unordered batch (core.md §3), so the
platform control is chosen in `afterUpdate()` from what the range *is*: SwiftUI's
`step:` and M3's `steps` can only draw a range whose top is one of their stops, so
when `maximum - minimum` is not a whole number of steps both platforms use the
continuous control and **native quantises** instead. That keeps the maximum
reachable (`<Slider maximumValue={10} step={3} />` can reach 10) and keeps the
value JS is told identical to the value the thumb is showing.

Quantising lives in one file per platform with one shared set of test vectors
(`ios/components/Slider/NitroUiSliderValue.swift`,
`android/.../nitroui/NitroUiSliderValue.kt`): clamp to the range, snap to the
step, then round to 15 significant digits. That last step is not cosmetic — a tenth
is not representable in binary, and Material's control is `Float`-based, so
without it native holds `0.30000000000000004` where React holds `0.3` and the
handshake's exact comparison sees a change on every commit (core.md §11).

## Sizing

`Slider` is the repo's first `fillWidth` control (`docs/architecture/sizing.md`
§5): the width is the Yoga box, the height is measured.

| Platform              | Height the control measures | Box Yoga gives it |
| --------------------- | --------------------------- | ----------------- |
| iOS (26.4 and 27.0)   | 31 pt                       | box width × **31** |
| Android               | 48 dp                       | box width × **48** |

Both numbers are measured on device, not read out of a spec,
and both are asserted on-device by `example/__tests__/Slider.harness.tsx`: the
box's height, `measureContent()`'s height, and the same height at a second box
width (so the height provably does not move with the width). iOS was measured on
iOS 26.4 and iOS 27.0 and agrees; Android's 48 dp is the control's own height
inside Material 3's 48 dp minimum interactive size, so the box includes the touch
target the platform enforces.

Because only the height belongs to the control, the harness asserts the height and
the *box* width, and `nuiSizingKey` is the empty string: no prop changes a
Slider's height (`value`, `step`, `disabled` and `tintColor` move the thumb or
repaint), so there is one configuration and one cached height for the whole app —
which is what `prewarm(['NitroUiSlider'])` can warm ahead of the first screen.

The declared fallback is the per-OS height above plus a plausible width
(351 pt / 328 dp, used only when a parent gives no finite width — a Slider in a
horizontal scroller). It is deliberately the *measured* height: for a `fillWidth`
control the width is never corrected, so the height is the only half that can be
wrong, and being wrong costs a visible jump on the first frame (D14, D17). An OS
whose control turns out to be a different size corrects itself from its own
measurement on the first layout rather than shipping a wrong constant.

The base style is `{ alignSelf: 'stretch' }` (`FILL_WIDTH_BASE_STYLE`,
`src/components/Slider/Slider.tsx`) — the opposite of `Switch`'s
`'flex-start'`, for the same reason in reverse: a Slider's width *is* the axis it
wants filled, and `alignSelf` is what decides it. An explicit `width`, `height`,
`flex` or `alignSelf` in the caller's `style` still wins (measured: a 300 × 60 box
keeps 60, and a `width: 200` keeps 200 while the height stays measured).

One invariant belongs here because the first `fillWidth` component is what found
it: the control must answer its height **even when its box has none**. The
ordinary way that happens is a caller's `height: 0` (before declared fallbacks
were registered at startup, a cold first instance supplied its own zero too,
because the declared fallback arrived only with the component's first view — `docs/architecture/sizing.md` §5 and §6).
Either way, a `fillWidth` measure that waits for a non-zero box height can starve
forever, and on iOS a stalled host paints SwiftUI's minimum content: a thumb with
no track, overflowing its neighbours. The gate is the box's *width* only
(`docs/architecture/sizing.md` §5), asserted on both platforms by
`answers its own height even when the box has none`
(`example/__tests__/Slider.harness.tsx`).

## Behaviour notes

- **Native owns the displayed value during a drag.** The thumb follows the finger
  with no JS round trip, and it keeps doing so when the JS thread is busy — the
  example screen has a slider behind a deliberately expensive handler to show it.
- **At most one `onValueChange` per frame.** Coalescing is native: samples
  accumulate and a frame tick (iOS `CADisplayLink`, Android `Choreographer`) emits
  the newest one. Every emission is a JS entry plus the app's handler plus a React
  render plus a props commit back (core.md §11), so per-sample events are exactly
  the stutter this control cannot have. The pump is armed for the whole of a drag —
  from the first sample to the release — and hands itself back at the end or at a
  cancel; a frame with no new sample simply has nothing to emit. The harness asserts
  both halves (`nuiTestFramePumpArmed` is true mid-drag and false after the release,
  after a cancel, and after every accessibility step).
- **The final value always arrives.** `onSlidingComplete` fires at release with
  the value the thumb settled on, even when the last frame already emitted it. A
  gesture that changed nothing reports nothing but the start/complete pair.
- **A parent write during a drag is reconciled, not obeyed blindly.** `value`
  written while a drag is in flight goes through the event-count handshake
  (core.md §4): writes newer than the last event native emitted are applied — they
  are the app deliberately taking control — and stale ones are dropped so they
  cannot yank the thumb out from under the finger. A write is dropped during the
  fraction of a frame in which native holds a touch sample it has not emitted yet:
  JS cannot have seen that value, so accepting a write there would paint the app's
  number and then put the dragged value back under it. Release always hands the
  final value back.
- **A rejected change reverts.** If `onValueChange` does not update state, the
  event count still advanced, so a commit happens and native repaints the value
  React kept.
- **Uncontrolled costs no render.** With no `value` prop, native owns the display
  and JS is only told (see `useControlled`); a drag spends no React render.
- **Disabled means no drag.** Ignored touches on both platforms, and the flag
  follows back on. A drag abandoned by an unmount/recycle is cancelled: no
  callback reaches an app that no longer owns the instance.
- **Recycling is safe.** `NitroUiSlider` implements `RecyclableView` with a full
  reset (value, range, callbacks, sizing key, handshake counters, frame pump);
  on Android the composition is disposed and rebuilt before reuse (core.md §6).
- **Perf marks.** With `nitroUiCore.setPerfEnabled(true)` and a `nuiPerfId`,
  native records `propsApplied` and `firstFrame` per instance. Off by default.

## Accessibility

Both platforms get the control's own adjustable element: the label goes on the
hosted control, never on the container (core.md §3 — a role or `accessible` on the
container hides the real control), and the label is applied only when set, because
an empty `accessibilityLabel` would silence the control's own.

- **iOS**: the component view vends one `UIAccessibilityElement` with the
  `.adjustable` trait: `accessibilityLabel` is the app's label, `accessibilityValue`
  is the value the thumb shows (an app's unit, not a percentage), and
  `accessibilityIncrement`/`accessibilityDecrement` — what VoiceOver's swipe up/down
  performs — step by this Slider's own grid. `.accessibilityElement(children:
  .ignore)` plus `.accessibilityAdjustableAction` say the same thing in SwiftUI, for
  the case where a runtime builds its reader tree past `accessibilityElements`. The
  spoken result (wording, rotor, whether the value is re-read after a step) has not
  been verified with VoiceOver running.
- **Android**: the control's semantics node is `clearAndSetSemantics`-owned: it
  publishes `progressBarRangeInfo` (the real range and current value — M3 1.4's
  `Slider` does not) and a `setProgress` action that steps by this Slider's own grid
  rather than by Compose's stride; `accessibilityLabel` becomes that node's
  `contentDescription`.

The increment goes through the same native value rules as a drag, so an
accessibility step on a range that is not a whole number of steps still lands on
values the thumb can show, and still emits through the same handshake.

## Limits

- **`step` is quantised natively, so a fractional range shows no tick marks.**
  When `maximum - minimum` is not a whole number of steps, both platforms use the
  continuous control and native snaps the value. Ticks appear only on ranges that
  end on a step.
- **Android start events are inferred.** Compose has no drag-start callback, so
  `onSlidingStart` comes from the first value change. A touch that never changes
  the value therefore reports nothing at all: `onSlidingComplete` is guarded on a
  drag having started, so the three callbacks are never half-emitted.
- **Compose semantics are not Views.** `@react-native-harness/ui`'s label query
  matches `View.contentDescription`, so it cannot see the label on either platform's
  hosted control (on iOS it matches the wrapped `UISlider`, whose label SwiftUI sets
  for us); the harness therefore asserts the label reached the control and asserts
  the queried box on iOS only. Mirroring the label onto the host `View` would give
  the reader a second focus stop, which core.md §3 forbids. The *actions* are
  reachable: the harness steps the Android control by invoking its real
  `SetProgress` semantics action, and the iOS one by performing
  `accessibilityIncrement` on the element UIKit vends.
- **No tick labels, no `Slider`-specific a11y value formatting, no reversed
  range.** `minimumValue > maximumValue` is treated as a one-value range (the
  thumb sits at an end) rather than an inverted track.
- **`tintColor` on Android recolours the thumb and active track only**, which is
  the closest analogue of iOS `.tint()`; the inactive track keeps the M3 scheme.
- Android's 48 dp box includes the touch target, so a Slider in a tight row has
  more vertical padding than on iOS by design.
- No `ref` forwarding; `accessibilityLabel` and `disabled` are the a11y API.
