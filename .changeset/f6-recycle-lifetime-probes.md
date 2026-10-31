---
"react-native-nitro-ui": patch
---

Two test-only read-outs so the recycle rule can be measured instead of inferred: `nuiTestDisplayedIndex()` on SegmentedControl (which segment the control is really painting — the handle's `selectedIndex` only echoes what React sent) and `nuiTestLifetimeReport()` on Switch (`drops=`/`recycles=` counted per native object, never reset by `prepareForRecycle`, so a second mount that reports a drop it survived proves the pool handed that exact instance back). `nitroUiCore.drainPerf()` also answers two new kinds, `dropped` and `recycled`. No app-visible change; nothing in a public type.
