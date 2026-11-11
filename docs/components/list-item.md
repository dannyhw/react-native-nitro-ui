# ListItem

The row *content* of a list row, drawn by the platform's own row view: UIKit's
`UIListContentView` on iOS, Material 3's `ListItem` on Android. Not a `Text` pair
measured to look like one — the row's metrics, truncation, chevron and press
highlight are the platform's, and a screen reader meets the platform's row rather
than an approximation of it.

A ListItem is content, **not a cell**. Inside a [`Form.Row`](form.md) the row is
the cell and owns the insets, the shape and the press; standalone the item adds
the list's own insets and its own highlight. Nothing has to be configured for the
difference — `Form.Row` publishes it, and the item reads it.

```tsx
import { ListItem } from 'react-native-nitro-ui';

<ListItem
  accessory="disclosure"
  androidIcon={require('./icons/bell.xml')}
  onPress={openNotifications}
  subtitle="Only while the app is open"
  systemImage="bell.badge"
  title="Notifications"
  value="On"
/>;
```

## API

| Prop                 | Type                        | Default  | Notes                                                        |
| -------------------- | --------------------------- | -------- | ------------------------------------------------------------ |
| `title`              | `string \| undefined`       | —        | The headline. One line, tail-truncated.                      |
| `subtitle`           | `string \| undefined`       | —        | The supporting line under the headline. The one slot that costs height. |
| `value`              | `string \| undefined`       | —        | Trailing text on the **headline's own line**. Costs no height. |
| `systemImage`        | `string \| undefined`       | —        | Leading SF Symbol (iOS). Android ignores it.                  |
| `androidIcon`        | `AndroidIconProp \| undefined` | —     | Leading glyph on Android: a `require()`'d file, `{ uri }`, or a drawable name. |
| `accessory`          | `'none' \| 'disclosure'`    | `'none'` | The trailing chevron a row that goes somewhere carries.       |
| `onPress`            | `() => void \| undefined`   | —        | Absent → not a button, no highlight, and a tap goes through the row. |
| `disabled`           | `boolean`                   | `false`  | Drawn, inert: no press, no highlight, no event.               |
| `accessibilityLabel` | `string \| undefined`       | —        | The whole label. Without it the row reads title, subtitle and value. |
| `testID`             | `string`                    | —        | Forwarded to the native view.                                 |
| `style`              | `StyleProp<ViewStyle>`      | —        | Applied over the item's own `alignSelf: 'stretch'`.           |

`systemImage` and `androidIcon` are the two spellings of one slot, because
neither platform can draw the other's artwork; the same row names both and each
platform reads its own. An `androidIcon` that cannot be resolved draws nothing and
warns in development, exactly as `Button`'s does — the slot is still held at its
24 dp, so the row does not move when a glyph fails to load.

## Platform mapping

| Slot               | iOS                                                          | Android                                                     |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| The row            | `UIListContentView` with `.cell()` / `.subtitleCell()`        | `androidx.compose.material3.ListItem` (material3 1.5)        |
| Headline           | the configuration's `text`                                    | `headlineContent`                                            |
| Subtitle           | `secondaryText`                                               | `supportingContent`                                          |
| Value              | a label pinned to the headline's **first baseline**           | a trailing composable in `headlineContent`, same line         |
| Leading glyph      | the configuration's `image`, `imageToTextPadding` 16 pt       | `leadingContent`, 24 dp (`ListTokens.ItemLeadingIconSize`), 12 dp gap |
| Chevron            | `chevron.right` in `.tertiaryLabel`, right-aligned            | `chevron_right` in `trailingContent`                          |
| Press highlight    | the platform's own row colour (`.quaternarySystemFill`)       | Material's own `ripple()`, bounded to the row (see below)      |
| Container          | none — the row is transparent                                 | `containerColor = Transparent`, because M3 paints `Surface` by default |

**The value is on the headline's line on both platforms.** Material's
`trailingContent` slot is vertically centred against the whole row, which on a
two-line item puts the value between the lines; UIKit's value slot sits on the
headline's baseline. Material's centred slot is therefore not used — the value goes
into `headlineContent` behind the headline, which is the same arrangement UIKit
draws.

## Press feedback

**Android's row installs its own ripple.** Material's interactive `ListItem(onClick:)`
overload answers a press two ways — it morphs the container it paints, and it draws
`ripple(bounded = false)` — and this row paints no container, so the first has nothing to
show and, measured on a device, the second showed nothing either: a 996 × 189 px row
sampled as a 5 × 3 grid read 0.9880 mean luma at rest and 0.9880 luma with a real gesture
stream holding a finger on it 900 ms later, while the row's own `onClick` fired twice. The
row therefore takes the plain `ListItem` overload and carries Material's own bounded
`ripple()`, the same indication `Form` puts on its rows: 0.9133 luma with the finger down,
back to 0.9880 when it lifts. It is still the platform's indication rather than a colour
this library chose; what changed is who installs it. Inside a `Form.Row` the indication is
`null`, because the cell's highlight is the highlight and a second one would be a band
inside a band.

## Sizing

`fillWidth`: the width is the box's, and the item answers only the height.

**Every slot is one line, tail-truncated**, and that is the sizing rule, not a
style. It is what makes the height a function of *which* slots are filled rather
than of what was typed into them, so the size configuration is two booleans —
subtitle present, leading glyph present:

| Configuration            | Size key   | iOS      | Android |
| ------------------------ | ---------- | -------- | ------- |
| Headline only            | `''`       | 52 pt    | 56 dp   |
| Headline + value         | `''`       | 52 pt    | 56 dp   |
| Headline + glyph         | `'i'`      | 52 pt    | 56 dp   |
| + subtitle               | `'s'`      | 69 pt    | 72 dp   |
| + subtitle + glyph       | `'s\|i'`   | 69 pt    | 72 dp   |

The numbers are the platforms', not this library's: 52 pt and 68.33 pt are what
`UIListContentView` measures with `.cell()` and `.subtitleCell()` at the large
content size (the height is rounded up when it reaches layout), and 56 dp and
72 dp are Material 3's own one- and two-line container minima. The leading glyph
is in the key because on Android a leading composable *could* raise the row's
minimum; it costs no height measured at 24 dp, and is keyed anyway so a taller
glyph cannot be silently shared into a shorter row's cached size.

A `value` and a `disclosure` chevron are **not** in the key: the value shares the
headline's line and the chevron sits inside the insets the row already has. Measured
on both platforms, neither moves the height, and the harness asserts that changing
them opens no new configuration at all.

The declared fallback — what a first mount is laid out at before anything has been
measured — is 300 × 52 on iOS and 300 × 56 on Android: the headline-only row, which
is what a list's first row almost always is. Because a fallback is a guess, the
harness measures every *other* configuration from a poisoned size, so a correction
that fails to arrive is a wrong box rather than a lucky one.

Dynamic Type and `fontScale` are respected through the sizing engine's environment
epoch: the row re-measures and every cached size for it is dropped. Measured on
iOS, one line of the body font goes 52 pt → 54 pt (accessibility XL) → 56 pt (XXL)
→ 113.33 pt (AXL), which is UIKit's own row growing rather than this library's
arithmetic. On Android Material's text styles grow with `fontScale` and the row
rises past its 56 dp floor for the same reason.

## Inside a `Form`

A `Form.Row` is the cell: it draws the section's shape, the list's insets and the
press highlight. An item inside one therefore draws **none of those** — its content
starts where the cell's content starts, and it adds no background and no
highlight of its own. It knows because `Form.Row` publishes that through a context,
so an app never configures it and cannot get it wrong.

```tsx
<Form.Row onPress={openProfile}>
  {/* the row owns the press and the cell: this item is the content */}
  <ListItem subtitle="Signed in on 3 devices" title="Profile" />
</Form.Row>
```

That means a row can own the press and the item stay a label inside it — the
`Form.Row` example above, where `ListItem` has no `onPress`. Or the item can own
it, and then the row is a plain container for it. Wire the press on one of the
two, not both: two handlers on one cell is two highlights and, if both fire, two
navigations for one tap.

Standalone, the same item adds the list's own horizontal insets — 16 pt on iOS,
16 dp on Android, both measured against a real list cell — and, with `onPress`,
its own highlight. The `insets=` the harness reads are where the content actually
landed inside the view's bounds, and they are 16,16 standalone and 0,0 inside a
row.

## In a `FlashList` or `FlatList` row

Put one item in a row and it behaves like the row's own content:

```tsx
<FlashList
  data={conversations}
  renderItem={({ item }) => (
    <ListItem
      accessory="disclosure"
      onPress={() => open(item.id)}
      subtitle={item.preview}
      title={item.name}
      value={item.time}
    />
  )}
/>
```

- **The height is stable while the text changes.** Every slot is one line, so a
  row does not grow when a message arrives, and rows keep their pitch. A row that
  needs to wrap is not what this control is: it would make the height depend on a
  width the list does not know when it mounts.
- **The size is cached per configuration, not per row.** A hundred rows of one
  configuration pay one measurement.
- **A recycled row is reset completely.** The drawn slots, the press counter, the
  highlight, the accessibility label and the pixel-probe seams all go back to
  "nothing yet" in `prepareForRecycle`, so a reused row cannot show the previous
  owner's headline for one frame or count a press that belonged to it. Verified on
  both platforms: a row's second owner sees `presses=1` for its first tap, not 2.
- **`onPress` must not capture a stale row.** The callback is stable across
  re-renders, but a recycled row keeps the handler it was last given until the next
  commit — pass a handler that reads the row's current identity from the item, or
  key the row by it.
- `onDropView` releases what the row holds; nothing here keeps a view alive past
  the row.

## Accessibility

One element per item — never three — carrying the row's own label:

- With `onPress` it is a **button** on both platforms (UIKit's `.button` trait, and
  on Android an explicit `Role.Button`, because the `ListItem` overload that draws
  this row publishes no role of its own); without it, a plain text element.
- Its label is `accessibilityLabel` when given, otherwise the row's own title,
  subtitle and value.
- `disabled` is published as disabled, so a reader says so and a swipe action
  refuses the element; the row is still drawn and still hit-testable as a label.
- The leading glyph is decoration and is not announced; the chevron is the
  platform's own, so it carries no separate label.

The a11y sweep (`scripts/real-input`) reads the same node a reader is handed, and
the harness reads one node per item through the control's own probe — including
"more than one node names this item", which would be the row leaking its labels as
separate elements.

## Limits

- **One line per slot.** No wrapping, no `numberOfLines`, no attributed or
  multi-paragraph subtitle. Multi-line rows would need a height that depends on the
  box's width, which a `fillWidth` control deliberately does not have.
- **No control accessories**: a `Switch` or a checkbox inside the row, a detail
  disclosure *button*, or swipe actions. Put a control in a `Form.Row` instead,
  which is built for an accessory of its own.
- **`value` is text only** — a date, a version, a setting name. Not a badge, an
  icon or a count bubble.
- **No virtualization here.** This is one row; `Form` is the scrolling list, and a
  `FlashList`/`FlatList` row of items is the long-list answer.
- The disclosure chevron is drawn, not a button: `accessory="disclosure"` marks a
  row that goes somewhere, and the whole row is the target.
