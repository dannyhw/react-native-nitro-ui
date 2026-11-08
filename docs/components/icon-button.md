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
`variant | size | width | form | systemImage | androidIcon` — the fields that can
change the box, plus the glyph, which decides the width on iOS and cannot on
Android and is in the key so both platforms read one key.

`form` is the press form or the toggle form, and it is in the key because the two
are different native controls with different padding: on iOS the same `tonal` rung
measures wider as a `Button` than as a `Toggle(.button)`, and one cached size cannot
be both. Android composes both forms from the same container and is unaffected; it
shares the field because the platforms read one key.

`shape`, `checked`, `disabled` and `tintColor` are *not* in the key. They repaint
and do not resize, and that is measured rather than assumed: the two states of a
toggle are the same box, and a fresh control of a configuration a toggled one has
already drawn needs no correction.

The first control of a configuration is laid out at a declared fallback and corrected
the turn it measures. The fallback for IconButton:

| Platform | Declared fallback | What it is                                                            |
| -------- | ----------------- | --------------------------------------------------------------------- |
| Android  | 48 × 48 dp        | Material's `MinInteractiveComponentSize` — the floor under every rung   |
| iOS      | 44 × 44 pt        | Apple's minimum tappable region — the floor under every rung            |

On this control neither number is an estimate of some average configuration: both are
the floor that every configuration is at least as big as (see "The touch target"),
which is what makes a single number fair for a five-rung ladder. Each platform's
minimum is larger than every container and every glyph its ladder draws below the top
rung, so no cold first frame is further from its own control than that number is; the
measured tables below say where a box leaves the floor.

### The ladder, measured

`example/__tests__/IconButton.harness.tsx` mounts every rung × width from a poisoned
fallback and reports the laid-out box. Material's own container tokens, read out of
the `material3` artifact — the test asserts *these* numbers rather than a copy of
what a device said:

| `size`   | token | `narrow` | `uniform` | `wide` | height | glyph |
| -------- | ----- | -------- | --------- | ------ | ------ | ----- |
| `small`  | XS    | 28       | 32        | 40     | 32     | 20    |
| `medium` | S     | 32       | 40        | 52     | 40     | 24    |
| `large`  | M     | 48       | 56        | 72     | 56     | 24    |
| `xlarge` | L     | 64       | 96        | 128    | 96     | 32    |
| `xxlarge`| XL    | 104      | 136       | 184    | 136    | 40    |

And what the device lays out (`max(token, 48)` on each axis, which is Material's
`minimumInteractiveComponentSize()` doing exactly what the token table says it
should):

| `size`   | `narrow`  | `uniform` | `wide`      | height |
| -------- | --------- | --------- | ----------- | ------ |
| `small`  | 48 × 48   | 48 × 48   | 48 × 48     | 48     |
| `medium` | 48 × 48   | 48 × 48   | 52 × 48     | 48     |
| `large`  | 48 × 56   | 56 × 56   | 72 × 56     | 56     |
| `xlarge` | 64 × 96   | 96 × 96   | 128 × 96    | 96     |
| `xxlarge`| 104 × 136 | 136 × 136 | 184 × 136   | 136    |

Two things fall out of the second table, and both are printed rather than hidden:

- the two bottom rungs are one 48 dp box for every width — Material's own floor, the
  same one `Button` hits at the bottom of its ladder — so `width` separates
  configurations everywhere its token clears that floor (`medium`'s 32/40/52 and up;
  only `small`'s 28/32/40 are all under it), while `size` separates them at every
  width from `large` up and only at `wide` below that;
- the token is not the box. Design against the right-hand table.

### iOS

iOS has no icon-button containers to ask, and `.controlSize` alone does not size an
icon-only label: measured on the device, the five rungs with `.controlSize` only
came back as **two** boxes — 15.33 × 15.00 pt and 17.67 × 16.00 pt. So the rung sets
the symbol's point size directly, to Material's glyph token for that rung
(20 / 24 / 24 / 32 / 40 pt), and the box is the glyph plus whatever the button style
adds. That makes the iOS ladder Material's **glyph** ladder rather than its
container ladder, and it inherits the token's one repeat: `medium` and `large` are
both 24 pt and so one glyph, while every other rung's glyph grows.

Measured on the device, `standard` (`.borderless`) in the press form with `xmark`.
The glyph column is what the rung's point size measures before the target is applied;
the box column is what the layout gets, and the two only part company where the floor
lifts:

| `size`   | glyph pt | glyph box (pt)  | `narrow` = `uniform` = `wide` |
| -------- | -------- | --------------- | ----------------------------- |
| `small`  | 20       | 20.33 × 19.00   | 44 × 44                       |
| `medium` | 24       | 25.00 × 23.00   | 44 × 44                       |
| `large`  | 24       | 25.00 × 23.00   | 44 × 44                       |
| `xlarge` | 32       | 33.33 × 31.00   | 44 × 44                       |
| `xxlarge`| 40       | 40.67 × 38.00   | 44 × 44                       |

All three `width` options are every one of those boxes: iOS has no counterpart to
Material's width options, so the column is printed three times over in the harness
and is one configuration in the engine.

### The touch target

**Every box is at least 44 × 44 pt, and the glyph stays at its rung.** Apple's
minimum for a tappable region is the same rule Material's 48 dp
`MinInteractiveComponentSize` is, so iOS floors the *target* exactly where Android
floors the *container*: `max(glyph box, 44)` on each axis, with the artwork drawn at
its own rung and centred. A `small` IconButton is a 20 pt glyph in a 44 pt target, not
a 20 pt control — which is also why the declared first-frame size is 44 × 44 rather
than the default rung's 25 × 23: with every glyph box under the floor, that one number
is now right for the whole ladder.

Growing the layout is not the same as growing the target. A SwiftUI `Button` hit-tests
its own label and style, not the frame its host was laid out in, so `.borderless` gets
its floor as a 44 pt minimum on the label — with nothing drawn around it, a wider label
*is* a wider control — and the configurations that draw a bezel (the three bordered
button styles, and the toggle form, whose `.button` style is bordered whatever
`variant` says) get a clear, tappable layer behind the control that answers a tap in
the margin through the same `press()` the control's own gesture runs. Widening their
label instead would widen the artwork, and a `filled` button's pill is design, not
padding.

The bordered variants are larger than their glyph by their style's own padding, and the two
forms pad differently: at `tonal`/`xxlarge` the harness measures 70.67 × 68.00 pt for the press
control and 80.67 × 68.00 pt for the toggle, so those are two boxes and two keys. Lower down
both styles measure under the target and lay out as one 44 × 44 pt box — correct, and the
reason `form` is asserted through its own size key rather than through a box the floor has just
hidden. `variant` is in the key for the same reason: each configuration is measured for itself.

## Accessibility

- **The label is the control's only name.** An IconButton has no text, so
  `accessibilityLabel` is required in the type, an empty one warns once in
  development, and the string goes to the native control's own name: Compose
  `semantics { contentDescription = … }` on the button, and the `Label`'s title on
  iOS, which `.labelStyle(.iconOnly)` hides visually without hiding from a reader.
  The real-input suite reads both back out of the OS tree.
- **A toggle adds a state, not a name.** On Android the merged semantics node a
  reader is handed carries the label *and* `toggle=On`/`toggle=Off` (the harness
  reads the same node, through Compose's own test-root accessibility API). On iOS the
  same control is announced as a **switch whose value is `1` when on and `0` when
  off** — what `Toggle(.button)` reports to XCUITest, which is what the real-input
  suite reads after a real tap rather than what a design note would prefer.
- `disabled` removes the control from interaction and reads as disabled on both
  platforms.
- **The stop is the drawn control, and for a bezelled one that is smaller than the
  target.** Measured by the real-input sweep: the `filled` case is announced by a button
  element at `18.67, 269.67, 38.67 × 38.67 pt` inside the `16, 267, 44 × 44 pt` box
  React Native laid out (see "The touch target"). A reader stops on the artwork's box; a
  finger can land anywhere in the 44 pt target, because the tappable margin behind the
  control is hidden from a reader on purpose. Two ways of moving the stop onto the
  target were built and both measured worse — they left the name on two elements — so
  the inset stop is what ships, and the real-input sweep prints it on every run and goes
  red the moment the name lands somewhere else.

## Behaviour notes

- **The form follows the props, every update.** Taking `checked`, `defaultChecked` and
  `onCheckedChange` away from a rendered control turns that same control back into a press
  button: `onPress` fires again, the selection read-out goes, and on iOS the control re-measures
  as the `Button` it now is. The form is a prop, not a decision the control keeps.
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

- `width` does nothing on iOS, and the ladder has eleven distinct boxes on Android and
  **one** on iOS: every glyph up to `xxlarge` measures under the 44 pt target, so all
  five `standard` rungs are laid out at one 44 × 44 pt box and only the artwork inside
  it changes. A configuration whose own style measures past the target — a bordered
  variant at a high rung, or a toggle — gets a box of its own, which is why `variant`
  and `form` are in the size configuration. Android's 48 dp floor hides the bottom of
  its ladder instead. The measured tables are the arbiter.
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
