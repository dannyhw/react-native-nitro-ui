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

/*
 * Popover (G22, DECISIONS D44): a popup whose content is React Native views, anchored to a
 * view the app lays out in place. Android has no popover control, so this is D38 item 1's
 * rule carried out: a Compose `Popup` - a window - under a Material 3 `Surface`, holding the
 * React Native content.
 *
 * The three things the shape turns on, all of them S5's measurements
 * (`docs/tasks/S5-popover-spike.report.md`):
 *
 * 1. **The box is Yoga's.** The JS wrapper makes this view as wide as the cap with
 *    `alignItems: 'flex-start'`, so its one child - the content box - gets the content's own
 *    width and height from Yoga. This file reads *that child's* frame and composes the popup
 *    at exactly that size, and only once it has one: a popup composed before then draws at
 *    one size and then at the real one (S5's red arm: 840x126, then 840x359).
 * 2. **The children are redirected, not copied.** `NitroUiPopoverViewManager` speaks to this
 *    host's child list, while the children physically live in [NitroUiSheetRootView] - React
 *    Native's `Modal` root, with its own `JSTouchDispatcher` - inside the popup's window.
 *    That is what gives the content its frames, its touches and its accessibility tree where
 *    the popup shows it.
 * 3. **The anchor is the wrapper, not this view.** The JS wrapper hugs the app's anchor
 *    element and this view is absolute at its origin, so the popup points at this view's
 *    parent - a view the component itself renders, never one it guessed at.
 *
 * D44 item 1 is [PopoverPositionProvider]: below the anchor, start-aligned, above it when
 * there is no room below, and clear of the keyboard. What it is placed against is the host
 * window's visible display frame - whose bottom edge *is* the keyboard's edge once the
 * keyboard is up - and [KeyboardInsets] is what has the open popup placed again when it moves.
 */

/** State of one popover. See [NitroUiModel] for the shape this has to have. */
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
   * The keyboard's height, px, as the host's window reports it (D44 item 1).
   *
   * It places nothing by itself: [PopoverPositionProvider] is placed against the frame the
   * keyboard has already moved. What it does is make the keyboard part of what the popup's
   * composition observes, so that an open popup is placed again - and carry the number into
   * [HybridNitroUiPopover.nuiTestStateReport], where a device run can see it.
   */
  var imeBottomPx by mutableIntStateOf(0)
    private set

  var maxWidth by mutableStateOf(0.0)
  var testID by mutableStateOf<String?>(null)

  /** `presented` behind the event-count handshake (`core.md` section 4). */
  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onDismissed: ((Boolean) -> Unit)? = null
  var owesDismissal = false

  val presentCount = AtomicInteger(0)
  val userDismissals = AtomicInteger(0)
  val unaskedExits = AtomicInteger(0)

  /**
   * What the popup's window drew, frame by frame - the first-frame witness. Written on the UI
   * thread and read from the JS thread by [HybridNitroUiPopover.nuiTestStateReport], so each
   * is `@Volatile` (`core.md` section 5).
   */
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
  /**
   * How often a composition asked for the popup before Yoga had laid the content box
   * out: Android's version of iOS's `contentWaits`, and the same honest number - a
   * present that went out at no size never counts here, it draws a wrong first frame.
   */
  @Volatile var contentWaits = 0

  /** Make the composition match [state]'s `displayed`. Returns whether it moved. */
  fun applyDisplayed(): Boolean {
    val next = state.displayed
    // React asked for a popover: from this turn the wrapper has content mounted for it, and it
    // has to be told that content can go - including a present that never gets on screen,
    // whose box never sizes and whose popup is therefore never composed. BottomSheet takes the
    // debt here (`HybridNitroUiBottomSheet.applyDisplayed`) and iOS's `sync()` does too; taken
    // only when a presentation ends, a popover opened and then withdrawn at a box that never
    // sized leaves its content mounted for good.
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
     * How many popover popups this process has composed right now: counted by a
     * `DisposableEffect` inside the popup's own content, so it returns to zero exactly when
     * nothing of a presentation is left - closed, dropped or recycled. Process-wide, because
     * a dropped mount has nothing left to report and a harness reads it through a fresh one.
     */
    val livePresentations = AtomicInteger(0)

    /** How many React Native content roots are alive in a popover right now. */
    val liveRoots = AtomicInteger(0)
  }
}

/**
 * The popover's Fabric view: a host that draws nothing, composes the popup, and is the
 * *logical* parent of the React Native children - the list Fabric's indices refer to while
 * [NitroUiPopoverViewManager] keeps their physical parent in the popup's window.
 */
internal class PopoverHost(
  private val reactContext: ThemedReactContext,
  activity: Activity?,
  model: PopoverModel,
) : NitroComposeHost<PopoverModel>(reactContext, activity, model),
  ReactPointerEventsView {
  /** Where a detach's deferred check runs. */
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
    // Nothing of the popover is drawn here, and this box is the content's, not a target.
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /** Never composed by a `<Host>`: its content is React Native views (`docs/components/host.md`). */
  override val isHostable: Boolean
    get() = false

  /**
   * React Native's own touch search skips this view: its box is the content's, which is on
   * screen in another window, and a touch landing where that box is must reach the app's own
   * children behind it. Only a [ReactPointerEventsView] can answer this on Android.
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

  /** The `AndroidView` factory's call: the root the children live in, with them moved into it. */
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
    // The box is normally laid out *before* the popup composes, so a layout listener is
    // not on its way: without asking here, the first-frame witness would never arm and
    // the run would report no draws for a popup that drew.
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

  /**
   * Every frame the popup's window draws, its size and where it sits - so a test can say "the
   * first frame was the final size" instead of asserting it. Only ever armed while a test is
   * reading reports ([HybridNitroUiPopover.reportsWanted]), so an app pays nothing.
   */
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
    // The popup is composed only once Yoga has laid the content box out, and at that box's
    // size: composing before then is the first-frame jump D44 exists to prevent.
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
    // Read here, not only inside the provider: the popup is placed again when the keyboard
    // changes, which needs the keyboard to be part of what this composition observes. The
    // provider is remembered, so a provider that only read the frame in `calculatePosition`
    // would never be asked again - and by the time this composition runs, the frame the
    // provider reads has moved with the keyboard.
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
          // Focusable, so a `TextInput` inside brings up the keyboard and real keystrokes
          // reach it - and so a press outside and Back are the popup's to answer (D44).
          focusable = true,
          // The popup is exactly the content's box, not the platform's preferred popup
          // width: that cap is what would make a wide popover's first frame one width and
          // its content another.
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

  /**
   * Count this popup for as long as its content is composed - the dialog's witness, inside the
   * popup so it counts the window rather than the presentation's intent. The wrapper's content
   * unmount rides on the same disposal: a popup that is gone is a presentation that ended,
   * whoever closed it.
   */
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
   * Watches the keyboard so that an open popup is placed again when it arrives or leaves
   * (D44 item 1).
   *
   * Nothing here computes where the popup goes: [PopoverPositionProvider.visibleFrame] reads
   * the frame the keyboard has already shrunk, which is the host window's own. What this
   * adds is the *change* - Compose places a popup again when the state its position provider
   * was built from moves, and the keyboard has to be part of that state or an open popup
   * stays where the screen was before the keys came up.
   *
   * The value is taken from the *host's* window rather than the popup's own. The popup's
   * window is the one the input method attaches to, so it is as good a signal that a keyboard
   * has arrived, but the insets it reports are its own: on the API 35 image it stopped 43 px
   * short of the settled inset - `WindowInsets.Type.ime()` there said 840 against the 883 the
   * activity's `InsetsState` published - so the host's are watched and trusted, which is also
   * the number the report carries. Both are watched, because whichever dispatches first
   * triggers the re-placement.
   *
   * `rootWindowInsets` is read rather than the dispatched argument because an ancestor that
   * consumes the ime inset would leave the argument reaching this view at zero.
   */
  @Composable
  private fun KeyboardInsets(model: PopoverModel) {
    val popupView = LocalView.current
    // The host view: this class, which lives in the window the popup is placed inside.
    val hostView: View = this
    DisposableEffect(popupView, model, hostView) {
      // Plain platform APIs, not `androidx.core`: this module does not put `androidx.core`
      // on its own compile classpath, and `View.setOnApplyWindowInsetsListener` is API 21.
      // Both listeners hand back what they were given, so neither stops the dispatch - they
      // are triggers, and the value they read is the host window's own.
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
    // `WindowInsets.Type.ime()` is API 30. Below it the popup is placed with the keyboard
    // ignored, which is what it did before D44 item 1 - and an emulator or a device running
    // API 30+ is where this is tested.
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
   * Losing the window while presented closes the popover and reports it, as a sheet's does -
   * one turn later, so an unmount's `onDropView` (which runs in the same mount batch, and
   * which must report *nothing*: D44 item 2) and a reparent that puts the view straight back
   * both get there first.
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
 * A `ViewTreeObserver.OnDrawListener` and the observer it went on: `getViewTreeObserver()`
 * hands a detached view a *new* floating observer, so the only handle on the one holding the
 * listener is the one taken when it went on (`NitroComposeHost`'s reason, same trap).
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

/**
 * A box in one coordinate space, in px.
 *
 * Its own type rather than `android.graphics.Rect` because [PopoverPlacement] is the subject
 * of a JVM unit test and the platform's `Rect` is a stubbed method body under plain JUnit;
 * rather than Compose's `IntRect` because this is not a geometry the composition sees, it is
 * one box the position provider converts on the way in.
 */
internal data class PopoverFrame(
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
)

/**
 * The popup's placement, as arithmetic rather than as Compose state.
 *
 * Three branches decide whether a `TextInput` inside the popover ends up above the keyboard
 * or under it, which is the one part of D44 item 1 a device run can only read after the
 * fact. `PopoverPlacementTest` runs the fixtures the harness measures, including the one the
 * first version got wrong: an anchor that is itself behind the keyboard, where flipping the
 * popup above the anchor still left its lower edge under the keys.
 *
 * Both edges of the frame are parameters rather than one height, because the coordinates this
 * answers in are the host window's own while the region a popup may fill inside them is that
 * window's *visible display frame*: it starts below the status bar and stops at the keyboard.
 * The size of that frame is what Compose hands the position provider as `windowSize`, and its
 * origin is what that size throws away. Subtracting the keyboard from the size counted the
 * keyboard twice - the frame has already lost it - and put the popup a status bar's height too
 * high, where the window manager pinned it to the top of the screen and left a thousand pixels
 * of room unused (measured on the API 35 emulator, G22: keyboard up, `windowSize.height` 1399
 * of a 2424 px screen, frame [142..1541], keyboard edge exactly the frame's bottom).
 */
internal object PopoverPlacement {
  /**
   * The host window's visible display frame, in the coordinates the popup is placed in.
   *
   * The two are different spaces, and only a host window at the screen's origin hides it:
   * `View.getWindowVisibleDisplayFrame` answers in *screen* coordinates, while Compose hands
   * the position provider an `anchorBounds` from `LayoutCoordinates.positionInWindow` and
   * puts this function's answer in the popup window's `LayoutParams`, measured from the host
   * window's own top-left (`PopupLayout.updatePosition`). Every fixture in this repo has the
   * host at (0, 0), where the two spaces read the same number; a host in split-screen or a
   * freeform window does not, and there the unconverted frame sits a whole window's height
   * below where the popup can go - it lets the popup hang past the bottom of the window it
   * belongs to and stops treating that window's keyboard edge as an edge at all.
   *
   * @param frameLeft the frame's left edge, in screen coordinates
   * @param frameTop the frame's top edge, in screen coordinates
   * @param frameRight the frame's right edge, in screen coordinates
   * @param frameBottom the frame's bottom edge, in screen coordinates
   * @param windowLeft where the host window starts on screen, px
   * @param windowTop where that window starts vertically, px
   * @returns the same box in the host window's coordinates
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

  /**
   * @param anchorTop the anchor's top edge, in the host window's coordinates
   * @param anchorBottom the anchor's bottom edge
   * @param contentHeight the height the popup was composed at
   * @param spacingPx the gap kept between the anchor and the popup
   * @param marginPx how far inside the frame's edges the popup may not cross
   * @param frameTopPx where the frame the popup may use starts, in the same coordinates
   * @param frameBottomPx where it ends - the keyboard's own edge once the keyboard is up
   * @returns the popup's top edge
   */
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
      // Flipping above the anchor is only an answer while the keyboard leaves the popup's
      // lower edge alone. The anchor can be behind the keyboard itself - the field that
      // raised it usually is - and then the flip parks the content under the keys.
      above >= minTop && above + contentHeight <= usableBottom -> above
      // Neither placement has the room: sit as high as the frame allows. Android gives the
      // popup the height it asked for, so the alternative is content the user cannot reach
      // at all.
      else -> max(minTop, min(below, usableBottom - contentHeight))
    }
  }

  /**
   * The popup's left edge: the anchor's, moved inside the frame.
   *
   * @param anchorLeft the anchor's left edge, in the host window's coordinates
   * @param contentWidth the width the popup was composed at
   * @param marginPx how far inside the frame's edges the popup may not cross
   * @param frameLeftPx where the frame starts horizontally
   * @param frameRightPx where it ends
   */
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
 * Below the anchor, start-aligned, kept inside the frame, and above the anchor when there is
 * no room below - where "room below" is the room left *after* the keyboard, which is what
 * moves a popover sitting under a keyboard up above its anchor instead (D44 item 1).
 *
 * The anchor box is [PopoverHost.anchorSize] at the popup's anchor point: the wrapper's box,
 * which is what hugs the app's anchor element. The host's own box is the *content's*, so it
 * is never the anchor.
 */
private class PopoverPositionProvider(
  private val host: PopoverHost,
  private val model: PopoverModel,
  private val spacingPx: Int,
  private val marginPx: Int,
) : PopupPositionProvider {
  /**
   * The frame the popup may use, read from the host view rather than from [windowSize].
   *
   * It is the same frame Compose measures `windowSize` from - `PopupLayout` asks the host's
   * window for its visible display frame and keeps only the size - and the platform puts a
   * popup window inside that frame, so it is the one edge worth placing against: with the
   * keyboard up its bottom *is* the keyboard's edge ([0,142]..[1080,1541] measured on the API
   * 35 emulator, [0,142]..[1080,2361] with the keyboard away). A view that is not attached
   * answers with an empty rect, and then the size Compose chose is the only thing left to go
   * on, taken from the window's own top edge.
   */
  private fun visibleFrame(windowSize: IntSize): PopoverFrame {
    val frame = Rect()
    host.getWindowVisibleDisplayFrame(frame)
    if (frame.bottom <= frame.top || frame.right <= frame.left) {
      // A view that is not attached answers with an empty rect, and `windowSize` - the
      // frame's size, which Compose measured from the same window - is all that is left. It
      // is already in the window's own coordinates, so it needs no conversion.
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

/** The Popover's Hybrid View: the props, the handshake, and the popup's lifetime. */
class HybridNitroUiPopover(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiPopoverSpec(), RecyclableView {
  private val model = PopoverModel()
  private val mainHandler = Handler(Looper.getMainLooper())

  /** The Nitro `view` - created once here and never replaced. */
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
    // The handshake decides whether React's `presented` wins - including a close JS refused,
    // which presents the popover again (D33).
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
    // `host.prepareForRecycle()` resets the model, which stops composing the window - and
    // `onDropView` already disposed the composition that held it.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    // A popup must not outlive the mount that opened it. Callbacks go first, so nothing this
    // teardown causes can reach JS for a mount React has finished with - the drop rule D44
    // item 2 gives Popover with BottomSheet's.
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
    /**
     * Whether any test has ever asked for a report. Until one has, the per-frame draw witness
     * is never armed, so a shipped app pays nothing for it (BottomSheet's rule).
     */
    @Volatile
    private var wantedReports = false

    /** Whether a test has read a report, which is what arms the draw witness. */
    val reportsWanted: Boolean
      get() = wantedReports

    fun noteReportWanted() {
      wantedReports = true
    }
  }
}
