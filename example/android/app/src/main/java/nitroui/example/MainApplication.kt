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
          // Test-only probe module for the harness tests.
          add(NitroUiProbePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // Must follow `loadReactNative`: that initialises SoLoader, which the flag accessor
    // needs, and installs RN's own flag provider. The C++ side takes one provider per
    // process, so installing ours first would make RN's install throw.
    NitroUiFeatureFlags.install()
  }
}
