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
 * The Fabric view manager of `NitroUiBottomSheet` - hand-written, and registered instead
 * of the generated `HybridNitroUiBottomSheetManager` (`component.json`'s
 * `androidViewManager`; the registry checks `NitroUiPackage` registers this one).
 *
 * **Why hand-written:** a Nitro Hybrid View is a leaf - nitrogen emits a
 * `SimpleViewManager`, which implements no `IViewGroupManager` - and a BottomSheet's
 * whole content is React Native children. The `<Host>` has the same reason
 * (`NitroUiHostViewManager`). This class is the generated manager's body (one Hybrid
 * Object per view, props applied through the generated state updater in one batch,
 * recycling set up because the Hybrid is a [RecyclableView]) on a [ViewGroupManager]
 * base, plus the redirect S2 measured: [addView] and [removeViewAt] speak to the
 * children's *logical* parent - the host, whose list Fabric's indices index into - while
 * the children physically live in the sheet's window for as long as it is up.
 */
internal class NitroUiBottomSheetViewManager : ViewGroupManager<BottomSheetHost>() {
  /** The View and its last state snapshot, as the generated managers keep them. */
  private class HybridViewHolder(
    val hybridView: HybridNitroUiBottomSheet,
    var lastState: StateWrapper? = null,
  )

  init {
    // The generated manager's rule: recycling is on when the Hybrid can reset itself.
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

  /**
   * `false`: Yoga keeps the layout, and RN 0.88's `SurfaceMountingManager` sets each
   * child's frame itself - inside whatever view the child is in, which is the point of
   * the redirect.
   */
  override fun needsCustomLayoutForChildren(): Boolean = false

  private fun getHybridViewHolder(view: View): HybridViewHolder? =
    view.getTag(associated_hybrid_view_tag) as? HybridViewHolder
}
