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

`Switch` is a `View`, so any other `ViewProps` (`accessibilityRole`,
`onLayout`, …) work as usual.

Uncontrolled Switches cost no React render per toggle: native owns the
displayed value and JS is only told about it (see `useControlled`).

`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14). v0.1 publishes no
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

| Platform             | Content measures | Default box         |
| -------------------- | ---------------- | ------------------- |
| iOS 26 and later     | 61 × 28 pt       | **61 × 28**         |
| iOS 15 - 25          | 51 × 31 pt       | **51 × 31**         |
| Android              | 52 × 48 dp       | **52 × 48**         |

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

T11 replaces both constants: `measureContent()` already reports what the hosted
control measures, so `DEFAULT_SIZE` in `src/components/Switch/Switch.tsx` is the
only thing that has to go.

A Nitro Hybrid View is a plain Yoga leaf, so with no `style` at all it would be
0×0. `DEFAULT_SIZE` fills that in; a user `style` wins (the control stays
centered in whatever box it gets).

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
- The default box is a per-OS constant, not a measurement — until T11.
- Android has no `testID` inside the Compose view; the id lands on the host
  `View.tag`, which is what the harness and `findNodeByName` read.
- A rejected change reverts *without* animation: the thumb snaps back to the
  value React kept. Only the first commit of a mount suppresses animation
  deliberately (`ios/core/NitroSwiftUIHost.swift:171-184`); a post-mount revert
  runs in a plain transaction, and neither platform wraps it in
  `withAnimation`/`animate*AsState`. Deliberate for v0.1 — an animated revert is
  a visible contradiction of what the user just did — but it is a polish item.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated;
  `accessibilityLabel` and `disabled` are the a11y API. The label belongs to the
  hosted control, so putting `accessible`, an `accessibilityRole` or another
  a11y prop on the container can hide that control from VoiceOver/TalkBack
  (`docs/architecture/core.md` §3). Style the box; do not re-role it.
