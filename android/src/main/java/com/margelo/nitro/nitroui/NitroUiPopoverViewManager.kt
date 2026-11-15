package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.views.HybridNitroUiPopoverStateUpdater
import com.margelo.nitro.views.RecyclableView

/**
 * Hand-written view manager for `NitroUiPopover`, registered instead of the generated one.
 * Nitrogen emits a `SimpleViewManager`, which cannot have children. [addView] and
 * [removeViewAt] address [PopoverHost]'s logical child list, which Fabric's indices refer
 * to, while the children live in the popup's window.
 */
internal class NitroUiPopoverViewManager : ViewGroupManager<PopoverHost>() {
  private class HybridViewHolder(
    val hybridView: HybridNitroUiPopover,
    var lastState: StateWrapper? = null,
  )

  init {
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiPopover"

  override fun createViewInstance(reactContext: ThemedReactContext): PopoverHost {
    val hybridView = HybridNitroUiPopover(reactContext)
    val view = hybridView.host
    view.setTag(associated_hybrid_view_tag, HybridViewHolder(hybridView))
    return view
  }

  override fun updateState(
    view: PopoverHost,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder =
      getHybridViewHolder(view)
        ?: throw Error("Couldn't find view $view in local views table!")
    val hybridView = holder.hybridView
    val oldState = holder.lastState
    hybridView.beforeUpdate()
    HybridNitroUiPopoverStateUpdater.updateViewProps(hybridView, stateWrapper, oldState)
    hybridView.afterUpdate()
    holder.lastState = stateWrapper
    return super.updateState(view, props, stateWrapper)
  }

  override fun onDropViewInstance(view: PopoverHost) {
    val holder = getHybridViewHolder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    super.onDropViewInstance(view)
  }

  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: PopoverHost,
  ): PopoverHost? {
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = getHybridViewHolder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    return prepared
  }

  // MARK: IViewGroupManager - the children, as Fabric sees them

  override fun addView(
    parent: PopoverHost,
    child: View,
    index: Int,
  ) {
    parent.mountChild(child, index)
  }

  override fun removeViewAt(
    parent: PopoverHost,
    index: Int,
  ) {
    parent.unmountChildAt(index)
  }

  override fun removeView(
    parent: PopoverHost,
    view: View,
  ) {
    val index = (0 until parent.childCountReported()).firstOrNull { parent.childAtReported(it) === view }
    if (index != null) parent.unmountChildAt(index)
  }

  override fun getChildAt(
    parent: PopoverHost,
    index: Int,
  ): View =
    parent.childAtReported(index)
      ?: throw IndexOutOfBoundsException("No child $index of $parent")

  override fun getChildCount(parent: PopoverHost): Int = parent.childCountReported()

  // Yoga lays the children out, inside whichever view currently holds them.
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: View): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
