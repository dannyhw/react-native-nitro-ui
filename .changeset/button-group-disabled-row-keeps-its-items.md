---
'react-native-nitro-ui': patch
---

`ButtonGroup`: on iOS a disabled group keeps the row it had enabled. The overflow control was left
out of a disabled row, which measured that row narrower, so disabling a group could pull another
item out of the menu and re-enabling it put the item back — the items moved under the person's
eyes. The control now keeps its room while disabled and is drawn dimmed in the same place with
nothing to present: a disabled group opens no menu, takes no tap and fires no event, and
`disabled` arriving while the menu is open still closes it. Android is unchanged.
