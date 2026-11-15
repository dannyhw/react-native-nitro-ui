# Slider

The platform slider: SwiftUI `Slider` on iOS, Material 3 `Slider` on Android, with the control's
own animation, haptics, accessibility behaviour and dynamic-type and locale handling.

```tsx
import { Slider } from 'react-native-nitro-ui';

const [volume, setVolume] = useState(0.5);
<Slider value={volume} onValueChange={setVolume} />;
```

Prop names follow `@react-native-community/slider` (`value`/`defaultValue`/`minimumValue`/
`maximumValue`/`step`/`onValueChange`/`onSlidingStart`/`onSlidingComplete`); `tintColor` follows
this library's `Switch`.

## API

| Prop                 | Type                          | Default        | Maps to                                                                 |
| -------------------- | ----------------------------- | -------------- | ----------------------------------------------------------------------- |
| `value`              | `number \| undefined`         | unset          | Controlled value. Omit it for an uncontrolled Slider.                   |
| `defaultValue`       | `number \| undefined`         | `minimumValue` | Initial value of an uncontrolled Slider.                                |
| `minimumValue`       | `number \| undefined`         | `0`            | `ClosedRange` lower bound / `valueRange` start.                         |
| `maximumValue`       | `number \| undefined`         | `1`            | `ClosedRange` upper bound / `valueRange` endInclusive.                  |
| `step`               | `number \| undefined`         | `0`            | `0` = continuous. Else SwiftUI `step:` / Material 3 `steps` tick count. |
| `disabled`           | `boolean \| undefined`        | `false`        | SwiftUI `.disabled()` / Compose `enabled = false`.                      |
| `tintColor`          | `ColorValue \| undefined`     | platform       | SwiftUI `.tint()` / `SliderDefaults.colors(thumb, activeTrack)`.        |
| `onValueChange`      | `(value: number) => void`     | —              | During a drag, at most once per frame, with the value native shows.     |
| `onSlidingStart`     | `(value: number) => void`     | —              | When a gesture begins, with the value it began at.                      |
| `onSlidingComplete`  | `(value: number) => void`     | —              | When a drag ends, always with the final value.                          |
| `style`              | `ViewStyle`                   | —              | Overrides the default box (see Sizing).                                 |
| `testID`             | `string \| undefined`         | —              | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.           |
| `accessibilityLabel` | `string \| undefined`         | —              | Label of the control itself.                                            |
| `hybridRef`          | `(view: handle) => void`      | —              | Internal. Read-only handle for this repo's harness and benchmarks.      |
| `nuiPerfId`          | `number \| null \| undefined` | `null`         | Internal. Instance id for perf marks; `null` disables marks.            |

`Slider` is a `View`, so any other `ViewProps` work as usual.

`hybridRef` and `nuiPerfId` are not app API. The handle is read-only (plus `measureContent()` and
test-only probes), and it is invoked once when the view mounts.

## Platform mapping

| Concept          | iOS                                                    | Android                                                   |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Control          | `Slider(value:in:[step:]onEditingChanged:)`            | `androidx.compose.material3.Slider`                       |
| Host             | `UIHostingController` inside `NitroSwiftUIHost`        | `NitroComposeHost<M>: AbstractComposeView`                |
| Range            | `ClosedRange<Double>`                                  | `ClosedFloatingPointRange<Float>`                         |
| Stepped          | `step:` when the range ends on a step, else continuous | `steps = wholeSteps - 1` when it does, else continuous    |
| Value            | `NitroUiControlledValue<Double>` on `SliderModel`      | `NitroUiControlledValue<Double>` on `SliderModel`         |
| Drag start       | `onEditingChanged(true)`, or the first `Binding` write | the finger going down on the control's own box            |
| Drag end         | `onEditingChanged(false)`                              | `onValueChangeFinished`, or the finger leaving            |
| Events per frame | one `onValueChange` per `CADisplayLink` tick           | one per `Choreographer` frame callback                    |
| Test id          | RN's `testID` → `accessibilityIdentifier`              | `host.tag` (Compose has no test id)                       |
| Label            | `.accessibilityLabel(_:)` on the Slider                | `Modifier.semantics { contentDescription }` on the Slider |
| Recycle          | hosting controller reused                              | objects reused; composition rebuilt                       |

### What counts as a gesture

The three callbacks describe one gesture, and the gesture is the touch, not the value change. An
app that receives `onSlidingStart` always receives `onSlidingComplete`, and the two bracket
whatever `onValueChange` events the touch produced, in that order: the last value of a gesture
is delivered before the callback that says the gesture ended.

| Input                                        | iOS                                                | Android                                                 |
| -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Drag the thumb                               | start, one change per frame, complete              | the same                                                |
| Touch the track beside the thumb             | nothing: SwiftUI's `Slider` ignores the track      | start, the value it landed on, complete                 |
| Press without moving the thumb off its value | not measured; a track tap reports nothing          | one start, one complete, no change                      |
| A screen-reader step                         | one start, one change, one complete                | the same triple, with the same values                   |
| A release batched with its own last move     | not measured; SwiftUI's `onEditingChanged` decides | one start, the last value, one complete                 |
| A second finger joining and leaving          | not measured; SwiftUI's own gesture                | one start, one complete: the gesture is the first touch |
| A stream a parent takes over (`CANCEL`)      | not measured; SwiftUI's own gesture                | one start, one complete, whatever the value did         |
| The control disabled mid-press               | not measured; `disabled` is SwiftUI's own          | one start, one complete, from the prop that disabled it |

iOS reports what SwiftUI's `Slider` reports: its `onEditingChanged` decides where a drag begins
and ends.

Android takes its start from the control's own touch stream (`sliderPressWatcher` in
`HybridNitroUiSlider.kt`: the finger down on the `Initial` pointer pass, the finger up on
`Final`), not from the first value change. Material 3's tap path only calls `onValueChange` when
the computed value differs, so a motionless touch has no value change to infer a start from.

What a contributor must keep true on Android:

- Material 3 does not act on a touch while it reads it. Foundation's `DragGestureNode` queues
  what it saw and a coroutine on the UI dispatcher drains it afterwards, so the watcher sees a
  release before Material 3 has applied the last value. A finger's last move and its release
  arriving in one batch is ordinary.
- The watcher never ends a drag Material 3 has taken (`SliderState.isDragging` at the release
  says which those are). Material 3 ends those itself, value first and end second. Ending one
  from the watcher would report the complete before the last change and let that change open a
  second drag.
- The watcher ends a touch Material 3 never took as a drag (a stream a parent took over, an
  `ACTION_CANCEL`). It launches that end one main-thread hop later, so it stays behind Material
  3's own work when the slop was crossed in the same batch as the release. `endDrag` is
  idempotent, so only one complete is ever reported.
- A value that arrives with no touch behind it opens its own drag, so a screen-reader step and
  Compose's key-event step report the same start, change, complete triple.

Two Android behaviours that come from Material 3:

- A tap is applied when the finger lifts. Material 3's `onTap` runs after the release, so the
  value a press selects arrives after the start and before the complete, never during the hold.
- A press onto a value JS wrote can report one `onValueChange` carrying the number the thumb
  already had. Material 3 compares the float it derives from the touch with the value it was
  given, and a written `0.5` may not be reproduced exactly by any track position. Pressing the
  same point a second time reports no change.

### Why stepped mode is chosen natively

`step` and the two bounds arrive as one unordered batch, so the platform control is chosen in
`afterUpdate()`. SwiftUI's `step:` and Material 3's `steps` can only draw a range whose top is
one of their stops, so when `maximum - minimum` is not a whole number of steps both platforms use
the continuous control and native quantises. That keeps the maximum reachable
(`<Slider maximumValue={10} step={3} />` can reach 10) and keeps the value JS receives identical
to the value the thumb shows.

Quantising is in one file per platform with one shared set of test vectors
(`ios/components/Slider/NitroUiSliderValue.swift`, `android/.../nitroui/NitroUiSliderValue.kt`):
clamp to the range, snap to the step, then round to 15 significant digits. The rounding is
required: Material's control is `Float`-based, so without it native would hold
`0.30000000000000004` where React holds `0.3`, and the exact comparison of controlled values
would see a change on every commit.

## Sizing

`Slider` is a `fillWidth` control: the width is the Yoga box, the height is measured.

| Platform            | Height the control measures | Box Yoga gives it  |
| ------------------- | --------------------------- | ------------------ |
| iOS (26.4 and 27.0) | 31 pt                       | box width × **31** |
| Android             | 48 dp                       | box width × **48** |

Both heights are measured on device and do not change with the box width. Android's 48 dp is the
control's own height inside Material 3's 48 dp minimum interactive size, so the box includes the
touch target.

`nuiSizingKey` is the empty string: no prop changes a Slider's height (`value`, `step`,
`disabled` and `tintColor` move the thumb or repaint), so there is one configuration and one
cached height for the whole app, which `prewarm(['NitroUiSlider'])` can seed before the first
screen.

The declared fallback is the per-OS height above plus a width (351 pt / 328 dp) that is used
when a parent gives no finite width, such as a horizontal scroller. Under such a parent that
width is what the Slider draws on every frame, because the control has no width of its own.
Under any finite parent the box owns the width and the declared width never shows.

The base style is `{ alignSelf: 'stretch' }` (`FILL_WIDTH_BASE_STYLE`,
`src/components/Slider/Slider.tsx`). An explicit `width`, `height`, `flex` or `alignSelf` in the
caller's `style` wins: a 300 × 60 box keeps 60, and a `width: 200` keeps 200 while the height
stays measured.

The control reports its height even when its box has none, for example with a caller's
`height: 0`. A `fillWidth` measure that waited for a non-zero box height could never run, and on
iOS a stalled host paints SwiftUI's minimum content: a thumb with no track. The measure is gated
on the box's width only.

## Behaviour notes

- Native owns the displayed value during a drag. The thumb follows the finger with no JS round
  trip, and keeps doing so when the JS thread is busy.
- On iOS a drag has to start on the thumb. SwiftUI's `Slider` ignores a touch on the track beside
  its thumb, so tapping the track does nothing there, while Compose's `Slider` moves to a track
  touch.
- At most one `onValueChange` per frame. Samples accumulate natively and a frame tick (iOS
  `CADisplayLink`, Android `Choreographer`) emits the newest one. The frame source is armed from
  the first sample of a drag to the release or a cancel.
- The final value always arrives. `onSlidingComplete` fires at release with the value the thumb
  settled on, even when the last frame already emitted it. A gesture that changed nothing reports
  only the start and complete pair.
- A parent write during a drag is reconciled through the event count
  ([DESIGN.md](../DESIGN.md), section 3.5). A write newer than the last event native emitted is
  applied; a stale one is dropped, so it cannot move the thumb out from under the finger. A write
  is also dropped while native holds a touch sample it has not emitted yet. Release always
  reports the final value.
- A rejected change reverts. If `onValueChange` does not update state, the event count still
  advances, so a commit happens and native repaints the value React kept.
- Uncontrolled costs no render. With no `value` prop, native owns the display and a drag spends
  no React render.
- Disabled means no drag: touches are ignored on both platforms. A drag abandoned by an unmount
  or a recycle is cancelled, and no callback fires.
- `NitroUiSlider` implements `RecyclableView` with a full reset (value, range, callbacks, sizing
  key, event counts, frame source); on Android the composition is disposed and rebuilt before
  reuse.
- Perf marks. With `nitroUiCore.setPerfEnabled(true)` and a `nuiPerfId`, native records
  `propsApplied` and `firstFrame` per instance. Off by default.

## Accessibility

Both platforms expose the control's own adjustable element. The label goes on the hosted control,
never on the container, and is applied only when set, because an empty `accessibilityLabel` would
silence the control's own.

- iOS: the component view vends one `UIAccessibilityElement` with the `.adjustable` trait.
  `accessibilityLabel` is the app's label, `accessibilityValue` is the value the thumb shows (the
  app's unit, not a percentage), and `accessibilityIncrement`/`accessibilityDecrement` step by
  this Slider's own grid. `.accessibilityElement(children: .ignore)` plus
  `.accessibilityAdjustableAction` say the same in SwiftUI. What VoiceOver speaks (wording,
  rotor, whether the value is re-read after a step) is not verified.
- Android: the control's semantics node is set with `clearAndSetSemantics`. It publishes
  `progressBarRangeInfo` (the real range and current value, which Material 3's `Slider` does
  not) and a `setProgress` action that steps by this Slider's own grid; `accessibilityLabel` is
  that node's `contentDescription`. The action receives a target computed by the platform from
  the published progress, so the step direction is taken from that published progress, not from
  the value the model holds.

A step goes through the same native value rules as a drag, so it lands on values the thumb can
show and emits through the same event count. A target equal to the published progress has no
direction and moves nothing (see Limits).

## Limits

- `step` is quantised natively, so a fractional range shows no tick marks. Ticks appear only on
  ranges that end on a step.
- On Android a screen reader cannot step a narrow window over a large offset. Android carries
  `progressBarRangeInfo` in a 32-bit `Float`: at 1e9 a `Float` is 64 apart, so a Slider over an
  epoch-milliseconds window publishes a progress that is not the value it holds, and the
  platform's stride (a twentieth of the range) lands back on that published number. The control
  then moves nothing. iOS takes a direction, not a target, and still steps. Use a coarse `step`
  for such a range.
- A touch a parent takes over is still a gesture. On Android a press that a scrolling parent
  takes over reports `onSlidingComplete` with the value the control had when the finger left.
- Disabling a Slider mid-press closes its gesture and reports `onSlidingComplete`, because the
  app was given the start.
- The in-app harness's label query matches `View.contentDescription`, so it cannot see a Compose
  semantics label. The label is not mirrored onto the host `View`, which would give a screen
  reader a second focus stop.
- No tick labels, no Slider-specific accessibility value formatting, no reversed range.
  `minimumValue > maximumValue` is treated as a one-value range.
- `tintColor` on Android recolours the thumb and active track only; the inactive track keeps the
  Material 3 scheme.
- Android's 48 dp box includes the touch target, so a Slider in a tight row has more vertical
  padding than on iOS.
- No `ref` forwarding; `accessibilityLabel` and `disabled` are the accessibility API.
