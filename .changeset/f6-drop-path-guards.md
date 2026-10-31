---
'react-native-nitro-ui': patch
---

Android: a host whose mount has ended now declines `onMeasure` and `onLayout` until the next one (B1 review N5). Fabric normally measures a view before dropping it, but `stopSurface` drops its views first and takes the root out afterwards, so a dropped host that is measured while still attached would rebuild a composition with no strategy left to dispose it — the leak the drop path exists to prevent, arriving through the other door. Both passes count the ask before declining, and `nuiTestLifetimeReport()` answers the counts, so `example/__tests__/Recycling.harness.tsx` can report a run's zero as a measurement rather than as a guess. The same report's two process-wide counters also stop being per-host: they were declared twice, and the instance field shadowed the companion's total, which made every host but the reporting one invisible to the number.
