package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.TooltipScope
import androidx.compose.material3.TooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.PopupPositionProvider
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicInteger

// Tooltip: Material 3's `TooltipBox`. The view React Native lays out is the anchor: an
// empty box behind the app's children that takes no touch.

internal class TooltipModel : NitroUiModel() {
  var presented by mutableStateOf(false)
    private set

  /** Composed from a present until the exit transition finishes, so the hide animates. */
  var composing by mutableStateOf(false)

  /** Bumped per presentation, so presenting again gets a new `TooltipState` that animates in. */
  var generation by mutableIntStateOf(0)
    private set

  var message by mutableStateOf("")
  var title by mutableStateOf<String?>(null)
  var actions by mutableStateOf<List<NitroUiTooltipAction>>(emptyList())
  var placement by mutableStateOf("auto")
  var testID by mutableStateOf<String?>(null)

  /** The anchor's size in px: this view's own box, which Fabric sets. */
  var anchorWidthPx by mutableIntStateOf(0)
  var anchorHeightPx by mutableIntStateOf(0)

  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onAction: ((String) -> Unit)? = null

  /** With a title or an action, Material's rich tooltip; otherwise its plain one. */
  val isRich: Boolean
    get() = title != null || actions.isNotEmpty()

  val hasActions: Boolean
    get() = actions.isNotEmpty()

  // Counted where Material composes the popup, not in the tooltip content, which
  // material3 1.5 can compose again inside the same popup.
  private val composedPresentations = AtomicInteger(0)

  // Test read-outs. Written on the UI thread, read from the JS thread.
  @Volatile private var composedFacts = "kind=none"

  @Volatile private var geometry = "popupRect=-;anchorRect=-;hostRect=-"

  @Volatile private var placements = 0

  @Volatile private var closeReasons = ""

  fun applyDisplayed(): Boolean {
    val next = state.displayed
    if (next == presented) {
      return false
    }
    if (next) {
      composing = true
      generation += 1
    }
    presented = next
    return true
  }

  /** Reports the action first, then the close. */
  fun performAction(id: String) {
    if (!presented || actions.none { it.id == id }) {
      return
    }
    onAction?.invoke(id)
    userClosed("action")
  }

  /** A close with no action: a tap outside, Back, or `nuiTestDismiss`. */
  fun userDismissed() {
    if (!presented) {
      return
    }
    userClosed("dismiss")
  }

  /** The window went away under the tooltip (its anchor left the window). */
  fun closedByWindowLoss() {
    if (!presented) {
      return
    }
    userClosed("detached")
    // No exit animation: the anchor it would animate against is gone.
    composing = false
  }

  private fun userClosed(reason: String) {
    val count = state.user(false)
    applyDisplayed()
    closeReasons = if (closeReasons.isEmpty()) reason else "$closeReasons,$reason"
    onPresentedChange?.invoke(false, count.toDouble())
  }

  fun noteComposed(facts: String) {
    composedFacts = facts
  }

  fun notePlaced(
    anchor: IntRect,
    size: IntSize,
    position: IntOffset,
    host: String,
    density: Float,
  ) {
    placements += 1
    geometry =
      "popupRect=${position.x},${position.y},${size.width},${size.height}" +
      ";anchorRect=${anchor.left},${anchor.top},${anchor.width},${anchor.height}" +
      ";hostRect=$host;density=$density;placements=$placements"
  }

  fun notePopupShown() {
    composedPresentations.incrementAndGet()
  }

  fun notePopupGone() {
    composedFacts = "kind=none"
    geometry = "popupRect=-;anchorRect=-;hostRect=-"
    placements = 0
  }

  // Every field is volatile or atomic, so this is safe to call from the JS thread.
  fun readReport(lifetime: String): String =
    "presented=${if (state.displayed) 1 else 0};js=${if (state.js == true) 1 else 0}" +
      ";live=${livePresentations.get()};presentCount=${composedPresentations.get()}" +
      ";composing=${if (composing) 1 else 0};anchorW=${anchorWidthPx};anchorH=${anchorHeightPx}" +
      ";$composedFacts;$geometry;closes=${closeReasons.ifEmpty { "-" }};$lifetime"

  override fun reset() {
    presented = false
    composing = false
    message = ""
    title = null
    actions = emptyList()
    placement = "auto"
    testID = null
    state.displayed = false
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    onPresentedChange = null
    onAction = null
    composedPresentations.set(0)
    composedFacts = "kind=none"
    geometry = "popupRect=-;anchorRect=-;hostRect=-"
    placements = 0
    closeReasons = ""
  }

  companion object {
    // Tooltip popups composed right now, process-wide, so a test can read it through a
    // fresh mount after the one that presented is gone.
    val livePresentations = AtomicInteger(0)
  }
}

/** `placement` as Material's anchor position. Material flips to the other side itself. */
@OptIn(ExperimentalMaterial3Api::class)
private fun anchorPositionOf(placement: String): TooltipAnchorPosition =
  if (placement == "below") TooltipAnchorPosition.Below else TooltipAnchorPosition.Above

private class TooltipHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: TooltipModel,
) : NitroComposeHost<TooltipModel>(context, activity, model),
  ReactPointerEventsView {
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  init {
    // The anchor is not an accessibility element: the app's children are.
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  // Makes React Native's touch search skip this view. Only a `ReactPointerEventsView`
  // can answer `none` on Android; any other view reads as `auto`.
  override val pointerEvents: PointerEvents
    get() = PointerEvents.NONE

  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The root offers its content unbounded height, so `fillMaxSize()` would be zero high.
    model.anchorWidthPx = w
    model.anchorHeightPx = h
    applyModelWrites()
  }

  @Composable
  override fun Component(model: TooltipModel) {
    if (model.composing) {
      key(model.generation) {
        TooltipPresentation(model)
      }
    }
  }

  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  private fun TooltipPresentation(model: TooltipModel) {
    // Persistent: Material's timer never hides it; the user or the app does.
    val tooltipState = remember { TooltipState(initialIsVisible = false, isPersistent = true) }
    val presented = model.presented
    LaunchedEffect(presented) {
      if (presented) {
        // Suspends while it is up; a JS `false` restarts this effect, and the cancelled
        // `show()` dismisses on its way out.
        tooltipState.show()
      } else {
        tooltipState.dismiss()
      }
    }
    // Stop composing once the exit transition has finished, so the hide animates.
    val transition = tooltipState.transition
    if (!presented && transition.isIdle && !transition.currentState) {
      SideEffect { model.composing = false }
    }
    // Tracked on the condition Material composes the popup on, not inside the tooltip
    // content: material3 1.5 keys that content on the anchor's position, so it is disposed
    // and composed again inside a popup that stayed up.
    if (tooltipState.isVisible) {
      DisposableEffect(Unit) {
        model.notePopupShown()
        onDispose { model.notePopupGone() }
      }
    }
    val density = LocalDensity.current
    val hasActions = model.hasActions
    val material = TooltipDefaults.rememberTooltipPositionProvider(anchorPositionOf(model.placement))
    val positionProvider = remember(material) { RecordingPositionProvider(material, model, this) }
    TooltipBox(
      positionProvider = positionProvider,
      tooltip = { TooltipContent(model) },
      state = tooltipState,
      onDismissRequest = {
        model.userDismissed()
        applyModelWrites()
      },
      // Back and TalkBack reach an actionable tooltip's buttons; a plain one leaves
      // focus where it was (an open keyboard keeps its field).
      focusable = hasActions,
      // The app opens it; there is no built-in trigger.
      enableUserInput = false,
      hasAction = hasActions,
    ) {
      // The anchor: this view's own box.
      with(density) {
        Box(Modifier.size(model.anchorWidthPx.toDp(), model.anchorHeightPx.toDp()))
      }
    }
  }

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  private fun TooltipScope.TooltipContent(model: TooltipModel) {
    TooltipWitness()
    val title = model.title
    val message = model.message
    val actions = model.actions
    val rich = model.isRich
    SideEffect {
      model.noteComposed(
        "kind=${if (rich) "rich" else "plain"};title=${title ?: "-"};message=$message" +
          ";actions=${actions.size};ids=${actions.joinToString(",") { it.id }}" +
          ";focusable=${if (actions.isNotEmpty()) 1 else 0}",
      )
    }
    val modifier =
      Modifier
        .tooltipTestTag(model.testID)
        // TalkBack announces the tooltip when it shows; nothing else would tell the user.
        .semantics { liveRegion = LiveRegionMode.Polite }
    if (rich) {
      RichTooltip(
        modifier = modifier,
        title = title?.let { text -> { Text(text) } },
        action =
          if (actions.isEmpty()) {
            null
          } else {
            {
              Row {
                for (action in actions) {
                  TextButton(onClick = {
                    model.performAction(action.id)
                    applyModelWrites()
                  }) {
                    Text(action.title)
                  }
                }
              }
            }
          },
      ) {
        Text(message)
      }
    } else {
      PlainTooltip(modifier = modifier) {
        Text(message)
      }
    }
  }

  // Counts this popup while its content is composed. Balanced even when Material
  // composes the content again.
  @Composable
  private fun TooltipWitness() {
    DisposableEffect(Unit) {
      TooltipModel.livePresentations.incrementAndGet()
      onDispose {
        TooltipModel.livePresentations.decrementAndGet()
      }
    }
  }

  // A Compose popup survives its host's detach (a screen push), so close it. One turn
  // later, so an unmount's `onDropView` or an immediate re-attach gets there first.
  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    if (!model.presented && !model.composing) {
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

}

/**
 * Material's position provider, recording what it was asked and answered for the test
 * report. Material asks again whenever the anchor moves.
 */
private class RecordingPositionProvider(
  private val material: PopupPositionProvider,
  private val model: TooltipModel,
  private val host: View,
) : PopupPositionProvider {
  private val hostLocation = IntArray(2)

  override fun calculatePosition(
    anchorBounds: IntRect,
    windowSize: IntSize,
    layoutDirection: LayoutDirection,
    popupContentSize: IntSize,
  ): IntOffset {
    val position = material.calculatePosition(anchorBounds, windowSize, layoutDirection, popupContentSize)
    host.getLocationInWindow(hostLocation)
    model.notePlaced(
      anchorBounds,
      popupContentSize,
      position,
      "${hostLocation[0]},${hostLocation[1]},${host.width},${host.height}",
      host.resources.displayMetrics.density,
    )
    return position
  }
}

/** Tags the popup `<testID>-tooltip`, as a resource id that uiautomator can find. */
@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.tooltipTestTag(testID: String?): Modifier =
  if (testID == null) {
    this
  } else {
    this.semantics { testTagsAsResourceId = true }.testTag("$testID-tooltip")
  }

class HybridNitroUiTooltip(
  reactContext: ThemedReactContext,
) : HybridNitroUiTooltipSpec(), RecyclableView {
  private val model = TooltipModel()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = TooltipHost(reactContext, reactContext.currentActivity, model)

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

  override var message: String
    get() = model.message
    set(next) {
      if (next != model.message) {
        model.message = next
        host.markDirty()
      }
    }

  override var title: Variant_NullType_String
    get() = model.title?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value != model.title) {
        model.title = value
        host.markDirty()
      }
    }

  override var actions: Array<NitroUiTooltipAction>
    get() = model.actions.toTypedArray()
    set(next) {
      val list = next.toList()
      if (list != model.actions) {
        model.actions = list
        host.markDirty()
      }
    }

  override var placement: String
    get() = model.placement
    set(next) {
      if (next != model.placement) {
        model.placement = next
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

  override var onAction: ((id: String) -> Unit)?
    get() = model.onAction
    set(next) {
      model.onAction = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // A close that JS refused presents the tooltip again.
    model.state.reconcile()
    if (model.applyDisplayed()) {
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.mountGeneration += 1
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onAction = null
    // Disposing the composition takes the popup down; make the state agree.
    model.state.displayed = false
    model.applyDisplayed()
    model.composing = false
    host.drop()
  }

  // MARK: - Methods

  override fun nuiTestStateReport(): String = model.readReport(host.lifetimeReport().replace(' ', ';'))

  override fun nuiTestPerformAction(id: String) {
    runOnUi {
      model.performAction(id)
      host.applyModelWrites()
    }
  }

  override fun nuiTestDismiss() {
    runOnUi {
      model.userDismissed()
      host.applyModelWrites()
    }
  }

  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }
}
