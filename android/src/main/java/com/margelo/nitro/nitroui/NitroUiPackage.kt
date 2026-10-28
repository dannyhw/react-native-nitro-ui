package com.margelo.nitro.nitroui

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.nitroui.core.NitroUiDeclaredFallbacks
import com.margelo.nitro.nitroui.views.HybridNitroUiButtonManager
import com.margelo.nitro.nitroui.views.HybridNitroUiDatePickerManager
import com.margelo.nitro.nitroui.views.HybridNitroUiPickerManager
import com.margelo.nitro.nitroui.views.HybridNitroUiProgressManager
import com.margelo.nitro.nitroui.views.HybridNitroUiSliderManager
import com.margelo.nitro.nitroui.views.HybridNitroUiSegmentedControlManager
import com.margelo.nitro.nitroui.views.HybridNitroUiSwitchManager
// T18's TextField spike (`src/spike/`). Deliberately below the generated manager imports rather than
// among them: the registry owns the contiguous run of generated rows and reports anything inside it that
// is not one of them, so a spike row has to sit outside the run - the same reason `NitroUiHostViewManager`
// does. Delete this import and its row with the spike.
import com.margelo.nitro.nitroui.views.HybridNitroUiSpikeTextFieldManager

/**
 * The React package of `react-native-nitro-ui`.
 *
 * It declares no modules of its own: our HybridObjects are implemented in C++
 * and registered by Nitro's autolinking
 * (nitrogen/generated/android/nitrouiOnLoad.cpp). What it does declare is view
 * managers, which Fabric needs before any Nitro Hybrid View can be created.
 * Autolinking instantiates this type, and loading it is what pulls
 * `libnitroui.so` - and with it the Hybrid Object registrations - into the app
 * process.
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
  ): List<ViewManager<*, *>> = listOf(
    HybridNitroUiSwitchManager(),
    HybridNitroUiSliderManager(),
    HybridNitroUiButtonManager(),
    HybridNitroUiProgressManager(),
    HybridNitroUiSegmentedControlManager(),
    HybridNitroUiDatePickerManager(),
    HybridNitroUiPickerManager(),
    // Not the generated `HybridNitroUiHostManager`: a Hybrid View is a leaf, so
    // nitrogen emits a `SimpleViewManager` for it, and a container needs the
    // `IViewGroupManager` half. See `NitroUiHostViewManager`.
    NitroUiHostViewManager(),
    // T18's spike field, and the only registered view that is not a shipped component. It is outside the
    // generated run for the reason on the import above. Delete with the spike.
    HybridNitroUiSpikeTextFieldManager(),
  )

  companion object {
    init {
      nitrouiOnLoad.initializeNative()
      // After `initializeNative()`, because a declared fallback is a JNI call.
      // Both lines run before Fabric is handed any view manager from this
      // package, so the sizing engine knows every component's declared size
      // before its first measure (`NitroUiDeclaredFallbacks`, T14).
      NitroUiDeclaredFallbacks.registerAll()
    }
  }
}
