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
import com.margelo.nitro.nitroui.views.HybridNitroUiMenuManager
import com.margelo.nitro.nitroui.views.HybridNitroUiDialogManager
import com.margelo.nitro.nitroui.views.HybridNitroUiTextFieldManager
import com.margelo.nitro.nitroui.views.HybridNitroUiChipManager
import com.margelo.nitro.nitroui.views.HybridNitroUiTooltipManager
import com.margelo.nitro.nitroui.views.HybridNitroUiCheckboxManager
import com.margelo.nitro.nitroui.views.HybridNitroUiSearchFieldManager
import com.margelo.nitro.nitroui.views.HybridNitroUiIconButtonManager
import com.margelo.nitro.nitroui.views.HybridNitroUiStepperManager
import com.margelo.nitro.nitroui.views.HybridNitroUiButtonGroupManager

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
    HybridNitroUiMenuManager(),
    HybridNitroUiDialogManager(),
    HybridNitroUiTextFieldManager(),
    HybridNitroUiChipManager(),
    HybridNitroUiTooltipManager(),
    HybridNitroUiCheckboxManager(),
    HybridNitroUiSearchFieldManager(),
    HybridNitroUiIconButtonManager(),
    HybridNitroUiStepperManager(),
    HybridNitroUiButtonGroupManager(),
    // Not the generated `HybridNitroUiHostManager`: a Hybrid View is a leaf, so
    // nitrogen emits a `SimpleViewManager` for it, and a container needs the
    // `IViewGroupManager` half. See `NitroUiHostViewManager`.
    NitroUiHostViewManager(),
    // The BottomSheet's React Native children are mounted into the sheet's window, so
    // it needs the `IViewGroupManager` half too: its manifest names this class
    // (`androidViewManager`), and the registry checks it is registered here instead of
    // the generated manager. See `NitroUiBottomSheetViewManager`.
    NitroUiBottomSheetViewManager(),
    // A ContextMenu is a `View` around React Native children, styled like one: its
    // manager is a `ReactViewManager` that keeps the menu's 0 x 0 compose host out of
    // Fabric's child indices. See `NitroUiContextMenuViewManager`.
    NitroUiContextMenuViewManager(),
    // A Popover's React Native children are mounted into the popup's window, so it needs
    // the `IViewGroupManager` half as a sheet does: its manifest names this class
    // (`androidViewManager`), and the registry checks it is registered here instead of the
    // generated manager. See `NitroUiPopoverViewManager`.
    NitroUiPopoverViewManager(),
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
