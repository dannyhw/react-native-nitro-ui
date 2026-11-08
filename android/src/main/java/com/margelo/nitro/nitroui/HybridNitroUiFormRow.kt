package com.margelo.nitro.nitroui

import android.os.Looper
import android.os.Handler
import android.view.MotionEvent
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
 * The `Form.Row` of the S6 spike on Android: React Native content that keeps its children
 * where Yoga put them, watches its own touches, and is the box its section's Compose layer
 * draws a segmented shape behind (Q10 Appendix C1, question 7).
 *
 * **Watching, not taking.** The row reads the gesture in `dispatchTouchEvent`, which runs
 * before any child sees it, and never intercepts: a `Switch` or a `Pressable` inside a row
 * keeps its own touch, and a row with `onPress` still gets its ripple and its shape morph.
 * A press that travels past the touch slop is dropped (the child is scrolling or dragging),
 * and a `CANCEL` from an ancestor drops it too. This is ContextMenu's arbitration
 * ([ContextMenuView]) with the opposite outcome: a ContextMenu *takes* the gesture on
 * recognition because the menu must own it; a row must not, because its content does.
 *
 * **The press feedback lives in the section's layer**, not here: a per-row Compose runtime
 * would cost what `docs/components/host.md` measures for an unhosted control, for one ripple.
 * So this view hands the section a `PressInteraction` on a source the section owns.
 *
 * The row does not draw and does not clip: `ListItemDefaults.segmentedShapes` gives the shape
 * and the layer draws it, one composition behind a whole section's rows.
 *
 * The row reports no position either. Here the row is where Yoga put it, so the shadow tree
 * and the screen agree without being told (the reason Android sends no scroll offset and no
 * placement of its own, and the reason iOS has to say both).
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

  override fun afterUpdate() {
    view.applyChrome(rawAccessory, rawSelected, rawPressable)
  }

  override fun prepareForRecycle() {
    rawAccessory = NitroUiFormAccessory.NONE
    rawSelected = false
    rawPressable = false
    view.resetRow()
  }

  override fun onDropView() {
    onPress = null
  }

  /** The cell's press reached React. */
  fun firePress() {
    onPress?.invoke()
  }

  /**
   * The report as JavaScript sees it.
   *
   * A Nitro method runs on the JS thread and every number here is the UI thread's, so
   * the read is eventually consistent - built on the UI thread and returned as it last
   * stood, the rule `HybridNitroUiBottomSheet.nuiTestStateReport` sets. The harness
   * polls a report until it says what the test is waiting for.
   */
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

  /** Read on the UI thread only. */
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
      "pressesPending=${if (view.pressed) 1 else 0}",
      "accessory=${rawAccessory.name.lowercase()}",
      "pressable=${if (rawPressable) 1 else 0}",
      "selected=${if (rawSelected) 1 else 0}",
    ).joinToString(";")
  }

  /**
   * The row's box in its own window, in dp, or `-` before it is attached.
   *
   * iOS added this field for S6b question 4: a row there is re-parented into a
   * `UICollectionViewListCell`, so what UIKit shows and what `measure()` reports came to be
   * different numbers, and the harness needs both to see it. Android is the control for that
   * case - this view is where Yoga put it, so the two answers are the same number by
   * construction, which is exactly what the case needs to be able to say.
   */
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

/**
 * The row's view. Also the thing the harness measures for question 3 (its Yoga box) and
 * question 4 (`measure()` of a view that is where Yoga put it).
 */
internal class NitroUiFormRowView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiFormRow,
) : ReactViewGroup(context) {
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
  private var downX = 0f
  private var downY = 0f
  private var pending = false

  /** `onPress` calls delivered, for the harness's 10/10. */
  var taps = 0
    private set

  /** Whether a press is in flight on this row right now. */
  var pressed = false
    private set

  /** Chrome the section's layer draws with. */
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
    // A row that can be pressed is one clickable element to a screen reader, the same as
    // iOS's cell; `isClickable` is what makes the framework offer ACTION_CLICK by itself.
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
  }

  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    super.onLayout(changed, left, top, right, bottom)
    // The row's box is the shape's box, so every move is the layer's business.
    section?.publishRects()
  }

  // MARK: Watching the gesture (see the file header)

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        pending = hybrid.pressable
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
    // The children still get everything: this is a listener, not a gate.
    return super.dispatchTouchEvent(event)
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

  /** A coroutine scope for the interaction emits, on the main dispatcher. */
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

  /**
   * Whether this row is on screen, for the report. Walks the parents' clipping rather than
   * trusting one rect, because the scroller is React Native's.
   */
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

/** The Fabric manager of `NitroUiFormRow`. Its children are React Native's and stay in place. */
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
