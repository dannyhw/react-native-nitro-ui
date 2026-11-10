# Checkbox

A checkbox: Material 3's `Checkbox` on Android, and on iOS SwiftUI's `Toggle(isOn:)`
wearing a style that draws Apple's own checklist glyph — `checkmark.circle.fill` over
`circle`, the one Reminders and Notes draw. iOS has no checkbox: `CheckboxToggleStyle`
is `@available(iOS, unavailable)` in the SDK, so there is no system checkbox to
borrow, only the `Toggle` underneath one. Drawing Apple's symbol on Apple's control is
what lets a `Checkbox` stop looking exactly like a `Switch` without this library
imitating a control of its own (DECISIONS D47). `iosStyle` chooses the picture there —
`'circle'` (the default), `'square'`, or `'switch'`, the look this component shipped
with — and is ignored on Android, where Material 3 has a checkbox and there is nothing
to choose.

The value, the label, the events and the accessibility element are the same in all
three: the control is the `Toggle` in every style, and only its drawing changes.

Both are hosted by the core runtime (`docs/architecture/core.md`), so the control is
the real one, with its own press feedback, its own accessibility element and its own
dynamic-type handling.

```tsx
import { Checkbox } from 'react-native-nitro-ui';

const [terms, setTerms] = useState(false);
<Checkbox label="I accept the terms" checked={terms} onCheckedChange={setTerms} />
<Checkbox label="Email me offers" defaultChecked />
```

## API

| Prop                 | Type                                  | Default   | Maps to                                                              |
| -------------------- | ------------------------------------- | --------- | -------------------------------------------------------------------- |
| `label`              | `string \| undefined`                  | none      | Text beside the box: SwiftUI `Text`, Compose `Text`. Part of the control and of its size. `''` is treated as no label at all, on both platforms. On iOS the glyph is on its left. |
| `checked`            | `boolean \| undefined`                 | unset     | Controlled value. Omit it for an uncontrolled checkbox.              |
| `defaultChecked`     | `boolean \| undefined`                 | `false`   | Initial value of an uncontrolled checkbox.                           |
| `onCheckedChange`    | `(checked: boolean) => void`          | none      | Fired after every user toggle, with the value native now shows.      |
| `indeterminate`      | `boolean \| undefined`                 | `false`   | The third state: Material's `TriStateCheckbox` dash on Android, `minus.circle.fill` / `minus.square.fill` on iOS. A display, not a value, and `checked` outranks it on both. |
| `disabled`           | `boolean \| undefined`                 | `false`   | SwiftUI `.disabled()` / M3 `enabled = false`. No event fires.        |
| `tintColor`          | `ColorValue \| undefined`              | none      | The "on" accent: SwiftUI `.tint()` / `CheckboxDefaults.colors(checkedColor:)`. On iOS it colours the filled glyph; the empty box stays the system's secondary label colour. |
| `iosStyle`           | `'circle' \| 'square' \| 'switch'`       | `'circle'` | **iOS only.** Which picture to draw: the checklist circle, the square pair, or the `.switch` `Toggle` this component shipped with. Anything unrecognised is `'circle'`. Android ignores it, and its sizing key does not carry it. |
| `style`              | `ViewStyle`                           | none      | Overrides the measured box (see Sizing).                             |
| `testID`             | `string \| undefined`                  | none      | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.        |
| `accessibilityLabel` | `string \| undefined`                  | `label`   | Name of the control itself.                                          |
| `hybridRef`          | `(view: handle) => void`              | none      | **Internal.** Read-only handle for this repo's harness.              |
| `nuiPerfId`          | `number \| null \| undefined`          | `null`    | **Internal.** Instance id for perf marks.                            |

`Checkbox` is a `View`, so other `ViewProps` (`onLayout`, …) work as usual.
`hybridRef` and `nuiPerfId` are not app API (DECISIONS D14).

## Platform mapping

| Concept         | iOS                                                        | Android                                                        |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Control         | `Toggle(isOn:) { label }`, in all three styles             | `androidx.compose.material3.Checkbox`                          |
| Picture         | `iosStyle`: `checkmark.circle.fill` / `.square.fill`, or `.switch` | one Material 3 box — the prop is stored and never read    |
| Third state     | `minus.circle.fill` / `minus.square.fill`; `'switch'` has two positions and reads it as off | `androidx.compose.material3.TriStateCheckbox` |
| Label           | the `Toggle`'s label, beside the glyph; the row is one tap target | a `Row` of box + `Text`, both tappable                     |
| Value           | `NitroUiControlledValue<Bool>` on `CheckboxModel`          | `NitroUiControlledValue<Boolean>` on `CheckboxModel`           |
| Role            | SwiftUI's toggle trait                                     | `Role.Checkbox` with its `ToggleableState`, published by M3    |
| Name            | `.accessibilityLabel(_:)` on the `Toggle`                  | `contentDescription` on the merged row only — the box is presentational |
| Host            | `UIHostingController` inside `NitroSwiftUIHost`            | `NitroComposeHost<M>: AbstractComposeView`                     |

### Why `indeterminate` is a prop and not a third `checked` value

`checked` is `boolean | null` on both platforms. A `checked: 'indeterminate'` would
put a third case in the one prop every caller reads, and would make an app's `checked`
a type its `Switch` is not. So `indeterminate` is a *display*: it picks the third
picture — `TriStateCheckbox` on Android, `minus.circle.fill` / `minus.square.fill` on
iOS (DECISIONS D47 item 3) — and `onCheckedChange` never carries a third value.

One exception is worth stating because both platforms had to agree on it: `'switch'`
has two positions, so that one style reads the prop as off and draws nothing, exactly
as it did before D47. The harness pins the distinction by reading the picture, not the
prop — `displayed=mixed` with `symbol=minus.circle.fill` for a glyph style and
`displayed=0` with `symbol=switch` for `'switch'` — so the day SwiftUI gains a checkbox
and this library draws one, the test goes red rather than quietly agreeing.

### What a tap reports, from every state

One rule covers all four: **a press reports the opposite of what the box is
showing**, because the box's own value is what the user just pressed.

| What the box shows  | `indeterminate` | Tap reports | And then the box shows |
| ------------------- | --------------- | ----------- | ---------------------- |
| empty box           | `false`         | `true`      | check mark             |
| check mark          | `false`         | `false`     | empty box              |
| dash                | `true`          | `true`      | check mark             |
| check mark          | `true`          | **`false`** | dash                   |

The table is one table because the rule is one rule on both platforms: **`checked`
outranks `indeterminate`**, so the dash only ever shows while the value is off. Android's
`TriStateCheckbox` has always worked that way, and iOS was built to agree rather than to
invent a third picture of its own — were the dash stronger here, the same props would
draw a check mark on one platform and a dash on the other.

The last row is the one a caller has to handle, because it is the one where the display
and the value disagree in the direction that surprises: a box that is `indeterminate`
*while `checked` is true* draws a check mark, so the press that empties it reports
`false`. Nothing clears `indeterminate` for you — it is your prop — so a caller that
treats the third state as "some of them are selected" has to drop it when the user
resolves it:

```tsx
const [all, setAll] = useState(false);
const [mixed, setMixed] = useState(false);
<Checkbox
  label="Select all"
  checked={all}
  indeterminate={mixed}
  onCheckedChange={(next) => {
    setAll(next);
    setMixed(false); // the press answered the question the dash was asking
  }}
/>
```

Leaving it set is not broken, just still-ambiguous: the box falls back to the dash on
the next render, which is what the row above it (check mark → `false` → dash) draws.
`iosStyle='switch'` is the one place the table does not hold, because that control has
two positions to move between: it draws the empty box for the dash row and its press
reports `!checked` like any other.

`Checkbox.harness.tsx`'s third-state case pins the dash row on both platforms — drawn
`mixed`, tap reports `true` — and reads the picture with it (`symbol=minus.circle.fill`
on iOS, `symbol=switch` for the style that cannot draw it), so the two platforms cannot
drift into disagreeing about what the prop means; `real-input:android` taps both rows
with a finger.

## Sizing

A checkbox is its box plus its label (`sizing: "intrinsic"`). The host measures the
control unbounded and Yoga lays out that box. The sizing key is
`indeterminate|label`:

- `label` is content — a bare box and a labelled one are different controls of
  different widths, so a new label is a new configuration (`noteContentSizeMayHaveChanged`
  on iOS, the same call on Android);
- `indeterminate` is in the key on Android only, because that is where it changes
  what is drawn: `TriStateCheckbox` is a different composable with a different glyph.
  iOS draws the same switch either way, so turning it on there is not a cold
  configuration;
- `checked` is in neither key, because neither platform's box moves between states.
  `Checkbox.harness.tsx` measures a checked and an unchecked checkbox of one label
  side by side and asserts they are the same size — if that ever differs, the key is
  wrong and a first toggle is a cold configuration with a frame at the fallback.

`CheckboxFallbacks` measured on iPhone 17 / iOS 27 and an API 35 Pixel 9 emulator by
`example/__tests__/Checkbox.harness.tsx` (`bun run harness:*` prints them):

| Configuration         | iOS          | Android       |
| --------------------- | ------------ | ------------- |
| no label              | 61.00 × 28.00 pt | 48.00 × 48.00 dp |
| `label="Measured"`    | 145.00 × 28.00 pt | 131.05 × 48.00 dp |
| `indeterminate`, labelled | 145.00 × 28.00 pt | 131.05 × 48.00 dp |

The third state costs nothing: the dash replaces the check inside the same box, so
`indeterminate` measures the labelled size on both platforms — and on iOS it measures
it because the switch does not move at all. The bare iOS box is the one measurement
that equals its own declared fallback (61 × 28 pt), which is exactly why
`Checkbox.harness.tsx` poisons the cache with `11.5 × 57.5` before mounting: the
agreement has to be earned by a correction, not handed over by the fallback.

The fallback — the size of the very first frame before anything is measured — is
61 × 28 pt on iOS (51 × 31 pt before iOS 26) and 48 × 48 dp on Android
(`NitroUiSizing.setFallback` in `ios/components/Checkbox/HybridNitroUiCheckbox.swift`
and `android/.../HybridNitroUiCheckbox.kt`). Its **height is not a guess**:
`minimumInteractiveComponentSize` will not publish a smaller Android target than 48 dp,
so every configuration of this control is 48 dp tall, and the conformance run compares
that constant against the box it measures. The width is a bare box's, because the
engine keys fallbacks by component alone and a labelled Checkbox is wider by its label
(`Checkbox.harness.tsx` measures 48 against 131.05 dp, 61 against 145 pt). The first
instance of a new configuration can show it for one frame (DECISIONS D17).

A user `style` wins. A `width` narrower than the control truncates the label with a
trailing ellipsis on both platforms rather than painting outside the box.

**Where a tap lands.** Both platforms make the whole control one target, and they get
there differently. On Android the merged row node carries the toggle, so the box beside
it is presentational (`Checkbox.clearAndSetSemantics`) and the label is inside the row.
On iOS a switch-style `Toggle` answers touches on its glyph only: a press on a labelled
Checkbox's label measured as no `value` change and no event at all, so the row carries a
tap target of its own — an `overlay` calling `press()`, the same hook a harness toggle
runs. The `background` layer one would rather write was tried here and measured: three
presses on the row's middle left the switch at `off`, because a `Toggle` claims the whole
row for hit testing and a layer *behind* it is never asked. In front of the row a press
lands wherever it lands, and what that costs the glyph is SwiftUI's own press feedback and
the thumb's drag. What it does not cost is one press meaning one `onCheckedChange`:
`real-input:ios` taps the glyph itself and counts the events, which is where a row handler
and the `Toggle`'s own gesture both answering the same touch would show up.

**The label is centred against the box.** The Android row is 48 dp tall because the box
asks for a 48 dp touch target, and a `Row` aligns its children to the top unless told
otherwise — which drew a ~24 dp label 12 dp above the middle of a row every size
assertion measured as 48 dp. `verticalAlignment = Alignment.CenterVertically` is the fix,
and `Checkbox.harness.tsx` measures the label's middle against its row's to keep it.

## Accessibility

The control is the platform's, so the accessibility element is too:

- **Android is a checkbox.** Material publishes `Role.Checkbox` with its
  `ToggleableState`, and a labelled checkbox merges the box and the text into one
  node, so TalkBack gets one focus stop — "checkbox, checked, Email me offers" —
  rather than a nameless box and a separate piece of text. `mergeDescendants = true`
  is what does it: with two actionable nodes (the box and the clickable label)
  Compose otherwise leaves them alone. `Checkbox.harness.tsx` reads the merged node
  in-app through the control's own probe and asserts `role=Checkbox`,
  `checked=false`/`true`, the name, `disabled`, and that exactly one node publishes
  a toggle.
- **iOS is a toggle in all three styles.** G31 changed what the control *draws*, not
  what a reader meets: the element is still the `Toggle`'s, its name is still the label,
  and the symbol is `.accessibilityHidden(true)` so the glyph is a picture of the value
  rather than a second stop that says "image". XCUITest reports SwiftUI's toggle trait as
  a `switch` element with `value` 0 or 1 — the same answer Chip's filter chip measures,
  for the same reason. On iOS 27 the hosting view exposes no element to an in-app probe
  (`nuiTestProbeAccessibility` answers `unavailable`, as it does for Slider and Chip), so
  iOS role and state are asserted by real input: `RealInputTests.testRealInputCheckbox`
  and the a11y sweep's `checkbox` case.
- **The third state says "mixed", on both platforms.** A `Toggle` is two-position, so
  its element can only say checked or unchecked, and a reader told "off" about a box
  showing a dash is being told about a different box. Android's Material publishes
  `ToggleableState.Indeterminate` and TalkBack reads it as "Mixed"; iOS sets
  `.accessibilityValue(Text("mixed"))` for exactly the state where the picture and the
  value disagree, and leaves the `Toggle`'s own value alone otherwise — an empty value
  would silence it.
- `accessibilityLabel` goes on the control, never on a wrapper, and defaults to
  `label`. A *bare* Android checkbox has no name of its own, which is the argument
  for giving one: pass `accessibilityLabel` when there is no `label`.
- An empty name is no name. `accessibilityLabel=""` would silence the label it is meant
  to replace, and `label=""` would ask iOS for a checkbox with an empty name, so `''` is
  read as "unset" on both props, on both platforms: the control keeps the label it has and
  gets no `accessibilityLabel` applied at all. The same rule
  covers `label` for sizing — `''` is the bare configuration, so `label=""` and no `label`
  share one sizing key rather than paying for two first frames.

## Behaviour notes

- **Refused toggles revert.** A controlled checkbox whose `onCheckedChange` does not
  pass the value back snaps back: the event count still advanced, so a commit
  happens and native repaints the value React kept. The next tap asks for the same
  value again — which is the oracle `real-input` uses for a refusing parent.
- **Stale writes are dropped.** A `checked` written while a toggle is in flight is
  ignored rather than undoing what the user just did (the event-count handshake,
  `docs/architecture/core-architecture.md` §4).
- **A press asks for the opposite of what is showing**, from whichever hand the
  platform's control reaches: Material's own `onCheckedChange` on Android's bare box, the
  merged row's `clickable` beside a label, and the `Toggle` binding on iOS. Every one of
  them ends in the model's `press()`, so a tap, a harness hook and a keyboard cannot
  disagree about what a press means; a hook that always asked for `true` would be a
  control only the harness could turn off. On iOS the row's tap target calls `press()`
  too, which is what makes a press on the *label* a press on the control at all — see
  [Sizing](#sizing)'s note on where a tap lands.
- **Uncontrolled costs no render on either platform**, because neither state of a
  label is a different size — unlike Chip's filter chip on Android.
- **Recycling resets everything.** `NitroUiCheckbox` implements `RecyclableView`: a
  reused instance resets its model, its handshake counters, its test reports and
  re-seeds `defaultChecked`. The conformance suite's recycle probes cover it.

## Limits

- **iOS has no checkbox *control*.** `CheckboxToggleStyle` is unavailable there, so a
  Checkbox is a `Toggle` wearing a style that draws Apple's symbols. The glyph, the
  colours and the dash are Apple's; the layout around them is ours, which means iOS
  gets a checklist row rather than a system checklist row — no swipe-to-complete, no
  list separators, and no list-inset alignment with the system's own tables.
- **`iosStyle` is iOS's prop with Android's API surface.** It is sent to Android, kept
  on the model, read by nothing, and kept out of Android's sizing key — so an app that
  sets it gets one checkbox on Android whichever name it passes.
- **A label is one line**, tail-truncated, in the platform's body type. No
  multiline label and no `numberOfLines`.
- **No checkbox without a label on Android is unnamed** unless
  `accessibilityLabel` is given (see Accessibility).
- **Not hostable.** A `<Host>` refuses a `Checkbox` with an error that names it, as
  it does `Chip` and `TextField`. No round has measured a checkbox inside a Host.
- **The iOS harness cannot tap a checkbox.** Its HID-less touch reaches no SwiftUI
  gesture, and a `Toggle` is a gesture recognizer (`Button.harness.tsx` measured that
  for `Button`). The harness presses through `nuiTestToggle()`, and `real-input:ios`
  does the real taps — in both the default style and `iosStyle='switch'`.
  Those real taps are also what pin the row: a switch-style `Toggle` answers touches on
  its glyph only — measured, a press on a labelled Checkbox's label delivered no value
  change and no event at all — so the row carries a tap target of its own that calls the
  same `press()` a tap takes, the way Android's merged `Row` does. The check taps the
  row's middle and asserts that middle is on the label's side of the glyph, so the claim
  cannot quietly become a tap on the box.
- **No bench arm.** `component.json` says `bench: false`, so the bench host has no
  Checkbox row yet; Switch's arms are the template when one is added.
