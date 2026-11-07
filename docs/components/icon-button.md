# IconButton

One glyph as a control. `IconButton` is Material 3's four icon buttons —
`standard`, `filled`, `tonal`, `outlined` — and their toggle forms on Android, and
a SwiftUI `Button` / `Toggle(…).toggleStyle(.button)` whose label is
`.iconOnly` on iOS.

It has no text and no children, which decides the shape of its API:
`accessibilityLabel` is **required**, because it is the only name a screen reader
can read. An empty one warns in development.

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

| Prop                | Type                                                    | Default      | Notes                                                                        |
| ------------------- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `accessibilityLabel`| `string`                                                | —            | **Required.** The control's only name. Empty warns in development.           |
| `systemImage`       | `string`                                                | —            | SF Symbol. **iOS only.** Part of the size configuration.                     |
| `androidIcon`       | `string \| number` (a `require`)                          | —            | Android vector drawable. **Android only.** Part of the size configuration.    |
| `onPress`           | `() => void`                                            | —            | Press form: one call per tap. Nothing while `disabled`.                       |
| `variant`           | `'standard' \| 'filled' \| 'tonal' \| 'outlined'`       | `'standard'` | Material's own names for the four icon buttons.                              |
| `size`              | `'small' \| … \| 'xxlarge'`                             | `'medium'`   | The shared ladder (`ButtonSize`'s vocabulary, D42).                           |
| `width`             | `'narrow' \| 'uniform' \| 'wide'`                       | `'uniform'`  | **Android only.** Material's three width options for a rung.                  |
| `shape`             | `'round' \| 'square' \| null`                           | `'round'`    | `ButtonShape`. Repaints; does not resize.                                     |
| `checked`           | `boolean \| undefined`                                  | `undefined`  | Present → the toggle form, controlled.                                        |
| `defaultChecked`    | `boolean \| undefined`                                  | `false`      | Seed for an uncontrolled toggle.                                              |
| `onCheckedChange`   | `(checked: boolean) => void`                            | —            | Toggle form: the selection native now displays.                               |
| `disabled`          | `boolean`                                               | `false`      | No event, and Material's disabled content colour.                             |
| `tintColor`         | `ColorValue`                                            | platform     | SwiftUI `.tint()` / the variant's container colour (content colour when `outlined`). |
| `testID`            | `string`                                                | —            | Forwarded to the native view.                                                 |
| `style`             | `StyleProp<ViewStyle>`                                  | —            | Applied over the control's own `alignSelf: 'flex-start'`.                     |

A control becomes a **toggle** when any of `checked`, `defaultChecked` or
`onCheckedChange` is present, and a **press button** when none is. The two forms
are different native controls, not one control with a flag, and the form is decided
by what the caller wrote rather than by a default — passing none of the three does
not compose a toggle that happens to be off.

## Platform mapping

| `variant`  | Android                                                            | iOS                                                     |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `standard` | `IconButton`                                                       | `.borderless`                                            |
| `filled`   | `FilledIconButton`                                                 | `.borderedProminent`                                     |
| `tonal`    | `FilledTonalIconButton`                                            | `.bordered`                                              |
| `outlined` | `OutlinedIconButton`                                               | `.bordered` plus a hairline stroke                       |
| toggle     | the matching `…IconToggleButton(checked, onCheckedChange, shapes)` | `Toggle(isOn:…).toggleStyle(.button)`                    |

- **Android** gets Material's own components, their colour roles
  (`IconButtonDefaults.*IconButtonColors()` / `*IconToggleButtonColors()`, cached
  per colour scheme as `Button`'s are) and their per-size shapes
  (`IconButtonDefaults.shapes(shape, pressedShape)` and
  `toggleableShapes(shape, pressedShape, checkedShape)`, with the `…RoundShape` /
  `…SquareShape` / `…PressedShape` / `…SelectedShape` tokens for the rung).
- **iOS** has no icon-button control. It draws a `Button(action:)` with
  `Label(accessibilityLabel, systemImage:)` under `.labelStyle(.iconOnly)`, so the
  look is whatever a SwiftUI button style makes of an icon-only label, and the four
  variants are the four button styles above. `outlined`'s ring is a hairline
  `RoundedRectangle` stroke drawn over `.bordered`, because iOS has no outlined
  button style — it reads as Material's outline, it is not drawn by UIKit.
- `shape="square"`: `IconButtonDefaults`' square tokens on Android (which morph back
  to the pressed shape while pressed), `.buttonBorderShape(.roundedRectangle(radius: 8))`
  on iOS, whose button styles have no cornerless option. `round` is `.circle` on
  iOS 17 and later, `.capsule` before it.
- `width` is **Android only**. iOS's box is the symbol plus the style's own padding
  and has no counterpart, so all three options are one box there — printed rather
  than hidden, because it is the one prop on this control that a reader has to
  accept as a no-op on one platform.
- **On iOS `variant` is the press form's prop.** A `Button` answers `buttonStyle`,
  so the four variants are four styles; a `Toggle(…).toggleStyle(.button)` does not
  read `buttonStyle` at all and has exactly one look — a bordered box that fills
  with the accent colour while on. Applying a button style to it would be decoration
  that does nothing, so the toggle form ignores `variant` there and `tintColor` is
  what moves its on-fill. Android's toggle forms do have the four looks, because they
  are four different composables.
## Sizing

`intrinsic`: the control measures itself, so a parent's width does not decide its
box (`docs/architecture/sizing.md`). The size configuration is
`variant | size | width | systemImage | androidIcon` — the four fields that can
change the box, plus the glyph, which decides the width on iOS and cannot on
Android and is in the key so both platforms read one key.

`shape`, `checked`, `disabled` and `tintColor` are *not* in the key. They repaint
and do not resize, and that is measured rather than assumed: the two states of a
toggle are the same box, and a fresh control of a configuration a toggled one has
already drawn needs no correction.

The first control of a configuration is laid out at a declared fallback and
corrected the turn it measures. The fallback for IconButton:

| Platform | Declared fallback | The default it stands for                                |
| -------- | ----------------- | -------------------------------------------------------- |
| Android  | 48 × 48 dp        | `standard` / `medium` / `uniform`, glyph named            |
| iOS      | 32 × 32 pt        | `standard` / `medium` / `uniform`, `systemImage="xmark"`  |

Android's is exact — the `medium` container is 40 dp and Material will not publish
a touch target below `MinInteractiveComponentSize` (48 dp) — which is why the
conformance run also insists that a *warm* engine needs no correction from it. An
exact fallback is only a fair claim because the conformance fixture is that default
configuration, and because every other measurement below is taken from a fallback
poisoned to 17.5 × 63.5 pt first: a correction that never arrives leaves a wrong box
visible rather than a passing test.

### The ladder, measured

`example/__tests__/IconButton.harness.tsx` mounts every rung × width from a poisoned
fallback and reports the laid-out box. Android (dp, from Material's container
tokens, with the 48 dp floor applied):

| `size`  | token name | `narrow` | `uniform` | `wide` | height | glyph |
| ------- | ---------- | -------- | --------- | ------ | ------ | ----- |
| `small` | XS         | 28       | 32        | 40     | 32     | 20    |
| `medium`| S          | 32       | 40        | 52     | 40     | 24    |
| `large` | M          | 48       | 56        | 72     | 56     | 24    |
| `xlarge`| L          | 64       | 96        | 128    | 96     | 32    |
| `xxlarge`| XL        | 104      | 136       | 184    | 136    | 40    |

### iOS

iOS draws the glyph at the `.controlSize` the rung selects and takes its width from
the symbol, so the box is the glyph plus the style's own padding. Measured on the
same run as the Android grid above, `medium` + `standard` with a 24 pt symbol is
32 x 32 pt, and the three bordered variants land on that same box at that rung —
which is why the declared fallback is one number for the whole component. The
rungs above it are one box apart at most: iOS has four control sizes for a ladder
with five rungs, so `xlarge` and `xxlarge` share a box, as they do on `Button`.

IOS_MEASURED_TABLE

## Accessibility

- **The label is the control's only name.** An IconButton has no text, so
  `accessibilityLabel` is required in the type, an empty one warns once in
  development, and the string goes to the native control's own name: Compose
  `semantics { contentDescription = … }` on the button, and the `Label`'s title on
  iOS, which `.labelStyle(.iconOnly)` hides visually without hiding from a reader.
  The real-input suite reads both back out of the OS tree.
- **A toggle adds a state, not a name.** On Android the merged semantics node a
  reader is handed carries the label *and* `toggle=On`/`toggle=Off` (the harness
  reads the same node, through Compose's own test-root accessibility API). On iOS a
  `Toggle(.button)` is a button with the selected state, which XCUITest reads as the
  element's value after a real tap.
- `disabled` removes the control from interaction and reads as disabled on both
  platforms.

## Behaviour notes

- **One press per tap**, on either form. The press form's `onPress` is a gesture,
  not a value: JS cannot refuse it, and neither can a `checked` prop.
- **A refused flip reverts.** A controlled toggle paints the flip it was asked for
  and then returns to the value React pushes — the same handshake as `Switch`,
  `Slider` and `Chip`, and for the same reason: the tap that was already taken has
  to be visible at once, and the app's answer still wins. A second tap on a refused
  toggle reports the same value again, which is how a control that had quietly kept
  the change is caught.
- **`defaultChecked` is a seed, not a value.** It applies once, to an uncontrolled
  toggle, and is ignored afterwards — a re-render does not revert a toggle the user
  just moved.
- **Recycling is a full reset**, including the resolved glyph. A recycled control
  that still held its previous owner's parsed drawable would draw it before the new
  one resolved, so the reset clears the name and the slot, the handshake's event
  counts, and the `defaultChecked` one-shot. The counts are the part no prop
  re-sends: a second owner controlled to `false` would be refused as stale if they
  survived.
- **A glyph that cannot be resolved draws nothing and reserves nothing** — no slot,
  no padding change, so the control is exactly its no-icon self, and says so once.
  This is the same rule `Button`'s `androidIcon` has (`docs/components/button.md`,
  "Android icons"), including what each failure looks like.
- **`<Host>` cannot hold an IconButton yet** (`docs/components/host.md`). It is a
  measured control whose box is its own, and hosting one is an unmeasured question;
  in development a `<Host>` refuses it by name rather than drawing half of it.

## Limits

- `width` does nothing on iOS, and `size` has five heights on Android and fewer on
  iOS: SwiftUI has fewer control sizes than the ladder has rungs, so the top rungs
  share a box there (`docs/components/button.md` prints the same column). The
  measured table is the arbiter.
- On iOS the toggle form has one look, not four: `variant` is ignored by
  `Toggle(.button)` (see "Platform mapping"). Android's toggle forms do have all four.
- The `outlined` ring on iOS is drawn by this library over a `.bordered` button,
  because iOS has no outlined button style. It is a hairline at the control's own
  border shape, not a copy of Material's stroke.
- An IconButton is not a `Button` with an empty title: it has no `title`, no
  `loading`, no `variant: 'text' | 'elevated'`, and no `systemImage`-and-label
  layout. If the control has text, it is a `Button`.
- `androidIcon` accepts an Android vector drawable (or a drawable resource name), not
  a PNG: the rules, formats and failure table are `docs/components/button.md`'s.
