package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.views.HybridNitroUiBottomSheetStateUpdater
import com.margelo.nitro.views.RecyclableView

/**
 * Registered in place of the generated manager, which is a leaf `SimpleViewManager`: a
 * BottomSheet holds React Native children. [addView] and [removeViewAt] address the host,
 * whose list Fabric's indices refer to, while the children live in the sheet's window.
 */
internal class NitroUiBottomSheetViewManager : ViewGroupManager<BottomSheetHost>() {
  private class HybridViewHolder(
    val hybridView: HybridNitroUiBottomSheet,
    var lastState: StateWrapper? = null,
  )

  init {
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiBottomSheet"

  override fun createViewInstance(reactContext: ThemedReactContext): BottomSheetHost {
    val hybridView = HybridNitroUiBottomSheet(reactContext)
    val view = hybridView.host
    view.setTag(associated_hybrid_view_tag, HybridViewHolder(hybridView))
    return view
  }

  override fun updateState(
    view: BottomSheetHost,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder =
      getHybridViewHolder(view)
        ?: throw Error("Couldn't find view $view in local views table!")
    val hybridView = holder.hybridView
    val oldState = holder.lastState
    hybridView.beforeUpdate()
    HybridNitroUiBottomSheetStateUpdater.updateViewProps(hybridView, stateWrapper, oldState)
    hybridView.afterUpdate()
    holder.lastState = stateWrapper
    return super.updateState(view, props, stateWrapper)
  }

  override fun onDropViewInstance(view: BottomSheetHost) {
    val holder = getHybridViewHolder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    super.onDropViewInstance(view)
  }

  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: BottomSheetHost,
  ): BottomSheetHost? {
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = getHybridViewHolder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    return prepared
  }

  // MARK: IViewGroupManager - the children, as Fabric sees them

  override fun addView(
    parent: BottomSheetHost,
    child: View,
    index: Int,
  ) {
    parent.mountChild(child, index)
  }

  override fun removeViewAt(
    parent: BottomSheetHost,
    index: Int,
  ) {
    parent.unmountChildAt(index)
  }

  override fun removeView(
    parent: BottomSheetHost,
    view: View,
  ) {
    val index = (0 until parent.childCountReported()).firstOrNull { parent.childAtReported(it) === view }
    if (index != null) parent.unmountChildAt(index)
  }

  override fun getChildAt(
    parent: BottomSheetHost,
    index: Int,
  ): View =
    parent.childAtReported(index)
      ?: throw IndexOutOfBoundsException("No child $index of $parent")

  override fun getChildCount(parent: BottomSheetHost): Int = parent.childCountReported()

  /** Yoga keeps the layout: React Native sets each child's frame in whatever view holds it. */
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: View): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
