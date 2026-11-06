package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.views.HybridNitroUiPopoverProtoStateUpdater
import com.margelo.nitro.views.RecyclableView

/**
 * S5 spike only (never merged): the PopoverProto's hand-written manager - BottomSheet's
 * (`NitroUiBottomSheetViewManager`) with the types renamed. Its children are the
 * popover's content, redirected into the popup window's root.
 */
internal class NitroUiPopoverProtoViewManager : ViewGroupManager<PopoverProtoHost>() {
  /** The View and its last state snapshot, as the generated managers keep them. */
  private class HybridViewHolder(
    val hybridView: HybridNitroUiPopoverProto,
    var lastState: StateWrapper? = null,
  )

  init {
    // The generated manager's rule: recycling is on when the Hybrid can reset itself.
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiPopoverProto"

  override fun createViewInstance(reactContext: ThemedReactContext): PopoverProtoHost {
    val hybridView = HybridNitroUiPopoverProto(reactContext)
    val view = hybridView.host
    view.setTag(associated_hybrid_view_tag, HybridViewHolder(hybridView))
    return view
  }

  override fun updateState(
    view: PopoverProtoHost,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder =
      getHybridViewHolder(view)
        ?: throw Error("Couldn't find view $view in local views table!")
    val hybridView = holder.hybridView
    val oldState = holder.lastState
    hybridView.beforeUpdate()
    HybridNitroUiPopoverProtoStateUpdater.updateViewProps(hybridView, stateWrapper, oldState)
    hybridView.afterUpdate()
    holder.lastState = stateWrapper
    return super.updateState(view, props, stateWrapper)
  }

  override fun onDropViewInstance(view: PopoverProtoHost) {
    val holder = getHybridViewHolder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    super.onDropViewInstance(view)
  }

  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: PopoverProtoHost,
  ): PopoverProtoHost? {
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = getHybridViewHolder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    return prepared
  }

  // MARK: IViewGroupManager - the children, as Fabric sees them

  override fun addView(
    parent: PopoverProtoHost,
    child: View,
    index: Int,
  ) {
    parent.mountChild(child, index)
  }

  override fun removeViewAt(
    parent: PopoverProtoHost,
    index: Int,
  ) {
    parent.unmountChildAt(index)
  }

  override fun removeView(
    parent: PopoverProtoHost,
    view: View,
  ) {
    val index = (0 until parent.childCountReported()).firstOrNull { parent.childAtReported(it) === view }
    if (index != null) parent.unmountChildAt(index)
  }

  override fun getChildAt(
    parent: PopoverProtoHost,
    index: Int,
  ): View =
    parent.childAtReported(index)
      ?: throw IndexOutOfBoundsException("No child $index of $parent")

  override fun getChildCount(parent: PopoverProtoHost): Int = parent.childCountReported()

  /**
   * `false`: Yoga keeps the layout, and RN 0.88's `SurfaceMountingManager` sets each
   * child's frame itself - inside whatever view the child is in, which is the point of
   * the redirect.
   */
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: View): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
