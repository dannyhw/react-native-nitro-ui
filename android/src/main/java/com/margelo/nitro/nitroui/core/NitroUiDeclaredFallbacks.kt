package com.margelo.nitro.nitroui.core

import com.margelo.nitro.nitroui.HybridNitroUiButton
import com.margelo.nitro.nitroui.HybridNitroUiDatePicker
import com.margelo.nitro.nitroui.HybridNitroUiPicker
import com.margelo.nitro.nitroui.HybridNitroUiProgress
import com.margelo.nitro.nitroui.HybridNitroUiSlider
import com.margelo.nitro.nitroui.HybridNitroUiSegmentedControl
import com.margelo.nitro.nitroui.HybridNitroUiSwitch
import com.margelo.nitro.nitroui.HybridNitroUiMenu
import com.margelo.nitro.nitroui.HybridNitroUiTextField
import com.margelo.nitro.nitroui.HybridNitroUiChip
import com.margelo.nitro.nitroui.HybridNitroUiCheckbox
import com.margelo.nitro.nitroui.HybridNitroUiSearchField
import com.margelo.nitro.nitroui.HybridNitroUiIconButton
import com.margelo.nitro.nitroui.HybridNitroUiStepper
import com.margelo.nitro.nitroui.HybridNitroUiButtonGroup
import com.margelo.nitro.nitroui.HybridNitroUiListItem

/**
 * Registers every self-sizing component's fallback size at startup. Fabric measures a
 * shadow node before it creates the view, so a fallback declared by the view is a frame late.
 */
object NitroUiDeclaredFallbacks {
  fun registerAll() {
    HybridNitroUiSwitch.declareFallback()
    HybridNitroUiSlider.declareFallback()
    HybridNitroUiButton.declareFallback()
    HybridNitroUiProgress.declareFallback()
    HybridNitroUiSegmentedControl.declareFallback()
    HybridNitroUiDatePicker.declareFallback()
    HybridNitroUiPicker.declareFallback()
    HybridNitroUiMenu.declareFallback()
    HybridNitroUiTextField.declareFallback()
    HybridNitroUiChip.declareFallback()
    HybridNitroUiCheckbox.declareFallback()
    HybridNitroUiSearchField.declareFallback()
    HybridNitroUiIconButton.declareFallback()
    HybridNitroUiStepper.declareFallback()
    HybridNitroUiButtonGroup.declareFallback()
    HybridNitroUiListItem.declareFallback()
  }
}
