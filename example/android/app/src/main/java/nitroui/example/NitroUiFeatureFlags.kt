package nitroui.example

import android.util.Log
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider

/**
 * The example app's React Native feature flags: one override, `enableViewRecycling`.
 *
 * Why the example turns it on. The library implements `RecyclableView` on every
 * control, so a Hybrid View is *poolable*, but the pool exists only under this flag
 * (`ViewManager.setupViewRecycling` allocates `mRecyclableViews` only when
 * `ReactNativeFeatureFlags.enableViewRecycling()` is true, and RN 0.88's default for
 * it is `false`). With it off, `prepareForRecycle()` is dead code in every gate this
 * repo runs on Android, which is what `docs/tasks/B1-android-mount-oom` recorded as
 * "the recycling path has no leak gate". The flag is therefore the difference between
 * the recycle reset being tested and being merely written, so the app the harness
 * drives runs with it - and `example/__tests__/Recycling.harness.tsx` measures the
 * result rather than trusting this paragraph.
 *
 * What that means for everything else in this app, stated so a reader of a red harness
 * run knows where they are standing: `enableViewRecycling` is the master switch, and
 * RN's own per-class flags (`enableViewRecyclingForView`, `...ForText`,
 * `...ForImage`) already default to `true`. So turning it on also pools React Native's
 * plain `View`, `Text` and `Image`, not just nitro-ui's controls. That is the state a
 * host app opts into when it turns the flag on, which is exactly the state this repo
 * wants a gate for.
 *
 * ## Why this runs *after* `loadReactNative`, and why it forces
 *
 * Both halves are load-bearing, and both were learned the hard way: installed the
 * naive way, the app died on launch with `SoLoader.init() not yet called`, then with
 * `Feature flags cannot be overridden more than once`.
 *
 * - **After:** `loadReactNative` is what calls `SoLoader.init`, and the flag accessor is
 *   a JNI door whose class loads `libreactnative.so` in a static initialiser. An
 *   override installed before it is a call into a class that cannot load yet.
 * - **Forced:** `loadReactNative` reaches `DefaultNewArchitectureEntryPoint.load`, which
 *   installs RN's own provider through `override` — and the C++ side takes exactly one
 *   provider per process and throws for a second. `dangerouslyForceOverride` is the API
 *   for replacing an installed one, and the trade it makes (the accessor caches each
 *   flag the first time it is asked, so a swap after a read would leave that read in
 *   force) is one this app can honour: nothing has read a flag at this point, because
 *   the first reader is `ViewManager`'s constructor and no `ViewManager` exists until
 *   the first surface, which is after `onCreate` returns.
 * - **Wraps the RNOSS class rather than the bare defaults:** that is the provider `load`
 *   installs for this app (`ReleaseLevel.STABLE`, the default), so wrapping it with
 *   Kotlin delegation changes exactly one answer and leaves every other flag RN decided
 *   for a stable RN 0.88 app exactly as it decided it. Wrapping
 *   `ReactNativeFeatureFlagsDefaults` instead would silently undo those. (It cannot be
 *   subclassed: the RNOSS class is `final`.)
 *
 * The accessor caches each flag the first time it is asked, and `ViewManager`'s
 * constructor is the first reader of this one. That constructor runs when the React
 * host builds its first surface, which is the first time an Activity touches the lazy
 * `reactHost` - after `onCreate` has returned - so an override placed here is still in
 * place before anything can read the flag.
 *
 * Coupled to that release level: if this app ever sets a different one
 * (`DefaultNewArchitectureEntryPoint.releaseLevel`), the class extended here has to
 * follow it, or the override silently unsets RN's other choices.
 *
 * Test-only in the same sense as `NitroUiProbePackage`: this is example-app code, not
 * in the published package, and an app that wants view recycling sets the flag itself.
 */
object NitroUiFeatureFlags {
  fun install() {
    // `dangerouslyForceOverride`, not `override`: the C++ side accepts exactly one
    // provider per process and RN's `load()` - reached from `loadReactNative` - has
    // already installed the RNOSS one by the time this runs. `override` throws
    // "Feature flags cannot be overridden more than once"; forcing is what this method
    // is for, and it is safe here because nothing has read a flag yet (the accessor's
    // caches are per-process and `ViewManager`'s constructor is the first reader of
    // this one, which happens on the first surface, after `onCreate`). It returns what
    // the C++ side thought of the swap, which is logged rather than discarded: a
    // warning there is the only sign a future RN starts refusing this.
    val notice =
      ReactNativeFeatureFlags.dangerouslyForceOverride(
        // Delegation, not subclassing: the RNOSS class is `final`, and this is the one
        // answer this file exists to change.
        object :
          ReactNativeFeatureFlagsProvider by ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android() {
          override fun enableViewRecycling(): Boolean = true
        }
      )
    Log.i(TAG, "enableViewRecycling=${ReactNativeFeatureFlags.enableViewRecycling()} " +
      "(forced over the RNOSS provider): $notice")
  }

  private const val TAG = "NitroUiFeatureFlags"
}
