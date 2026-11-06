---
'react-native-nitro-ui': minor
---

Make `Menu`'s `primaryAction` work on Android, where it used to be ignored.

- **`primaryAction` is no longer iOS-only.** On iOS nothing changed: the trigger stays one button, a tap runs the action and a long-press opens the list. On Android the trigger becomes Material 3 Expressive's split button — the leading half shows the title and runs the action, the trailing half is a chevron that opens the list and whose checked state _is_ the menu's open state, so its inner corner stays morphed while the list is up. A press on the action half never opens the list on either platform, and `disabled` disables both halves and closes an open menu.
- **The split button takes your variant.** `filled`, `tonal`, `outlined` and `elevated` draw the matching `SplitButtonDefaults` set; `text` has no split set of its own (a split button is two containers and the text variant has none), so it draws the outlined pair, hairline included — a `variant="text"` Menu changes looks the moment a `primaryAction` arrives.
- **Android is wider, and the sizing key knows.** A second container plus its gap is a wider box, so Menu's configuration gains an `action`/`plain` field and the split configuration is measured as its own. On iOS the same prop costs one extra cache entry and no layout, because there it is a gesture rather than a second half.
- **Two announcement sites, not one.** The action half is a button named by the title, and the chevron half is a button named "More options" that says expanded or collapsed — the single dropdown node a plain Menu has cannot survive being two controls that do different things.
