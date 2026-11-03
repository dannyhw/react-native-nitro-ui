---
'react-native-nitro-ui': patch
---

A `Slider` no longer reports `onSlidingComplete` while the finger is still on the track. A screen reader's increment or decrement that arrived mid-drag ran its own start/change/complete triple, and closing that triple is what emits a completion — so the app got a "the user let go" for a thumb it was still holding, the frame pump that drag armed stopped, and the finger's next move opened a second gesture that reported the drag a second time. A step that lands inside a drag is now just another sample of that drag: the value moves at once, its `onValueChange` reaches the app on the drag's next frame like any other, and the gesture's start and completion stay with the finger. A step while nothing is being dragged is unchanged — it still reports all three callbacks, so an app does not have to tell an increment from a release.
