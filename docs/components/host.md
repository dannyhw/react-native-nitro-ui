# Host

A container that renders its nitro-ui children into one native composition instead of one per
control. On Android that means one Compose `Composition`, one `AndroidComposeView` and one
`LayoutNode` tree for the whole batch; outside a Host every control brings its own.

It is opt-in, and Android-only: on iOS `<Host>` is a passthrough `View`, so the same JSX renders
normally there.

```tsx
import { Host, Switch } from 'react-native-nitro-ui';

<Host style={{ height: 20 * 48 }}>
  {rows.map((row) => (
    <Switch key={row.id} value={row.on} onValueChange={row.toggle} />
  ))}
</Host>;
```

## When to use it

Use it when a screen mounts a batch of the same control at once and the mount is what costs: a
settings list, a table of rows, a filter panel. Measured with Switches (memory at N=200, the rest
at N=50), ART `speed-profile`, on an API 35 Pixel 9 emulator. Every number is the launch-paired
ratio to `expo-ui-shared-host` (the same controls through `@expo/ui` in one hosting view):

|                              | `nitro-ui` (no Host) | `expo-ui-shared-host` | `nitro-ui` + `<Host>` |
| ---------------------------- | -------------------- | --------------------- | --------------------- |
| Mount memory                 | 2.75x                | 1.00x                 | **0.86x**             |
| Mount UI-thread CPU per op   | 1.39x                | 1.00x                 | **0.87x**             |
| Mount wall time (`mounted`)  | 1.13x                | 1.00x                 | **0.97x**             |
| Mount `presented`            | 1.01x                | 1.00x                 | **0.99x**             |
| Mount JS CPU per op          | 0.73x                | 1.00x                 | 1.18x                 |
| Unmount UI-thread CPU per op | 1.31x                | 1.00x                 | **0.78x**             |

The unmount figure has a 16% launch spread.

The cost is on the JS thread: a hosted control is still a React Native node and also a child of
the Host's composition, so mount JS CPU is 1.18x the shared host (between 1.10x and 1.26x across
runs), where the unhosted control is below it at 0.73x. That cost is why `Host` is something an
app chooses for a dense list and not what every container does.

The numbers for the other hostable controls are in [performance.md](../performance.md), under
"`<Host>` on Android".

## API

`HostProps extends ViewProps`. It is a container, so it takes layout props like any other view
and nothing else: no `count`, no `renderItem`, no per-child options.

| Prop       | Type                  | Notes                                                                                                                                                                  |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `children` | `ReactNode`           | Hostable controls only; see "What a Host cannot hold".                                                                                                                 |
| `style`    | `ViewStyle`           | Its `height` is the box the content is drawn into (see Sizing).                                                                                                        |
| `testID`   | `string \| undefined` | Lands on the container. Hosted children keep theirs, but on Android their box is the engine's frame, never the drawing's (see "Finding a hosted control from a test"). |
| `onLayout` | callback              | Chained: the caller's handler runs first, then the dev-only warning. A release build passes yours, or none.                                                            |

## What a Host cannot hold

Each rule follows from who owns the pixels, and each is a refusal in development, not a screen
that draws half of itself.

- Anything that is not a hostable control. The hostable controls are `Switch`, `Slider`,
  `Progress`, `Button`, `SegmentedControl`, `Picker`, `DatePicker`, `Menu`, `AlertDialog` and
  `ConfirmationDialog` (`HOSTABLE_CONTROLS` in `src/components/Host/HostChildren.ts`). The
  library's other components, an RN view (`View`, `Text`, `ScrollView`, `Image`, `Modal`, …), a
  third-party native view, plain text as a direct child, and another `<Host>` each throw in
  development, on both platforms.
- The rule is enforced twice, because the two sides see different trees. JavaScript refuses what
  it can name. It cannot see through a component, so a `<Row>` that renders a `View` reaches the
  native Host as a direct child, and there `NitroComposeHost.isHostable` decides: it is `false`
  on the base class and `true` on the hostable controls' hosts only. In a debuggable build the
  Host reports the refusal to JavaScript, where it becomes a `console.error` that names the
  child's class. In a release build the child draws nothing and nothing is logged.
- No nesting. A `<Host>` cannot hold another `<Host>`. Put Hosts side by side, each with its own
  height.
- No interleaving. An RN view cannot sit between two hosted controls or beside one: RN hands the
  Host one rectangle and everything inside it is Compose's.
- No RN scrolling, clipping or transforming of the children. A `ScrollView` around a Host moves
  the Host's whole rectangle. RN cannot scroll the content inside it, clip part of it
  (`removeClippedSubviews`) or transform one child. A list that virtualises has to add and remove
  whole children; the Host recomposes when the set changes.
- No React Native `Modal`, and no other RN view that owns a window. Its window would be a sibling
  of the Host's, not a child of its composition. A hosted control that presents its own popup or
  dialog is supported; see "Popups and dialogs".
- No per-child size. A `width`, `height` or `alignSelf` on a hosted child moves the frame React
  Native computes, not the drawing (see Sizing). The drawing comes from the control's own sizing
  policy and the Host's box: `Slider`, a linear `Progress` and a `wheel` `Picker` take the Host's
  inner width, and `Button`, `Switch`, a circular `Progress`, `SegmentedControl`, a `menu`
  `Picker` and `DatePicker` take their own size at the column's leading edge.
- Only some of a Host's own styles reach the drawing. `width`, `height` and `flex` size the box,
  `alignSelf` positions the Host inside its parent, and `padding` and `borderWidth` inset the
  drawing. A Host paints nothing of its own, so `borderWidth: 2` moves the drawing in by 2 dp
  and draws no border. `gap` / `rowGap` / `columnGap`, `flexDirection`, `alignItems`,
  `alignContent`, `justifyContent` and `pointerEvents` do not reach the drawing: Compose arranges
  the rows (one column, no gaps) and takes the touches, while Yoga still applies them to the box.
  So `gap: 8` over ten children adds 72 dp of height and no space between rows, and
  `flexDirection: 'row'` gives a one-row-tall box around a stack of rows. Development builds warn
  about each once per instance. Give the Host a height and stack it in a column.

Components are transparent in both directions. React flattens them out of the native tree, so a
wrapper component that renders a `Switch` is a direct child of the Host and is hosted. A `Switch`
inside an RN `View` inside a Host is not hosted, because the `View` is the direct child, and a
`View` is refused.

## Popups and dialogs

Some hosted controls present something outside their own box: a `Picker` opens an
`ExposedDropdownMenu`, a `DatePicker` on Android opens a dialog in each of its `compact` modes,
and a `Menu` opens its list ([menu.md](menu.md), "Inside a `Host`").

Those windows belong to the Host's composition: a Compose popup opened from inside an
`AndroidComposeView` is attached to that view, so disposing the composition takes the window
down. React Native's frame for a hosted child is `0 × 0`, so an open menu's anchor is read out of
the drawing (`noteCompositionOrigin`), its box is watched from the nearest ancestor React Native
placed (`placedViewOf` and its `OnLayoutChangeListener`), and `dropOpenMenu` closes the menu when
that box moves. `Picker` and `Menu` do this hosted and unhosted alike.

| Situation                                                                                     | What a hosted popup does                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Host is scrolled, or sits nowhere near the top of the screen                              | The menu opens under the box the Host drew, wherever on the screen that is. React Native's frame for the child is never consulted.                                                                     |
| The Host, or the row, is moved by layout while a menu is open                                 | The menu closes: the window cannot follow a row that is no longer where it opened. A scroll is not a layout move, and an open menu stays open across one. The same applies to an unhosted `Picker`.    |
| Outside tap, the back gesture, or a row                                                       | Each closes it, as unhosted, and the event count still decides whether the row is accepted. A refused choice still closes the menu and leaves the value where React kept it.                           |
| The options change while it is open                                                           | The open menu shows the new rows; the chosen index is whatever the list now says.                                                                                                                      |
| The control is disabled while its window is up                                                | The window closes.                                                                                                                                                                                     |
| The child is removed, reordered, or the Host is dropped (`onDropView`) while a window is open | Nothing is left behind. The window belongs to the composition that opened it, so when that composition goes, the window goes with it. A reorder that moves the row under an open menu closes the menu. |
| A neighbour row leaves the Host while a window is open                                        | The rows after it are re-framed, which is a layout move, so their popup or dialog closes. A change that moves no row closes nothing.                                                                   |
| Two popup owners in one Host                                                                  | They open one after the other; the second one's window does not inherit the first one's state, and afterwards no window is left.                                                                       |
| TalkBack / VoiceOver                                                                          | The rows are reachable while the menu is open, and the current choice is marked selected. On iOS a Host is a passthrough, so it is the ordinary `Picker` tree ([picker.md](picker.md)).                |

The `DatePicker`'s dialog follows the same rule: it is composed from the model's own `presented`
state inside the Host's composition ([date-picker.md](date-picker.md)). A hosted field's dialog
follows a value React writes while it is up, closes when the field is disabled, and leaves nothing
when the Host is dropped. It also closes when the child is taken out of the Host, when the child
gets `display: 'none'`, and when its row is moved by layout. This holds for the `date`, `time`
and `datetime` modes.

A `Menu` has no value, so no event count is involved: a pick reports `onSelect` and then
`onClose`. On iOS a Host is a passthrough and SwiftUI keeps the presentation to itself.

## Sizing

A hosted control never measures its content and never reports to the sizing engine. Its React
Native frame still exists, is still the engine's answer and still feeds the Host's box, but it
does not place the drawing. The Host places its children itself: one Compose `Column`, in mount
order, at the Host's width, from the top-leading edge, clipped to the Host's box. That box is the
Host's own `style` or, with no `height`, the sum of its children's engine boxes.

Measured (`example/__tests__/Host.harness.tsx`):

| Measured                                                       | Result                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Host `{width: 260, height: 140}` with 288 of children          | box is 260 × 140; `onLayout` reports the same                                                          |
| Host `{width: 260}`, children `height: 24` (Compose draws 144) | height is 72, the sum of the children's engine boxes                                                   |
| Host with children `height: 96` vs the same Host with `20`     | identical presses at identical offsets                                                                 |
| Host `{width: 300, height: 60}` vs `{height: 240}`, same rows  | the short one clips its lower rows; neither centres them                                               |
| Child `width: '100%'` + `alignSelf: 'stretch'` vs nothing      | hit-testable at the same x offsets                                                                     |
| Eight hosted Switches on an invalidated cache                  | reports 0, cache entries 0, corrections 0                                                              |
| The same eight unhosted                                        | reports 16, cache entries 1                                                                            |
| Measure calls, hosted vs unhosted                              | 8 and 8: Yoga still asks, and the engine still answers                                                 |
| A hosted child's own Android view                              | found by `testID`; `0 × 0` at mount, its Yoga frame after any later pass over it, never the drawn rect |
| A Host with `padding: 32` vs the same Host with none           | the drawing starts 32 dp later; the box is the same                                                    |
| A hosted child with `display: 'none'` vs shown                 | the hidden row draws and answers nothing; the shown one answers both                                   |

### What each control draws inside the box

The Host gives every child the same constraint, the Host's inner width, and the control's own
sizing policy decides what to do with it:

| Control             | Policy    | Drawn inside a Host                                                 | Aimed at (Android)              |
| ------------------- | --------- | ------------------------------------------------------------------- | ------------------------------- |
| `Slider`            | fillWidth | the Host's inner width × its own height                             | the drawn track, by label       |
| `Progress` linear   | fillWidth | the Host's inner width × the bar's thickness                        | nothing to press; read the tree |
| `Progress` circular | intrinsic | its own square, at the column's leading edge                        | nothing to press; read the tree |
| `Switch`            | intrinsic | its own box (52 × 32 dp of drawing), at the leading edge            | the drawn switch, by label      |
| `Button`            | intrinsic | the width its title needs × its scale's height, at the leading edge | the drawn button, by label      |

- A hosted `Slider` is stretched by the Host, not by its own style. The same child with
  `width: 60` answers `0…100` differently in a 260 dp Host and a 100 dp one, because a tap's
  value is a fraction of the width Compose laid the track out at. In a 260 dp Host a tap 240 dp
  along answers 90+.
- A hosted `Button` is not stretched. Two Buttons in one 260 dp Host, one titled `Go` and one
  `Roll back the release`, both start at the leading edge, and neither answers 250 dp across.
  `width: 220, height: 120` on the child changes none of it.
- A linear and a circular `Progress` coexist in one Host: the accessibility tree reports the bar
  as wide as a `Slider` in the same Host and the indicator as a small square.

Two consequences:

- A Host that ends up 0 tall draws nothing. It cannot grow, because nothing inside it reports a
  size. Development builds warn once per instance from the Host's own `onLayout`.
- A hosted control never shows a fallback size for a frame: there is no measurement that could
  arrive late. Unhosted controls are unchanged.

## Accessibility

A Host changes which side publishes the accessibility node, and that is invisible from outside.
On an API 35 emulator (Android 15, 420 dpi):

- One labelled node per hosted control, from Compose. Each hosted child publishes an
  `android.view.View` whose `content-desc` is its `accessibilityLabel`, from the same
  `Modifier.semantics { contentDescription }` as unhosted. Attribute for attribute (`class`,
  `content-desc`, `enabled`, `focusable`, `clickable`, `checkable`, `checked`) a hosted node and
  the same control unhosted are identical, and a Host of five children publishes five nodes, in
  mount order.
- No node from the React Native side. A hosted child's own Android view is laid out at `0 × 0`
  when it mounts, which is not visible to the user, so it contributes no accessibility node and
  no control is read twice.
- Reading order is mount order. The labelled nodes sit between the RN content above the Host and
  the RN content below it.
- The rect is the box that is drawn. A hosted Switch reports 137 × 84 px, the 52 × 32 dp Compose
  switch. For a hosted control the focused rect, the drawn rect and the hit rect are one rect.
- The Host's own box is not an accessibility element. It has no label and no role, so it is not a
  focus stop and does not swallow its children. Style the box; do not re-role it.
- Children that are off screen report an empty rect. In a batch of 24, the 20 that fit the
  viewport report bounds; the rest report `[0,0][0,0]` until scrolled into view. The whole set is
  in the accessibility tree at once, so a screen reader can reach every hosted control.

### Finding a hosted control from a test

`testID` survives hosting: the child's Android view still exists and still carries the id, so
`queryByTestId` finds it. What it returns is never where the control is drawn:

- At mount it is `0 × 0` at the Host's origin. A view that declines to measure gets no frame.
- After any later layout pass over that child it is the child's Yoga frame. A hosted child whose
  own `style` goes from 120 × 44 to 160 × 60 reads `[160, 60, 0, 48]`, the engine's box in the
  row Yoga put it in, while the drawing answers at the same offsets as before. A child added to a
  Host later reads the same way (`[52, 48, 0, 96]` for a third row), and so does one whose row
  moved because a sibling above it was re-framed.

So a hosted child's box is sometimes nothing and sometimes a rectangle around something else:
108 dp of box around a 52 × 32 switch. Detox, Maestro and Appium tap the centre of the view that
carries the id, so `tap(by.id('wifi'))` inside a Host taps nothing, the middle of an empty box,
or the row beside it.

Inside a Host, find hosted controls by `accessibilityLabel`. The label is published by the
Compose node, whose rect is the drawn one. `testID` is not carried into Compose for a hosted
control, so the drawn rect has no `resource-id`.

A Host does not change what a control reports to a screen reader: the toggle state of a hosted
`Switch` is the same as an unhosted one's ([switch.md](switch.md)). On iOS a Host is a
passthrough, so the iOS accessibility tree is the unhosted one.
