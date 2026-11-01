---
'react-native-nitro-ui': patch
---

The Android `Menu`'s list is now as wide as its items need instead of as wide as the trigger. Every row used to be measured against the button's width, so a label longer than the title lost its tail — the README screenshot rendered "AirDrop" as "AirDr". The list keeps Material's own sizing, so it is no narrower than its 112 dp floor and no wider than the 280 dp a row's content caps at, and a long group title is shortened with an ellipsis rather than stretching the list past that. Short items still get the 112 dp floor, and the list stays aligned with the trigger's start edge, so it still opens under its trigger.
