---
'react-native-nitro-ui': patch
---

The Android `Slider`'s thumb lands on the same stop as iOS's when a stepped range's value sits a hair under the halfway point between two stops. The step count is now rounded on the number itself rather than on that number plus a half: adding the half can round too, and `(0.21 - 0.1) / 0.22` is `0.49999999999999994` — nearer 0 than 1 — while adding a half to it is exactly `1.0`. Android therefore moved the thumb one whole step above where iOS put it, on any range whose step count lands near a tie; a controlled `value={0.21}` on a `0…0.44` slider with `step={0.22}` drew a different thumb per platform. A genuine tie still rounds away from zero on both OSes.
