# Progress

The platform progress indicator: SwiftUI `ProgressView` (`.linear` / `.circular`) on iOS, Material
3 `LinearProgressIndicator` / `CircularProgressIndicator` plus the Expressive
`LinearWavyProgressIndicator` / `CircularWavyProgressIndicator` and `LoadingIndicator` on Android.
The drawing, the indeterminate animation, the accessibility behaviour and the dynamic-type and
RTL handling are the platform's.

```tsx
import { Progress } from 'react-native-nitro-ui';

<Progress value={uploaded / total} />; // a bar that fills
<Progress variant="circular" />; // a ring that spins
<Progress variant="circular" appearance="wavy" />; // Material's wavy ring
<Progress variant="loading" contained />; // Material's morphing shape
```

The last two are Material 3 Expressive shapes. Android draws them; iOS has neither a wavy
indicator nor a morphing one, so it draws the closest `ProgressView` (see Platform mapping and
Limits).

A Progress is not interactive: there are no callbacks and no event count. React always owns
`value`, so writing it at 60 Hz is one `number` prop and one commit per frame.

For the `ActivityIndicator` look, use an indeterminate ring:

```tsx
<Progress variant="circular" /> // no `value` = indeterminate
```

## API

| Prop                 | Type                                  | Default    | Maps to                                                                                                                  |
| -------------------- | ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `variant`            | `'linear' \| 'circular' \| 'loading'` | `'linear'` | SwiftUI `.progressViewStyle()` / which Material 3 composable is built.                                                   |
| `appearance`         | `'flat' \| 'wavy'`                    | `'flat'`   | Material 3 `LinearWavyProgressIndicator` / `CircularWavyProgressIndicator`. Android only; iOS draws flat.                |
| `contained`          | `boolean`                             | `false`    | `ContainedLoadingIndicator` instead of `LoadingIndicator`. Android only, and only with `variant="loading"`.              |
| `value`              | `number \| null \| undefined`         | `null`     | The fraction shown, `0…1`. `null`/`undefined` = indeterminate. On iOS a circular indicator does not draw it; see Limits. |
| `tintColor`          | `ColorValue \| undefined`             | platform   | SwiftUI `.tint()` / Material 3 `color`.                                                                                  |
| `trackColor`         | `ColorValue \| undefined`             | platform   | Material 3 `trackColor`. Android only; see Limits.                                                                       |
| `style`              | `ViewStyle`                           | —          | Overrides the default box (see Sizing).                                                                                  |
| `testID`             | `string \| undefined`                 | —          | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.                                                            |
| `accessibilityLabel` | `string \| undefined`                 | —          | Label of the indicator itself.                                                                                           |
| `hybridRef`          | `(view: handle) => void`              | —          | Internal. Read-only handle for this repo's harness and benchmarks.                                                       |
| `nuiPerfId`          | `number \| null \| undefined`         | `null`     | Internal. Instance id for perf marks; `null` disables marks.                                                             |

`Progress` is a `View`, so any other `ViewProps` work as usual.

`hybridRef` and `nuiPerfId` are not app API. The handle is read-only (plus `measureContent()`,
and the test-only `nuiTestDisplayedValue` / `nuiTestIsAnimating`). It is invoked once when the
view mounts, so after a `variant` change, which remounts (see Sizing), a handle you kept belongs
to a dropped view.

There is no `animated` prop: the library neither adds nor suppresses an animation between two
fractions (see Behaviour notes).

## Platform mapping

| Concept             | iOS                                                                                           | Android                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control             | `ProgressView(value:)` + `.progressViewStyle(.linear/.circular)`                              | `LinearProgressIndicator` / `CircularProgressIndicator` (Material 3)                                                                              |
| Host                | `UIHostingController` inside `NitroSwiftUIHost`                                               | `NitroComposeHost<M>: AbstractComposeView`                                                                                                        |
| Indeterminate       | `ProgressView()` with no value; a bar stays an empty track (Limits)                           | the overload without `progress`                                                                                                                   |
| Determinate value   | the `Double`, clamped at the draw site; drawn by the bar only, a ring keeps spinning (Limits) | `progress = { Float }` lambda, read by Material 3's own composition                                                                               |
| Indicator colour    | `.tint(_:)`                                                                                   | `color:` (`ProgressIndicatorDefaults.*Color` when untinted)                                                                                       |
| Track colour        | nothing addresses the track                                                                   | `trackColor:` (`…linearTrackColor` / `…circular*TrackColor`)                                                                                      |
| `appearance="wavy"` | no such control; the flat bar/ring is drawn (Limits)                                          | `LinearWavyProgressIndicator` / `CircularWavyProgressIndicator`, determinate and indeterminate, at Material's own amplitude, wavelength and speed |
| `variant="loading"` | a circular `ProgressView`, the closest native control (Limits)                                | `LoadingIndicator` / `ContainedLoadingIndicator`, determinate with a `value`, indeterminate without                                               |
| `contained`         | nothing to contain; stored, and paints nothing                                                | the tonal container behind the morphing shape (`containerColor`)                                                                                  |
| Value animation     | the toolkit's; each value is drawn as it arrives                                              | Material 3 draws the lambda's value; it does not interpolate                                                                                      |
| Indeterminate       | the toolkit's own animation                                                                   | the toolkit's own animation (Compose-driven)                                                                                                      |
| Test id             | RN's `testID` → `accessibilityIdentifier`                                                     | `host.tag` (Compose has no test id)                                                                                                               |
| Label               | `.accessibilityLabel(_:)`                                                                     | `Modifier.semantics { contentDescription }`                                                                                                       |
| Recycle             | hosting controller reused                                                                     | objects reused; composition rebuilt                                                                                                               |

## Sizing

The variants use two sizing policies ([DESIGN.md](../DESIGN.md), section 3.6):

- `linear` is `fillWidth`. Its height is its own; its width is the box. The wrapper adds
  `alignSelf: 'stretch'` so a parent's cross-axis alignment cannot shrink the box.
- `circular` and `loading` are `intrinsic`: each measures its own square, and the wrapper adds
  `alignSelf: 'flex-start'` so a stretching parent cannot widen the ring into an ellipse.

`nuiSizingKey` names the configuration: the shape, and the two props that change a shape's size
on Android.

| Props sent                   | Key                    |
| ---------------------------- | ---------------------- |
| `linear`                     | `''`                   |
| `linear appearance="wavy"`   | `'wavy'`               |
| `circular`                   | `'circular'`           |
| `circular appearance="wavy"` | `'circular\|wavy'`     |
| `loading`                    | `'loading'`            |
| `loading contained`          | `'loading\|contained'` |

`''` is the configuration `prewarm(['NitroUiProgress'])` seeds. The two props are normalised
before they reach the key: `appearance` means nothing for `'loading'` and `contained` means
nothing for a bar or a ring, so a prop that cannot change the drawing never creates a cache
entry.

### Measured sizes

Measured on an iPhone Air simulator on iOS 27 and an API 35 emulator at 420 dpi:

| Configuration                | iOS                                   | Android                                                                              |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `linear`                     | 4 pt tall; width = the box            | 4.19 dp tall (Material 3's 4 dp track = 11 whole px at 420 dpi); width = the box     |
| `linear appearance="wavy"`   | 4 pt, the flat bar                    | 9.90 dp tall (Material's 10 dp wave = 26 whole px, rounded down like the flat bar's) |
| `circular`                   | 20 × 20 pt                            | 40 × 40 dp                                                                           |
| `circular appearance="wavy"` | 20 × 20 pt, the flat ring             | 48 × 48 dp (Material's `WaveSize`)                                                   |
| `loading`                    | 20 × 20 pt, a circular `ProgressView` | 48 × 48 dp, the morphing shape 38 dp inside it                                       |
| `loading contained`          | 20 × 20 pt, the same                  | 48 × 48 dp; the container is the box                                                 |

`contained` does not change the box on either platform. It is in the key so the two
configurations do not share a cache entry.

The declared fallback is `320 × 4` with the `fillWidth` policy on both platforms, registered at
startup through `NitroUiDeclaredFallbacks`:

- The declared height is the linear one, which is the default variant, so a cold bar is laid out
  at the right thickness on the first frame. Under a finite parent only the declared height
  shows, because the box owns the width. Under a parent that gives no finite width, such as a
  horizontal `ScrollView`, the declared width is what draws on every frame: a linear bar has no
  intrinsic width, so the bar is 320 long. Give the bar an explicit `width` style if 320 is wrong
  for the layout.
- The fallback is per component, not per configuration, so a cold mount of the ring starts from
  the bar's box and is corrected to 20 pt / 40 dp one frame later.

A `variant` change remounts the native view (the wrapper keys it on the shape): the shapes are
different controls, and the Android host decides which sizing question to ask when the
composition is built. A Progress has no native state to lose.

An `appearance` or `contained` change does not remount: neither changes the sizing policy, so
both re-measure in place through `nuiSizingKey`.

## Behaviour notes

### Values that are not in range

`value` is clamped natively to `0…1`, and `NaN` becomes 0. The prop getter still returns what
React sent, unclamped: the clamp is at the draw site, so `handle.value` reads `1.5` after a write
of `1.5` while the bar is full.

### Determinate ↔ indeterminate

`value = null` is indeterminate, not empty. Both platforms switch the control's shape (Material 3
has separate overloads and separate track defaults for the two states) and both report the change
to a screen reader.

### The indeterminate animation stops when nobody can see it

Both platforms gate the indeterminate animation on window membership:

- iOS: a zero-size sibling observer (`NitroUiProgressWindowObserver`) reports `didMoveToWindow`.
  Off-window the model draws an empty determinate indicator in the same style, so the measured
  size does not move and nothing animates. The swap is only visible on a linear bar; a circular
  style looks the same with a value and without one (Limits).
- Android: the same rule on the same flag, driven by the host's attach/detach callbacks and the
  recycle path. An off-window control is composed as determinate, so Material 3's
  `rememberInfiniteTransition` leaves the composition.

`nuiTestIsAnimating()` reports "indeterminate and on screen". It is what the view was asked to
do. On Android that is what the pixels do. On iOS a determinate ring reports `false` and spins
anyway, and an indeterminate bar reports `true` and does not move (see Limits). The CPU saved by
the gate is not measured.

### No interpolation

The library never interpolates a value. Each fraction is drawn as it arrives, so a 60 Hz source
looks smooth and a coarse one looks like steps. An app that wants a tween owns it (Reanimated on
the JS side, for example). Whether the toolkit wraps a write in its own animation is the
toolkit's.

### One commit per update

`afterUpdate()` is `host.commit()` and nothing else. 20 awaited writes cost 20 `propsApplied`
marks and exactly one `firstFrame`, and a dropped view marks nothing.

## Accessibility

Determinate is a progress bar with a value; indeterminate is a progress bar that says so.

- iOS: SwiftUI's `ProgressView` is the element. `.accessibilityLabel(_:)` is added only when a
  label is given, and `.accessibilityValue("<n>%")` when there is a value.
- Android: one `clearAndSetSemantics` node with `contentDescription` when labelled, and
  `progressBarRangeInfo` = `ProgressBarRangeInfo(value, 0f..1f, 0)` or
  `ProgressBarRangeInfo.Indeterminate`.

Every configuration reads the same way on Android, because the node is built once, above the
`when` that picks the composable: TalkBack says "In progress" plus the label, and the percentage
when there is a value. `clearAndSetSemantics` replaces the semantics the wavy indicators and
`LoadingIndicator` publish themselves, so the value announced is the one React sent. On iOS
`loading` is a circular `ProgressView` and `wavy` is the flat control, so VoiceOver reads what
the matching `variant` reads.

## Limits

- `trackColor` is Android-only, and on a contained loading indicator it paints the container
  (see the `contained` item). SwiftUI's `ProgressView` has no API that addresses its track, so on
  iOS the prop is accepted, stored and paints nothing.
- A determinate `circular` indicator does not show its value on iOS. SwiftUI's `.circular`
  `ProgressView` keeps spinning whatever fraction it is handed, so `variant="circular"` with a
  `value` looks like the indeterminate ring: the number reaches VoiceOver (`accessibilityValue`)
  and the handle, not the pixels. Android draws it. SwiftUI's `Gauge` with
  `.gaugeStyle(.accessoryCircularCapacity)` is not a substitute: it lays out a 58 pt circle where
  this control's rings are 20 pt on iOS and 40 dp on Android, so a ring would resize when a value
  arrived.
- On iOS an indeterminate `linear` bar shows an empty track and does not animate. It is
  pixel-identical to the same bar at `value={0}`. UIKit's `UIProgressView` has no indeterminate
  mode (its `isIndeterminate` is read-only and never true). Use a ring where indeterminate motion
  carries meaning.
- `appearance="wavy"` is Android-only. SwiftUI has no wavy progress indicator, so iOS stores the
  prop and draws the flat bar or ring.
- `variant="loading"` is a circular `ProgressView` on iOS, at the ring's 20 pt. Material's
  morphing shape has no iOS counterpart.
- `appearance` does not apply to `variant="loading"`, on either platform. The wrapper resolves
  `wavy` + `loading` to `flat` before it reaches native, and its sizing key is `'loading'`. In
  the same way `contained` on a bar or a ring is resolved to `false`.
- `contained` is Android-only, and it is where `trackColor` paints: on a
  `ContainedLoadingIndicator`, `trackColor` colours the tonal container behind the shape.
- `LoadingIndicator` and `ContainedLoadingIndicator` are `@ExperimentalMaterial3ExpressiveApi` in
  material3 1.5.0-beta02, so `HybridNitroUiProgress.kt` opts in at one private composable. An
  experimental member can change or disappear at a minor version; the library pins material3, so
  such a change fails the build in that file. The two wavy indicators are not experimental.
- A wavy ring keeps its track while indeterminate; a flat ring does not. Material's wavy
  indicators use one visible track default for both states
  (`ProgressIndicatorTokens.TrackColor`), while the flat `CircularProgressIndicator`'s
  indeterminate track is transparent.
- No size or thickness control. `controlSize` and `frame()` conflict with the control's own
  measurement, so the sizes above are fixed, and `style` overrides the box: a bar in a 60 pt-tall
  box still draws 4 pt of bar inside it, centred.
- No label or formatted value inside the control. Labelling is `accessibilityLabel` on both
  platforms.
- `variant` changes remount; `appearance` and `contained` changes do not (see Sizing). A remount
  drops the `hybridRef` handle.
