package com.margelo.nitro.nitroui

import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.core.NitroUiHostView
import com.margelo.nitro.nitroui.views.HybridNitroUiHostStateUpdater

/**
 * The Fabric view manager of `NitroUiHost` - hand-written, and registered instead
 * of the generated `HybridNitroUiHostManager` (see `NitroUiPackage`).
 *
 * **Why hand-written:** a Nitro Hybrid View is a leaf - nitrogen emits a
 * `SimpleViewManager`, which implements no `IViewGroupManager`, so Fabric has no
 * `addView`/`removeViewAt` for it and a `<Host>` would mount empty
 * (`docs/research/nitro-patterns.md`; the same fix for the same reason in
 * `react-native-nitro-contextmenu`'s `ContextMenuViewManager`). This class is the
 * generated manager's body - one Hybrid Object per view, tagged on the view, props
 * applied through the generated state updater in one batch - on a
 * [ViewGroupManager] base.
 *
 * **Why nothing else is here:** no `setupViewRecycling()` (a Host implements no
 * `RecyclableView`: it holds no state to reset), and no `NitroUiSizing.bind()` (a
 * Host is not self-sizing - its box is its `style`, and its children's boxes are
 * Compose's, so there is nothing to report back to Yoga).
 */
internal class NitroUiHostViewManager : ViewGroupManager<NitroUiHostView>() {

  /** The View and its last state snapshot, as the generated managers keep them. */
  private class HybridViewHolder(
    val hybridView: HybridNitroUiHost,
    var lastState: StateWrapper? = null,
  )

  override fun getName(): String = "NitroUiHost"

  override fun createViewInstance(reactContext: ThemedReactContext): NitroUiHostView {
    val hybridView = HybridNitroUiHost(reactContext)
    val view = hybridView.host
    view.setTag(associated_hybrid_view_tag, HybridViewHolder(hybridView))
    return view
  }

  override fun updateState(
    view: NitroUiHostView,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder = getHybridViewHolder(view)
      ?: throw Error("Couldn't find view $view in local views table!")
    val hybridView = holder.hybridView
    val oldState = holder.lastState
    val newState = stateWrapper

    hybridView.beforeUpdate()
    HybridNitroUiHostStateUpdater.updateViewProps(hybridView, newState, oldState)
    hybridView.afterUpdate()
    holder.lastState = newState

    return super.updateState(view, props, newState)
  }

  override fun onDropViewInstance(view: NitroUiHostView) {
    val holder = getHybridViewHolder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    return super.onDropViewInstance(view)
  }

  /**
   * `false`, i.e. Yoga keeps laying the children out (RN 0.88's
   * `SurfaceMountingManager` sets each child's frame itself). That is what a hosted
   * child expects: it declines its own measure and layout, and Compose does the
   * placing. Asking for custom layout here would only move the work.
   */
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: NitroUiHostView): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
