package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlin.math.max
import kotlin.math.min

/*
 * S5 spike only (never merged): a popover whose content is React Native views, Q7
 * Appendix F, on Android. Material has no popover, so this is D38 item 1's rule: a
 * Compose `Popup` (a window) holding an M3 `Surface` (`shapes.medium`, tonal elevation
 * 3 dp) that holds the React Native root through `AndroidView`.
 *
 * The content machinery is BottomSheet's (G14): the hand-written `ViewGroupManager`
 * redirects the children into [NitroUiSheetRootView] - React Native's `Modal` root,
 * with its own `JSTouchDispatcher` - which lives in the popup while it is up.
 *
 * Two-axis `fit`: the JS wrapper makes the content box the node's one child, sized by
 * Yoga to the content (at most the cap). Its frame is read from Fabric's layout of that
 * child, and the popup is composed only once that size is known, at that size - so the
 * popup is measured after the root has its size, and its first frame is its last.
 */

internal class PopoverProtoModel : NitroUiModel() {
  var presented by mutableStateOf(false)
    private set

  @Volatile var composed = false
  var generation by mutableIntStateOf(0)
    private set

  /** The content box, px: the node's first child, as Fabric laid it out. */
  var contentWpx by mutableIntStateOf(0)
  var contentHpx by mutableIntStateOf(0)
  var maxWidth by mutableStateOf(320.0)
  var sizeBeforePresent by mutableStateOf(true)
  var testID by mutableStateOf<String?>(null)

  val state = NitroUiControlledValue(false)
  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onDismissed: ((Boolean) -> Unit)? = null
  var owesDismissal = false

  val presentCount = AtomicInteger(0)
  val userDismissals = AtomicInteger(0)
  val unaskedExits = AtomicInteger(0)

  /** The Q1 sampler: what the popup window drew, frame by frame, px. */
  @Volatile var draws = 0
  @Volatile var firstDraw = "0x0"
  @Volatile var lastDraw = "0x0"
  @Volatile var drawSizes = ""
  @Volatile var drawTrace = ""
  @Volatile var composeAtMs = 0L
  @Volatile var firstDrawMs = -1L
  @Volatile var popupRect = "-"
  @Volatile var focused = 0

  fun applyDisplayed(): Boolean {
    val next = state.displayed
    if (next) owesDismissal = true
    if (next == presented) return false
    if (next) {
      generation += 1
      resetSampler()
    }
    presented = next
    return true
  }

  fun resetSampler() {
    draws = 0
    firstDraw = "0x0"
    lastDraw = "0x0"
    drawSizes = ""
    drawTrace = ""
    firstDrawMs = -1L
    composeAtMs = 0L
  }

  /** A tap outside or Back (`onDismissRequest`). */
  fun userDismissed() {
    if (!presented) return
    userDismissals.incrementAndGet()
    closeAsNative()
  }

  fun closedByWindowLoss() {
    if (!presented) return
    unaskedExits.incrementAndGet()
    closeAsNative()
  }

  private fun closeAsNative() {
    val count = state.user(false)
    applyDisplayed()
    onPresentedChange?.invoke(false, count.toDouble())
  }

  fun presentationEnded() {
    owesDismissal = state.displayed
    onDismissed?.invoke(true)
  }

  fun withdrawnWithNothingUp() {
    if (!owesDismissal || presented) return
    owesDismissal = false
    onDismissed?.invoke(false)
  }

  override fun reset() {
    presented = false
    contentWpx = 0
    contentHpx = 0
    maxWidth = 320.0
    sizeBeforePresent = true
    testID = null
    state.displayed = false
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    onPresentedChange = null
    onDismissed = null
    owesDismissal = false
    composed = false
    presentCount.set(0)
    userDismissals.set(0)
    unaskedExits.set(0)
    resetSampler()
    popupRect = "-"
  }

  companion object {
    val livePresentations = AtomicInteger(0)
    val liveRoots = AtomicInteger(0)
  }
}

internal class PopoverProtoHost(
  private val reactContext: ThemedReactContext,
  activity: Activity?,
  model: PopoverProtoModel,
) : NitroComposeHost<PopoverProtoModel>(reactContext, activity, model),
  ReactPointerEventsView {
  private val mainHandler = Handler(Looper.getMainLooper())
  var mountGeneration = 0
  private val children = ArrayList<View>()
  private var popupRoot: NitroUiSheetRootView? = null
  private var drawWatch: ViewTreeObserver.OnDrawListener? = null
  private var drawObserver: ViewTreeObserver? = null

  /** The content box is the first child: its layout is the popup's size. */
  private val contentListener =
    View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
      if (children.firstOrNull() === view) noteContentSize(view.width, view.height)
    }

  init {
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /** React Native's touch search skips this view: the anchor beside it takes the taps. */
  override val pointerEvents: PointerEvents
    get() = PointerEvents.NONE

  override val isHostable: Boolean
    get() = false

  // MARK: Children

  fun mountChild(
    child: View,
    index: Int,
  ) {
    val at = index.coerceIn(0, children.size)
    children.forEach { it.removeOnLayoutChangeListener(contentListener) }
    children.add(at, child)
    children.first().addOnLayoutChangeListener(contentListener)
    children.first().let { if (it.width > 0) noteContentSize(it.width, it.height) }
    popupRoot?.let { root ->
      (child.parent as? ViewGroup)?.removeView(child)
      root.addView(child, at.coerceIn(0, root.childCount))
    }
  }

  fun unmountChildAt(index: Int) {
    val child = children.getOrNull(index) ?: return
    child.removeOnLayoutChangeListener(contentListener)
    children.removeAt(index)
    (child.parent as? ViewGroup)?.removeView(child)
    children.firstOrNull()?.addOnLayoutChangeListener(contentListener)
  }

  fun childCountReported(): Int = children.size

  fun childAtReported(index: Int): View? = children.getOrNull(index)

  private fun noteContentSize(
    widthPx: Int,
    heightPx: Int,
  ) {
    if (widthPx == model.contentWpx && heightPx == model.contentHpx) return
    model.contentWpx = widthPx
    model.contentHpx = heightPx
    applyModelWrites()
  }

  // MARK: The popup's root

  fun obtainRoot(): NitroUiSheetRootView {
    popupRoot?.let { return it }
    val root =
      NitroUiSheetRootView(reactContext).apply {
        eventDispatcher = UIManagerHelper.getEventDispatcher(reactContext)
      }
    popupRoot = root
    PopoverProtoModel.liveRoots.incrementAndGet()
    for ((index, child) in children.withIndex()) {
      (child.parent as? ViewGroup)?.removeView(child)
      root.addView(child, index)
    }
    root.addOnAttachStateChangeListener(
      object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v: View) = watchDraws(v)

        override fun onViewDetachedFromWindow(v: View) = unwatchDraws()
      },
    )
    if (root.isAttachedToWindow) watchDraws(root)
    return root
  }

  fun releaseRoot(root: NitroUiSheetRootView) {
    if (popupRoot !== root) return
    popupRoot = null
    unwatchDraws()
    PopoverProtoModel.liveRoots.decrementAndGet()
    root.eventDispatcher = null
    for (child in children) {
      if (child.parent === root) root.removeView(child)
    }
  }

  /**
   * Q1's sampler: every frame the popup's window draws, its size (the window's root,
   * `PopupLayout`, which wraps the M3 surface) and the React Native root's.
   */
  private fun watchDraws(root: View) {
    unwatchDraws()
    val observer = root.viewTreeObserver
    val sizes = LinkedHashSet<String>()
    val trace = ArrayList<String>()
    val watch =
      ViewTreeObserver.OnDrawListener {
        val window = root.rootView
        if (window.width <= 0 || window.height <= 0) return@OnDrawListener
        val size = "${window.width}x${window.height}"
        model.draws += 1
        if (model.firstDrawMs < 0) {
          model.firstDraw = size
          model.firstDrawMs = SystemClock.uptimeMillis() - model.composeAtMs
        }
        model.lastDraw = size
        sizes.add(size)
        model.drawSizes = sizes.joinToString(",")
        if (trace.size < 8) {
          trace.add("$size/r${root.width}x${root.height}/a${"%.2f".format(window.alpha)}")
          model.drawTrace = trace.joinToString(",")
        }
        val at = IntArray(2)
        window.getLocationOnScreen(at)
        model.popupRect = "${at[0]},${at[1]},${window.width},${window.height}"
        model.focused = if (window.hasWindowFocus()) 1 else 0
      }
    observer.addOnDrawListener(watch)
    drawWatch = watch
    drawObserver = observer
  }

  private fun unwatchDraws() {
    val watch = drawWatch ?: return
    drawObserver?.takeIf { it.isAlive }?.removeOnDrawListener(watch)
    drawWatch = null
    drawObserver = null
  }

  fun resetMount() {
    popupRoot?.let { releaseRoot(it) }
    children.forEach { it.removeOnLayoutChangeListener(contentListener) }
    children.clear()
  }

  // MARK: Composition

  @Composable
  override fun Component(model: PopoverProtoModel) {
    if (!model.presented) return
    val sized = model.contentWpx > 0 && model.contentHpx > 0
    // Q1: compose the popup only once the content box has its size, unless the red-proof
    // knob says otherwise.
    if (model.sizeBeforePresent && !sized) return
    key(model.generation) {
      Witness(model)
      PopupContent(model)
    }
  }

  @Composable
  private fun Witness(model: PopoverProtoModel) {
    DisposableEffect(Unit) {
      PopoverProtoModel.livePresentations.incrementAndGet()
      model.presentCount.incrementAndGet()
      model.composed = true
      model.composeAtMs = SystemClock.uptimeMillis()
      onDispose {
        PopoverProtoModel.livePresentations.decrementAndGet()
        model.composed = false
        val generation = mountGeneration
        mainHandler.post {
          if (generation == mountGeneration) model.presentationEnded()
        }
      }
    }
  }

  @Composable
  private fun PopupContent(model: PopoverProtoModel) {
    val density = LocalDensity.current
    val spacingPx = with(density) { 4.dp.roundToPx() }
    val marginPx = with(density) { 16.dp.roundToPx() }
    val provider = remember(model) { AnchorPositionProvider(this, spacingPx, marginPx) }
    Popup(
      popupPositionProvider = provider,
      onDismissRequest = {
        model.userDismissed()
        applyModelWrites()
      },
      properties = PopupProperties(focusable = true),
    ) {
      // The red-proof arm (`sizeBeforePresent = false`): an estimated first size (the cap
      // x 48 dp) until the content's own size is used, 150 ms later - what a popup
      // measured before the root has its size does.
      var measured by remember { mutableStateOf(model.sizeBeforePresent) }
      LaunchedEffect(Unit) {
        if (!measured) {
          delay(150)
          measured = true
        }
      }
      val w = if (measured) model.contentWpx else with(density) { model.maxWidth.dp.roundToPx() }
      val h = if (measured) model.contentHpx else with(density) { 48.dp.roundToPx() }
      Surface(
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 3.dp,
        shadowElevation = 3.dp,
      ) {
        AndroidView(
          factory = { obtainRoot() },
          onRelease = { root -> releaseRoot(root) },
          modifier = Modifier.size(with(density) { w.toDp() }, with(density) { h.toDp() }),
        )
      }
    }
  }

  /** The wrapper's box - the anchor's - on screen, px. */
  fun anchorRect(): String {
    val wrapper = parent as? View ?: return "-"
    val at = IntArray(2)
    wrapper.getLocationOnScreen(at)
    return "${at[0]},${at[1]},${wrapper.width},${wrapper.height}"
  }

  fun wrapperSize(): IntSize {
    val wrapper = parent as? View ?: return IntSize(width, height)
    return IntSize(wrapper.width, wrapper.height)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    if (!model.presented) return
    val generation = mountGeneration
    mainHandler.post {
      if (generation != mountGeneration || isAttachedToWindow) return@post
      model.closedByWindowLoss()
      markDirty()
      commit()
    }
  }

  fun facts(): String {
    val density = resources.displayMetrics.density
    val root = popupRoot
    return "contentW=${Math.round(model.contentWpx / density)};contentH=${Math.round(model.contentHpx / density)}" +
      ";nodeW=${Math.round(width / density)};nodeH=${Math.round(height / density)}" +
      ";rootW=${Math.round((root?.width ?: 0) / density)};rootH=${Math.round((root?.height ?: 0) / density)}" +
      ";children=${children.size};inPopup=${children.count { root != null && it.parent === root }}" +
      ";density=$density;anchorRect=${anchorRect()}"
  }
}

/**
 * Below the anchor (the wrapper's box), start-aligned and kept inside the window; above
 * it when there is no room below. The anchor box is the host's own top-left - the host
 * sits at the wrapper's origin - with the wrapper's size.
 */
private class AnchorPositionProvider(
  private val host: PopoverProtoHost,
  private val spacingPx: Int,
  private val marginPx: Int,
) : PopupPositionProvider {
  override fun calculatePosition(
    anchorBounds: IntRect,
    windowSize: IntSize,
    layoutDirection: LayoutDirection,
    popupContentSize: IntSize,
  ): IntOffset {
    val box = host.wrapperSize()
    val anchor = IntRect(anchorBounds.left, anchorBounds.top, anchorBounds.left + box.width, anchorBounds.top + box.height)
    val maxX = max(marginPx, windowSize.width - popupContentSize.width - marginPx)
    val x = min(max(anchor.left, marginPx), maxX)
    val below = anchor.bottom + spacingPx
    val above = anchor.top - spacingPx - popupContentSize.height
    val y =
      if (below + popupContentSize.height <= windowSize.height - marginPx || above < marginPx) below else above
    return IntOffset(x, y)
  }
}

class HybridNitroUiPopoverProto(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiPopoverProtoSpec(), RecyclableView {
  private val model = PopoverProtoModel()
  private val mainHandler = Handler(Looper.getMainLooper())
  internal val host = PopoverProtoHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  override var presented: Boolean
    get() = model.state.js ?: false
    set(next) {
      model.state.js = next
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var maxWidth: Double
    get() = model.maxWidth
    set(next) {
      if (next != model.maxWidth) {
        model.maxWidth = next
        host.markDirty()
      }
    }

  override var sizeBeforePresent: Boolean
    get() = model.sizeBeforePresent
    set(next) {
      if (next != model.sizeBeforePresent) {
        model.sizeBeforePresent = next
        host.markDirty()
      }
    }

  override var testID: Variant_NullType_String
    get() = model.testID?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      model.testID = next.asSecondOrNull()
    }

  override var onPresentedChange: ((presented: Boolean, eventCount: Double) -> Unit)?
    get() = model.onPresentedChange
    set(next) {
      model.onPresentedChange = next
    }

  override var onDismissed: ((ended: Boolean) -> Unit)?
    get() = model.onDismissed
    set(next) {
      model.onDismissed = next
    }

  override fun afterUpdate() {
    model.state.reconcile()
    if (model.applyDisplayed()) host.markDirty()
    if (!model.state.displayed) model.withdrawnWithNothingUp()
    host.commit()
  }

  override fun prepareForRecycle() {
    host.mountGeneration += 1
    host.resetMount()
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onDismissed = null
    model.state.displayed = false
    model.applyDisplayed()
    host.drop()
  }

  private val reportSeq = AtomicInteger(0)

  /** The activity `LifecycleRegistry`'s observer count, read on main (it must be). */
  @Volatile private var lifecycleObservers = -1

  private fun readLifecycleObservers() {
    val registry = (reactContext.currentActivity as? LifecycleOwner)?.lifecycle as? LifecycleRegistry
    lifecycleObservers = registry?.observerCount ?: -1
  }

  override fun nuiTestStateReport(): String {
    // Refreshed on main for the next read, never waited for (JS never blocks on main):
    // a test that reads it polls, so it is at most one read behind.
    if (Looper.myLooper() == Looper.getMainLooper()) readLifecycleObservers() else mainHandler.post { readLifecycleObservers() }
    return "seq=${reportSeq.incrementAndGet()}" +
      ";presented=${if (model.state.displayed) 1 else 0};js=${if (model.state.js == true) 1 else 0}" +
      ";live=${PopoverProtoModel.livePresentations.get()};presentCount=${model.presentCount.get()}" +
      ";onScreen=${if (model.composed) 1 else 0};roots=${PopoverProtoModel.liveRoots.get()}" +
      ";${host.facts()}" +
      ";draws=${model.draws};firstDraw=${model.firstDraw};lastDraw=${model.lastDraw}" +
      ";drawSizes=${model.drawSizes};trace=${model.drawTrace};firstDrawMs=${model.firstDrawMs}" +
      ";popRect=${model.popupRect};windowFocused=${model.focused}" +
      ";lifecycleObservers=$lifecycleObservers" +
      ";userDismissals=${model.userDismissals.get()};unasked=${model.unaskedExits.get()}" +
      ";anchored=${if (host.isAttachedToWindow) 1 else 0}" +
      ";guards=${host.armedGuardsReport()}" +
      ";${host.lifetimeReport().replace(' ', ';')}"
  }

  override fun nuiTestDismiss() {
    val run = {
      model.userDismissed()
      host.applyModelWrites()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) run() else mainHandler.post { run() }
  }
}
