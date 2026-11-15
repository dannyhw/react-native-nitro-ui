package com.margelo.nitro.nitroui

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitroui.core.NitroUiMaterialTheme

/**
 * Stateless: every instance reads and writes the process-wide [NitroUiMaterialTheme].
 * Called on the JS thread; the write is snapshot state and needs no hop to the UI thread.
 */
@DoNotStrip
@Keep
class HybridNitroUiMaterialTheme : HybridNitroUiMaterialThemeSpec() {
  override var expressive: Boolean
    get() = NitroUiMaterialTheme.expressive
    set(value) {
      NitroUiMaterialTheme.expressive = value
    }

  override fun composedReport(): String = NitroUiMaterialTheme.report()
}
