package nitroui.example

import android.util.Log
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider

/**
 * Turns on React Native's `enableViewRecycling`, which is off by default. Without it
 * no view is pooled and `prepareForRecycle()` never runs, so nothing would test it.
 * The flag also pools React Native's own `View`, `Text` and `Image`.
 *
 * Call [install] after `loadReactNative`: that call runs `SoLoader.init`, which the
 * flag accessor's native library needs, and installs React Native's own provider.
 */
object NitroUiFeatureFlags {
  fun install() {
    // React Native accepts one provider per process and has already installed its own,
    // so a plain `override` throws. Forcing is safe only before any flag is read: the
    // first reader of this one is a `ViewManager` constructor, on the first surface.
    val notice =
      ReactNativeFeatureFlags.dangerouslyForceOverride(
        // Wraps the provider of the stable release level, so every other flag keeps
        // React Native's value. It must follow the app's release level if that changes.
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
