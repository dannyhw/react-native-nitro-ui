---
'react-native-nitro-ui': patch
---

fix(menu): a row that cannot be picked answers nothing and holds the menu open

`MenuModel.applyPick` reported nothing for a disabled row, an id the menu does not
hold and any row of a disabled control, but closed the popup for all of them. A real
press on such a row is swallowed by Material's own row and leaves the menu standing,
so the pick path and a finger gave an app two different answers for one row. The pick
path now answers nothing at all, which is also what it means for a hook call to pick a
row an app cannot pick: no `onSelect` and no `onClose`, and the menu is dismissed the
way a person dismisses it. A press on an enabled row still reports `onSelect` then
closes with `onClose`, on both platforms.

The docs said the Android rows all report `enabled="true"`, a disabled one included,
which was measured on an older Material. Material 1.5's row publishes its disabled
state and `menu.e2e.ts` reads it from an open menu, so a screen reader is told a row
cannot be picked before a person presses it.
