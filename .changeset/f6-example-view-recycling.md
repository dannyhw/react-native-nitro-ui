---
"react-native-nitro-ui": patch
---

The example app now runs with RN's `enableViewRecycling` flag on, so the harness drives screens where Fabric really pools our Hybrid Views (`prepareForRecycle` is live code on Android, as it already was on iOS). Nothing in the published package changes: a host app that wants view recycling still opts in itself.
