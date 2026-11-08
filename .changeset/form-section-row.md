---
'react-native-nitro-ui': minor
---

New: `Form`, `Form.Section` and `Form.Row` — grouped settings-style lists whose rows are ordinary React Native views.

- **The platform draws the grouping, React Native lays out the row.** iOS is a `UICollectionView` in the `.insetGrouped` list style with the rows inside its cells; Android leaves rows where Yoga put them and draws Material 3 Expressive's segmented-list shapes behind them. Any view is a row — a nitro-ui control inside one is the same control it is anywhere else, with no wrapper around it.
- **`Form.Section` takes a `title` and a `footer`.** Every direct child is one row, so an app writes the wrapper only when it wants the row-level behaviour.
- **`Form.Row` adds `onPress`, `accessory` (`'none' | 'disclosure' | 'checkmark'`) and `selected`.** A row with `onPress` is one button element for a screen reader; a row without it leaves its content alone, so a `Switch` inside it keeps its own element.
- **A focused field stays above the keyboard**, including in a row near the bottom, on both platforms. `keyboardAvoidance={false}` opts out.
- **`measure()` on a row is right once scrolling has settled**, at rest and after a scroll. A row that has scrolled out of the visible cells is not attached to a cell; `docs/components/form.md` says what that means for an anchored `Tooltip`, `Popover` or `ContextMenu`, and points lists long enough to need real virtualisation at FlashList or Legend List.
