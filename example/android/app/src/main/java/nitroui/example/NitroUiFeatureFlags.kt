package nitroui.example

import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults

/**
 * The example app's React Native feature flags: one override, `enableViewRecycling`.
 *
 * Why the example turns it on. The library implements `RecyclableView` on every
 * control, so a Hybrid View is *poolable*, but the pool exists only under this
 * flag (`ViewManager.setupViewRecycling` allocates `mRecyclableViews` only when
 * `ReactNativeFeatureFlags.enableViewRecycling()` is true, and RN's default for
 * it is `false`). With it off, `prepareForRecycle()` is dead code in every gate
 * this repo runs on Android, which is what `docs/tasks/B1-android-mount-oom`
 * recorded as "the recycling path has no leak gate" and what
 * `example/__tests__/Conformance.harness.tsx` states as "Android does not reach
 * it". The flag is therefore the difference between the recycle reset being
 * tested and being merely written, so the app the harness drives runs with it.
 *
 * What that means for everything else in this app, stated so a reader of a red
 * harness run knows where they are standing: `enableViewRecycling` is the master
 * switch, and RN's own per-class flags (`enableViewRecyclingForView`,
 * `...ForText`, `...ForImage`) already default to `true`. So turning it on also
 * pools React Native's plain `View`, `Text` and `Image`, not just nitro-ui's
 * controls. That is the state a host app opts into when it turns the flag on,
 * which is exactly the state this repo wants a gate for.
 *
 * `override` has to run before React Native is initialised and before anything
 * reads a flag, so it happens at the top of [MainApplication.onCreate], ahead of
 * `loadReactNative`. It is a JVM-side override on top of the C++ defaults, and
 * the C++ accessor caches a flag the first time it is asked, so a flag read
 * earlier than here would keep the older answer - `ViewManager`'s constructor is
 * the first reader of this one and no `ViewManager` exists before
 * `loadReactNative`.
 *
 * Test-only in the same sense as `NitroUiProbePackage`: this is example-app
 * code, not in the published package, and an app that wants recycling sets the
 * flag itself.
 */
object NitroUiFeatureFlags {
  fun install() {
    ReactNativeFeatureFlags.override(
      object : ReactNativeFeatureFlagsDefaults() {
        override fun enableViewRecycling(): Boolean = true
      }
    )
  }
}
