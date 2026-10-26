package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.nitroui.core.NitroUiHostView

/*
 * The Host component (H1, `docs/components/host.md`). Like every other Hybrid View here it lives in
 * package `com.margelo.nitro.nitroui`, because that is the package the generated
 * `HybridNitroUiHostStateUpdater` imports with a wildcard; the view it owns is
 * core, in `...nitroui.core`.
 */

/**
 * The Hybrid View behind `<Host>`: a container whose nitro-ui children render into
 * **one** Compose composition instead of one each.
 *
 * No props and no methods: the Host stores nothing, so the class is the view it owns
 * plus one teardown hook ([onDropView]). Created once per Fabric node by
 * [NitroUiHostViewManager] and never replaced, which is the perf contract's rule for a
 * hosting view (`setContent` at init only, no rebuild per update).
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

  /**
   * Release the composition when Fabric drops this node.
   *
   * `HybridView.onDropView()` is a no-op, and [NitroUiHostViewManager] can only call
   * this override - without it nothing runs on a Host's unmount, and the leak is the
   * one `NitroComposeHost.drop()`'s own KDoc describes: the
   * `DisposeOnLifecycleDestroyed` observer armed at attach stays on the activity's
   * `LifecycleRegistry`, which holds observers strongly, so the path
   * `activity -> LifecycleRegistry -> ComposeContent -> Host` keeps the Host, its
   * `AndroidComposeView`, its composition and the last slot table alive for the life
   * of the activity. In a single-activity RN app that is the life of the process, so
   * every visit to a settings screen built on a `<Host>` would retain one Host
   * (review M1 - B1's shape, one level up).
   *
   * A Host unmounted before its first frame also leaves a first-frame `PreDrawWatch`
   * on the *window's* observer, which `drop()` removes for the same reason.
   */
  override fun onDropView() {
    host.drop()
  }
}
