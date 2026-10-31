package nitroui.example

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Test-only probe for example/__tests__/MountChurn.harness.tsx (task B1).
          add(NitroUiProbePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // After `loadReactNative`, which both initialises SoLoader and installs RN's own
    // flag provider - `override` replaces rather than merges, so an override installed
    // first would be gone by the time the first ViewManager reads it. No ViewManager
    // exists until the lazy `reactHost` is first touched, which is later than here.
    // See NitroUiFeatureFlags for the full reason.
    NitroUiFeatureFlags.install()
  }
}
