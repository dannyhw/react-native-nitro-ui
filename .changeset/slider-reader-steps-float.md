---
'react-native-nitro-ui': patch
---

fix(slider): an Android screen-reader step is decided in the progress the reader was shown

`SliderModel.accessibilityStepToward` compared the target the platform hands the
Slider's `setProgress` action with the `Double` the model holds, while the semantics
node carries its progress through a `Float` and the target is computed from that. On a
grid whose stops are not exact in binary the two are different numbers, so a reader
asking for the value it can already read was read as a step — up where the float lands
above the value (0.3), down where it lands below it (0.7). On a narrow window over a
large offset (an epoch-milliseconds Slider, where a `Float` at 1e9 is 64 apart) the
reader's own stride cannot be carried at all and lands back on the published progress,
which made every press up answer with the value before it. The comparison now goes
through the same round-trip the node uses; the destination is still this Slider's own
grid, and a target the float can still stride still steps one stop. iOS is unchanged:
VoiceOver performs increment/decrement, a direction rather than a number to compare.
