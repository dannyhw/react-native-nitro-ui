---
'react-native-nitro-ui': minor
---

`ConfirmationDialog`'s Android rows are Material 3 Expressive's, and a disabled row is now genuinely disabled.

- **The actions are one segmented group.** On Android the confirmation sheet's actions now draw as an Expressive segmented group: one card inset inside the sheet, rounded at its outer corners, with the standard gap between the rows, and a press that animates like any other Expressive row.
- **A disabled row is really disabled.** It takes no press, tells TalkBack it is disabled, and is drawn in the component's own disabled state — including a `destructive` or `tintColor` row, which is drawn disabled rather than coloured. What a person sees and what a screen reader reports are the same thing again.
- **Nothing else moved.** The order of the actions, the cancel action last, `dismissible`, the "an action always closes" rule, `titleVisibility` and `AlertDialog` are as they were. iOS is unchanged.
