---
'react-native-nitro-ui': minor
---

`Checkbox` on iOS now draws a checkmark instead of a switch, which is what makes it read as a checkbox.

- **The default iOS picture is Apple's own checklist glyph.** `checkmark.circle.fill` over `circle` — the symbol Reminders and Notes draw — in the accent colour, the empty box in the system's secondary label colour, and the label beside it at the platform's own spacing. iOS has no checkbox control, so this is still the platform's `Toggle`, wearing a style that draws Apple's symbols rather than a hand-drawn imitation of one.
- **`iosStyle` picks the picture: `'circle'` (the new default), `'square'`, or `'switch'`.** `'switch'` is the look this component shipped with, unchanged down to its box and its accessibility element. Android ignores the prop — Material 3 has a checkbox, so there is nothing to choose.
- **`indeterminate` is drawn on iOS too.** The glyph styles show `minus.circle.fill` / `minus.square.fill`, and the state is announced rather than left as "off": iOS says "mixed" (Apple's own word for a checkbox that is partly on) where its `Toggle` would otherwise say unchecked, and Android's Compose says "Partially checked". Two words for one state, and one rule behind both — `checked` outranks the dash on either platform, so a box that is checked _and_ `indeterminate` draws a checkmark wherever it is rendered, and a reader is told about the mark and not the dash.
- **A tap anywhere on the row toggles once.** Glyph and label together are one target, so a press on the text checks the box — as a Reminders row does — and one press is exactly one `onCheckedChange`.
