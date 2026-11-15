package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.ViewTreeObserver
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
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
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min

// A popup of React Native views anchored to a view the app lays out: a Compose `Popup`
// under a Material 3 `Surface`, placed below its anchor and clear of the keyboard.

internal class PopoverModel : NitroUiModel() {
  /** Whether the popover is presented: the handshake's `displayed`, as snapshot state. */
  var presented by mutableStateOf(false)
    private set

  /** Bumped per presentation, so a refused close composes a fresh popup. */
  var generation by mutableIntStateOf(0)
    private set

  /** The content box, px: the node's one child, as Fabric laid it out. */
  var contentWpx by mutableIntStateOf(0)
    private set

  var contentHpx by mutableIntStateOf(0)
    private set

  /**
   * The keyboard's height in px. It places nothing itself; it makes the keyboard part of what
   * the popup's composition observes, so an open popup is placed again when it changes.
   */
  var imeBottomPx by mutableIntStateOf(0)
    private set

  var maxWidth by mutableStateOf(0.0)
  var testID by mutableStateOf<String?>(null)

  /** `presented` behind the event-count handshake. */
  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onDismissed: ((Boolean) -> Unit)? = null
  var owesDismissal = false

  val presentCount = AtomicInteger(0)
  val userDismissals = AtomicInteger(0)
  val unaskedExits = AtomicInteger(0)

  /** What the popup's window drew, for tests. Written on the UI thread, read on the JS thread. */
  @Volatile var draws = 0
  @Volatile var firstDraw = "0x0"
  @Volatile var lastDraw = "0x0"
  @Volatile var drawSizes = ""
  @Volatile var firstDrawMs = -1L
  @Volatile var composeAtMs = 0L
  @Volatile var popupRect = "-"
  @Volatile var windowFocused = 0
  @Volatile var placed = 0
  @Volatile var placedAt = "-"
  /** How often a composition wanted the popup before the content box had a size. */
  @Volatile var contentWaits = 0

  /** Make the composition match [state]'s `displayed`. Returns whether it moved. */
  fun applyDisplayed(): Boolean {
    val next = state.displayed
    // From here the wrapper has content mounted and must be told when it can go, even for
    // a present that never reaches the screen because its box never gets a size.
    if (next) owesDismissal = true
    if (next == presented) {
      return false
    }
    if (next) {
      generation += 1
      resetWitnesses()
    }
    presented = next
    return true
  }

  /** The content box's px size, from Fabric's layout of the node's one child. */
  fun noteContentSize(
    widthPx: Int,
    heightPx: Int,
  ): Boolean {
    if (widthPx == contentWpx && heightPx == contentHpx) {
      return false
    }
    contentWpx = widthPx
    contentHpx = heightPx
    return true
  }

  /** The keyboard's height in the host's window, px. */
  fun noteImeBottom(heightPx: Int): Boolean {
    val next = max(0, heightPx)
    if (next == imeBottomPx) {
      return false
    }
    imeBottomPx = next
    return true
  }

  /** The position provider placed the popup: [placed] is how often, for a moving anchor. */
  fun notePlaced(
    x: Int,
    y: Int,
    size: IntSize,
  ) {
    placed += 1
    placedAt = "$x,$y,${size.width},${size.height}"
  }

  fun resetWitnesses() {
    draws = 0
    firstDraw = "0x0"
    lastDraw = "0x0"
    drawSizes = ""
    firstDrawMs = -1L
    composeAtMs = 0L
    popupRect = "-"
    placed = 0
    placedAt = "-"
    contentWaits = 0
  }

  /** A tap outside, or Back: the close the user caused. */
  fun userDismissed() {
    if (!presented) {
      return
    }
    userDismissals.incrementAndGet()
    closeAsNative()
  }

  /** The window under the popover went away while it was up, and this mount is still live. */
  fun closedByWindowLoss() {
    if (!presented) {
      return
    }
    unaskedExits.incrementAndGet()
    closeAsNative()
  }

  private fun closeAsNative() {
    val count = state.user(false)
    applyDisplayed()
    onPresentedChange?.invoke(false, count.toDouble())
  }

  /** A presentation ended, so the wrapper can unmount its content. */
  fun presentationEnded() {
    owesDismissal = state.displayed
    onDismissed?.invoke(true)
  }

  /** React withdrew a popover that never got up: the wrapper still has content mounted. */
  fun withdrawnWithNothingUp() {
    if (!owesDismissal || presented) {
      return
    }
    owesDismissal = false
    onDismissed?.invoke(false)
  }

  override fun reset() {
    presented = false
    maxWidth = 0.0
    testID = null
    contentWpx = 0
    contentHpx = 0
    imeBottomPx = 0
    state.displayed = false
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    onPresentedChange = null
    onDismissed = null
    owesDismissal = false
    presentCount.set(0)
    userDismissals.set(0)
    unaskedExits.set(0)
    resetWitnesses()
  }

  companion object {
    /**
     * Popups composed in this process right now, counted inside the popup's own content.
     * Process-wide, because a dropped mount has nothing left to report.
     */
    val livePresentations = AtomicInteger(0)

    /** How many React Native content roots are alive in a popover right now. */
    val liveRoots = AtomicInteger(0)
  }
}

/**
 * Draws nothing itself: it composes the popup. It is the logical parent of the React Native
 * children, which physically live in the popup's window.
 */
internal class PopoverHost(
  private val reactContext: ThemedReactContext,
  activity: Activity?,
  model: PopoverModel,
) : NitroComposeHost<PopoverModel>(reactContext, activity, model),
  ReactPointerEventsView {
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  /** The children in mount order - what Fabric's indices index into. */
  private val children = ArrayList<View>()

  /** The root in the popup's window, while there is one. */
  private var popupRoot: NitroUiSheetRootView? = null

  private var drawWatch: DrawWatch? = null

  /** The content box is the node's one child: its frame is the popover's size. */
  private val contentListener =
    View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
      if (children.firstOrNull() === view) {
        noteBox(view.width, view.height)
      }
    }

  init {
    // Nothing is drawn here, so this box is not an accessibility target.
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /** Never composed by a `<Host>`: its content is React Native views. */
  override val isHostable: Boolean
    get() = false

  /**
   * This view's box is the content's, which is shown in another window, so a touch here must
   * reach the app's views behind it. Only a [ReactPointerEventsView] can say so on Android.
   */
  override val pointerEvents: PointerEvents
    get() = PointerEvents.BOX_NONE

  // MARK: - The children, as Fabric sees them

  fun mountChild(
    child: View,
    index: Int,
  ) {
    val at = index.coerceIn(0, children.size)
    children.forEach { it.removeOnLayoutChangeListener(contentListener) }
    children.add(at, child)
    children.firstOrNull()?.let { box ->
      box.addOnLayoutChangeListener(contentListener)
      if (box.width > 0) {
        noteBox(box.width, box.height)
      }
    }
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

  private fun noteBox(
    widthPx: Int,
    heightPx: Int,
  ) {
    if (model.noteContentSize(widthPx, heightPx)) {
      applyModelWrites()
    }
    watchDraws()
  }

  fun resetMount() {
    popupRoot?.let { releaseRoot(it) }
    children.forEach { it.removeOnLayoutChangeListener(contentListener) }
    children.clear()
    model.resetWitnesses()
  }

  // MARK: - The popup's root

  /** Called by the `AndroidView` factory: creates the root and moves the children into it. */
  fun obtainRoot(): NitroUiSheetRootView {
    popupRoot?.let { return it }
    val root =
      NitroUiSheetRootView(reactContext).apply {
        eventDispatcher = UIManagerHelper.getEventDispatcher(reactContext)
      }
    popupRoot = root
    PopoverModel.liveRoots.incrementAndGet()
    for ((index, child) in children.withIndex()) {
      (child.parent as? ViewGroup)?.removeView(child)
      root.addView(child, index)
    }
    // The box is usually laid out before the popup composes, so no layout listener will
    // fire: arm the draw watch here.
    watchDraws()
    return root
  }

  /** The popup's window is going away: take the children out of its root. */
  fun releaseRoot(root: NitroUiSheetRootView) {
    if (popupRoot !== root) {
      return
    }
    popupRoot = null
    stopWatchingDraws()
    PopoverModel.liveRoots.decrementAndGet()
    root.eventDispatcher = null
    for (child in children) {
      if (child.parent === root) {
        root.removeView(child)
      }
    }
  }

  /** The wrapper's box - the anchor's - on screen, px: what the popup points at. */
  fun anchorRectOnScreen(): String {
    val wrapper = parent as? View ?: return "-"
    val at = IntArray(2)
    wrapper.getLocationOnScreen(at)
    return "${at[0]},${at[1]},${wrapper.width},${wrapper.height}"
  }

  fun anchorSize(): IntSize {
    val wrapper = parent as? View ?: return IntSize(width, height)
    return IntSize(wrapper.width, wrapper.height)
  }

  // MARK: - The first-frame witness

  /** Records each frame the popup's window draws. Armed only while a test reads reports. */
  fun watchDraws() {
    if (!HybridNitroUiPopover.reportsWanted || drawWatch != null) {
      return
    }
    val root = popupRoot ?: return
    val watch = DrawWatch(root) { window ->
      val size = "${window.width}x${window.height}"
      model.draws += 1
      if (model.firstDrawMs < 0) {
        model.firstDraw = size
        model.firstDrawMs = SystemClock.uptimeMillis() - model.composeAtMs
      }
      model.lastDraw = size
      val sizes = model.drawSizes.split(",").filter { it.isNotEmpty() }.toMutableList()
      if (!sizes.contains(size)) {
        sizes.add(size)
        model.drawSizes = sizes.joinToString(",")
      }
      val at = IntArray(2)
      window.getLocationOnScreen(at)
      model.popupRect = "${at[0]},${at[1]},${window.width},${window.height}"
      model.windowFocused = if (window.hasWindowFocus()) 1 else 0
    }
    watch.start()
    drawWatch = watch
  }

  private fun stopWatchingDraws() {
    drawWatch?.stop()
    drawWatch = null
  }

  // MARK: - Composition

  @Composable
  override fun Component(model: PopoverModel) {
    if (!model.presented) {
      return
    }
    // Compose the popup only once Yoga has laid the content box out, at that size, so its
    // first frame is its final size.
    if (model.contentWpx <= 0 || model.contentHpx <= 0) {
      model.contentWaits += 1
      return
    }
    key(model.generation) {
      Presentation(model)
    }
  }

  @OptIn(ExperimentalComposeUiApi::class)
  @Composable
  private fun Presentation(model: PopoverModel) {
    val density = LocalDensity.current
    val spacingPx = with(density) { 4.dp.roundToPx() }
    val marginPx = with(density) { 16.dp.roundToPx() }
    val widthPx = model.contentWpx
    val heightPx = model.contentHpx
    // Read here so this composition observes the keyboard. The provider is remembered,
    // and keying it on this value is what has an open popup placed again.
    val imePx = model.imeBottomPx
    val provider =
      remember(this, model, spacingPx, marginPx, imePx) {
        PopoverPositionProvider(this, model, spacingPx, marginPx)
      }
    Popup(
      popupPositionProvider = provider,
      onDismissRequest = {
        model.userDismissed()
        applyModelWrites()
      },
      properties =
        PopupProperties(
          // Focusable, so a `TextInput` inside gets the keyboard, and a press outside or Back
          // dismisses the popup.
          focusable = true,
          // The popup is exactly the content's box, not the platform's default popup width.
          usePlatformDefaultWidth = false,
        ),
    ) {
      PresentationWitness(model)
      KeyboardInsets(model)
      Surface(
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 3.dp,
        shadowElevation = 3.dp,
        modifier =
          Modifier
            .semantics { testTagsAsResourceId = true }
            .testTag(popoverTestTag(model.testID)),
      ) {
        AndroidView(
          factory = { obtainRoot() },
          onRelease = { root -> releaseRoot(root) },
          modifier =
            with(density) {
              Modifier.size(widthPx.toDp(), heightPx.toDp())
            },
        )
      }
    }
  }

  /** Counts the popup while its content is composed, and reports its end when it is disposed. */
  @Composable
  private fun PresentationWitness(model: PopoverModel) {
    DisposableEffect(Unit) {
      PopoverModel.livePresentations.incrementAndGet()
      model.presentCount.incrementAndGet()
      model.composeAtMs = SystemClock.uptimeMillis()
      watchDraws()
      onDispose {
        PopoverModel.livePresentations.decrementAndGet()
        val generation = mountGeneration
        mainHandler.post {
          if (generation == mountGeneration) {
            model.presentationEnded()
          }
        }
      }
    }
  }

  /**
   * Watches the keyboard so an open popup is placed again when it arrives or leaves. The
   * inset is read from the host's window: the popup's own window can report a smaller one.
   * `rootWindowInsets` is used because an ancestor may consume the dispatched inset.
   */
  @Composable
  private fun KeyboardInsets(model: PopoverModel) {
    val popupView = LocalView.current
    val hostView: View = this
    DisposableEffect(popupView, model, hostView) {
      // Platform APIs, because `androidx.core` is not on this module's compile classpath.
      // Both listeners return what they were given, so neither stops the dispatch.
      val observer =
        View.OnApplyWindowInsetsListener { view, incoming ->
          noteKeyboard(
            model,
            hostView.rootWindowInsets ?: view.rootWindowInsets ?: incoming
          )
          incoming
        }
      popupView.setOnApplyWindowInsetsListener(observer)
      hostView.setOnApplyWindowInsetsListener(observer)
      hostView.requestApplyInsets()
      noteKeyboard(model, hostView.rootWindowInsets)
      onDispose {
        popupView.setOnApplyWindowInsetsListener(null)
        hostView.setOnApplyWindowInsetsListener(null)
        if (model.noteImeBottom(0)) {
          applyModelWrites()
        }
      }
    }
  }

  private fun noteKeyboard(
    model: PopoverModel,
    insets: WindowInsets?,
  ) {
    // `WindowInsets.Type.ime()` is API 30; below it the keyboard is ignored.
    val imePx =
      if (insets != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        insets.getInsets(WindowInsets.Type.ime()).bottom
      } else {
        0
      }
    if (model.noteImeBottom(imePx)) {
      applyModelWrites()
    }
  }

  /**
   * Losing the window while presented closes the popover and reports it. One turn later, so
   * an unmount's `onDropView`, which must report nothing, or a reparent gets there first.
   */
  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stopWatchingDraws()
    if (!model.presented) {
      return
    }
    val generation = mountGeneration
    mainHandler.post {
      if (generation != mountGeneration || isAttachedToWindow) {
        return@post
      }
      model.closedByWindowLoss()
      markDirty()
      commit()
    }
  }

  /** What the composition and the root say, for the report. */
  fun facts(): String {
    val root = popupRoot
    val density = resources.displayMetrics.density.toDouble()
    return "contentW=${Math.round((root?.width ?: 0) / density)}" +
      ";contentH=${Math.round((root?.height ?: 0) / density)}" +
      ";nodeW=${Math.round(width / density)};nodeH=${Math.round(height / density)}" +
      ";children=${children.size};inPopup=${children.count { root != null && it.parent === root }}" +
      ";density=$density;anchorRect=${anchorRectOnScreen()}"
  }
}

/** `<testID>-popover` on the presented popup, as a tag uiautomator can find. */
private fun popoverTestTag(testID: String?): String =
  if (testID == null) {
    "nitro-ui-popover"
  } else {
    "$testID-popover"
  }

/**
 * An `OnDrawListener` with the observer it was added to: a detached view answers
 * `viewTreeObserver` with a new floating observer, which could not remove it.
 */
private class DrawWatch(
  private val root: View,
  private val onDraw: (View) -> Unit,
) {
  private var observer: ViewTreeObserver? = null

  private val listener =
    ViewTreeObserver.OnDrawListener {
      onDraw(root.rootView)
    }

  fun start() {
    stop()
    val live = root.viewTreeObserver
    if (!live.isAlive) {
      return
    }
    live.addOnDrawListener(listener)
    observer = live
  }

  fun stop() {
    observer?.takeIf { it.isAlive }?.removeOnDrawListener(listener)
    observer = null
  }
}

/** A box in px. Its own type because `android.graphics.Rect` is stubbed in JVM unit tests. */
internal data class PopoverFrame(
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
)

/**
 * The popup's placement as plain arithmetic, so it can be unit-tested. The frame is the host
 * window's visible display frame, both edges of it: it starts below the status bar and its
 * bottom is the keyboard's edge, so the keyboard must not be subtracted again.
 */
internal object PopoverPlacement {
  /**
   * Converts the visible display frame, which `View.getWindowVisibleDisplayFrame` gives in
   * screen coordinates, into the host window's coordinates, which the popup is placed in.
   * The two differ when the window is not at the screen's origin (split-screen, freeform).
   */
  fun windowFrame(
    frameLeft: Int,
    frameTop: Int,
    frameRight: Int,
    frameBottom: Int,
    windowLeft: Int,
    windowTop: Int,
  ): PopoverFrame =
    PopoverFrame(
      left = frameLeft - windowLeft,
      top = frameTop - windowTop,
      right = frameRight - windowLeft,
      bottom = frameBottom - windowTop,
    )

  /** All values are px in the host window's coordinates. Returns the popup's top edge. */
  fun placeTop(
    anchorTop: Int,
    anchorBottom: Int,
    contentHeight: Int,
    spacingPx: Int,
    marginPx: Int,
    frameTopPx: Int,
    frameBottomPx: Int,
  ): Int {
    val minTop = frameTopPx + marginPx
    val usableBottom = frameBottomPx - marginPx
    val below = anchorBottom + spacingPx
    val above = anchorTop - spacingPx - contentHeight
    return when {
      below + contentHeight <= usableBottom -> below
      // Flip above only if the popup then clears the keyboard: the anchor itself can be
      // behind it.
      above >= minTop && above + contentHeight <= usableBottom -> above
      // No room either way: sit as high as the frame allows, so the content stays reachable.
      else -> max(minTop, min(below, usableBottom - contentHeight))
    }
  }

  /** The popup's left edge: the anchor's, moved inside the frame. */
  fun placeLeft(
    anchorLeft: Int,
    contentWidth: Int,
    marginPx: Int,
    frameLeftPx: Int,
    frameRightPx: Int,
  ): Int =
    min(
      max(anchorLeft, frameLeftPx + marginPx),
      max(frameLeftPx + marginPx, frameRightPx - contentWidth - marginPx),
    )
}

/**
 * Below the anchor, start-aligned, kept inside the frame, and above the anchor when there
 * is no room below. The anchor is the wrapper's box; the host's own box is the content's.
 */
private class PopoverPositionProvider(
  private val host: PopoverHost,
  private val model: PopoverModel,
  private val spacingPx: Int,
  private val marginPx: Int,
) : PopupPositionProvider {
  /**
   * The host window's visible display frame, in that window's coordinates. Compose's
   * `windowSize` is this frame's size without its origin.
   */
  private fun visibleFrame(windowSize: IntSize): PopoverFrame {
    val frame = Rect()
    host.getWindowVisibleDisplayFrame(frame)
    if (frame.bottom <= frame.top || frame.right <= frame.left) {
      // A detached view answers with an empty rect; `windowSize` is all that is left.
      return PopoverFrame(0, 0, windowSize.width, windowSize.height)
    }
    val at = IntArray(2)
    host.rootView.getLocationOnScreen(at)
    return PopoverPlacement.windowFrame(
      frameLeft = frame.left,
      frameTop = frame.top,
      frameRight = frame.right,
      frameBottom = frame.bottom,
      windowLeft = at[0],
      windowTop = at[1],
    )
  }

  override fun calculatePosition(
    anchorBounds: IntRect,
    windowSize: IntSize,
    layoutDirection: LayoutDirection,
    popupContentSize: IntSize,
  ): IntOffset {
    val box = host.anchorSize()
    val anchor =
      IntRect(
        anchorBounds.left,
        anchorBounds.top,
        anchorBounds.left + box.width,
        anchorBounds.top + box.height,
      )
    val frame = visibleFrame(windowSize)
    val x =
      PopoverPlacement.placeLeft(
        anchorLeft = anchor.left,
        contentWidth = popupContentSize.width,
        marginPx = marginPx,
        frameLeftPx = frame.left,
        frameRightPx = frame.right,
      )
    val y =
      PopoverPlacement.placeTop(
        anchorTop = anchor.top,
        anchorBottom = anchor.bottom,
        contentHeight = popupContentSize.height,
        spacingPx = spacingPx,
        marginPx = marginPx,
        frameTopPx = frame.top,
        frameBottomPx = frame.bottom,
      )
    model.notePlaced(x, y, popupContentSize)
    return IntOffset(x, y)
  }
}

class HybridNitroUiPopover(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiPopoverSpec(), RecyclableView {
  private val model = PopoverModel()
  private val mainHandler = Handler(Looper.getMainLooper())

  internal val host = PopoverHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

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

  override var testID: Variant_NullType_String
    get() = model.testID?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value != model.testID) {
        model.testID = value
        host.markDirty()
      }
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
      }
    set(next) {
      host.perfInstanceId = next.asSecondOrNull()?.toInt() ?: NitroUiPerf.NO_INSTANCE
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

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The handshake decides whether React's `presented` wins. A close JS refused presents
    // the popover again.
    model.state.reconcile()
    if (model.applyDisplayed()) {
      host.markDirty()
    }
    if (!model.state.displayed) {
      model.withdrawnWithNothingUp()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.mountGeneration += 1
    host.resetMount()
    // Resets the model, which stops composing the window.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    // Callbacks go first, so nothing this teardown causes reaches JS for a finished mount.
    model.onPresentedChange = null
    model.onDismissed = null
    model.state.displayed = false
    model.applyDisplayed()
    host.drop()
  }

  // MARK: - Methods

  /** Bumped per report: Android builds each report as it is read, so every read is fresh. */
  private val reportSeq = AtomicInteger(0)

  /** The activity `LifecycleRegistry`'s observer count, read on the UI thread (it must be). */
  @Volatile private var lifecycleObservers = -1

  private fun readLifecycleObservers() {
    val registry = (reactContext.currentActivity as? LifecycleOwner)?.lifecycle as? LifecycleRegistry
    lifecycleObservers = registry?.observerCount ?: -1
  }

  override fun nuiTestStateReport(): String {
    HybridNitroUiPopover.noteReportWanted()
    if (Looper.myLooper() == Looper.getMainLooper()) {
      readLifecycleObservers()
    } else {
      mainHandler.post { readLifecycleObservers() }
    }
    val density = host.resources.displayMetrics.density.toDouble()
    return "seq=${reportSeq.incrementAndGet()}" +
      ";presented=${if (model.state.displayed) 1 else 0};js=${if (model.state.js == true) 1 else 0}" +
      ";live=${PopoverModel.livePresentations.get()};presentCount=${model.presentCount.get()}" +
      ";onScreen=${if (model.presented) 1 else 0};roots=${PopoverModel.liveRoots.get()}" +
      ";askedW=${Math.round(model.contentWpx / density)};askedH=${Math.round(model.contentHpx / density)}" +
      ";maxWidth=${Math.round(model.maxWidth)};imePx=${model.imeBottomPx}" +
      ";contentWaits=${model.contentWaits}" +
      ";placed=${model.placed};placedAt=${model.placedAt}" +
      ";${host.facts()}" +
      ";draws=${model.draws};firstDraw=${model.firstDraw};lastDraw=${model.lastDraw}" +
      ";drawSizes=${model.drawSizes};firstDrawMs=${model.firstDrawMs}" +
      ";popRect=${model.popupRect};windowFocused=${model.windowFocused}" +
      ";lifecycleObservers=$lifecycleObservers" +
      ";userDismissals=${model.userDismissals.get()};unasked=${model.unaskedExits.get()}" +
      ";anchored=${if (host.isAttachedToWindow) 1 else 0}" +
      ";guards=${host.armedGuardsReport()}" +
      ";${host.lifetimeReport().replace(' ', ';')}"
  }

  override fun nuiTestDismiss() {
    runOnUi {
      model.userDismissed()
      host.applyModelWrites()
    }
  }

  /** Run [action] on the UI thread, now if already there, queued otherwise. */
  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }

  companion object {
    /** Set by the first test report. Until then the per-frame draw watch is never armed. */
    @Volatile
    private var wantedReports = false

    val reportsWanted: Boolean
      get() = wantedReports

    fun noteReportWanted() {
      wantedReports = true
    }
  }
}
