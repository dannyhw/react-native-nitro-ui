package com.margelo.nitro.benchprobe

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/**
 * Intentionally module-less React package.
 *
 * Loading the class is what pulls `libbenchprobe.so` and with it the
 * `BenchProbe` HybridObject registration (see the companion `init`), exactly
 * like the library's own `NitroUiPackage`. As a side effect it parks the
 * [ReactApplicationContext] for [HybridBenchProbe].
 */
class BenchProbePackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext
  ): NativeModule? {
    BenchProbeContextHolder.context = reactContext
    return null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> {
    BenchProbeContextHolder.context = reactContext
    return emptyList()
  }

  companion object {
    init {
      benchprobeOnLoad.initializeNative()
    }
  }
}
