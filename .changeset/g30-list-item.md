---
'react-native-nitro-ui': minor
---

`ListItem`: a list row's content, drawn by the platform's own row view.

- **The real row, not a `Text` pair.** iOS hosts UIKit's `UIListContentView` (`.cell()` / `.subtitleCell()`), Android Material 3's `ListItem` — so the truncation, the leading glyph's slot, the disclosure chevron and the press highlight are the platform's, and a screen reader meets one platform row rather than three text nodes.
- **A row's height depends on which slots are filled, never on what was typed into them.** `title`, `subtitle` and `value` are each one line, tail-truncated, which is what lets one measured height serve every row of that configuration: a hundred-row list pays four measurements, not a hundred, and a row's pitch does not change when its text does.
- **Inside a `Form.Row` the item is the content and the row stays the cell** — no second set of insets, no second shape, no second highlight. It knows which it is on its own; there is nothing to configure. The handler can still be written on the item: the cell takes it, so the row that owns the touch is the row that presses and highlights.
- **`onPress` is what makes a row a row.** Without it the item has no highlight, is not a button to a screen reader, and a tap goes through to whatever is behind it. `disabled` is drawn and inert: no press, no highlight, no event.
