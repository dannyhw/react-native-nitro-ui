---
'react-native-nitro-ui': patch
---

The Android `Menu`'s list is now as wide as its items need instead of as wide as the trigger. `ExposedDropdownMenu` takes `matchAnchorWidth = true` by default, and its own `exposedDropdownSize()` sets `minWidth = maxWidth = anchorWidth`, so every row was measured against the button's width and a label longer than the title lost its tail — the README screenshot rendered "AirDrop" as "AirDr". The call now passes `matchAnchorWidth = false`, which leaves the list at Material's own content sizing: nothing narrower than its 112 dp floor, nothing wider than the 280 dp a row's content caps at. Short items still get the 112 dp floor, and the popup's left edge is unchanged, so a list still opens under its trigger.
