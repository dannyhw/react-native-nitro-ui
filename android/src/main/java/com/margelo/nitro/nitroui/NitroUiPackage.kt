package com.margelo.nitro.nitroui

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/**
 * Intentionally empty React Package.
 *
 * Our HybridObjects are implemented in C++ and registered by Nitro's own
 * autolinking (nitrogen/generated/android/nitrouiOnLoad.cpp), so there are no
 * modules or view managers to declare here. The class still has to exist:
 * React Native CLI autolinking instantiates it, and loading the class is what
 * pulls `libnitroui.so` - and with it the Hybrid Object registrations - into
 * the app process.
 */
class NitroUiPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext
  ): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()

  companion object {
    init {
      nitrouiOnLoad.initializeNative()
    }
  }
}
