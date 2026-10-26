package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.nitroui.core.NitroUiHostView

/*
 * The Host component (T16 spike). Like every other Hybrid View here it lives in
 * package `com.margelo.nitro.nitroui`, because that is the package the generated
 * `HybridNitroUiHostStateUpdater` imports with a wildcard; the view it owns is
 * core, in `...nitroui.core`.
 */

/**
 * The Hybrid View behind `<Host>`: a container whose nitro-ui children render into
 * **one** Compose composition instead of one each.
 *
 * No props and no methods - the Host stores nothing, so the whole class is the
 * view it owns. Created once per Fabric node by [NitroUiHostViewManager] and never
 * replaced, which is the perf contract's rule for a hosting view (`setContent` at
 * init only, no rebuild per update).
 */
class HybridNitroUiHost(
  reactContext: ThemedReactContext,
) : HybridNitroUiHostSpec() {
  /**
   * The Host's view - what the view manager hands Fabric.
   *
   * `internal`, like the view type itself: a component's host and model are
   * implementation here (every other Hybrid View keeps its host `private`); this one
   * is `internal` rather than `private` only because [NitroUiHostViewManager]
   * constructs the pair.
   */
  internal val host: NitroUiHostView = NitroUiHostView(reactContext, reactContext.currentActivity)

  override val view: View
    get() = host
}
