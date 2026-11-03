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
 * The Fabric view manager of `NitroUiContextMenu` - hand-written, and registered instead
 * of the generated `HybridNitroUiContextMenuManager` (`component.json`'s
 * `androidViewManager`; the registry checks `NitroUiPackage` registers this one).
 *
 * **Why `ReactViewManager`:** a ContextMenu replaces a `View` around existing content, so
 * it has to style like one. Nitrogen emits a `SimpleViewManager`, which has no
 * `IViewGroupManager` half for the children and only `BaseViewManager`'s props, whose
 * border-radius setters just log. RN's own `ReactViewManager` is `open`, so the wrapper
 * takes every prop RN's `View` takes. Otherwise this is the generated manager's body, as
 * `NitroUiBottomSheetViewManager` is: one Hybrid per view, Nitro's props applied through
 * the generated state updater in one batch, recycling set up because the Hybrid is a
 * `RecyclableView`.
 *
 * **The children:** Fabric's indices are the React Native children's. The menu's compose
 * host is the wrapper's last child and is hidden from [getChildCount], [getChildAt] and the
 * removals, so an insert at `n` lands before it and an unmount never takes it.
 */
internal class NitroUiContextMenuViewManager : ReactViewManager() {
  /** The View and its last state snapshot, as the generated managers keep them. */
  private class HybridViewHolder(
    val hybridView: HybridNitroUiContextMenu,
    var lastState: StateWrapper? = null,
  )

  init {
    // The generated manager's rule. `ReactViewManager` only turns recycling on for its own
    // class, never a subclass, so this is not a second call.
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
    // `ReactViewManager`'s half resets the `View` (background, borders, pointer events)
    // and removes every child - the compose host too - so the host is put back after it.
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = holder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    (prepared as ContextMenuView).reinstallHost()
    return prepared
  }

  /**
   * Refused, with a dev warning (Q6 Appendix C1): the clipping list would have to keep out
   * of the compose host's way, and a context-menu wrapper is not a scroll container.
   */
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
