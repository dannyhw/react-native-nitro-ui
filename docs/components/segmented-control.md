# SegmentedControl

The platform segmented control: SwiftUI `Picker` with `.pickerStyle(.segmented)`
on iOS, Material 3 `SingleChoiceSegmentedButtonRow` + `SegmentedButton` on
Android. Both are hosted by the core runtime (`docs/architecture/core.md`), so
segment shapes, press feedback, haptics, a11y behaviour and dynamic type belong
to the control, not to us.

```tsx
import { SegmentedControl } from 'react-native-nitro-ui';

const [index, setIndex] = useState(0);
<SegmentedControl
  options={['List', 'Grid', 'Board']}
  selectedIndex={index}
  onChange={(event) => setIndex(event.index)}
/>;
```

The value of the control is an **index** into `options`, never the label: two
options may carry the same text, and an index is what both platforms' controls
store. Options are plain strings in v0.1 — no icons, no per-option colours.

## API

| Prop                   | Type                            | Default  | Maps to                                                          |
| ---------------------- | ------------------------------- | -------- | ---------------------------------------------------------------- |
| `options`              | `string[]`                      | required | The segment labels — and the only prop that decides the width.    |
| `selectedIndex`        | `number \| undefined`           | —        | Controlled index. `undefined` makes the control uncontrolled.     |
| `defaultSelectedIndex` | `number \| undefined`           | `0`      | Seed for an uncontrolled control; ignored while `selectedIndex` is set. |
| `onChange`             | `((e: {index, value}) => void) \| undefined` | — | One call per user selection, with the new index and its label.    |
| `disabled`             | `boolean \| undefined`          | `false`  | SwiftUI `.disabled()` / Compose `enabled = false`.                |
| `tintColor`            | `ColorValue \| undefined`       | platform | **Android only**: the selected segment's container + border. iOS ignores it (see Limits). |
| `style`                | `ViewStyle`                     | —        | Overrides the measured box (see Sizing).                          |
| `testID`               | `string \| undefined`           | —        | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.     |
| `accessibilityLabel`   | `string \| undefined`           | —        | Label of the group; the segments keep their own labels.           |
| `hybridRef`            | `(view: handle) => void`        | —        | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`            | `number \| null \| undefined`   | `null`   | **Internal.** Instance id for perf marks; `null` disables marks.  |

`SegmentedControl` is a `View`, so any other `ViewProps` (`onLayout`, …) work as
usual. `hybridRef` and `nuiPerfId` are not app API (DECISIONS D14): the handle is
read-only plus `measureContent()`, and it runs once, when the view mounts.

## Platform mapping

| Concept         | iOS                                              | Android                                                   |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Control         | `Picker(selection:) { … }.pickerStyle(.segmented)`  | `SingleChoiceSegmentedButtonRow` + one `SegmentedButton` each |
| Host            | `UIHostingController` inside `NitroSwiftUIHost`     | `NitroComposeHost<M>: AbstractComposeView`                    |
| Theme           | system traits                                       | `MaterialTheme` + dynamic color on Android 12+                |
| Selected segment| the scheme's accent fill; `tintColor` does nothing  | `activeContainerColor` + `activeBorderColor`, both from `tintColor` (default: transparent) |
| Popup           | none — the control presents nothing                 | none — same                                                   |
| Test id         | RN's `testID` → `accessibilityIdentifier`           | `host.tag` (Compose has no test id)                           |
| Label           | `.accessibilityLabel(_:)` on the `Picker`           | `Modifier.semantics { contentDescription }` on the row        |
| Recycle         | hosting controller reused                           | objects reused; composition rebuilt (`core.md` §6)            |

Because the control presents nothing, this host needs no view-controller
containment — unlike the `.menu` Picker, which is the 0.2 `Picker` component
(`docs/tasks/G4-segmented-picker.md`, deferred by D19) and will have to own one.

## Selection

The selection is a number, so it goes through the event-count handshake
(`docs/architecture/core.md` §4) exactly like `Switch` and `Slider`:

- A tap paints the new segment **at once** and reports `(index, eventCount)` to
  JS. There is no visual latency while React thinks about it.
- If the parent moves `selectedIndex` to what was asked, the handshake accepts it.
  If it does not, the handshake reverts the displayed index — that is the
  snap-back, and it needs no second frame of animation to look right.
- `onChange` carries the label from the `options` of the render the event landed
  in; `index` is the part that cannot be stale.
- **A tap on the segment that is already selected reports nothing, on both
  platforms.** A SwiftUI `Picker` binding only writes when the selection moves,
  while Material 3 fires `onClick` for every press, so the Android implementation
  suppresses the no-op (`android/.../HybridNitroUiSegmentedControl.kt:305`).
  This is what makes the two platforms report the same events, and it is what
  makes a snap-back observable at all: `scripts/real-input` taps the refused
  segment *twice*, and the second tap can only be reported if native put the
  selection back.
- `disabled` is native: the control dims with its own disabled colours and JS
  gets no event.

### Clamping

`options` and the selection arrive in one Nitro batch, in no guaranteed order
(`core.md` §3), so neither is interpreted against the other in a setter. Both
platforms normalise in `afterUpdate()`, and the JS wrapper clamps on the way in so
a caller cannot make the two platforms disagree:

| Situation                              | Result                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| `selectedIndex` past the end           | the last option                                                     |
| `selectedIndex` negative, `NaN`, `null`-ish junk | the first option                                          |
| `options` shrinks under the selection  | the last remaining option (the index is clamped, never cleared)     |
| `options` grows                        | the selection stays on the same option                              |
| `options` empty                        | no segments; the index reads `0` and no tap can report anything     |
| `defaultSelectedIndex` out of range    | clamped the same way, applied once, on the first batch              |
| a write straight to the Hybrid View    | clamped too: reading `selectedIndex` back gives the clamped index   |

Clamping is silent by design — a segmented control with no valid segment is not a
state an app can act on, and the nearest end is what both platforms' own controls
do.

## Sizing

SegmentedControl is `intrinsic`, and it is the library's second control whose size
comes from its props and the first whose size comes from a **list**: the labels
*are* the width, so the option list is the whole size configuration. This is the
R3 verification DECISIONS D16 asks for, in
`example/__tests__/SegmentedControl.harness.tsx`.

The sizing key is `optionCount|label|label|…`
(`src/components/SegmentedControl/SegmentedControl.tsx:128`), with every label
escaped (`\` → `\\`, `|` → `\|`, `src/components/SegmentedControl/SegmentedControl.tsx:113`)
so a label containing the separator cannot forge one. Without the escape, a
same-count pair like `['aa|bb', 'c']` and `['aa', 'bb|c']` would build one key and
share one cached size, one of which is wrong for the life of the process. The
count comes first because escaping alone cannot tell `[]` from `['']` apart once
joined. `disabled` and `tintColor` repaint, they do not resize, and the text size / density / OS control
size are not in the key: native folds the environment in through the epoch
(`docs/architecture/sizing.md`, "Building `nuiSizingKey`").

Measured, with nothing overridden (iPhone Air / iOS 27 in pt; `nitroui_t02`,
API 35 at 420 dpi, in dp):

| `options`                          | iOS             | Android         |
| ---------------------------------- | ----------------- | ----------------- |
| `['Go']`                           | 36.00 × 31.00     | 67.81 × 48.00     |
| `['One', 'Two', 'Three']`          | 165.00 × 31.00    | 256.00 × 48.00    |
| `['North','South','East','West']`  | 220.00 × 31.00    | 344.00 × 48.00    |

The height is the platform's control height and does not move with the labels —
iOS draws a segmented `Picker` 31 pt tall for one option or for four long ones
alike, and Material 3 lays every segment in a 48 dp row. The width is the labels'.
Android's one-option row is wider than its label because Material 3 keeps a
minimum interactive width per segment, and Android's row gives each segment an
equal share of the track, so with equal labels the segments are equal — which is
what the real-input taps assume.

**What the engine starts from.** The engine keys fallbacks per component, so this
component has one declared pair however many option lists exist: `165 × 31` pt
(`ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift:201`) and
`256 × 48` dp (`android/.../HybridNitroUiSegmentedControl.kt:400`) — the
three-short-labels row above, measured rather than guessed, because a fallback
smaller than the control is the dead-touch story in `core.md` §7. Every other
option list is a first instance of *its own* configuration: it is laid out at the
fallback and corrected the turn it measures (D17). Registered at startup through
`NitroUiDeclaredFallbacks` (T14), not from the first view.

**What makes a change re-measure.** Compose observes `options` and its own
measure pass reports the new size, so Android needs nothing extra. iOS needs to
be told: the `options` setter calls `host.noteContentSizeMayHaveChanged()` next to
`markDirty()` (`ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift:235`)
— no bounds change and no trait change is coming, so without it the control would
repaint at the old width and Yoga would keep the old box. Both platforms reset the
host's last-reported size when `nuiSizingKey` changes
(`…/HybridNitroUiSegmentedControl.swift:336`,
`android/.../HybridNitroUiSegmentedControl.kt:551`): a new list that happens to
measure exactly what the old one did would otherwise have its correcting report
swallowed by the dedupe and stay at the fallback (G2's F1). D20 then keeps a
corrected instance re-measuring on later props turns.

A user `style` still wins: `width`, `height` or `flex` fixes the box and the
control centres inside it. When the labels do not fit that box, both platforms
lay the row out **at the box's width** and let the control truncate it: iOS hands
the box to SwiftUI and the `Picker` squeezes its segments into it, and Android
measures the composition a second time with the box's constraints and places that
answer (`NitroUiMeasuredRoot`). Only the drawing is placed at the box — the size
the control *reports* stays the unbounded one, because a row squeezed into a
narrow box would otherwise be cached at that width forever
(`docs/architecture/core.md` §7). What still differs per platform is how much of
each label survives: Material 3 shares the row's width equally between segments,
so four labels in a 140 dp box each collapse to an ellipsis, while SwiftUI
distributes the widths its own way. Keep option lists short enough to read; see
Limits.

The base style is `alignSelf: 'flex-start'`
(`src/components/SegmentedControl/SegmentedControl.tsx:144`) for the same reason
`Switch` and `Button` have one: in a column, `alignItems: stretch`
would decide the width for us and the measurement would never be asked for. Ask
for a stretched row with `alignSelf: 'stretch'`.

Text size does move this control: the labels are text, so Dynamic Type and
`font_scale` change the fitting size, and the sizing epoch invalidation is what
drops the now-wrong cached sizes.

## Accessibility

- Each segment is its own accessibility element with its own label, and the
  selected one is announced as selected — a uiautomator dump shows each segment as
  a `RadioButton`-class node inside the row's group, and the chosen one reports
  `checked=true`. On iOS the segmented `Picker` is the platform element VoiceOver
  already knows.
- `accessibilityLabel` describes the **group**: on Android it goes on the row
  (`android/.../HybridNitroUiSegmentedControl.kt:292`), on iOS on the `Picker`, and
  on both it is applied only when set — an empty label would silence the segments.
- `testID` is RN's own base prop and lands on the container; on iOS it is
  deliberately *not* also put on the hosted element, which would make the id match
  twice.
- Do not put `accessible` or another `accessibilityRole` on the container: the
  labelled element is the hosted control, and wrapping it can hide it from
  VoiceOver or TalkBack (`docs/architecture/core.md` §3).

## Behaviour notes

- **One callback per change.** `onValueChange` is a Nitro callback prop that is
  *always* sent — with a stable no-op when the caller passed nothing — because
  Nitro reads `undefined` as "unset" and a prop that disappears would leave a
  recycled view holding the previous mount's handler (D7b).
- **Every prop is always sent.** `options` is `[]` rather than absent, and the
  rest use `null`, because Nitro treats a missing prop as "unset" (D7) and a
  recycled view would otherwise keep the previous row's segments.
- **Recycling is safe.** `NitroUiSegmentedControl` implements `RecyclableView` on
  both platforms: the model resets (options, selection, default-seed flag, tint,
  label, sizing key, callback), and on Android the composition is disposed before
  reuse and rebuilt on the next attach (`core.md` §6). One batched commit per JS
  update; no hosting recreation per update. Nothing presents a popup, so there is
  no open-menu state to leak on recycle either.
- **Cached, never rebuilt.** The M3 `SegmentedButtonColors` per `(scheme, tint)`
  are served from a bounded process-wide cache keyed on the theme's identity
  (`android/.../HybridNitroUiSegmentedControl.kt:174`) — `SegmentedButtonDefaults.colors()`
  allocates, and building it per recomposition per mounted control is the cost the
  "Shared objects" rule in `core.md` is about. `itemShape` is *not* cached: it is
  derived from the index and count, not from the theme.
- **No check icon.** Material 3's default `icon` renders a check on the selected
  segment only, which would make the measured width change with the selection and
  force the selection into the sizing key. Labels only, matching iOS.
- **Real taps are proven, not assumed.** `scripts/real-input` taps segments from
  outside the app (`XCUIDevice` / `adb shell input`) and asserts only on text the
  app renders: a real tap moves the selection echo, and a refused selection still
  reports a second change — the snap-back witness.

## Limits

- No icons, no per-segment colours, no sublabels — `options` is `string[]` in v0.1.
- `tintColor` is **Android-only**: it replaces the selected segment's container
  **and** border and leaves every other colour to the scheme. On iOS it has **no
  visible effect** — a SwiftUI segmented `Picker` ignores `.tint()` (and
  `.accentColor`); the only per-control knob is
  `UISegmentedControl.selectedSegmentTintColor`, which SwiftUI does not expose, so
  setting it per instance would mean UIKit introspection or a global
  `UISegmentedControl.appearance()`. We do neither: the iOS implementation still
  applies `.tint()` (harmless, and the right call if SwiftUI ever honours it), and
  the prop simply changes nothing there. A tinted row looks like the default one on
  iOS.
- The platforms do not agree on how a segment gets its width (equal shares on
  Android, SwiftUI's own distribution on iOS), so a row of unequal labels looks
  different on each. Both grow with the labels, which is all the sizing key
  claims.
- **A row wider than its box fits on Android, and reads badly.** The host used to
  give the Compose row its measured (unbounded) size and place it centred in the
  Yoga box, so when the labels wanted more width than the box has — a four-label
  row on a phone is enough — both rounded end caps were cut off and the hidden
  part of the outer segments could not be tapped. It now measures the row a second
  time at the box's width and places *that*, so the row is inside the box, both
  end caps are drawn and every segment is tappable — which is what iOS has always
  done by proposing the box to SwiftUI. Fitting is not legibility: Material 3
  splits the row's width equally, so four options in a 140 dp box each show an
  ellipsis (`docs/tasks/C1-android-overwide/android-after.png`, before it
  `…/android-before.png`). This is shared `intrinsic` host behaviour (it applies to
  `Button` too, where the label usually survives). Keep option lists within the
  available width.
- One declared fallback pair per component, so the first instance of a wider option
  list starts from a 165 pt / 256 dp box and is corrected on the turn it measures
  (D17). A cold batch of 200 distinct option lists lands over several frames —
  logged, not gated; finer fallbacks are T14's story.
- Android has no `testID` inside the Compose view; the id lands on the host
  `View.tag`, which is what the harness reads.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
- `Picker` (menu / wheel) is **not** this component and is not in v0.1 (D19). A
  `.menu` Picker needs view-controller containment and an open-popup lifecycle that
  this control does not have.
