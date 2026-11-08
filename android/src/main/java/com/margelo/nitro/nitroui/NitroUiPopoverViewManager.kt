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
 * The Fabric view manager of `NitroUiPopover` - hand-written, and registered instead of the
 * generated `HybridNitroUiPopoverManager` (`component.json`'s `androidViewManager`; the
 * registry checks `NitroUiPackage` registers this one).
 *
 * **Why hand-written:** a Nitro Hybrid View is a leaf - nitrogen emits a `SimpleViewManager`,
 * which implements no `IViewGroupManager` - and a popover's whole content is React Native
 * children. Same reason as `NitroUiBottomSheetViewManager` and `NitroUiHostViewManager`. This
 * class is the generated manager's body (one Hybrid Object per view, props applied through the
 * generated state updater in one batch, recycling set up because the Hybrid is a
 * [RecyclableView]) on a [ViewGroupManager] base, plus the redirect: [addView] and
 * [removeViewAt] speak to the children's *logical* parent - [PopoverHost]'s list, which is
 * what Fabric's indices index into - while the children physically live in the popup's window
 * for as long as the popover is up.
 */
internal class NitroUiPopoverViewManager : ViewGroupManager<PopoverHost>() {
  /** The View and its last state snapshot, as the generated managers keep them. */
  private class HybridViewHolder(
    val hybridView: HybridNitroUiPopover,
    var lastState: StateWrapper? = null,
  )

  init {
    // The generated manager's rule: recycling is on when the Hybrid can reset itself.
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

  /**
   * `false`: Yoga keeps the layout, and RN 0.88's `SurfaceMountingManager` sets each child's
   * frame itself - inside whatever view the child is in, which is the point of the redirect.
   */
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: View): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
