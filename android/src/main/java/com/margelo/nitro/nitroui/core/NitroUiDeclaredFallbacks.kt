package com.margelo.nitro.nitroui.core

import com.margelo.nitro.nitroui.HybridNitroUiButton
import com.margelo.nitro.nitroui.HybridNitroUiDatePicker
import com.margelo.nitro.nitroui.HybridNitroUiPicker
import com.margelo.nitro.nitroui.HybridNitroUiProgress
import com.margelo.nitro.nitroui.HybridNitroUiSlider
import com.margelo.nitro.nitroui.HybridNitroUiSegmentedControl
import com.margelo.nitro.nitroui.HybridNitroUiSwitch

/**
 * The startup half of `NitroUiSizing.setFallback` (T14) - Android's version of
 * `ios/core/NitroUiDeclaredFallbacks.swift`.
 *
 * A component's declared fallback is the size the sizing engine lays it out with
 * before the control has measured itself (`docs/architecture/sizing.md` §5).
 * Asking the component's own Hybrid View for it was too late: Fabric measures a
 * shadow node before it creates the view, so the first instance of every
 * configuration was measured with no fallback at all - a cold first `fillWidth`
 * control laid out 0 tall, a cold first `intrinsic` control with no box, for one
 * frame (D17). Each component still owns its numbers, because only the component
 * knows what it hosts and which platform's control size applies (D14); this file
 * only says *when* they are registered.
 *
 * [registerAll] runs from `NitroUiPackage`'s static init, which is what loads
 * `libnitroui.so` and therefore what makes `NitroUiSizing` usable at all. It is
 * earlier than any view manager Fabric can ask for, so it is earlier than any
 * measure. One line per self-sizing component, kept in step with
 * `nitro-ui.sizing.json` (core.md §9); a component missing here still declares
 * its fallback when its first view is created, which is the old one-frame-late
 * behaviour rather than a broken layout.
 */
object NitroUiDeclaredFallbacks {
  fun registerAll() {
    // Each call is once per process on its own, so this stays correct even if it
    // is ever reached twice (a second `NitroUiSizing` class loader, say).
    HybridNitroUiSwitch.declareFallback()
    HybridNitroUiSlider.declareFallback()
    HybridNitroUiButton.declareFallback()
    HybridNitroUiProgress.declareFallback()
    HybridNitroUiSegmentedControl.declareFallback()
    HybridNitroUiDatePicker.declareFallback()
    HybridNitroUiPicker.declareFallback()
  }
}
