package com.margelo.nitro.nitroui

// S3 spike only: the Fabric manager of `NitroUiContextMenuProto`, registered instead of
// the generated `SimpleViewManager`. It subclasses RN's `ReactViewManager`, so the
// wrapper takes every prop RN's `View` takes (borders, radius, overflow, hitSlop,
// accessibility), and it is the generated manager's body otherwise: one Hybrid per
// view, Nitro's props applied through the generated state updater. The compose host is
// the wrapper's last child and is hidden from Fabric's indices.

import android.view.View
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.nitroui.views.HybridNitroUiContextMenuProtoStateUpdater

internal class NitroUiContextMenuProtoViewManager : ReactViewManager() {
  private class HybridViewHolder(
    val hybridView: HybridNitroUiContextMenuProto,
    var lastState: StateWrapper? = null,
  )

  override fun getName(): String = "NitroUiContextMenuProto"

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val hybridView = HybridNitroUiContextMenuProto(context)
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
    HybridNitroUiContextMenuProtoStateUpdater.updateViewProps(hybridView, stateWrapper, holder.lastState)
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
  ): ReactViewGroup? = null

  override fun addView(
    parent: ReactViewGroup,
    child: View,
    index: Int,
  ) {
    (parent as S3ContextMenuView).addReactChild(child, index)
  }

  override fun getChildCount(parent: ReactViewGroup): Int = (parent as S3ContextMenuView).reactChildCount

  override fun getChildAt(
    parent: ReactViewGroup,
    index: Int,
  ): View? = if (index < (parent as S3ContextMenuView).reactChildCount) parent.getChildAt(index) else null

  override fun removeViewAt(
    parent: ReactViewGroup,
    index: Int,
  ) {
    (parent as S3ContextMenuView).removeReactChildAt(index)
  }

  override fun removeAllViews(parent: ReactViewGroup) {
    val wrapper = parent as S3ContextMenuView
    while (wrapper.reactChildCount > 0) wrapper.removeReactChildAt(0)
  }

  private fun holder(view: View): HybridViewHolder? = view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
