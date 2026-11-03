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

/*
 * Tooltip (G18, DECISIONS D38, Q7 Appendix C3): Material 3's `TooltipBox`, with a
 * `PlainTooltip` for a message alone and a `RichTooltip` once there is a title or an
 * action.
 *
 * The view React Native lays out is the **anchor**: the JS wrapper fills its own box
 * with it, behind the app's children, so `TooltipBox`'s content is an empty box the size
 * of this view, and Material positions the popup against that box. It takes no touch -
 * the composition has no pointer input, and React Native's own touch search skips it
 * (`ReactPointerEventsView`, `PointerEvents.NONE`) - so a tap lands on the app's children.
 *
 * The popup is a window composed by this host's composition, the machinery Picker and
 * Menu proved (`docs/components/host.md`, "Popups and dialogs"): disposing the
 * composition in `drop()` takes the window down with the mount. A closed tooltip
 * composes nothing at all - `composing` is false until the first present.
 */

/** State of one tooltip. See [NitroUiModel] for the shape this has to have. */
internal class TooltipModel : NitroUiModel() {
  /** Whether the tooltip is presented: the handshake's `displayed`, as snapshot state. */
  var presented by mutableStateOf(false)
    private set

  /**
   * Whether the tooltip is composed: from a present until its exit transition has
   * finished, so the hide still animates (Q7 C3 "A closed tooltip composes nothing").
   */
  var composing by mutableStateOf(false)

  /**
   * Bumped on every presentation, so a tooltip presented again (a refused close) is a
   * fresh `TooltipState` that animates in again, not the one still on its way out.
   */
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

  /** `presented` behind the event-count handshake (`core.md` section 4). */
  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onAction: ((String) -> Unit)? = null

  /** With a title or an action, Material's rich tooltip; otherwise its plain one. */
  val isRich: Boolean
    get() = title != null || actions.isNotEmpty()

  val hasActions: Boolean
    get() = actions.isNotEmpty()

  /** How many times this mount's tooltip content entered the composition. */
  private val composedPresentations = AtomicInteger(0)

  /** What the composed tooltip showed, for [readReport]. Written on the UI thread. */
  @Volatile private var composedFacts = "kind=none"

  /** Where Material placed the popup against which anchor box, in px, for [readReport]. */
  @Volatile private var geometry = "popupRect=-;anchorRect=-;hostRect=-"

  /** How many times Material placed this popup, for [readReport]: a move places it again. */
  @Volatile private var placements = 0

  /** How many closes this mount reported, by reason, for [readReport]. */
  @Volatile private var closeReasons = ""

  /** Make the composition match [state]'s `displayed`. Returns whether it moved. */
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

  /** An action was tapped: report it, then the close (D32's order), then close. */
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

  /** Recorded by the composed tooltip content. */
  fun noteComposed(facts: String) {
    composedFacts = facts
  }

  /**
   * Material placed the popup: [anchor] is the box it was given (window coordinates),
   * [size] the popup's, [position] where it put it, and [host] this view's own box in the
   * same window - which [anchor] has to be, or the popup points at something else.
   */
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

  fun noteContentEntered() {
    composedPresentations.incrementAndGet()
  }

  fun noteContentLeft() {
    composedFacts = "kind=none"
    geometry = "popupRect=-;anchorRect=-;hostRect=-"
    placements = 0
  }

  /**
   * What this tooltip shows, as `key=value` pairs. Every field is a volatile written on
   * the UI thread or an atomic, so this is safe from the JS thread without waiting for
   * the UI thread (`core.md` section 5).
   */
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
    /**
     * How many tooltip popups this process has composed right now: one per popup,
     * counted by a `DisposableEffect` inside the popup's own content, so it returns to
     * zero exactly when nothing of a presentation is left - closed, dropped or recycled.
     * Process-wide, because a dropped mount has nothing left to report; a harness reads
     * it through a fresh mount.
     */
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
  /** Where a detach's deferred check runs. */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  init {
    // The anchor is not an accessibility element: the app's children are, and the
    // popup announces itself (Q7 C5).
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /**
   * React Native's own touch search skips this view: the anchor is behind the app's
   * children and never the target of a touch, which is what `pointerEvents="none"`
   * asks and what only a [ReactPointerEventsView] can answer on Android (any other
   * view reads as `auto`).
   */
  override val pointerEvents: PointerEvents
    get() = PointerEvents.NONE

  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The anchor's box, for the composition: the root offers its content an unbounded
    // height, so `fillMaxSize()` would give Material a zero-height anchor.
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
    // Persistent, so neither kind hides itself on Material's timer: a tooltip stays up
    // until the user or the app closes it, on both platforms (Q7 C1).
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
      // No trigger in v1: the app opens it (Q7 C1).
      enableUserInput = false,
      hasAction = hasActions,
    ) {
      // The anchor: this view's own box, which is the wrapper's.
      with(density) {
        Box(Modifier.size(model.anchorWidthPx.toDp(), model.anchorHeightPx.toDp()))
      }
    }
  }

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  private fun TooltipScope.TooltipContent(model: TooltipModel) {
    TooltipWitness(model)
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
        // TalkBack announces the tooltip when it shows: the app opened it, so nothing
        // else would tell a screen-reader user it is there (Q7 C5).
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

  /**
   * Count this popup for as long as its content is composed - the Dialog witness
   * (`HybridNitroUiDialog.kt`, `DialogWitness`), placed inside the popup so it counts
   * the window, not the presentation's intent.
   */
  @Composable
  private fun TooltipWitness(model: TooltipModel) {
    DisposableEffect(Unit) {
      TooltipModel.livePresentations.incrementAndGet()
      model.noteContentEntered()
      onDispose {
        TooltipModel.livePresentations.decrementAndGet()
        model.noteContentLeft()
      }
    }
  }

  /**
   * Losing the window while presented closes the tooltip and reports it, as a dialog
   * does: a Compose popup survives its host's detach (a screen push, say) and would
   * otherwise stay up over a screen it does not belong to. One turn later, so an
   * unmount's `onDropView`, which runs in the same mount batch, and a reparent that puts
   * the view straight back both get there first.
   */
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
 * Material's position provider, plus a record of what it was asked and answered: the
 * anchor box it placed the popup against (window coordinates), the popup's size, and
 * the offset it chose: the popup window's position against the anchor, for the report.
 * Material asks again whenever the anchor moves, so the popup follows a layout move
 * or a scroll rather than staying over the place the anchor left (measured, G18).
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

/**
 * `<testID>-tooltip` on the popup's content, as a resource id uiautomator can find.
 * Nothing is tagged when the app gave no `testID`.
 */
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

  /** Where [runOnUi] sends work that is not already on the UI thread. */
  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = TooltipHost(reactContext, reactContext.currentActivity, model)

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
    // The handshake decides whether React's `presented` wins - including a close JS
    // refused, which presents the tooltip again (D33).
    model.state.reconcile()
    if (model.applyDisplayed()) {
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.mountGeneration += 1
    // `host.prepareForRecycle()` resets the model, which stops composing the popup -
    // and `onDropView` already disposed the composition that held it.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onAction = null
    // The composition disposal in `drop()` takes the popup down with the mount; the
    // flags follow so the state is honest as well as the screen.
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

  /** Run [action] on the UI thread, now if already there, queued otherwise. */
  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }
}
