---
'react-native-nitro-ui': patch
---

Two test-only read-outs, so the recycle rule can be measured instead of inferred. `nuiTestDisplayedIndex()` on SegmentedControl answers which segment the control is really painting — the handle's `selectedIndex` only echoes what React sent. `nuiTestLifetimeReport()` on Switch answers `drops=` and `recycles=` per native object, and neither is cleared by a recycle, so a control that reports `recycles=1` while it is on screen can only be an instance the pool handed back. `nitroUiCore.drainPerf()` also answers two new kinds, `dropped` and `recycled`. Both methods appear on the `hybridRef` type, alongside the other `nuiTest*` probes; no behaviour an app can see changes.
