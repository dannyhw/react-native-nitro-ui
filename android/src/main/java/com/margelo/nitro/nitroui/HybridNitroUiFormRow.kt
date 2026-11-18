package com.margelo.nitro.nitroui

import android.os.Bundle
import android.os.Looper
import android.os.Handler
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.ViewConfiguration
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.ui.geometry.Offset
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiLifetimeGate
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.views.HybridNitroUiFormRowStateUpdater
import com.margelo.nitro.views.RecyclableView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.math.hypot

/**
 * `Form.Row` on Android: a React Native view group whose children stay where Yoga put them.
 *
 * The row watches the gesture in `dispatchTouchEvent` and never intercepts it, so a `Switch`
 * or `Pressable` inside a row keeps its own touch. A tap that lands on a hosted control is
 * that control's alone and leaves the row's `onPress` un-fired; a tap on React Native content
 * inside the row is answered by both, because nothing tells it apart from plain content.
 * It draws nothing itself: the section's one Compose layer draws the shape and the ripple
 * behind all of its rows, fed a `PressInteraction` from here.
 */
internal class HybridNitroUiFormRow(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormRowSpec(), RecyclableView {
  override val view: NitroUiFormRowView by lazy { NitroUiFormRowView(reactContext, this) }

  private var rawAccessory = NitroUiFormAccessory.NONE
  private var rawSelected = false
  private var rawPressable = false

  override var accessory: NitroUiFormAccessory
    get() = rawAccessory
    set(value) {
      rawAccessory = value
    }

  override var selected: Boolean
    get() = rawSelected
    set(value) {
      rawSelected = value
    }

  override var pressable: Boolean
    get() = rawPressable
    set(value) {
      rawPressable = value
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(perfInstanceId.toDouble())
      }
    set(next) {
      val raw = next.asSecondOrNull()
      perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  private var perfInstanceId = NitroUiPerf.NO_INSTANCE

  override var onPress: (() -> Unit)? = null

  /** Never called on Android: a row keeps the width Yoga gave it, so there is nothing to report. */
  override var onContentBox: ((width: Double) -> Unit)? = null

  override fun afterUpdate() {
    view.applyChrome(rawAccessory, rawSelected, rawPressable)
  }

  override fun prepareForRecycle() {
    rawAccessory = NitroUiFormAccessory.NONE
    rawSelected = false
    rawPressable = false
    view.lifetime.onRecycle()
    view.resetRow()
  }

  override fun onDropView() {
    onPress = null
    view.lifetime.onDrop()
  }

  override fun nuiTestA11yClick() {
    // Goes through the framework's ACTION_CLICK path, the one a screen reader's double-tap takes.
    view.post {
      view.performAccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, null)
    }
  }

  fun firePress() {
    onPress?.invoke()
  }

  // Nitro methods run on the JS thread and the numbers are the UI thread's, so a read returns
  // the report as the UI thread last built it. Callers poll.
  @Volatile private var report = "pending"
  private val reportHandler = Handler(Looper.getMainLooper())

  override fun nuiTestRowReport(): String {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      report = buildRowReport()
    } else {
      reportHandler.post { report = buildRowReport() }
    }
    return report
  }

  private fun buildRowReport(): String {
    val density = view.resources.displayMetrics.density
    return listOf(
      "where=" + if (view.parent == null) "detached" else "inplace",
      "frame=${String.format(
        "%.1f,%.1f,%.1f,%.1f",
        view.left / density,
        view.top / density,
        view.width / density,
        view.height / density,
      )}",
      "window=" + windowField(density),
      "h=${String.format("%.1f", view.height / density)}",
      "presses=${view.taps}",
      "desc=${view.contentDescription ?: "-"}",
      "drops=${view.lifetime.drops}",
      "recycles=${view.lifetime.recycles}",
      "pressesPending=${if (view.pressed) 1 else 0}",
      "accessory=${rawAccessory.name.lowercase()}",
      "pressable=${if (rawPressable) 1 else 0}",
      "selected=${if (rawSelected) 1 else 0}",
    ).joinToString(";")
  }

  /** The row's box in its own window, in dp, or `-` before it is attached. */
  private fun windowField(density: Float): String {
    if (!view.isAttachedToWindow) return "-"
    val at = IntArray(2)
    view.getLocationInWindow(at)
    return String.format(
      "%.1f,%.1f,%.1f,%.1f",
      at[0] / density,
      at[1] / density,
      view.width / density,
      view.height / density,
    )
  }
}

internal class NitroUiFormRowView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiFormRow,
) : ReactViewGroup(context) {
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
  private var downX = 0f
  private var downY = 0f
  private var pending = false

  val lifetime = NitroUiLifetimeGate()

  /** `onPress` calls delivered. */
  var taps = 0
    private set

  var pressed = false
    private set

  /** Read by the section's layer when it draws. */
  var rowSelected = false
    private set
  var rowAccessory = ACCESSORY_NONE
    private set

  private val section: NitroUiFormSectionView?
    get() = parent as? NitroUiFormSectionView

  fun applyChrome(
    accessory: NitroUiFormAccessory,
    selected: Boolean,
    pressable: Boolean,
  ) {
    rowAccessory =
      when (accessory) {
        NitroUiFormAccessory.DISCLOSURE -> ACCESSORY_DISCLOSURE
        NitroUiFormAccessory.CHECKMARK -> ACCESSORY_CHECKMARK
        else -> ACCESSORY_NONE
      }
    rowSelected = selected
    // `isClickable` makes the framework offer ACTION_CLICK, so a pressable row is one
    // clickable element to a screen reader.
    isClickable = pressable
    importantForAccessibility = if (pressable) IMPORTANT_FOR_ACCESSIBILITY_YES else IMPORTANT_FOR_ACCESSIBILITY_AUTO
    section?.publishRects()
  }

  fun resetRow() {
    rowAccessory = ACCESSORY_NONE
    rowSelected = false
    pressed = false
    pending = false
    taps = 0
    // React Native's `prepareToRecycleView` clears its `accessibility_label` tag but not
    // these, so a pooled view would be announced with the previous mount's label.
    contentDescription = null
    isClickable = false
    isLongClickable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
  }

  // A screen reader's double-tap sends ACTION_CLICK, not touches, and a `ReactViewGroup` has
  // no `OnClickListener` for `performClick` to call, so the press is fired here.
  override fun performAccessibilityAction(
    action: Int,
    args: Bundle?,
  ): Boolean {
    if (action == AccessibilityNodeInfo.ACTION_CLICK) {
      if (!hybrid.pressable) return false
      taps += 1
      hybrid.firePress()
      return true
    }
    return super.performAccessibilityAction(action, args)
  }

  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    super.onLayout(changed, left, top, right, bottom)
    // The section's layer draws this row's shape at this row's box.
    section?.publishRects()
  }

  // MARK: Watching the gesture (see the file header)

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        pending = hybrid.pressable && !hostedControlAt(event.x, event.y)
        if (pending) setPressed(true, event)
      }

      MotionEvent.ACTION_MOVE -> {
        if (pending && hypot((event.x - downX).toDouble(), (event.y - downY).toDouble()) > touchSlop) {
          releasePressed()
        }
      }

      MotionEvent.ACTION_UP -> {
        val wasPending = pending
        releasePressed()
        if (wasPending) {
          taps += 1
          hybrid.firePress()
        }
      }

      MotionEvent.ACTION_CANCEL -> releasePressed()
    }
    // Never consumed here: the children still get every event.
    return super.dispatchTouchEvent(event)
  }

  /**
   * Whether a hosted nitro-ui control that answers its own taps owns this point of the row.
   *
   * A control draws itself in the Compose host that is its own view. The tag every Nitro view
   * manager puts on its root is not the sign: it also lands on a wrapper that only holds React
   * Native children, and those children are the row's own content. React Native's views claim a
   * touch the same way plain content does, so nothing tells a `Pressable` from a `Text` here.
   * A hosted item that hands its press up to the cell, a `ListItem` inside the row, is content
   * too: the row presses for it.
   */
  private fun hostedControlAt(
    x: Float,
    y: Float,
  ): Boolean {
    var target = deepestChildAt(this, x, y)
    while (target != null && target !== this) {
      if (target is NitroComposeHost<*>) return !target.pressOwnedByRow
      target = target.parent as? View
    }
    return false
  }

  /** The deepest visible descendant drawn over this point, in [parent]'s coordinates. */
  private fun deepestChildAt(
    parent: ViewGroup,
    x: Float,
    y: Float,
  ): View? {
    for (index in parent.childCount - 1 downTo 0) {
      val child = parent.getChildAt(index)
      if (child.visibility != View.VISIBLE || child.alpha <= 0f) continue
      val left = child.left - parent.scrollX
      val top = child.top - parent.scrollY
      if (x < left || x >= left + child.width || y < top || y >= top + child.height) continue
      if (child is ViewGroup) {
        val deeper = deepestChildAt(child, x - left, y - top)
        if (deeper != null) return deeper
      }
      return child
    }
    return null
  }

  private fun setPressed(
    pressedNow: Boolean,
    event: MotionEvent,
  ) {
    if (pressed == pressedNow) return
    pressed = pressedNow
    section?.let { target ->
      target.setPressed(this, pressedNow)
      val source = target.interactionSourceFor(this) ?: return
      if (pressedNow) {
        scope?.launch { source.emit(PressInteraction.Press(Offset(event.x, event.y))) }
      } else {
        scope?.launch { source.emit(PressInteraction.Release(PressInteraction.Press(Offset(event.x, event.y)))) }
      }
    }
  }

  private fun releasePressed() {
    pending = false
    if (!pressed) return
    pressed = false
    section?.let { target ->
      target.setPressed(this, false)
      val source = target.interactionSourceFor(this) ?: return
      scope?.launch { source.emit(PressInteraction.Release(PressInteraction.Press(Offset(downX, downY)))) }
    }
  }

  private var scope: CoroutineScope? = null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    section?.publishRects()
  }

  override fun onDetachedFromWindow() {
    scope?.cancel()
    scope = null
    releasePressedQuietly()
    super.onDetachedFromWindow()
  }

  private fun releasePressedQuietly() {
    pending = false
    pressed = false
  }

  fun isLocallyVisible(): Boolean {
    if (!isShown || width == 0 || height == 0) return false
    val bounds = android.graphics.Rect()
    if (!getGlobalVisibleRect(bounds)) return false
    return bounds.width() > 0 && bounds.height() > 0
  }

  companion object {
    const val ACCESSORY_NONE = 0
    const val ACCESSORY_DISCLOSURE = 1
    const val ACCESSORY_CHECKMARK = 2
  }
}

internal class NitroUiFormRowViewManager : ReactViewManager() {
  private class Holder(
    val hybridView: HybridNitroUiFormRow,
    var lastState: StateWrapper? = null,
  )

  init {
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiFormRow"

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val hybridView = HybridNitroUiFormRow(context)
    val view = hybridView.view
    view.setTag(associated_hybrid_view_tag, Holder(hybridView))
    return view
  }

  override fun updateState(
    view: ReactViewGroup,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder = holder(view) ?: throw Error("Couldn't find view $view in local views table!")
    holder.hybridView.beforeUpdate()
    HybridNitroUiFormRowStateUpdater.updateViewProps(holder.hybridView, stateWrapper, holder.lastState)
    holder.hybridView.afterUpdate()
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
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = holder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    return prepared
  }

  private fun holder(view: android.view.View): Holder? =
    view.getTag(associated_hybrid_view_tag) as? Holder
}
