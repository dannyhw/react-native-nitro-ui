# SegmentedControl

The platform segmented control: SwiftUI `Picker` with `.pickerStyle(.segmented)` on iOS, a
Material 3 Expressive connected button group on Android (one row spaced by
`ButtonGroupDefaults.ConnectedSpaceBetween`, its items carrying the connected
leading/middle/trailing corners). Segment shapes, press feedback, haptics, accessibility
behaviour and dynamic type belong to the control.

```tsx
import { SegmentedControl } from 'react-native-nitro-ui';

const [index, setIndex] = useState(0);
<SegmentedControl
  options={['List', 'Grid', 'Board']}
  selectedIndex={index}
  onChange={(event) => setIndex(event.index)}
/>;
```

The value is an index into `options`, never the label: two options may carry the same text, and
an index is what both platforms' controls store. Options are plain strings, with no icons and no
per-option colours.

## API

| Prop                   | Type                                         | Default  | Maps to                                                                               |
| ---------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `options`              | `string[]`                                   | required | The segment labels, and the only prop that decides the width.                         |
| `selectedIndex`        | `number \| undefined`                        | —        | Controlled index. `undefined` makes the control uncontrolled.                         |
| `defaultSelectedIndex` | `number \| undefined`                        | `0`      | Seed for an uncontrolled control; ignored while `selectedIndex` is set.               |
| `onChange`             | `((e: {index, value}) => void) \| undefined` | —        | One call per user selection, with the new index and its label.                        |
| `disabled`             | `boolean \| undefined`                       | `false`  | SwiftUI `.disabled()` / Compose `enabled = false`.                                    |
| `tintColor`            | `ColorValue \| undefined`                    | platform | Android only: the selected segment's container + border. iOS ignores it (see Limits). |
| `style`                | `ViewStyle`                                  | —        | Overrides the measured box (see Sizing).                                              |
| `testID`               | `string \| undefined`                        | —        | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.                         |
| `accessibilityLabel`   | `string \| undefined`                        | —        | Label of the group; the segments keep their own labels.                               |
| `hybridRef`            | `(view: handle) => void`                     | —        | Internal. Read-only handle for this repo's harness and benchmarks.                    |
| `nuiPerfId`            | `number \| null \| undefined`                | `null`   | Internal. Instance id for perf marks; `null` disables marks.                          |

`SegmentedControl` is a `View`, so any other `ViewProps` (`onLayout`, …) work as usual.
`hybridRef` and `nuiPerfId` are not app API: the handle is read-only plus `measureContent()`, and
it runs once, when the view mounts.

## Platform mapping

| Concept          | iOS                                                | Android                                                                                    |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Control          | `Picker(selection:) { … }.pickerStyle(.segmented)` | a row of connected items on `ButtonGroupDefaults` shapes                                   |
| Host             | `UIHostingController` inside `NitroSwiftUIHost`    | `NitroComposeHost<M>: AbstractComposeView`                                                 |
| Theme            | system traits                                      | `MaterialTheme` + dynamic color on Android 12+                                             |
| Selected segment | the scheme's accent fill; `tintColor` does nothing | `activeContainerColor` + `activeBorderColor`, both from `tintColor` (default: transparent) |
| Popup            | none: the control presents nothing                 | none                                                                                       |
| Test id          | RN's `testID` → `accessibilityIdentifier`          | `host.tag` (Compose has no test id)                                                        |
| Label            | `.accessibilityLabel(_:)` on the `Picker`          | `Modifier.semantics { contentDescription }` on the row                                     |
| Recycle          | hosting controller reused                          | objects reused; composition rebuilt                                                        |

The control presents nothing, so its host needs no view-controller containment. A menu or wheel
picker is the separate [Picker](picker.md) component.

## Selection

The selection is a controlled value and uses the event count, like `Switch` and `Slider`
([DESIGN.md](../DESIGN.md), section 3.5):

- A tap paints the new segment at once and reports `(index, eventCount)` to JS.
- If the parent moves `selectedIndex` to what was asked, native accepts it. If it does not,
  native reverts the displayed index.
- `onChange` carries the label from the `options` of the render the event landed in; `index` is
  the part that cannot be stale.
- A tap on the segment that is already selected reports nothing, on both platforms. A SwiftUI
  `Picker` binding only writes when the selection moves; on Android the implementation suppresses
  the no-op press.
- `disabled` is native: the control dims with its own disabled colours and JS gets no event.

### Clamping

`options` and the selection arrive in one batch in no guaranteed order, so neither is read
against the other in a setter. Both platforms normalise in `afterUpdate()`, and the JS wrapper
clamps on the way in:

| Situation                                        | Result                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `selectedIndex` past the end                     | the last option                                                   |
| `selectedIndex` negative, `NaN`, `null`-ish junk | the first option                                                  |
| `options` shrinks under the selection            | the last remaining option (the index is clamped, never cleared)   |
| `options` grows                                  | the selection stays on the same option                            |
| `options` empty                                  | no segments; the index reads `0` and no tap can report anything   |
| `defaultSelectedIndex` out of range              | clamped the same way, applied once, on the first batch            |
| a write straight to the Hybrid View              | clamped too: reading `selectedIndex` back gives the clamped index |

Clamping is silent.

## Sizing

The policy is `intrinsic`. The labels are the width, so the option list is the whole size
configuration.

The sizing key is `optionCount|label|label|…`
(`src/components/SegmentedControl/SegmentedControl.tsx`), with every label escaped (`\` → `\\`,
`|` → `\|`) so a label containing the separator cannot forge one: without the escape,
`['aa|bb', 'c']` and `['aa', 'bb|c']` would share one cached size. The count comes first because
escaping alone cannot tell `[]` from `['']`. `disabled` and `tintColor` repaint without resizing,
and text size, density and OS control size come in through the environment epoch
([DESIGN.md](../DESIGN.md), section 3.6).

Measured, with nothing overridden (iPhone Air / iOS 27 in pt; an API 35 emulator at 420 dpi, in
dp):

| `options`                         | iOS            | Android        |
| --------------------------------- | -------------- | -------------- |
| `['Go']`                          | 36.00 × 31.00  | 49.90 × 48.00  |
| `['One', 'Two', 'Three']`         | 165.00 × 31.00 | 187.81 × 48.00 |
| `['North','South','East','West']` | 220.00 × 31.00 | 265.90 × 48.00 |

The height is the platform's control height and does not move with the labels: iOS draws a
segmented `Picker` 31 pt tall, and Android lays every segment on the 48 dp touch target of a
`medium` Button. The width is the labels'.

On Android a segment is its label plus Material's content padding, 32 dp of it, and the row is
the sum of its segments plus the 2 dp between neighbours. A row of unequal labels is therefore
unequal by as much as its labels are, and the box the control reports is the row it draws:
`['Hour', 'Day', 'Week', 'Month', 'Year']` is 62.86 + 56.00 + 66.67 + 72.38 + 60.19 plus 4 × 2 =
326.10 dp of segments, and the control measures 325.71 × 48.00 (the 0.39 dp difference is px↔dp
rounding).

The row is a hand-written `Layout` (`ConnectedRow`, in
`android/.../HybridNitroUiSegmentedControl.kt`), not a `Row` with a weight on each item. A
weighted child may be at most its equal share, and the row's demand at
`width(IntrinsicSize.Max)` is n × the widest item, not the sum: laid out that way the five labels
above would ellipsise `Month` to `Mon…` inside a box 43 dp wider than the row drawn in it
(369.52 dp against 326.10 dp). `ConnectedRow` lays the row at the sum of its segments, and shares
the box equally only when the labels do not fit it.

The declared fallback is one pair per component: `165 × 31` pt
(`ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift`) and `187.9 × 48` dp
(`android/.../HybridNitroUiSegmentedControl.kt`), the three-short-labels row above, because a
fallback smaller than the control leaves part of it dead to touches. It is registered at startup
through `NitroUiDeclaredFallbacks`. Every other option list is laid out at the fallback when
first seen and corrected the turn it measures.

On Android, Compose observes `options` and its own measure pass reports the new size. On iOS the
`options` setter calls `host.noteContentSizeMayHaveChanged()` beside `markDirty()`, because no
bounds or trait change is coming. Both platforms reset the host's last-reported size when
`nuiSizingKey` changes, so a new list that measures the same as the old one still gets its
correcting report.

A user `style` wins: `width`, `height` or `flex` fixes the box and the control centres inside it.
When the labels do not fit that box, both platforms lay the row out at the box's width and let
the control truncate it: iOS proposes the box to SwiftUI and the `Picker` squeezes its segments,
and Android measures the composition a second time with the box's constraints and places that
(`NitroUiMeasuredRoot`). The size the control reports stays the unbounded one, so a squeezed row
is never cached at the narrow width. On Android the squeezed row shares its width equally between
segments, so four labels in a 140 dp box each collapse to an ellipsis; SwiftUI distributes the
widths its own way.

The base style is `alignSelf: 'flex-start'`
(`src/components/SegmentedControl/SegmentedControl.tsx`), so that in a column the control takes
its measured width. Ask for a stretched row with `alignSelf: 'stretch'`.

Text size moves this control: Dynamic Type and `font_scale` change the fitting size, and the
epoch change drops the cached sizes.

## Accessibility

- Each segment is its own accessibility element with its own label, and the selected one is
  announced as selected. On Android a segment is one item node at the segment's box carrying
  `checkable` and `checked`, with a `RadioButton`-class node for its role at the same box and its
  label as a child `TextView`, all inside the row's group. On iOS the segmented `Picker` is the
  platform element.
- `accessibilityLabel` describes the group: on Android it goes on the row, on iOS on the
  `Picker`, and on both it is applied only when set, because an empty label would silence the
  segments.
- `testID` is RN's own base prop and lands on the container. On iOS it is not also put on the
  hosted element, which would make the id match twice.
- Do not put `accessible` or another `accessibilityRole` on the container: the labelled element
  is the hosted control, and wrapping it can hide it from VoiceOver or TalkBack.

## Behaviour notes

- The value callback is always sent, with a stable no-op when the caller passes no `onChange`,
  and every other prop is always sent too: `options` is `[]` when absent and the rest use `null`,
  so a recycled view never keeps a previous mount's handler or segments.
- `HybridNitroUiSegmentedControl` implements `RecyclableView` on both platforms: the model resets
  (options, selection, default-seed flag, tint, label, sizing key, callback), and on Android the
  composition is disposed before reuse and rebuilt on the next attach. There is one batched
  commit per JS update, and the hosting view is never recreated per update.
- The Material 3 `SegmentedButtonColors` per `(scheme, tint)` come from a bounded process-wide
  cache keyed on the theme's identity (`android/.../HybridNitroUiSegmentedControl.kt`). The
  corners need no cache: a group of two or more takes the connected shapes `ButtonGroupDefaults`
  holds, and a one-option row uses `Button`'s cached `buttonShapes(Round, Medium)`.
- Each Android item is a `Box` with
  `Modifier.selectable(selected = …, role = Role.RadioButton)`, with Material's connected
  corners, border stroke, `ButtonDefaults.MinHeight` and the shared `Button` label style and
  padding. Material's `ToggleButton` is not used because it publishes `Role.Checkbox` from its
  own semantics, which an outer modifier cannot override. An unselected segment is an outlined
  item on the connected corner (round outside, 8 dp where it faces its neighbour) and the
  selected one is Material's stadium (`connectedButtonCheckedShape`), drawn solid. The shapes
  swap without a morph.
- No check icon. A check on the selected segment would make the width change with the selection.
  Labels only, matching iOS.

## Limits

- No icons, no per-segment colours, no sublabels: `options` is `string[]`.
- `tintColor` is Android-only: it replaces the selected segment's container and border and leaves
  every other colour to the scheme. On iOS it has no visible effect, because a SwiftUI segmented
  `Picker` ignores `.tint()` and `.accentColor`. The iOS implementation still applies `.tint()`
  (`OptionalSegmentedTint` in `HybridNitroUiSegmentedControl.swift`).
  - Writing `selectedSegmentTintColor` on the `UISegmentedControl` inside the hosted control is
    not used. On iOS 27 it paints the segment on the first frame, but the colour is gone from the
    screen after the first change of selection while the property still reads back the value, and
    writing it again does not restore it.
  - `UISegmentedControl.appearance()` is not used, because it restyles every segmented `Picker`
    in the app.
- A row of unequal labels looks different on each platform: Android sizes each segment to its
  label and SwiftUI distributes the widths its own way.
- A row wider than its box fits the box and reads badly. Both platforms place the row at the
  box's width, so both end caps are drawn and every segment is tappable, but on Android four
  options in a 140 dp box each show an ellipsis. Keep option lists within the available width.
- One declared fallback pair per component, so the first instance of a wider option list starts
  from the fallback box and is corrected on the turn it measures. A cold batch of 200 distinct
  option lists lands over several frames.
- Android has no `testID` inside the Compose view; the id lands on the host `View.tag`.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
