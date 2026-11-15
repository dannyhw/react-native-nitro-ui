package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.nitroui.core.NitroUiHostView

/** The Hybrid View behind `<Host>`: its nitro-ui children share one Compose composition. */
class HybridNitroUiHost(
  reactContext: ThemedReactContext,
) : HybridNitroUiHostSpec() {
  internal val host: NitroUiHostView = NitroUiHostView(reactContext, reactContext.currentActivity)

  override val view: View
    get() = host

  /**
   * Without this nothing releases the composition: its lifecycle observer stays registered on
   * the activity, which then retains the Host and its composition for as long as it lives.
   */
  override fun onDropView() {
    host.drop()
  }
}
