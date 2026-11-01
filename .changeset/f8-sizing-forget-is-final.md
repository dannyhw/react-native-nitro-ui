---
'react-native-nitro-ui': patch
---

Fixed a per-instance memory leak that a scrolling or churning list hit once per dropped control, and two ways a control could be left at the wrong size. A dropped view whose size correction was still on its way, and a control whose mount was abandoned after it had been laid out, both left a record behind that nothing ever reclaimed — one per occurrence, for the life of the process, on top of showing up in `sizingStats()`.

Also fixed: hiding a control with `display: none` and showing it again could leave it unable to accept a size correction for the rest of its life, so a later `sizingKey` or font-scale change had no effect on it. A long list's first frame, and a commit that re-showes more controls than before, are likewise no longer a case where some controls keep the guessed size instead of being corrected.
