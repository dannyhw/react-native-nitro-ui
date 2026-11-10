---
'react-native-nitro-ui': minor
---

`ConfirmationDialog`'s Android rows are Material 3 Expressive's, and a disabled row is now genuinely disabled.

- **One segmented row per action.** The confirmation sheet drew a plain `ListItem` with a `clickable` wrapped around it, because material3 1.4's list item had no `enabled`. On 1.5 it draws `SegmentedListItem`, with `ListItemDefaults.segmentedShapes(index, count)` — so the actions are one card inside the sheet, its outer corners carrying the sheet's own 16 dp radius and its rows meeting at 4 dp, and pressing a row morphs its shape the way an Expressive row does (`docs/components/dialog.md`, "Platform mapping").
- **A disabled row is the row's own disabled state.** `disabled` is now `enabled = false` on the row, not a hand-picked alpha on its label: the component takes the press, says `disabled` to TalkBack, and paints the label with its own disabled colour. A `destructive` or `tintColor` row that is disabled is drawn disabled, because those only ever replace the _enabled_ content colour. What a person sees and what a screen reader reports are the same thing again.
- **Nothing else moved.** The order of the actions, the cancel action last, `dismissible`, the "an action always closes" rule, `titleVisibility`, the hosting, the recycling and `AlertDialog` are as they were. iOS is unchanged.
