package com.margelo.nitro.nitroui

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitroui.core.NitroUiMaterialTheme

/**
 * JS's handle on the process-wide Material theme setting (`setMaterialTheme`).
 *
 * Holds nothing of its own: every instance reads and writes [NitroUiMaterialTheme],
 * which is what each composition's root reads, so two instances (two JS runtimes, a
 * reload) cannot disagree. Called on the JS thread; the write is snapshot state and
 * needs no hop to the UI thread (see [NitroUiMaterialTheme]).
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
