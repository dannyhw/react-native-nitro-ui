package com.margelo.nitro.nitroui

import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.core.NitroUiHostView
import com.margelo.nitro.nitroui.views.HybridNitroUiHostStateUpdater

/**
 * Hand-written view manager for `NitroUiHost`, registered instead of the generated one.
 * Nitrogen emits a `SimpleViewManager`, which cannot have children.
 */
internal class NitroUiHostViewManager : ViewGroupManager<NitroUiHostView>() {

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

  // Yoga lays the children out; a hosted child declines its own measure and Compose places it.
  override fun needsCustomLayoutForChildren(): Boolean = false

  // `ViewManager.setPadding` is a no-op by default, and Fabric calls it rather than the view's
  // setter. Without this, padding would grow the Host's box but not inset its content.
  override fun setPadding(
    view: NitroUiHostView,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    view.setPadding(left, top, right, bottom)
  }

  private fun getHybridViewHolder(view: NitroUiHostView): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
