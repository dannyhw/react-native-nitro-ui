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
| `hybridRef`          | `(view: NitroUiSwitch) => void`     | —         | Imperative access to the Hybrid View (props, `measureContent()`).   |
| `nuiPerfId`          | `number \| null \| undefined`       | `null`    | Instance id for perf marks; `null` disables marks for this view.     |

`Switch` is a `View`, so any other `ViewProps` (`accessibilityRole`,
`onLayout`, …) work as usual.

Uncontrolled Switches cost no React render per toggle: native owns the
displayed value and JS is only told about it (see `useControlled`).

## Platform mapping

| Concept         | iOS                                                 | Android                                                    |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Control       | `Toggle(…).labelsHidden().toggleStyle(.switch)`      | `androidx.compose.material3.Switch`                         |
| Host          | `UIHostingController` inside `NitroSwiftUIHost`      | `NitroComposeHost<M>: AbstractComposeView`                  |
| Theme         | system traits, `.tint()`                             | `MaterialTheme` + dynamic color on Android 12+              |
| Value         | `NitroUiControlledValue<Bool>` on `SwitchModel`      | `NitroUiControlledValue<Boolean>` on `SwitchModel`          |
| Disabled      | `.disabled(true)` + native dimming                  | `enabled = false` + M3 disabled colors                     |
| Test id       | RN's `testID` → `accessibilityIdentifier`            | `host.tag` (Compose has no test id)                        |
| Recycle       | `prepareForRecycle()` keeps the controller           | `drop()` disposes the composition                          |

## Sizing

Measured on the devices in `docs/tasks/T10-core-switch.report.md`, from inside
the app (`hybridRef.measureContent()` is the control's own measurement, the box
is what Yoga gave the Fabric node):

| Platform  | Content measures | Default box | Notes                                                  |
| --------- | ---------------- | ----------- | ------------------------------------------------------ |
| iOS       | 61 × 28 pt       | **51 × 31** | 51×31 is the visible track (UIKit `UISwitch` intrinsic);  |
| Android   | 52.19 × 48 dp    | **52 × 48** | M3 track is 52×32 inside a 48 dp minimum touch target.   |

SwiftUI reports the Toggle as 61×28 — about 10 pt of label spacing that survives
`labelsHidden()` because the label still exists as an empty view. Using it as the
default box would add a dead zone beside the track that swallows touches, so the
default stays the 51×31 the control actually paints. This is a decision for T11
to revisit once intrinsic sizing exists: `measureContent()` already reports
whatever the content measures, so the wrapper's `DEFAULT_SIZE` constant is the
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
- **Recycling is safe.** `NitroUiSwitch` implements `RecyclableView`; a reused
  instance resets its model and re-seeds `defaultValue`, and the first commit
  after a recycle suppresses the thumb animation on iOS.
- **Perf marks.** With `nitroUiCore.setPerfEnabled(true)` and a `nuiPerfId`,
  native records `propsApplied` and `firstFrame` per instance; drain them with
  `nitroUiCore.drainPerf()`. Off by default, where a mark costs one relaxed
  atomic load.

## Limits

- `tintColor` on Android only re-colours the checked track (`SwitchDefaults`
  keeps the rest of the M3 scheme), which is the closest analogue of iOS `.tint()`.
- The default box is a constant, not a measurement — until T11.
- Android has no `testID` inside the Compose view; the id lands on the host
  `View.tag`, which is what the harness and `findNodeByName` read.
