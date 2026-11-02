package com.margelo.nitro.nitroui

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.rememberNestedScrollInteropConnection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.facebook.react.bridge.ReactContext
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.uimanager.JSPointerDispatcher
import com.facebook.react.uimanager.JSTouchDispatcher
import com.facebook.react.uimanager.RootView
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.EventDispatcher
import com.facebook.react.views.view.ReactViewGroup
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/*
 * BottomSheet (G14, DECISIONS D33/D35): Material 3's `ModalBottomSheet` whose content is
 * React Native views.
 *
 * The sheet is a window composed by the host's own composition - the machinery the
 * dialogs proved (G11): disposing the composition takes the window down with the mount.
 * What is new is the content. Fabric mounts the BottomSheet's children through
 * [NitroUiBottomSheetViewManager], whose `addView` redirects them into a
 * [NitroUiSheetRootView] - a copy of React Native's own `Modal` root
 * (`ReactModalHostView.DialogRootViewGroup`): a `RootView` with a touch dispatcher of its
 * own, because no `ReactRootView` is above it in the sheet's window. The root sits in the
 * sheet as an `AndroidView` (S2, `docs/tasks/S2-bottomsheet-spike.report.md`).
 *
 * Material's sheet has two rest positions, so the detents map as DECISIONS D33 settled:
 * `medium` is `PartiallyExpanded`, and the largest other detent is `Expanded`.
 */

/** State of one sheet. See [NitroUiModel] for the shape this has to have. */
internal class BottomSheetModel : NitroUiModel() {
  /** Whether the sheet is composed: the handshake's `displayed`, mirrored into snapshot state. */
  var presented by mutableStateOf(false)
    private set

  /** Whether a closed sheet is still animating out (`sheetState.hide()` before it stops composing). */
  var closing by mutableStateOf(false)

  /** Whether a sheet window is in the composition right now (the witness says so). */
  @Volatile var composed = false

  /** Bumped per presentation, so a sheet presented again is a fresh window. */
  var generation by mutableIntStateOf(0)
    private set

  var detents by mutableStateOf<List<NitroUiSheetDetent>>(listOf(NitroUiSheetDetent("fit", 0.0)))
  var dismissible by mutableStateOf(true)
  var showsGrabber by mutableStateOf(true)
  var cornerRadius by mutableStateOf<Double?>(null)
  var containerColor by mutableStateOf<Int?>(null)
  var label by mutableStateOf<String?>(null)
  var testID by mutableStateOf<String?>(null)

  /** The content's height for `fit`, in px: the BottomSheet node's own height, which Yoga took from the children. */
  var fitHeightPx by mutableIntStateOf(0)

  /** `presented` behind the event-count handshake (`core.md` section 4). */
  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onDetentChange: ((Double) -> Unit)? = null
  var onDismissed: ((Boolean) -> Unit)? = null
  var onContentBox: ((Double, Double) -> Unit)? = null

  /** React asked for the sheet since the wrapper was last told its content can go. */
  var owesDismissal = false

  /** How many sheet windows this mount composed. */
  val presentCount = AtomicInteger(0)
  val userDismissals = AtomicInteger(0)
  val unaskedExits = AtomicInteger(0)

  /** What the composition last saw, for the report. Written on the UI thread. */
  @Volatile var sheetValue = "none"
  @Volatile var selected = 0
  @Volatile var boxReport = "boxW=0;boxH=0"

  /** Make the composition match [state]'s `displayed`. Returns whether it moved. */
  fun applyDisplayed(): Boolean {
    val next = state.displayed
    if (next) owesDismissal = true
    if (next == presented) {
      return false
    }
    if (next) {
      closing = false
      generation += 1
    } else {
      // Keep the sheet composed while it animates out; the sheet clears this when its
      // `hide()` returns. A sheet that never got a window (asked for while its view had
      // none) has nothing to animate.
      closing = composed
    }
    presented = next
    return true
  }

  /** Material asked to dismiss: a swipe down, the back gesture or a tap on the scrim. */
  fun userDismissed() {
    if (!presented || !dismissible) {
      return
    }
    userDismissals.incrementAndGet()
    userClosed(animate = false)
  }

  /** The sheet's place in the app went away while it was up (its view left the window). */
  fun closedByWindowLoss() {
    if (!presented) {
      return
    }
    unaskedExits.incrementAndGet()
    userClosed(animate = false)
  }

  private fun userClosed(animate: Boolean) {
    val count = state.user(false)
    applyDisplayed()
    if (!animate) {
      // Material has hidden the sheet already (or there is no window to animate in).
      closing = false
    }
    onPresentedChange?.invoke(false, count.toDouble())
  }

  /** A presentation ended: the window left the composition. */
  fun presentationEnded() {
    owesDismissal = state.displayed
    onDismissed?.invoke(true)
  }

  /** React withdrew a sheet with nothing on screen (see the spec's `onDismissed`). */
  fun withdrawnWithNothingUp() {
    if (!owesDismissal || presented || closing) return
    owesDismissal = false
    onDismissed?.invoke(false)
  }

  override fun reset() {
    presented = false
    closing = false
    detents = listOf(NitroUiSheetDetent("fit", 0.0))
    dismissible = true
    showsGrabber = true
    cornerRadius = null
    containerColor = null
    label = null
    testID = null
    fitHeightPx = 0
    state.displayed = false
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    onPresentedChange = null
    onDetentChange = null
    onDismissed = null
    onContentBox = null
    owesDismissal = false
    composed = false
    presentCount.set(0)
    userDismissals.set(0)
    unaskedExits.set(0)
    sheetValue = "none"
    selected = 0
    boxReport = "boxW=0;boxH=0"
  }

  companion object {
    /**
     * How many sheet windows this process has composed right now, counted by a
     * `DisposableEffect` in the subtree that composes the window - the dialogs' witness.
     */
    val livePresentations = AtomicInteger(0)

    /** How many [NitroUiSheetRootView]s are alive in a sheet right now. */
    val liveRoots = AtomicInteger(0)
  }
}

/**
 * The view the React Native children live in, inside the sheet's window: React Native's
 * `DialogRootViewGroup` with the state push taken out (the box goes to JS instead) and
 * its size driven by Compose.
 */
internal class NitroUiSheetRootView(
  context: Context,
) : ReactViewGroup(context), RootView {
  var eventDispatcher: EventDispatcher? = null

  /** This view's size changed, in px. */
  var onSizeReport: ((Int, Int) -> Unit)? = null

  private val jsTouchDispatcher = JSTouchDispatcher(this)
  private var jsPointerDispatcher: JSPointerDispatcher? = null

  init {
    if (ReactFeatureFlags.dispatchPointerEvents) {
      jsPointerDispatcher = JSPointerDispatcher(this)
    }
  }

  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w != oldw || h != oldh) onSizeReport?.invoke(w, h)
  }

  /**
   * Compose's `AndroidView` measures this with the constraints the sheet gave it; the
   * children's frames are Fabric's, so nothing here measures them.
   */
  override fun onMeasure(
    widthMeasureSpec: Int,
    heightMeasureSpec: Int,
  ) {
    setMeasuredDimension(
      resolveSize(suggestedMinimumWidth, widthMeasureSpec),
      resolveSize(suggestedMinimumHeight, heightMeasureSpec),
    )
  }

  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    // Fabric lays the children out (`needsCustomLayoutForChildren() == false`).
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    eventDispatcher?.let { dispatcher ->
      jsTouchDispatcher.handleTouchEvent(event, dispatcher, context as ReactContext)
      jsPointerDispatcher?.handleMotionEvent(event, dispatcher, true)
    }
    return super.onInterceptTouchEvent(event)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    eventDispatcher?.let { dispatcher ->
      jsTouchDispatcher.handleTouchEvent(event, dispatcher, context as ReactContext)
      jsPointerDispatcher?.handleMotionEvent(event, dispatcher, false)
    }
    super.onTouchEvent(event)
    // Keep the stream, the way RN's modal root does: without this a root with no
    // gesture-hungry child stops receiving the MOVEs a `Pressable` still needs.
    return true
  }

  override fun handleException(t: Throwable) {
    (context as ThemedReactContext).reactApplicationContext.handleException(RuntimeException(t))
  }

  /** A child took the gesture (a `ScrollView` began to scroll): JS gets a CANCEL. */
  override fun onChildStartedNativeGesture(
    childView: View?,
    ev: MotionEvent,
  ) {
    eventDispatcher?.let { jsTouchDispatcher.onChildStartedNativeGesture(ev, it) }
  }

  override fun onChildStartedNativeGesture(ev: MotionEvent) {
    onChildStartedNativeGesture(null, ev)
  }

  override fun onChildEndedNativeGesture(
    childView: View,
    ev: MotionEvent,
  ) {
    eventDispatcher?.let { jsTouchDispatcher.onChildEndedNativeGesture(ev, it) }
  }
}

/**
 * The BottomSheet's Fabric view: a `0 x 0`-drawing host whose composition composes the
 * sheet, and the *logical* parent of the React Native children - the list Fabric's
 * indices refer to. Physically the children are in [NitroUiSheetRootView] while the
 * sheet is up, and in no view at all otherwise (they are only mounted while it is up).
 */
internal class BottomSheetHost(
  private val reactContext: ThemedReactContext,
  activity: Activity?,
  model: BottomSheetModel,
) : NitroComposeHost<BottomSheetModel>(reactContext, activity, model) {
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  /** The children in mount order - what Fabric's indices index into. */
  private val children = ArrayList<View>()

  /** The root in the sheet's window, while there is one. */
  private var sheetRoot: NitroUiSheetRootView? = null

  private var lastBoxWidthPx = -1
  private var lastBoxHeightPx = -1

  init {
    // Nothing of the sheet is drawn here, and this box is the content's, not a target.
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /** Never composed by a `<Host>`: its content is React Native views (`docs/components/host.md`). */
  override val isHostable: Boolean
    get() = false

  // MARK: - The children, as Fabric sees them

  fun mountChild(
    child: View,
    index: Int,
  ) {
    val at = index.coerceIn(0, children.size)
    children.add(at, child)
    sheetRoot?.let { root ->
      (child.parent as? ViewGroup)?.removeView(child)
      root.addView(child, at.coerceIn(0, root.childCount))
    }
  }

  fun unmountChildAt(index: Int) {
    val child = children.getOrNull(index) ?: return
    children.removeAt(index)
    (child.parent as? ViewGroup)?.removeView(child)
  }

  fun childCountReported(): Int = children.size

  fun childAtReported(index: Int): View? = children.getOrNull(index)

  /** How many of the children are in the sheet's window right now. */
  fun childrenInSheet(): Int = children.count { sheetRoot != null && it.parent === sheetRoot }

  // MARK: - The sheet's root

  /** The `AndroidView` factory's call: the root the children live in, with them moved into it. */
  fun obtainSheetRoot(): NitroUiSheetRootView {
    sheetRoot?.let { return it }
    val root =
      NitroUiSheetRootView(reactContext).apply {
        eventDispatcher = UIManagerHelper.getEventDispatcher(reactContext)
        onSizeReport = { width, height -> reportBox(width, height) }
      }
    sheetRoot = root
    BottomSheetModel.liveRoots.incrementAndGet()
    for ((index, child) in children.withIndex()) {
      (child.parent as? ViewGroup)?.removeView(child)
      root.addView(child, index)
    }
    return root
  }

  /** The sheet's window is going away: take the children out of it. */
  fun releaseSheetRoot(root: NitroUiSheetRootView) {
    if (sheetRoot !== root) return
    sheetRoot = null
    BottomSheetModel.liveRoots.decrementAndGet()
    root.onSizeReport = null
    root.eventDispatcher = null
    for (child in children) {
      if (child.parent === root) root.removeView(child)
    }
  }

  /** The content's box, in dp: the sheet's width, and its height when there is no `fit`. */
  private fun reportBox(
    widthPx: Int,
    heightPx: Int,
  ) {
    if (widthPx <= 0) return
    if (widthPx == lastBoxWidthPx && heightPx == lastBoxHeightPx) return
    lastBoxWidthPx = widthPx
    lastBoxHeightPx = heightPx
    val density = resources.displayMetrics.density.toDouble()
    val width = widthPx / density
    val height = heightPx / density
    model.boxReport = "boxW=${Math.round(width)};boxH=${Math.round(height)}"
    model.onContentBox?.invoke(width, height)
  }

  /** The node's own height is the `fit` height: Yoga took it from the children. */
  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (h != model.fitHeightPx) {
      model.fitHeightPx = h
      // A layout pass, not a props batch: nothing else will apply the write.
      applyModelWrites()
    }
  }

  /** Forget everything a mount left (recycle). */
  fun resetMount() {
    lastBoxWidthPx = -1
    lastBoxHeightPx = -1
    sheetRoot?.let { releaseSheetRoot(it) }
    children.clear()
  }

  // MARK: - Composition

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  override fun Component(model: BottomSheetModel) {
    if (!(model.presented || model.closing)) return
    key(model.generation) {
      SheetWitness(model)
      Sheet(model)
    }
  }

  /** Count the window for as long as the composition that opened it lives. */
  @Composable
  private fun SheetWitness(model: BottomSheetModel) {
    DisposableEffect(Unit) {
      BottomSheetModel.livePresentations.incrementAndGet()
      model.presentCount.incrementAndGet()
      model.composed = true
      onDispose {
        BottomSheetModel.livePresentations.decrementAndGet()
        model.sheetValue = "none"
        model.composed = false
        // Posted: a callback from inside a composition's disposal must not re-enter it.
        // Keyed to the mount, so a drop's disposal can never report into the mount a
        // recycled host serves next.
        val generation = mountGeneration
        mainHandler.post {
          if (generation == mountGeneration) model.presentationEnded()
        }
      }
    }
  }

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  private fun Sheet(model: BottomSheetModel) {
    val detents = model.detents
    val hasMedium = detents.any { it.kind == "medium" }
    val expanded = expandedDetent(detents, model.fitHeightPx)
    val dismissible = model.dismissible
    // One instance for the whole presentation: `rememberModalBottomSheetState` keys its
    // saved state on this lambda, so a fresh one per recomposition - the content's box
    // arriving, a `fit` height moving - built a new, hidden `SheetState` and the sheet
    // took itself down. It reads the model when Material asks, not when it was made.
    val confirmValueChange =
      remember(model) {
        { value: SheetValue -> value != SheetValue.Hidden || model.dismissible || !model.presented }
      }
    val sheetState =
      rememberModalBottomSheetState(
        skipPartiallyExpanded = !hasMedium || expanded == null,
        confirmValueChange = confirmValueChange,
      )
    val presented = model.presented
    LaunchedEffect(presented) {
      if (!presented) {
        try {
          sheetState.hide()
        } finally {
          model.closing = false
        }
      }
    }
    DetentReporter(model, sheetState, detents, expanded)
    TestSeam(sheetState, detents, canPartiallyExpand = hasMedium && expanded != null)
    val radius = model.cornerRadius
    val color = model.containerColor
    ModalBottomSheet(
      onDismissRequest = { model.userDismissed() },
      modifier = Modifier.sheetTestTag(model.testID).semantics { model.label?.let { paneTitle = it } },
      sheetState = sheetState,
      shape = radius?.let { RoundedCornerShape(topStart = it.dp, topEnd = it.dp) } ?: BottomSheetDefaults.ExpandedShape,
      containerColor = color?.let { ComposeColor(it) } ?: BottomSheetDefaults.ContainerColor,
      dragHandle =
        if (model.showsGrabber) {
          { BottomSheetDefaults.DragHandle() }
        } else {
          null
        },
      properties =
        ModalBottomSheetProperties(
          shouldDismissOnBackPress = dismissible,
          shouldDismissOnClickOutside = dismissible,
        ),
    ) {
      val interop = rememberNestedScrollInteropConnection()
      val density = LocalDensity.current
      val sizing =
        when {
          // Only `medium`: half the sheet, expanded - Material has no other way to rest
          // there without a taller detent above it.
          expanded == null -> Modifier.fillMaxHeight(0.5f)
          expanded.kind == "fit" -> Modifier.height(with(density) { model.fitHeightPx.toDp() })
          expanded.kind == "height" -> Modifier.height(expanded.value.dp)
          expanded.kind == "fraction" -> Modifier.fillMaxHeight(expanded.value.toFloat().coerceIn(0.01f, 1f))
          else -> Modifier.fillMaxHeight()
        }
      AndroidView(
        factory = { obtainSheetRoot() },
        onRelease = { root -> releaseSheetRoot(root) },
        modifier = Modifier.fillMaxWidth().then(sizing).nestedScroll(interop),
      )
    }
  }

  /**
   * Report a drag to another detent: `PartiallyExpanded` is `medium`, `Expanded` the
   * expanded detent. The value the sheet first settles at is not a change.
   */
  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  private fun DetentReporter(
    model: BottomSheetModel,
    sheetState: SheetState,
    detents: List<NitroUiSheetDetent>,
    expanded: NitroUiSheetDetent?,
  ) {
    LaunchedEffect(sheetState, detents, expanded) {
      snapshotFlow { sheetState.currentValue }
        .distinctUntilChanged()
        .filter { it != SheetValue.Hidden }
        .drop(1)
        .collect { value ->
          val index = indexOf(value, detents, expanded)
          model.selected = index
          model.onDetentChange?.invoke(index.toDouble())
        }
    }
    LaunchedEffect(sheetState) {
      snapshotFlow { sheetState.currentValue }.collect { value ->
        model.sheetValue = value.name
        if (value != SheetValue.Hidden) model.selected = indexOf(value, detents, expanded)
      }
    }
  }

  /** Where `nuiTestSelectDetent` reaches the sheet: the same state calls a drag ends in. */
  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  private fun TestSeam(
    sheetState: SheetState,
    detents: List<NitroUiSheetDetent>,
    canPartiallyExpand: Boolean,
  ) {
    val scope = rememberCoroutineScope()
    DisposableEffect(sheetState) {
      selectDetent = { index ->
        val detent = detents.getOrNull(index)
        if (detent != null) {
          scope.launch {
            if (detent.kind == "medium" && canPartiallyExpand) {
              sheetState.partialExpand()
            } else {
              sheetState.expand()
            }
          }
        }
      }
      onDispose { selectDetent = null }
    }
  }

  /** The test seam's way into the composed sheet, while one is composed. */
  var selectDetent: ((Int) -> Unit)? = null

  @OptIn(ExperimentalMaterial3Api::class)
  private fun indexOf(
    value: SheetValue,
    detents: List<NitroUiSheetDetent>,
    expanded: NitroUiSheetDetent?,
  ): Int {
    if (value == SheetValue.PartiallyExpanded || expanded == null) {
      return detents.indexOfFirst { it.kind == "medium" }.coerceAtLeast(0)
    }
    return detents.indexOf(expanded).coerceAtLeast(0)
  }

  /**
   * The detent Material's `Expanded` stands for: the largest that is not `medium`, or
   * `null` when `medium` is all there is (DECISIONS D33). Ranked by the height each
   * would ask for, against the screen - `large` always wins.
   */
  private fun expandedDetent(
    detents: List<NitroUiSheetDetent>,
    fitHeightPx: Int,
  ): NitroUiSheetDetent? {
    val metrics = resources.displayMetrics
    val screen = metrics.heightPixels.toDouble()
    return detents
      .filter { it.kind != "medium" }
      .maxByOrNull { detent ->
        when (detent.kind) {
          "large" -> Double.MAX_VALUE
          "fraction" -> detent.value * screen
          "height" -> detent.value * metrics.density
          else -> fitHeightPx.toDouble()
        }
      }
  }

  /**
   * Losing the window while presented closes the sheet and reports it, as iOS does and
   * as the dialogs do: one turn later, so an unmount's `onDropView` and a reparent that
   * puts the view straight back both get there first.
   */
  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
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
    val root = sheetRoot
    val density = resources.displayMetrics.density
    return "contentW=${Math.round((root?.width ?: 0) / density)};contentH=${Math.round((root?.height ?: 0) / density)}" +
      ";hostH=${Math.round(height / density)};children=${children.size};inSheet=${childrenInSheet()}" +
      ";focused=${if (root?.hasWindowFocus() == true) 1 else 0}"
  }
}

/** `<testID>-sheet` on the presented sheet, as a resource id uiautomator can find. */
@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.sheetTestTag(testID: String?): Modifier =
  if (testID == null) {
    this
  } else {
    this.semantics { testTagsAsResourceId = true }.testTag("$testID-sheet")
  }

class HybridNitroUiBottomSheet(
  reactContext: ThemedReactContext,
) : HybridNitroUiBottomSheetSpec(), RecyclableView {
  private val model = BottomSheetModel()
  private val mainHandler = Handler(Looper.getMainLooper())
  internal val host = BottomSheetHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
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

  override var detents: Array<NitroUiSheetDetent>
    get() = model.detents.toTypedArray()
    set(next) {
      val list = next.toList().ifEmpty { listOf(NitroUiSheetDetent("fit", 0.0)) }
      if (list != model.detents) {
        model.detents = list
        host.markDirty()
      }
    }

  override var dismissible: Boolean
    get() = model.dismissible
    set(next) {
      if (next != model.dismissible) {
        model.dismissible = next
        host.markDirty()
      }
    }

  override var showsGrabber: Boolean
    get() = model.showsGrabber
    set(next) {
      if (next != model.showsGrabber) {
        model.showsGrabber = next
        host.markDirty()
      }
    }

  override var cornerRadius: Variant_NullType_Double
    get() = model.cornerRadius?.let { Variant_NullType_Double.Second(it) } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value != model.cornerRadius) {
        model.cornerRadius = value
        host.markDirty()
      }
    }

  override var containerColor: Variant_NullType_Double
    get() =
      model.containerColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // `processColor` is signed on Android (D10): keep the bit pattern.
      val value = next.asSecondOrNull()?.toLong()?.toInt()
      if (value != model.containerColor) {
        model.containerColor = value
        host.markDirty()
      }
    }

  override var label: Variant_NullType_String
    get() = model.label?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value != model.label) {
        model.label = value
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

  override var onDetentChange: ((index: Double) -> Unit)?
    get() = model.onDetentChange
    set(next) {
      model.onDetentChange = next
    }

  override var onDismissed: ((ended: Boolean) -> Unit)?
    get() = model.onDismissed
    set(next) {
      model.onDismissed = next
    }

  override var onContentBox: ((width: Double, height: Double) -> Unit)?
    get() = model.onContentBox
    set(next) {
      model.onContentBox = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The handshake decides whether React's `presented` wins - including a dismissal JS
    // refused, which presents the sheet again (D33).
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
    // `host.prepareForRecycle()` resets the model, which stops composing the window -
    // and `onDropView` already disposed the composition that held it.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onDetentChange = null
    model.onDismissed = null
    model.onContentBox = null
    // The composition disposal in `drop()` takes the window down with the mount; the
    // flags follow so the state is honest as well as the screen.
    model.state.displayed = false
    model.applyDisplayed()
    model.closing = false
    host.drop()
  }

  // MARK: - Methods

  override fun nuiTestStateReport(): String =
    "presented=${if (model.state.displayed) 1 else 0};js=${if (model.state.js == true) 1 else 0}" +
      ";live=${BottomSheetModel.livePresentations.get()};presentCount=${model.presentCount.get()}" +
      ";sheetValue=${model.sheetValue};detents=${model.detents.joinToString(",") { it.kind }}" +
      ";selected=${model.selected};${model.boxReport};${host.facts()}" +
      ";roots=${BottomSheetModel.liveRoots.get()};userDismissals=${model.userDismissals.get()}" +
      ";unasked=${model.unaskedExits.get()};anchored=${if (host.isAttachedToWindow) 1 else 0}" +
      ";${host.lifetimeReport().replace(' ', ';')}"

  override fun nuiTestDismiss() {
    runOnUi {
      model.userDismissed()
      host.applyModelWrites()
    }
  }

  override fun nuiTestSelectDetent(index: Double) {
    runOnUi { host.selectDetent?.invoke(index.toInt()) }
  }

  /** Run [action] on the UI thread, now if already there, queued otherwise. */
  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }
}
