---
'react-native-nitro-ui': patch
---

A `fillWidth` control (Slider, linear Progress) inside a parent that gives it no width — a horizontal `ScrollView`, for instance — no longer draws at the width a _different_ instance of the same control happened to be measured at. The size cache now stores the width the component declares for that case, which is the number `docs/architecture/sizing.md` already said it stored; before, the box of whichever bounded instance measured last was filed into the configuration an unbounded node then read, and nothing corrected it, because the policy compares heights only.
