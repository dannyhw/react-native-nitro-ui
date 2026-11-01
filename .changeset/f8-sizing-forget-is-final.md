---
'react-native-nitro-ui': patch
---

Fixed a per-instance memory leak in the sizing engine that a scrolling list hit once per dropped control. A size correction is an asynchronous Fabric state update, and React Native runs its callback _later_ — scheduling a layout pass over the tree revision that carried it. If the view is dropped in between, as it is on every row that scrolls off, that pass lays the instance out one more time and the engine recorded what it laid out in that instance's ledger entry. Nothing reclaimed the entry afterwards: the engine's cleanup walk looks for `State` objects that died without being forgotten, and a forgotten instance has no registry row to be found in. One entry per occurrence, for the life of the process, on top of the leak being visible to `sizingStats()`.

A layout arriving for an id the engine has already finished now returns the size it would have returned — the layout itself is real and Yoga still commits it — and writes no per-instance state. An id that is mounted again is a new id, so nothing is lost; an id that is genuinely still in flight, laid out a moment before it binds, is untouched and still gets its correction. Found by the `Menu × no-leak-on-drop` conformance rule on a GitHub hosted runner, where `50` drops left `1` ledger entry and the registry read `0`.
