# IconButton

One glyph as a control. `IconButton` is Material 3's four icon buttons (`standard`, `filled`,
`tonal`, `outlined`) and their toggle forms on Android, and a SwiftUI `Button` or
`Toggle(…).toggleStyle(.button)` whose label is `.iconOnly` on iOS.

It has no text and no children, so `accessibilityLabel` is required: it is the only name a screen
reader can read. An empty one warns in development.

```tsx
import { IconButton } from 'react-native-nitro-ui';

<IconButton
  accessibilityLabel="Search"
  systemImage="magnifyingglass"
  androidIcon={require('./icons/search_24px.xml')}
  onPress={openSearch}
/>;
```

## API

| Prop                 | Type                                              | Default      | Notes                                                                                |
| -------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `accessibilityLabel` | `string`                                          | —            | Required. The control's only name. Empty warns in development.                       |
| `systemImage`        | `string`                                          | —            | SF Symbol. iOS only. Part of the size configuration.                                 |
| `androidIcon`        | `string \| number` (a `require`)                  | —            | Android vector drawable. Android only. Part of the size configuration.               |
| `onPress`            | `() => void`                                      | —            | Press form: one call per tap. Nothing while `disabled`.                              |
| `variant`            | `'standard' \| 'filled' \| 'tonal' \| 'outlined'` | `'standard'` | Material's own names for the four icon buttons.                                      |
| `size`               | `'small' \| … \| 'xxlarge'`                       | `'medium'`   | The same five sizes as `Button` (`ButtonSize`).                                      |
| `width`              | `'narrow' \| 'uniform' \| 'wide'`                 | `'uniform'`  | Android only. Material's three width options for a size.                             |
| `shape`              | `'round' \| 'square' \| null`                     | `'round'`    | `ButtonShape`. Repaints; does not resize.                                            |
| `checked`            | `boolean \| undefined`                            | `undefined`  | Present → the toggle form, controlled.                                               |
| `defaultChecked`     | `boolean \| undefined`                            | `false`      | Seed for an uncontrolled toggle.                                                     |
| `onCheckedChange`    | `(checked: boolean) => void`                      | —            | Toggle form: the selection native now displays.                                      |
| `disabled`           | `boolean`                                         | `false`      | No event, and Material's disabled content colour.                                    |
| `tintColor`          | `ColorValue`                                      | platform     | SwiftUI `.tint()` / the variant's container colour (content colour when `outlined`). |
| `testID`             | `string`                                          | —            | Forwarded to the native view.                                                        |
| `style`              | `StyleProp<ViewStyle>`                            | —            | Applied over the control's own `alignSelf: 'flex-start'`.                            |

A control is a toggle when any of `checked`, `defaultChecked` or `onCheckedChange` is present,
and a press button when none is. The two forms are different native controls.

## Platform mapping

| `variant`  | Android                                                            | iOS                                   |
| ---------- | ------------------------------------------------------------------ | ------------------------------------- |
| `standard` | `IconButton`                                                       | `.borderless`                         |
| `filled`   | `FilledIconButton`                                                 | `.borderedProminent`                  |
| `tonal`    | `FilledTonalIconButton`                                            | `.bordered`                           |
| `outlined` | `OutlinedIconButton`                                               | `.bordered` plus a hairline stroke    |
| toggle     | the matching `…IconToggleButton(checked, onCheckedChange, shapes)` | `Toggle(isOn:…).toggleStyle(.button)` |

- Android uses Material's own components, their colour roles
  (`IconButtonDefaults.*IconButtonColors()` / `*IconToggleButtonColors()`, cached per colour
  scheme as `Button`'s are) and their per-size shapes
  (`IconButtonDefaults.shapes(shape, pressedShape)` and
  `toggleableShapes(shape, pressedShape, checkedShape)`, with the `…RoundShape` /
  `…SquareShape` / `…PressedShape` / `…SelectedShape` tokens for the size).
- iOS has no icon-button control. It draws a `Button(action:)` with
  `Label(accessibilityLabel, systemImage:)` under `.labelStyle(.iconOnly)`, and the four variants
  are the four button styles above. `outlined`'s ring is a hairline `RoundedRectangle` stroke
  drawn over `.bordered`, because iOS has no outlined button style.
- `shape="square"`: `IconButtonDefaults`' square tokens on Android (which morph to the pressed
  shape while pressed), `.buttonBorderShape(.roundedRectangle(radius: 8))` on iOS, whose button
  styles have no cornerless option. `round` is `.circle` on iOS 17 and later, `.capsule` before
  it.
- `width` is Android only. On iOS the box is the symbol plus the style's own padding, so all
  three options are one box there.
- On iOS `variant` applies to the press form only. A `Toggle(…).toggleStyle(.button)` does not
  read `buttonStyle` and has one look: a bordered box that fills with the accent colour while on.
  The toggle form ignores `variant` there, and `tintColor` colours its on-fill. Android's toggle
  forms have the four looks, because they are four different composables.

## Sizing

The policy is `intrinsic`: the control measures itself, so a parent's width does not decide its
box. The size configuration is `variant | size | width | form | systemImage | androidIcon`: the
fields that can change the box, plus the glyph, which decides the width on iOS and not on
Android. Both platforms use one key.

`form` is the press form or the toggle form. It is in the key because the two are different
native controls with different padding: on iOS the same `tonal` size measures wider as a `Button`
than as a `Toggle(.button)`. Android composes both forms from the same container.

`shape`, `checked`, `disabled` and `tintColor` are not in the key. They repaint and do not
resize: the two states of a toggle are the same box.

The first control of a configuration is laid out at a declared fallback and corrected the turn it
measures:

| Platform | Declared fallback | What it is                                                           |
| -------- | ----------------- | -------------------------------------------------------------------- |
| Android  | 48 × 48 dp        | Material's `MinInteractiveComponentSize`, the floor under every size |
| iOS      | 44 × 44 pt        | Apple's minimum tappable region, the floor under every size          |

Both numbers are the floor every configuration is at least as big as (see "The touch target").

### The sizes, measured

Material's container tokens, in dp:

| `size`    | token | `narrow` | `uniform` | `wide` | height | glyph |
| --------- | ----- | -------- | --------- | ------ | ------ | ----- |
| `small`   | XS    | 28       | 32        | 40     | 32     | 20    |
| `medium`  | S     | 32       | 40        | 52     | 40     | 24    |
| `large`   | M     | 48       | 56        | 72     | 56     | 24    |
| `xlarge`  | L     | 64       | 96        | 128    | 96     | 32    |
| `xxlarge` | XL    | 104      | 136       | 184    | 136    | 40    |

What an Android device lays out is `max(token, 48)` on each axis, from Material's
`minimumInteractiveComponentSize()`:

| `size`    | `narrow`  | `uniform` | `wide`    | height |
| --------- | --------- | --------- | --------- | ------ |
| `small`   | 48 × 48   | 48 × 48   | 48 × 48   | 48     |
| `medium`  | 48 × 48   | 48 × 48   | 52 × 48   | 48     |
| `large`   | 48 × 56   | 56 × 56   | 72 × 56   | 56     |
| `xlarge`  | 64 × 96   | 96 × 96   | 128 × 96  | 96     |
| `xxlarge` | 104 × 136 | 136 × 136 | 184 × 136 | 136    |

- The two smallest sizes are one 48 dp box for every width except `medium` `wide`. `width`
  separates configurations wherever its token clears the 48 dp floor.
- The token is not the box. Design against the second table.

### iOS

iOS has no icon-button containers, and `.controlSize` alone does not size an icon-only label:
with `.controlSize` only, the five sizes measure as two boxes, 15.33 × 15.00 pt and 17.67 ×
16.00 pt. So each size sets the symbol's point size directly, to Material's glyph token for that
size (20 / 24 / 24 / 32 / 40 pt), and the box is the glyph plus whatever the button style adds.
`medium` and `large` are both 24 pt and so one glyph.

Measured for `standard` (`.borderless`) in the press form with `xmark`. The glyph box is what the
size's point size measures before the touch target is applied; the last column is what the
layout gets:

| `size`    | glyph pt | glyph box (pt) | `narrow` = `uniform` = `wide` |
| --------- | -------- | -------------- | ----------------------------- |
| `small`   | 20       | 20.33 × 19.00  | 44 × 44                       |
| `medium`  | 24       | 25.00 × 23.00  | 44 × 44                       |
| `large`   | 24       | 25.00 × 23.00  | 44 × 44                       |
| `xlarge`  | 32       | 33.33 × 31.00  | 44 × 44                       |
| `xxlarge` | 40       | 40.67 × 38.00  | 44 × 44                       |

All three `width` options are one configuration on iOS.

### The touch target

Every box is at least 44 × 44 pt on iOS, and the glyph stays at its size: `max(glyph box, 44)` on
each axis, with the artwork centred. A `small` IconButton is a 20 pt glyph in a 44 pt target.
Android floors the container at 48 dp in the same way.

A SwiftUI `Button` hit-tests its own label and style, not the frame its host was laid out in. So
`.borderless` gets its floor as a 44 pt minimum on the label, and the configurations that draw a
bezel (the three bordered button styles, and the toggle form) get a clear, tappable layer behind
the control that runs the same `press()` as the control's own gesture. Widening their label
instead would widen the drawn bezel.

The bordered variants are larger than their glyph by their style's padding, and the two forms pad
differently: at `tonal`/`xxlarge` the press control measures 70.67 × 68.00 pt and the toggle
80.67 × 68.00 pt. At smaller sizes both measure under the target and lay out as one 44 × 44 pt
box.

## Accessibility

- The label is the control's only name. `accessibilityLabel` is required in the type, an empty
  one warns once in development, and the string goes to the native control's own name: Compose
  `semantics { contentDescription = … }` on the button, and the `Label`'s title on iOS, which
  `.labelStyle(.iconOnly)` hides visually but not from a screen reader.
- A toggle adds a state, not a name. On Android the merged semantics node carries the label and
  `toggle=On`/`toggle=Off`. On iOS the control is announced as a switch whose value is `1` when
  on and `0` when off, which is what `Toggle(.button)` reports.
- `disabled` removes the control from interaction and reads as disabled on both platforms.
- On iOS the accessibility element of a bezelled control is the drawn control, which is smaller
  than the touch target. The `filled` case is a button element at
  `18.67, 269.67, 38.67 × 38.67 pt` inside the `16, 267, 44 × 44 pt` box React Native laid out.
  A finger can land anywhere in the 44 pt target; the tappable margin behind the control is
  hidden from a screen reader so the name is on one element only.

## Behaviour notes

- The form follows the props on every update. Removing `checked`, `defaultChecked` and
  `onCheckedChange` from a rendered control turns it back into a press button: `onPress` fires
  again, and on iOS the control re-measures as a `Button`.
- One press per tap, on either form. The press form's `onPress` is a gesture, not a value: JS
  cannot refuse it.
- A refused flip reverts. A controlled toggle paints the flip it was asked for and then returns
  to the value React sends, through the same event count as `Switch`, `Slider` and `Chip`. A
  second tap on a refused toggle reports the same value again.
- `defaultChecked` is a seed. It applies once, to an uncontrolled toggle, and is ignored
  afterwards.
- Recycling is a full reset, including the resolved glyph, the event counts and the
  `defaultChecked` one-shot, so a recycled control never draws its previous owner's drawable.
- A glyph that cannot be resolved draws nothing and reserves nothing, so the control is exactly
  its no-icon self, and logs once. The rule and the failure table are `Button`'s
  ([button.md](button.md), "Android icons").
- A `<Host>` cannot hold an IconButton ([host.md](host.md)); in development a `<Host>` refuses it
  by name.

## Limits

- `width` does nothing on iOS. Android has eleven distinct boxes across its sizes and widths and
  iOS's `standard` variant has one: every glyph up to `xxlarge` measures under the 44 pt target,
  so all five sizes are laid out at 44 × 44 pt and only the artwork inside changes. A
  configuration whose style measures past the target (a bordered variant at a large size, or a
  toggle) gets a box of its own.
- On iOS the toggle form has one look, not four: `variant` is ignored by `Toggle(.button)` (see
  "Platform mapping").
- The `outlined` ring on iOS is drawn by this library over a `.bordered` button. It is a hairline
  at the control's own border shape, not a copy of Material's stroke.
- An IconButton is not a `Button` with an empty title: it has no `title`, no `loading`, no
  `variant: 'text' | 'elevated'`, and no icon-and-label layout. If the control has text, use a
  `Button`.
- `androidIcon` accepts an Android vector drawable (or a drawable resource name), not a PNG; the
  rules, formats and failure table are in [button.md](button.md).
