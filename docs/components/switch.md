# Switch

The platform toggle: SwiftUI `Toggle` with `.switch` style on iOS, Material 3
`Switch` on Android. Both are hosted by the core runtime
(`docs/architecture/core.md`), so the control is the real one — its own
animation, haptics, a11y behaviour and dynamic-type/locale handling.

```tsx
import { Switch } from 'react-native-nitro-ui';

const [wifi, setWifi] = useState(false);
<Switch value={wifi} onValueChange={setWifi} />;
```

## API

Everything except `style`/`testID`/accessibility props comes from the platform
controls it wraps (UIKit `UISwitch`, Compose `Switch`, React Native's own
`Switch`).

| Prop                 | Type                                | Default   | Maps to                                                             |
| -------------------- | ----------------------------------- | --------- | ------------------------------------------------------------------- |
| `value`              | `boolean \| undefined`              | unset     | Controlled state. Omit it for an uncontrolled Switch.               |
| `defaultValue`       | `boolean \| undefined`              | `false`   | Initial value of an uncontrolled Switch.                            |
| `onValueChange`      | `(value: boolean) => void`          | —         | Fired after every user interaction, with the value native displays. |
| `disabled`           | `boolean \| undefined`              | `false`   | SwiftUI `.disabled()` / Compose `enabled = false`.                  |
| `tintColor`          | `ColorValue \| undefined`           | platform  | SwiftUI `.tint()` / `SwitchDefaults.colors(checkedTrackColor = …)`. |
| `style`              | `ViewStyle`                         | —         | Overrides the default box (see Sizing).                             |
| `testID`             | `string \| undefined`               | —         | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.        |
| `accessibilityLabel` | `string \| undefined`               | —         | Label of the control itself.                                        |
| `hybridRef`          | `(view: handle) => void`            | —         | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`          | `number \| null \| undefined`       | `null`    | **Internal.** Instance id for perf marks; `null` disables marks.        |
| `nuiTestWidth`       | `number \| null \| undefined`       | `null`    | **Internal.** Test-only size-affecting prop, so the sizing harness can drive a real size change through a prop. Not app API. |

`Switch` is a `View`, so any other `ViewProps` (`accessibilityRole`,
`onLayout`, …) work as usual.

Uncontrolled Switches cost no React render per toggle: native owns the
displayed value and JS is only told about it (see `useControlled`).

`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14). The package publishes no
Hybrid View types and no way to write a prop from outside React: the handle is
read-only (plus `measureContent()`, which is a cached value and thread-safe), it
is invoked once when the view mounts, and a new function does not re-run it.

## Platform mapping

| Concept         | iOS                                                 | Android                                                    |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Control       | `Toggle(…).labelsHidden().toggleStyle(.switch)`      | `androidx.compose.material3.Switch`                         |
| Host          | `UIHostingController` inside `NitroSwiftUIHost`      | `NitroComposeHost<M>: AbstractComposeView`                  |
| Theme         | system traits, `.tint()`                             | `MaterialTheme` + dynamic color on Android 12+              |
| Value         | `NitroUiControlledValue<Bool>` on `SwitchModel`      | `NitroUiControlledValue<Boolean>` on `SwitchModel`          |
| Disabled      | `.disabled(true)` + native dimming                  | `enabled = false` + M3 disabled colors                     |
| Test id       | RN's `testID` → `accessibilityIdentifier`            | `host.tag` (Compose has no test id)                        |
| Label         | `.accessibilityLabel(_:)` on the Toggle              | `Modifier.semantics` on the Switch (not the container)     |
| Recycle       | hosting controller reused                            | objects reused; composition rebuilt (`core.md` §6)         |

## Sizing

`measureContent()` is the control's own measurement, the box is what Yoga gave
the Fabric node, and both are asserted on-device by
`example/__tests__/Switch.harness.tsx`:

| Platform             | Content measures | Box Yoga gives it   |
| -------------------- | ---------------- | ------------------- |
| iOS 26 and later     | 61 × 28 pt       | **61 × 28**         |
| iOS 15 - 25          | 51 × 31 pt       | **51 × 31**         |
| Android              | 52.19 × 48 dp    | **52.19 × 48**      |

Content does not grow with the box: rendered in a 90 × 50 box it still reports
the numbers above, and the control is centred inside the space
(`docs/architecture/core.md` §7 explains how each platform is asked). The harness
asserts exactly that, because at the default box the two platforms' answers are
indistinguishable.

The iOS default follows the running OS (DECISIONS D14): the switch changed size
with iOS 26, so one constant cannot be right on both. The first version of this
file shipped 51×31 everywhere, measured on a pre-26 SDK, and on a 26 device that
was a bug rather than a trade-off - SwiftUI lays the Toggle out at 61×28 and
refuses to shrink to 51, so it overflowed the Fabric box, centred: the track
painted roughly 5 pt past the left edge and 7 pt past the right, while RN
hit-tests to the box. The outer ~6 pt of a Switch you could see did nothing, and
the row it sat in was laid out ~12 pt too narrow.

Android's number is the Material 3 track (52×32 dp) inside the 48 dp minimum
interactive size, so the box includes the touch target the platform enforces.
The width is fractional (137 px at the test device's 2.625 density) because it is
the control's real measurement and not a written-down constant.
Both platforms ask the control for its size unbounded (`Constraints()` on
Android, an infinite proposal on iOS), so the recorded content is the control's
own size, not the box's; a box smaller than that is the caller's choice and the
control is centred in it.

**Nothing here is a constant.** The host measures what it hosts and
reports it, and Yoga lays the node out at that (`docs/architecture/sizing.md`).
What `Switch` declares is only the *fallback* — the size used for the very first
layout, before any measurement exists
(`NitroUiSizing.setFallback` in `ios/components/Switch/HybridNitroUiSwitch.swift`
and `android/.../HybridNitroUiSwitch.kt`), and it still follows the running iOS
for the reason above. A real measurement replaces it for the whole process after
the first instance, so an OS whose control is a different size corrects itself
rather than shipping a wrong constant. `DEFAULT_SIZE` is gone; the base style is
just `alignSelf: 'flex-start'` (`src/components/Switch/Switch.tsx`), and the
harness now asserts the box the platform *drew*, not a style
(`example/__tests__/Sizing.harness.tsx`).

A user `style` still wins: `width`, `height` or `flex` fixes the box and the
control centres inside it — measured 120 × 60, and 300 × 28 / 300.19 × 48 for a
`flex: 1` Switch in a 300 × 60 row. The one difference from the stock `Switch` is
the cross axis: once the engine has written a size, Yoga has nothing left to
stretch, so a parent's `alignItems: 'stretch'` does not widen it. Ask for the fill
with `alignSelf: 'stretch'` (measured: 300 wide, control height kept).

Text size does not move this control: neither `Toggle(.switch)` nor the M3 Switch
changes size with font scale, measured at Android `font_scale 1.3` and iOS
Accessibility Large (61 × 28 and 52.19 × 48 both unchanged). The environment epoch
still fires on a real trait or configuration change — it just has nothing to
invalidate here. See `docs/architecture/sizing.md` §9.

## Inside a `<Host>`

`Switch` was the first control `<Host>` could hold, and the only one in 0.1.0;
since 0.4.0 a Host holds all eight (`docs/components/host.md`). On
Android, Switches that are direct children of a `<Host>` are drawn by the Host's
single Compose composition instead of each owning one, which is what brings
their mount memory and UI-thread cost under `@expo/ui`'s shared host. A hosted
Switch keeps its props, events, controlled-value handshake and accessibility
label; what changes is sizing — it is never measured, and its React Native frame
no longer decides where it is drawn (the Host stacks its children in one column).
Find a hosted Switch in UI tests by `accessibilityLabel`, not `testID`: the view
carrying the id reads back `0 × 0` there. On iOS a `<Host>` is a plain `View`
and a Switch inside it is exactly the Switch described on this page.

## Accessibility

The control is the platform's, so the accessibility element is too: iOS hands
over the Toggle's own element — role, value and activation are SwiftUI's — and
Android hands over the M3 Switch's semantics node. Nothing about being a toggle
is re-implemented in JS.

- `accessibilityLabel` goes on the **control**: `.accessibilityLabel(_:)` on the
  Toggle, `Modifier.semantics { contentDescription }` on the Switch. The label
  must stay on the control — putting `accessible`, an `accessibilityRole` or
  another a11y prop on the container can hide that control from VoiceOver /
  TalkBack (`docs/architecture/core.md` §3). Style the box; do not re-role it.
- `disabled` is the enable/disable API; `aria-label` / `aria-disabled` are not
  translated, and there is no `ref` forwarding.
- `testID` is RN's own on iOS (`accessibilityIdentifier`); on Android it lands on
  the host `View.tag`, because Compose has no test id.
- **Android toggle state: unverified.** The Material 3 `Switch` is built with
  `onCheckedChange`, which gives its node `Role.Switch` and a toggleable state.
  But `uiautomator` dumps taken while building `<Host>` reported the labelled
  node as `checkable=false`, `checked=false` (hosted and unhosted alike), which
  would mean TalkBack reads the label without saying on or off. This has not
  been confirmed with TalkBack itself yet.
- Dynamic type does not change this control's size — measured at Android
  `font_scale 1.3` and iOS Accessibility Large, 61 × 28 and 52.19 × 48 both
  unchanged (Sizing above).

## Behaviour notes

- **Rejected changes revert.** `onValueChange` that does not update state leaves
  `value` unchanged; the event count still changed, so a commit happens and
  native repaints the old value. No flicker of an accepted state.
- **Stale writes are dropped.** A `value` prop written while a native event is
  in flight is ignored rather than clobbering what the user just did.
- **Recycling is safe, but does not preserve state.** `NitroUiSwitch` implements
  `RecyclableView`, and RN only pools it when `enableViewRecycling` is on (off by
  default in 0.88). A reused instance resets its model and re-seeds
  `defaultValue`; on Android the composition is disposed before the reuse and
  rebuilt on the next attach (`docs/architecture/core.md` §6), so nothing
  user-visible carries over. On iOS the first commit after a recycle suppresses
  the thumb animation.
- **Perf marks.** With `nitroUiCore.setPerfEnabled(true)` and a `nuiPerfId`,
  native records `propsApplied` and `firstFrame` per instance; drain them with
  `nitroUiCore.drainPerf()`. Off by default, where a mark costs one relaxed
  atomic load.

## Limits

- `tintColor` on Android only re-colours the checked track (`SwitchDefaults`
  keeps the rest of the M3 scheme), which is the closest analogue of iOS `.tint()`.
- Its size is measured, not declared, so the first instance of a new configuration
  costs one layout correction (usually the same numbers — `sizing.md` §4). The
  fallback it starts from is still a per-OS constant.
- A parent's `alignItems: 'stretch'` does not widen it (see Sizing above); stock
  RN's `Switch` does stretch.
- Android has no `testID` inside the Compose view; the id lands on the host
  `View.tag`, which is what the harness and `findNodeByName` read.
- A rejected change reverts *without* animation: the thumb snaps back to the
  value React kept. Only the first commit of a mount suppresses animation
  deliberately (`commit()` in `ios/core/NitroSwiftUIHost.swift`); a post-mount revert
  runs in a plain transaction, and neither platform wraps it in
  `withAnimation`/`animate*AsState`. Deliberate for now — an animated revert is
  a visible contradiction of what the user just did — but it is a polish item.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated;
  `accessibilityLabel` and `disabled` are the a11y API. The label belongs to the
  hosted control, so putting `accessible`, an `accessibilityRole` or another
  a11y prop on the container can hide that control from VoiceOver/TalkBack
  (`docs/architecture/core.md` §3). Style the box; do not re-role it.
