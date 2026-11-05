---
'react-native-nitro-ui': minor
---

Require React Native 0.88 or newer (Expo SDK 58), and draw Android controls with Material 3 Expressive by default.

- **New floor.** The peer range is now `react-native >= 0.88.0`. On Android the library builds against Compose 1.12 and Material 3 1.5 - `material3:1.5.0-beta02`, a beta - which need your app to compile with `compileSdkVersion` 37 and Android Gradle Plugin 9.1 or newer. New RN 0.88 and Expo SDK 58 apps already compile that way; an app upgraded from an older template that still says `compileSdkVersion = 36` has to raise it to 37. If your app uses Material 3 itself, Gradle resolves it to that beta too.
- **Material 3 Expressive on Android.** Every Android control and `<Host>` now uses `MaterialExpressiveTheme`, over the same dynamic or default colours as before. Today the visible change is motion: a Switch's thumb, a Checkbox's mark, a menu or a sheet opening move with Material's expressive springs.
- **`setMaterialTheme('baseline')`** keeps the baseline Material 3 theme instead. Call it once at startup, before the first screen renders; it applies to the whole app, there is no per-control prop, and it does nothing on iOS.
