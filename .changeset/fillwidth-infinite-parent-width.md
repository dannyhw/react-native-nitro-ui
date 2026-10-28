---
'react-native-nitro-ui': patch
---

A `fillWidth` control (Slider, linear Progress) inside a parent that gives it no width — a horizontal `ScrollView`, for instance — no longer draws at the width a _different_ instance of the same control happened to be measured at. The size cache now stores the width the component declares for that case instead of the last box width any instance reported, which is the width `docs/components/slider.md` documents the declared number as existing for. Two consequences for anyone whose layout hits this: the bar or slider under an unbounded parent changes width (Slider 351 pt / 328 dp, Progress 320, instead of some other instance's box), and since that width is now the component's own, no later measurement replaces it — under an unbounded parent the declared width is what draws on every frame, so it is a number to choose deliberately rather than a placeholder.
