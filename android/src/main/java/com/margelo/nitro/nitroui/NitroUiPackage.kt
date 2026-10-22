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
 * modules or view managers to declare here. Autolinking instantiates this
 * type, and loading it is what pulls `libnitroui.so` - and with it the Hybrid
 * Object registrations - into the app process.
 *
 * Wording note: consumer autolinkers (Expo SDK 58's `androidResolver`, and the
 * same family of regexes in the RN CLI) detect this type's name by regex over
 * the raw file text, matching the first Kotlin declaration of a ReactPackage
 * subtype in prose or in code. A declaration-shaped sentence above the real
 * declaration here hijacks the detected name, and every consumer build then
 * fails with "cannot find symbol" on a word from the prose.
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
