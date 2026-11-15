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
import com.margelo.nitro.nitroui.views.HybridNitroUiListItemManager

/**
 * The React package: registers the view managers, and loading it pulls in `libnitroui.so`.
 * Write no declaration-shaped sentence above the declaration: autolinkers find this type's
 * name by regex over the raw file text and would pick up the prose instead.
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
    HybridNitroUiListItemManager(),
    // Hand-written managers: these views hold React Native children, and nitrogen only
    // generates a leaf `SimpleViewManager`.
    NitroUiHostViewManager(),
    NitroUiBottomSheetViewManager(),
    NitroUiContextMenuViewManager(),
    NitroUiFormViewManager(),
    NitroUiFormSectionViewManager(),
    NitroUiFormRowViewManager(),
    NitroUiPopoverViewManager(),
  )

  companion object {
    init {
      nitrouiOnLoad.initializeNative()
      // After `initializeNative()`: declaring a fallback is a JNI call. Both run before Fabric
      // gets a view manager, so every declared size is known before the first measure.
      NitroUiDeclaredFallbacks.registerAll()
    }
  }
}
