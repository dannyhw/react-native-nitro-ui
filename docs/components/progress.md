# Progress

The platform progress indicator: SwiftUI `ProgressView` (`.linear` / `.circular`)
on iOS, Material 3 `LinearProgressIndicator` / `CircularProgressIndicator` on
Android, both hosted by the core runtime (`docs/architecture/core.md`) — so the
drawing, the indeterminate animation, the a11y behaviour and the dynamic-type
and RTL handling are the platform's.

```tsx
import { Progress } from 'react-native-nitro-ui';

<Progress value={uploaded / total} />;      // a bar that fills
<Progress variant="circular" />;            // a ring that spins
```

It is the library's first **non-interactive** component: nothing on a Progress
can be changed by the user, so there are no callbacks, no `onValueChange`, and no
event-count handshake (DECISIONS D7b, `docs/architecture/core.md` §12). React
always owns `value`, which is what makes writing it at 60 Hz cheap — one `number`
prop and one commit per frame, with no round trip to wait for.

For the `ActivityIndicator` look (`variant="circular"`, indeterminate) there is no
second component to add:

```tsx
<Progress variant="circular" />             // no `value` = indeterminate
```

## API

| Prop                 | Type                          | Default  | Maps to                                                        |
| -------------------- | ----------------------------- | -------- | -------------------------------------------------------------- |
| `variant`            | `'linear' \| 'circular'`      | `'linear'` | SwiftUI `.progressViewStyle()` / which M3 composable is built.  |
| `value`              | `number \| null \| undefined` | `null`   | The fraction shown, `0…1`. `null`/`undefined` = **indeterminate**. |
| `tintColor`          | `ColorValue \| undefined`     | platform | SwiftUI `.tint()` / M3 `color`.                                 |
| `trackColor`         | `ColorValue \| undefined`     | platform | M3 `trackColor`. **Android only today** — see Limits.            |
| `style`              | `ViewStyle`                   | —        | Overrides the default box (see Sizing).                          |
| `testID`             | `string \| undefined`         | —        | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.     |
| `accessibilityLabel` | `string \| undefined`         | —        | Label of the indicator itself.                                   |
| `hybridRef`          | `(view: handle) => void`      | —        | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`          | `number \| null \| undefined` | `null`   | **Internal.** Instance id for perf marks; `null` disables marks.   |

`Progress` is a `View`, so any other `ViewProps` work as usual.

`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14): v0.1 publishes no
Hybrid View types and no way to write a prop from outside React. The handle is
read-only (plus `measureContent()`, and the test-only `nuiTestDisplayedValue` /
`nuiTestIsAnimating`), it is invoked once when the view mounts, and a new function
does not re-run it — so after a `variant` change (which remounts, see Sizing) the
handle you kept belongs to a dropped view.

There is no `animated` prop. Interpolating between two fractions is the
toolkits' decision and we do not override it in either direction (Behaviour
notes), so a flag would have nothing to switch.

## Platform mapping

| Concept           | iOS                                                            | Android                                                          |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Control           | `ProgressView(value:)` + `.progressViewStyle(.linear/.circular)` | `LinearProgressIndicator` / `CircularProgressIndicator` (M3)      |
| Host              | `UIHostingController` inside `NitroSwiftUIHost`                 | `NitroComposeHost<M>: AbstractComposeView`                        |
| Indeterminate     | `ProgressView()` with no value                                  | the overload without `progress`                                   |
| Determinate value | the `Double`, clamped at the draw site                          | `progress = { Float }` lambda, read by M3's own composition        |
| Indicator colour  | `.tint(_:)`                                                     | `color:` (`ProgressIndicatorDefaults.*Color` when untinted)        |
| Track colour      | **nothing addresses the track**                                 | `trackColor:` (`…linearTrackColor` / `…circular*TrackColor`)       |
| Value animation   | the toolkit's; ours is "draw what arrived"                      | M3 draws the lambda's value; it does not interpolate               |
| Indeterminate     | the toolkit's own animation                                     | the toolkit's own animation (Compose-driven)                       |
| Test id           | RN's `testID` → `accessibilityIdentifier`                       | `host.tag` (Compose has no test id)                                |
| Label             | `.accessibilityLabel(_:)`                                       | `Modifier.semantics { contentDescription }`                        |
| Recycle           | hosting controller reused                                       | objects reused; composition rebuilt (`core.md` §6)                 |

## Sizing

Opted in per `docs/architecture/sizing.md` §5, and the two variants use the two
different policies — the only component so far to need both:

- **`linear` is `fillWidth`.** Its height is its own; its width *is* the box. The
  wrapper adds `alignSelf: 'stretch'` (sizing.md §6) so a parent's cross-axis
  alignment cannot shrink the box out from under it.
- **`circular` is `intrinsic`** (`docs/architecture/sizing.md` §7, T11): it
  measures its own square, and the wrapper adds `alignSelf: 'flex-start'` so a
  `stretch`ing parent cannot widen the ring into an ellipse.

`nuiSizingKey` is the variant, which is the only prop that changes the control's
size: `''` for `'linear'` (the configuration `prewarm(['NitroUiProgress'])` seeds)
and `'circular'` for the ring.

### Measured sizes

Both numbers below are what `measureContent()` and the Yoga box reported in the
same harness run on this task's two devices (iPhone 17 / iOS 27, and
`nitroui_t01` / API 35 at 420 dpi), and they are the same fixture the harness
asserts (`example/__tests__/Progress.harness.tsx`).

| Variant  | iOS                                  | Android                                            |
| -------- | ------------------------------------ | -------------------------------------------------- |
| `linear` | **4 pt** tall; width = the box        | **4.19 dp** tall (M3's 4 dp track = 11 whole px at 420 dpi); width = the box |
| `circular` | **20 × 20 pt**                       | **40 × 40 dp**                                     |

The component declares `320 × 4` with the `fillWidth` policy as its fallback on
both platforms (`NitroUiDeclaredFallbacks`, T14 — a Fabric measure can happen
before any view exists). Two things follow, both measured rather than argued:

- The declared height is the *linear* one, which is also the default variant, so
  a cold bar is laid out at the right thickness on the first frame. For a
  `fillWidth` fallback the width barely matters (the box's width replaces it); the
  height is the number that has to be right (sizing.md §5).
- The fallback map is keyed by **component**, not by configuration, so a cold
  mount of the *ring* starts from the bar's box and is corrected to 20 pt / 40 dp
  one frame later. That is D17's one-frame budget, documented here and named by
  the harness's poison test, which seeds the cache with `137 × 23` for both keys
  and then waits for the box to become what the control measured. Fixtures that
  equalled the declared fallback could not tell a correction from a control that
  never corrected.

A `variant` change **remounts** the native view (the wrapper keys it): the two
shapes are two controls, and Android asks its toolkit a different sizing question
per shape at the moment the composition is built and never re-asks it. Nothing is
lost — a Progress has no native state to carry over.

## Behaviour notes

### Values that are not in range

`value` is clamped natively (`0…1`), and `NaN` counts as out of range and becomes
0. Progress that arrives from a download callback overshoots; an indicator that
vanished because of it is worse than one that looked full for a frame. The prop
getter still answers what React sent, unclamped — the clamp lives at the draw
site, so `handle.value` round-trips a write of `1.5` as `1.5` while the bar is
full.

### Determinate ↔ indeterminate

`value = null` is indeterminate, not empty. Both platforms switch control
*shape* (M3 has separate overloads and separate track defaults for the two
states) and both report the change to a screen reader.

### The indeterminate animation stops when nobody can see it

An indeterminate indicator is the only thing in this library that draws itself
forever, so both platforms gate it on window membership:

- iOS: a zero-size sibling observer (`NitroUiProgressWindowObserver`) reports
  `didMoveToWindow`; off-window the model draws an **empty determinate**
  indicator in the same style — same style so the measured size does not move,
  empty because that is the one determinate state that needs no motion.
- Android: the same rule on the same flag, driven by the host's attach/detach
  callbacks, plus the recycle path.

`nuiTestIsAnimating()` is the shared invariant the harness asserts: *indeterminate
and on screen*. Recycling and `onDropView` reset the flag, so a hidden or pooled
indicator costs no frames (the harness test is
`animates while it is on screen and stops when it is gone`).

### What we do not do

We never interpolate a value. Each fraction is drawn as it arrives, so a 60 Hz
source looks smooth and a coarse one looks like steps; an app that wants a tween
owns it (Reanimated on the JS side, or a Compose `animateFloatAsState` inside its
own host). Whether the toolkit wraps a write in its own animation is the
toolkit's; we neither add one nor suppress one, and this page does not claim a
measurement of it.

### One commit per update

`afterUpdate()` is `host.commit()` and nothing else — no handshake, no
`mostRecentEventCount`, no callback identity to keep alive. The harness measures
it (`commits once per update at 60 Hz`): 20 awaited writes cost 20 `propsApplied`
marks and exactly one `firstFrame`, and a dropped view marks nothing.

## Accessibility

Determinate is a **progress bar with a value**; indeterminate is a progress bar
that says so.

- iOS: SwiftUI's `ProgressView` is already the right element; we add
  `.accessibilityLabel(_:)` only when a label was given and
  `.accessibilityValue("<n>%")` when there is a value (adding a label where there
  was none would silence the element the toolkit set up).
- Android: one `clearAndSetSemantics` node — `contentDescription` when labelled,
  and `progressBarRangeInfo` = `ProgressBarRangeInfo(value, 0f..1f, 0)` or
  `ProgressBarRangeInfo.Indeterminate`. `clearAndSetSemantics` because the subtree
  is then exactly this node, so a screen reader hears one rule from one place
  (the Slider's reasoning).

## Limits

- **`trackColor` is Android-only today.** Material 3 gives every indicator a
  `trackColor`; SwiftUI's `ProgressView` has no API that addresses its track, so
  on iOS the prop is accepted, stored, round-trips through the handle and paints
  nothing. It is a prop on both platforms anyway so the JS API means one thing
  rather than two.
- **No size or thickness control.** Neither toolkit lets us set a
  `ProgressView`'s thickness or ring diameter through an API we consider stable
  (`controlSize` and `frame()` fight the control's own measurement here), so the
  two sizes above are what you get, and `style` overrides the *box* — a bar in a
  60 pt-tall box still draws 4 pt of bar inside it, centred.
- **No label / formatted value.** SwiftUI's `ProgressView` label and M3's
  semantics for a text value have no equivalent on the other platform, so
  labelling is the plain `accessibilityLabel` route on both.
- **`variant` changes remount** (Sizing). Cheap here, but it is a remount.
