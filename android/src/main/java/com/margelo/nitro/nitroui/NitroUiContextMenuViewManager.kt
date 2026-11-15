package com.margelo.nitro.nitroui

import android.util.Log
import android.view.View
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.views.HybridNitroUiContextMenuStateUpdater

/**
 * Registered in place of the generated manager. It extends `ReactViewManager` so the wrapper
 * takes every style prop a `View` takes. The menu's compose host is the wrapper's last child
 * and is hidden from Fabric's child indices.
 */
internal class NitroUiContextMenuViewManager : ReactViewManager() {
  private class HybridViewHolder(
    val hybridView: HybridNitroUiContextMenu,
    var lastState: StateWrapper? = null,
  )

  init {
    // `ReactViewManager` turns recycling on only for its own class, never a subclass.
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiContextMenu"

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val hybridView = HybridNitroUiContextMenu(context)
    val view = hybridView.wrapper
    view.setTag(associated_hybrid_view_tag, HybridViewHolder(hybridView))
    return view
  }

  override fun updateState(
    view: ReactViewGroup,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder = holder(view) ?: throw Error("Couldn't find view $view in local views table!")
    val hybridView = holder.hybridView
    hybridView.beforeUpdate()
    HybridNitroUiContextMenuStateUpdater.updateViewProps(hybridView, stateWrapper, holder.lastState)
    hybridView.afterUpdate()
    holder.lastState = stateWrapper
    return super.updateState(view, props, stateWrapper)
  }

  override fun onDropViewInstance(view: ReactViewGroup) {
    val holder = holder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    super.onDropViewInstance(view)
  }

  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: ReactViewGroup,
  ): ReactViewGroup? {
    // The superclass removes every child, the compose host included; it is put back below.
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    // React Native's reset leaves `contentDescription` and `importantForAccessibility` as the
    // last owner set them, so a recycled wrapper would be announced with the old label.
    prepared.contentDescription = null
    prepared.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    val holder = holder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    (prepared as ContextMenuView).reinstallHost()
    return prepared
  }

  /** Ignored with a warning: a context-menu wrapper is not a scroll container. */
  override fun setRemoveClippedSubviews(
    view: ReactViewGroup,
    removeClippedSubviews: Boolean,
  ) {
    if (removeClippedSubviews) {
      Log.w("NitroUiContextMenu", "removeClippedSubviews is not supported on a ContextMenu and is ignored")
    }
  }

  // MARK: IViewGroupManager - the children, as Fabric sees them

  override fun addView(
    parent: ReactViewGroup,
    child: View,
    index: Int,
  ) {
    (parent as ContextMenuView).addReactChild(child, index)
  }

  override fun getChildCount(parent: ReactViewGroup): Int = (parent as ContextMenuView).reactChildCount

  override fun getChildAt(
    parent: ReactViewGroup,
    index: Int,
  ): View? = (parent as ContextMenuView).reactChildAt(index)

  override fun removeViewAt(
    parent: ReactViewGroup,
    index: Int,
  ) {
    (parent as ContextMenuView).removeReactChildAt(index)
  }

  override fun removeView(
    parent: ReactViewGroup,
    view: View,
  ) {
    (parent as ContextMenuView).removeReactChild(view)
  }

  override fun removeAllViews(parent: ReactViewGroup) {
    val wrapper = parent as ContextMenuView
    while (wrapper.reactChildCount > 0) wrapper.removeReactChildAt(0)
  }

  private fun holder(view: View): HybridViewHolder? = view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
