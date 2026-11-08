# Form

A grouped, scrolling settings screen: `UICollectionView` in the `.insetGrouped`
list style on iOS, rows left exactly where React Native put them with Material 3
Expressive's segmented-list shapes drawn behind them on Android. What the platform
draws is the *grouping* — the card, the header, the footer, the separators, the
rounded ends, the pressed state. What React Native lays out is the *row*: any view
can be a row, and a nitro-ui control inside one is the same standalone control it
is anywhere else in the app.

```tsx
import { Form, Switch, Text } from 'react-native-nitro-ui';

<Form>
  <Form.Section title="Notifications" footer="Push arrives on this device only.">
    <Form.Row>
      <Text style={{ flex: 1 }}>Push notifications</Text>
      <Switch value={push} onValueChange={setPush} />
    </Form.Row>
  </Form.Section>
</Form>;
```

There is no Android `Form` composable to host and no SwiftUI `Form` to bridge: on
iOS the container is UIKit's list, and on Android the scroller is React Native's
own `ScrollView` with one Compose layer per section behind its rows. That is what
keeps rows live — a row is a React Native subtree, so it keeps its own state, its
own gestures and its own controls (`docs/DECISIONS.md` D45).

## API

### `Form`

| Prop                | Type                     | Default | Maps to                                                                    |
| ------------------- | ------------------------ | ------- | -------------------------------------------------------------------------- |
| `children`          | `ReactNode`              | —       | `Form.Section`s, or rows directly.                                          |
| `keyboardAvoidance` | `boolean \| undefined`   | `true`  | Keeps the focused row above the keyboard, on both platforms.                |
| `style`             | `ViewStyle`              | —       | Give it `flex: 1`; the Form scrolls, so it wants the height it is given.    |
| `hybridRef`         | `(view: handle) => void` | —       | **Internal.** Test seam for this repo's harness.                            |

Everything else is `ViewProps`. `Form` is not a `<Host>` child, and it is not
self-sizing — it takes the box you give it.

### `Form.Section`

| Prop      | Type                     | Default | Maps to                                                        |
| --------- | ------------------------ | ------- | -------------------------------------------------------------- |
| `children`| `ReactNode`              | —       | Each direct child becomes one row.                              |
| `title`   | `string \| null`         | `null`  | The header above the group, as text.                            |
| `footer`  | `string \| null`         | `null`  | The explanation below the group, as text.                       |
| `hybridRef` | `(view: handle) => void` | —      | **Internal.** Test seam.                                        |

Headers and footers are strings in v1. The platform draws them, which is why they
cost no rows and why a React Native header node is a later decision.

### `Form.Row`

| Prop        | Type                     | Default    | Maps to                                                                 |
| ----------- | ------------------------ | ---------- | ------------------------------------------------------------------------ |
| `children`  | `ReactNode`              | —          | The row's content.                                                        |
| `onPress`   | `() => void \| undefined`| —          | The cell highlight and one a11y element on iOS; M3's pressed state and one merged node on Android. |
| `accessory` | `'none' \| 'disclosure' \| 'checkmark'` | `'none'` | `UICellAccessory.disclosureIndicator` / `.checkmark`; Material Symbols `chevron_right` / `check` (D43). |
| `selected`  | `boolean \| undefined`   | `false`    | The cell's selected background; `secondaryContainer` on Android.          |
| `style`     | `ViewStyle`              | —          | Laid out by Yoga inside the row box.                                      |
| `hybridRef` | `(view: handle) => void` | —          | **Internal.** Test seam.                                                  |

You rarely write `Form.Row`: `Form.Section` wraps every direct child in one, so an
app names the component only to add `onPress` or an accessory. A row without
`onPress` leaves its content alone — a `Switch` inside it keeps its own
accessibility element and its own touches.

## Platform mapping

| Concept      | iOS                                                        | Android                                                          |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Container    | `UICollectionView` + `UICollectionLayoutListConfiguration(.insetGrouped)` | React Native `ScrollView`; one Compose layer per section           |
| Rows         | React Native views adopted into list cells                  | React Native views, in place                                       |
| Grouping     | the list's own card, insets and separators                  | `SegmentedListItem` shapes and colours behind the rows             |
| Header/footer| a supplementary view in the list                            | text drawn in a band the section reserves above and below its rows |
| Accessory    | `UICellAccessory`                                            | Material Symbols drawables through `NitroUiIcons`                  |
| Press        | the cell's own highlight                                    | M3's pressed indication, without stealing touches from the row     |
| Keyboard     | a bottom content inset on the list, then scroll the row in | the IME inset reserved in the scroll content, then make the row visible |

## Rows

A row is one direct child of a section. The wrapper walks arrays and fragments, so
a `map` produces one row per item and an app's own keys survive. A bare string is a
row of text, the same rule React Native's lists use.

A row's own content is laid out by Yoga at the width the row is given, which on iOS
is the width a cell hands it — narrower than the list's own bounds by the grouped
insets. The Form reports that width and applies it to every row, which is what makes a
row's Yoga height equal the cell's height, and what makes a wrapping `Text` grow the
cell that holds it.

On Android a row with an `accessory` gives up the trailing room the section is going
to draw the glyph in, so the accessory never lands on top of your content.

## Sizing

A `Form` is not self-sizing (`sizing: null`): it fills the box you give it and
scrolls inside that. Rows size themselves from their content — there is no
`rowHeight` prop, and no measurement pass — because the row is React Native's, and
the cell takes the height Yoga computed for it.

What a row starts from is a minimum, not a fixed size: React Native's row box is
`minHeight: 44` on iOS and 56 on Android, and it grows with whatever you put in it.
The box you then see on screen is that plus the platform's own chrome — on iOS the
cell adds 4 pt above and below, which is what lands a one-line row on the 52 pt the
same row has in a SwiftUI `Form`. Compare a row with the platform's own list, not
with the minimum: the harness measures exactly that pair.

That chrome is the platform's, so the platform reports it — the section is told the
space between adjacent rows along with its header and footer bands, and each row
takes half of it above and below itself as a margin. Your row's own box stays the
box you styled; the space around it is measured, never typed. It matters for more
than the picture: rows are laid out by Yoga, and if the layout stacks them at 44 pt
while the list draws them at 52, every measurement below the first row is wrong by
8 pt more than the one above it.

## Keyboard

Neither platform avoids the keyboard for an input hosted inside a row, so the Form
does it (`keyboardAvoidance`, on by default). iOS grows the list's bottom inset by
the keyboard and scrolls the focused row in; Android reserves the IME inset in its
scroll content and asks the scroll ancestor to make the focused row visible. A
`TextField` or `SearchField` in a row near the bottom stays visible on both.

## `measure()` is right once scrolling settles

`measure()` and `measureInWindow()` on a row report where the row is drawn, not
where the layout tree pretends it is — including after a scroll. The Form publishes
its scroll offset as one prop and its shadow node subtracts it, the way React
Native's own scroll views do.

Two things follow from that, and both are deliberate:

- **A row's box is right when the list is at rest, not on every frame of a fling.**
  The offset is published when scrolling settles. Mid-fling, a measurement reads the
  last settled position.
- **A row outside the visible cells is not attached to a cell.** Its box is still the
  position its content occupies in the list, so an anchored surface — a `Tooltip`, a
  `Popover`, a `ContextMenu` — pointed at a row that has scrolled away behaves the
  way it would for any anchor that has been scrolled off. v1 has no
  "scroll-to-the-anchor first" step.

## Long lists

A `Form` builds every row it is given, like SwiftUI `Form` does: rows exist as
React Native views whether or not they are on screen (iOS reuses the *cells*, not the
rows). That is right for a settings screen. It is the wrong tool for a thousand
rows, and this library does not ship a virtualised list to compete with one — put
the long list in [FlashList](https://github.com/shopify/flash-list) or
[Legend List](https://github.com/LegendApp/legend-list), which virtualize ordinary
React Native children and so host nitro-ui controls in their rows today.

## Accessibility

A row with `onPress` is **one** element: a button on iOS (`.button` trait, the cell
itself as the element), one merged node on Android. Its content stops being read
piece by piece, which is what a settings row should do — label the row with
`accessibilityLabel` if its title is not the text inside it.

A row *without* `onPress` is not an element at all: its children are read
individually, so a `Switch` in a row is a switch and nothing more.

Section headers are headings on both platforms. Footers are plain text.

## Recycling and cleanup

All three views implement `RecyclableView` with a full reset, and each clears its
own state in `onDropView`: a cell handed back by UIKit forgets which row it held, a
row leaving its cell forgets its highlight, and a section whose rows changed
recounts the shapes before it draws the next frame. The harness checks this by
walking rows in and out of cells and asserting nothing is orphaned.

## Limits

- Headers and footers are strings; React Native header and footer nodes are not in
  v1.
- No swipe actions, no collapsible sections, no drag to reorder.
- `measure()` is settled-time, and a row off-screen has no cell (above).
- No virtualisation: a `Form` with hundreds of rows pays for hundreds of rows.
