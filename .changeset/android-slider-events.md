---
'react-native-nitro-ui': patch
---

Android `Slider` fixes.

- **A touch now reports its start and end.** `onSlidingStart` fires when a finger goes down on the thumb or track, and `onSlidingComplete` when it lifts, even if the value never changed. Before, the start was only reported on the first value change, so a touch that didn't move the thumb reported nothing. A drag reports start, then its value changes, then complete, in that order, as on iOS.
- **Screen-reader steps no longer go backwards.** Two quick TalkBack increments in a row could land on the previous value instead of the next one. Each step now moves from the value last shown.
