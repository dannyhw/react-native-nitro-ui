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
    // After `loadReactNative`, for two reasons that are easy to get wrong and were each
    // learned from a crash: it is what initialises SoLoader (the flag accessor's class
    // cannot load before that), and it is what installs RN's own flag provider - and the
    // C++ side takes one provider per process, so installing ours first and RN's second
    // would throw, not merge. See NitroUiFeatureFlags for the full reason, including why
    // the install has to *force*.
    NitroUiFeatureFlags.install()
  }
}
