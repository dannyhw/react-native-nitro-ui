package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.Choreographer
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.gestures.GestureCancellationException
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderColors
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SliderState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.util.fastAny
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.setProgress
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// The Slider component: Material 3 `Slider` with the drag owned natively. Must stay in
// this package, which the generated view manager imports with a wildcard.

/**
 * The frame ticker a drag uses, so at most one `onValueChange` is emitted per frame. An
 * interface so that JVM tests can drive a drag without a `Choreographer`.
 */
internal interface NitroUiFramePump {
  /** Ask for the next frame. Calling it twice is one callback, not two. */
  fun start(
    onFrame: () -> Unit,
  )

  /** Stop asking. After this, [isArmed] is false and no callback is outstanding. */
  fun stop()

  /** Whether [start] has run without a [stop]. Readable from any thread. */
  val isArmed: Boolean
}

/** A `Choreographer` frame callback is one-shot, so a drag re-posts it on every sample. */
internal class ChoreographerFramePump : NitroUiFramePump {
  private val frameCallback = Choreographer.FrameCallback { onFrame?.invoke() }

  private var onFrame: (() -> Unit)? = null

  @Volatile private var armed = false

  override val isArmed: Boolean
    get() = armed

  override fun start(
    onFrame: () -> Unit,
  ) {
    this.onFrame = onFrame
    armed = true
    Choreographer.getInstance().postFrameCallback(frameCallback)
  }

  override fun stop() {
    armed = false
    Choreographer.getInstance().removeFrameCallback(frameCallback)
  }
}

internal class SliderModel(
  private val pump: NitroUiFramePump = ChoreographerFramePump(),
) : NitroUiModel() {
  var displayed by mutableStateOf(0.0)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the thumb and filled track, or `null` for the scheme's. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  var minimumValue by mutableStateOf(0.0)
  var maximumValue by mutableStateOf(1.0)
  var step by mutableStateOf(0.0)

  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Double>(0.0)

  var defaultValue: Double? = null
  var didApplyDefault = false

  var onChange: ((Double, Double) -> Unit)? = null
  var onSlidingStart: ((Double, Double) -> Unit)? = null
  var onSlidingComplete: ((Double, Double) -> Unit)? = null

  // The un-emitted drag sample lives in `state.unreported`, so a React write cannot
  // overtake it.

  var dragging = false

  /**
   * Bumped when a drag is abandoned, so work queued for it (the test drag's posted moves)
   * can tell that it is stale and stop.
   */
  var dragGeneration = 0
    private set

  /** Made once: [dragTo] hands it to the pump on every sample. */
  private val onFrame: () -> Unit = { deliverUnreported() }

  fun quantize(raw: Double): Double =
    NitroUiSliderValue.quantize(raw, minimumValue, maximumValue, step)

  /**
   * The `steps` to give Material: stops between the endpoints, so n whole steps is n - 1.
   * 0 (continuous) when the range does not end on a step; [quantize] then applies the step.
   */
  fun steppedTicks(): Int {
    val division = NitroUiSliderValue.division(minimumValue, maximumValue, step) ?: return 0
    if (!division.endsOnStep || division.wholeSteps < 1) {
      return 0
    }
    return maxOf(0, division.wholeSteps.toInt() - 1)
  }

  fun stepped(
    from: Double,
    up: Boolean,
  ): Double = NitroUiSliderValue.stepped(from, up, minimumValue, maximumValue, step)

  /**
   * A screen reader's adjust action. Only the direction is taken from [target], against
   * [publishedProgress]: the semantics node can be a frame behind [displayed]. The
   * destination is [stepped], because Material's stride of a twentieth of the range can
   * quantise back to the start. Emits start, change and complete; returns whether it moved.
   */
  fun accessibilityStepToward(
    target: Double,
    publishedProgress: Double = displayed,
  ): Boolean {
    if (!enabled) {
      return false
    }
    val from = displayed
    val shown = asPublishedProgress(publishedProgress)
    val up =
      when {
        target > shown -> true
        target < shown -> false
        else -> return false
      }
    val to = stepped(from, up)
    if (to == from) {
      return false
    }
    if (dragging) {
      // A finger already owns the open drag. Make this a sample of it: a second begin/end
      // pair would report a complete while the thumb is still held.
      dragTo(to)
      return true
    }
    beginDrag()
    dragTo(to)
    endDrag()
    return true
  }

  // The semantics node publishes progress as a `Float`, and the reader's target is computed
  // from that. Compare in the same space: 0.3 through a `Float` is 0.30000001, which
  // against the `Double` 0.3 would read as a step up.
  private fun asPublishedProgress(
    displayed: Double,
  ): Double = displayed.toFloat().toDouble()

  val isFramePumpArmed: Boolean
    get() = pump.isArmed

  // Written on the UI thread by the test probe and read from JS, hence `@Volatile`.
  @Volatile var accessibilityStepReport: String = ""

  var accessibilityStepCount = 0

  /**
   * Opens a drag and reports the value it began from. Called on touch-down, and by [dragTo]
   * for a value that arrives without a touch (a keyboard step).
   */
  fun beginDrag() {
    if (dragging) {
      return
    }
    dragging = true
    startFramePump()
    onSlidingStart?.invoke(displayed, state.nativeEvents.toDouble())
  }

  /** Displays the quantised value at once; the change is emitted on the next frame. */
  fun dragTo(raw: Double) {
    if (!dragging) {
      beginDrag()
    }
    val value = quantize(raw)
    displayed = value
    state.unreported = value
    startFramePump()
  }

  /**
   * Ends the drag and delivers the final value. Idempotent: Material's
   * `onValueChangeFinished` and the press watcher can both call it for one gesture.
   */
  fun endDrag() {
    if (!dragging) {
      return
    }
    deliverUnreported()
    dragging = false
    stopFramePump()
    onSlidingComplete?.invoke(displayed, state.nativeEvents.toDouble())
  }

  /** Abandons a drag without reporting it: the view is being recycled or dropped. */
  fun cancelDrag() {
    state.unreported = null
    dragging = false
    stopFramePump()
    dragGeneration++
  }

  private fun startFramePump() {
    pump.start(onFrame)
  }

  private fun stopFramePump() {
    pump.stop()
  }

  // The frame tick: one event for everything since the last one. Writes no observed state
  // ([displayed] was written at sample time), so no apply notification is needed.
  private fun deliverUnreported() {
    val value = state.unreported ?: return
    state.unreported = null
    // `user()` increments the event count JS echoes back, so call it once per emitted event.
    val eventCount = state.user(value)
    onChange?.invoke(value, eventCount.toDouble())
  }

  override fun reset() {
    cancelDrag()
    displayed = 0.0
    enabled = true
    tintColor = null
    accessibilityLabel = null
    minimumValue = 0.0
    maximumValue = 1.0
    step = 0.0
    sizingKey = ""
    state.displayed = 0.0
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultValue = null
    didApplyDefault = false
    onChange = null
    onSlidingStart = null
    onSlidingComplete = null
  }
}

/**
 * Slider colours per (colour scheme, tint). Process-wide because every hosted control is
 * its own composition, and `SliderDefaults.colors(...)` builds a new object per call.
 */
private object SliderColorsCache {
  private const val MAX_TINTED_ENTRIES = 8

  private var scheme: ColorScheme? = null
  private var untinted: SliderColors? = null
  private var tinted: HashMap<Int, SliderColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): SliderColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: SliderColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, SliderColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  // Call with the lock held.
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

@Composable
private fun sliderColors(tint: Int?): SliderColors {
  val scheme = MaterialTheme.colorScheme
  SliderColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val built =
    if (tint != null) {
      // The thumb and filled track are the closest analogue of iOS `.tint()`.
      SliderDefaults.colors(
        thumbColor = ComposeColor(tint),
        activeTrackColor = ComposeColor(tint),
      )
    } else {
      SliderDefaults.colors()
    }
  SliderColorsCache.put(scheme, tint, built)
  return built
}

private class SliderHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SliderModel,
) : NitroComposeHost<SliderModel>(context, activity, model) {
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  // The accessibility test probe turns Compose semantics on with no reader connected, and
  // `AccessibilityManager` throws for an event sent while accessibility is off.
  override fun requestSendAccessibilityEvent(
    child: View,
    event: AccessibilityEvent,
  ): Boolean {
    if (systemAccessibility?.isEnabled != true) {
      return false
    }
    return super.requestSendAccessibilityEvent(child, event)
  }

  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: SliderModel) {
    // The dragged value is read only inside [SliderTrack], so a drag frame recomposes
    // just that composable.
    SliderTrack(
      model = model,
      enabled = model.enabled,
      colors = sliderColors(model.tintColor),
    )
  }
}

@Composable
private fun SliderTrack(
  model: SliderModel,
  enabled: Boolean,
  colors: SliderColors,
) {
  val displayed = model.displayed
  val label = model.accessibilityLabel
  val range = trackRange(model.minimumValue, model.maximumValue)
  val ticks = model.steppedTicks()
  // One `SliderState` per (steps, range): `rememberSliderState` never re-keys, so it would
  // keep the old track after a `step` or range change. Created here, not inside the `Box`,
  // because the press watcher on the `Box`'s modifier reads it.
  val sliderState = remember(ticks, range) { SliderState(displayed.toFloat(), ticks, range) }
  sliderState.value = displayed.toFloat()
  // One accessibility node whose progress action is native's. Material's own `setProgress`
  // would be a second node with a different rule. Material publishes no progress range,
  // and the accessibility delegate needs one to compute a scroll target, so it is stated.
  Box(
    modifier =
      Modifier.sliderPressWatcher(
        model = model,
        state = sliderState,
        enabled = enabled,
      )
        .clearAndSetSemantics {
          if (label != null) {
            contentDescription = label
          }
          progressBarRangeInfo = ProgressBarRangeInfo(displayed.toFloat(), range, ticks)
          // Compare against the progress this node published: a press can arrive before
          // Compose republishes it.
          setProgress { target ->
            model.accessibilityStepToward(target.toDouble(), publishedProgress = displayed)
          }
          // The clear also removed Material's `disabled()`, so restate it.
          if (!enabled) {
            disabled()
          }
        },
  ) {
    Slider(
      state = sliderState,
      onValueChange = { position -> model.dragTo(position.toDouble()) },
      enabled = enabled,
      // Material calls this after the last value of a gesture it took, tap or drag.
      onValueChangeFinished = { model.endDrag() },
      colors = colors,
    )
  }
}

/**
 * Reports a gesture for every touch, including one that never moves the thumb: Material
 * has no drag-start callback and calls `onValueChange` only when the value changes. The
 * down is read on the Initial pass, before Material handles it; the up on the Final pass.
 * Nothing is consumed.
 */
@Composable
private fun Modifier.sliderPressWatcher(
  model: SliderModel,
  state: SliderState,
  enabled: Boolean,
): Modifier {
  if (!enabled) {
    // Material removes its own gesture modifiers when disabled. Removing this one mid-drag
    // cancels the loop below, so `afterUpdate` closes that drag.
    return this
  }
  // [SliderTrack] makes a new `SliderState` when the step or range changes; read the
  // current one.
  val latestState = rememberUpdatedState(state)
  val scope = rememberCoroutineScope()
  // `model` never changes for the life of the view, so the block is installed once.
  return this.pointerInput(model) {
    awaitEachGesture {
      try {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        model.beginDrag()
        var pointersDown = true
        while (pointersDown) {
          val event = awaitPointerEvent(PointerEventPass.Final)
          // Until every pointer is up: a second finger joining and leaving does not end
          // the gesture.
          pointersDown = event.changes.fastAny { change -> change.pressed }
        }
        // Material queues drag events and applies them after this pointer pass, so the last
        // value may not have been applied yet. A drag Material took is ended by its own
        // `onValueChangeFinished`. Otherwise the end is dispatched (not `.immediate`) so it
        // lands behind anything Material has queued; `endDrag` is idempotent.
        if (!latestState.value.isDragging) {
          scope.launch(Dispatchers.Main) { model.endDrag() }
        }
      } catch (taken: GestureCancellationException) {
        // A takeover by a parent or an `ACTION_CANCEL` arrives as a release and is handled
        // above. This is a cancellation from inside pointer input: close the reported
        // gesture, and rethrow because `awaitEachGesture` recovers the stream.
        model.endDrag()
        throw taken
      }
    }
  }
}

/** A valid, non-empty range: Material divides by its width, and an empty one gives NaN. */
private fun trackRange(
  minimum: Double,
  maximum: Double,
): ClosedFloatingPointRange<Float> {
  if (!minimum.isFinite() || !maximum.isFinite()) {
    return 0f..1f
  }
  val low = minOf(minimum, maximum).toFloat()
  val high = maxOf(minimum, maximum).toFloat()
  if (!low.isFinite() || !high.isFinite()) {
    return 0f..1f
  }
  if (high > low) {
    return low..high
  }
  val widened = low + 1f
  return if (widened.isFinite()) low..widened else 0f..1f
}

class HybridNitroUiSlider(
  reactContext: ThemedReactContext,
) : HybridNitroUiSliderSpec(), RecyclableView {

  private val model = SliderModel()
  private val host = SliderHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    // A backstop: the fallback is normally declared at startup, before any view exists.
    declareFallback()
  }

  companion object {
    // Must match the component name in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiSlider"

    // The size before anything is measured, in dp. Material's `Slider` measures 48 dp tall
    // (its touch target). The width is used only under an unbounded parent, where it is
    // the width the Slider draws at.
    private const val FALLBACK_WIDTH_DP = 328.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    // Called at package init, before Fabric can measure, and again from `init`.
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var value: Variant_NullType_Double
    get() =
      model.state.js?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Not visual by itself: `displayed` follows in `afterUpdate()`, once JS has caught up.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValue: Variant_NullType_Double
    get() =
      model.defaultValue?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Stored raw: the range to quantise against may arrive in the same batch, in any order.
      model.defaultValue = next.asSecondOrNull()
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var minimumValue: Double
    get() = model.minimumValue
    set(next) {
      if (next == model.minimumValue) {
        return
      }
      model.minimumValue = next
      host.markDirty()
    }

  override var maximumValue: Double
    get() = model.maximumValue
    set(next) {
      if (next == model.maximumValue) {
        return
      }
      model.maximumValue = next
      host.markDirty()
    }

  override var step: Double
    get() = model.step
    set(next) {
      if (next == model.step) {
        return
      }
      model.step = next
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` passes the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, turning an opaque colour into `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val label = next.asSecondOrNull()
      if (label == model.accessibilityLabel) {
        return
      }
      model.accessibilityLabel = label
      host.markDirty()
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
      }
    set(next) {
      val raw = next.asSecondOrNull()
      host.perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      model.sizingKey = next
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((Double, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  override var onSlidingStart: ((Double, Double) -> Unit)?
    get() = model.onSlidingStart
    set(next) {
      model.onSlidingStart = next
    }

  override var onSlidingComplete: ((Double, Double) -> Unit)?
    get() = model.onSlidingComplete
    set(next) {
      model.onSlidingComplete = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // Value, range and step can arrive in one batch in any order, so quantise only here.
    model.state.js?.let { js ->
      val quantised = model.quantize(js)
      if (quantised != js) {
        model.state.js = quantised
      }
    }
    if (model.state.js == null && !model.didApplyDefault) {
      model.defaultValue?.let { default ->
        model.didApplyDefault = true
        val seeded = model.quantize(default)
        model.state.displayed = seeded
        model.displayed = seeded
        host.markDirty()
      }
    }
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A range or step change can leave the shown value outside the range.
    val shown = model.quantize(model.state.displayed)
    if (shown != model.state.displayed) {
      model.state.displayed = shown
      model.displayed = shown
      host.markDirty()
    }
    // Disabling removes the gesture modifiers, which cancels an open drag without any end
    // callback. Close it here, last, so the app hears the value before the end.
    if (!model.enabled && model.dragging) {
      model.endDrag()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The host clears the perf id itself, after marking; the model's reset cancels any drag.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.cancelDrag()
    model.onChange = null
    model.onSlidingStart = null
    model.onSlidingComplete = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size and never calls into Compose, so it is safe on the JS thread.
  override fun measureContent(): NitroUiSliderSize {
    val size = host.contentSize ?: return NitroUiSliderSize(0.0, 0.0)
    return NitroUiSliderSize(size.width, size.height)
  }

  // Test-only. `msPerStep` 0 runs every move in one main-thread turn, so no frame can
  // pass between them; a positive value lets frames pass between moves.
  override fun nuiTestDrag(
    to: Double,
    steps: Double,
    msPerStep: Double,
  ) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      runTestDrag(to, maxOf(1, steps.toInt()), maxOf(0.0, msPerStep))
    }
  }

  private fun runTestDrag(
    to: Double,
    steps: Int,
    msPerStep: Double,
  ) {
    // Material does not call `onValueChange` when disabled, so a simulated drag must not either.
    if (!model.enabled) {
      return
    }
    // Every queued step checks this: a test that unmounts mid-drag must not leave the
    // drag running into whatever instance is mounted next.
    val generation = model.dragGeneration
    val current = { model.dragGeneration == generation }
    val from = model.displayed
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    model.beginDrag()
    for (index in 1..steps) {
      val fraction = index.toDouble() / steps.toDouble()
      val move = {
        if (current()) {
          model.dragTo(from + (to - from) * fraction)
        }
      }
      if (msPerStep > 0.0) {
        handler.postDelayed(move, (msPerStep * index).toLong())
      } else {
        move()
      }
    }
    if (msPerStep > 0.0) {
      // One interval after the last move, so the drag ends after the frames it
      // generated rather than inside one of them.
      handler.postDelayed(
        {
          if (current()) {
            model.endDrag()
          }
        },
        (msPerStep * steps + 50).toLong(),
      )
    } else {
      model.endDrag()
    }
  }

  // Test-only. Performs the `SetProgress` action on the published node with the target the
  // accessibility delegate would compute. No fallback: calling the model directly would
  // not test the path TalkBack takes.
  override fun nuiTestAccessibilityStep(
    direction: Double,
  ) {
    val up = direction >= 0.0
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      runTestAccessibilityStep(up)
    }
  }

  override fun nuiTestAccessibilityStepReport(): String = model.accessibilityStepReport

  override fun nuiTestFramePumpArmed(): Boolean = model.isFramePumpArmed

  // Written on the main thread, read by a Nitro call on any thread.
  @Volatile
  private var pointerStreamReport = "no pointer stream injected yet"

  // Numbers the reports, so a caller can tell a new report from an identical earlier one.
  private var pointerStreamCount = 0

  override fun nuiTestPointerStream(mode: Double) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      runTestPointerStream(mode.toInt())
    }
  }

  override fun nuiTestPointerStreamReport(): String = pointerStreamReport

  // Test-only. Dispatches a canned pointer stream through the host view, controlling which
  // main-looper turn each event lands in: a real release can share a batch with a MOVE,
  // which per-event posting can never reproduce.
  private fun runTestPointerStream(mode: Int) {
    val width = host.width
    val height = host.height
    if (width <= 0 || height <= 0) {
      pointerStreamReport =
        "#${++pointerStreamCount} mode=$mode: nothing to touch (${width}x$height)"
      return
    }
    val generation = model.dragGeneration
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    val downTime = android.os.SystemClock.uptimeMillis()
    val midY = height / 2f
    var dispatched = 0

    // One post is one looper turn. Each turn re-checks the generation, in case the view
    // was recycled.
    val turn: (() -> Unit) -> Unit = { body -> handler.post(Runnable { body() }) }
    val send = { action: Int, xs: FloatArray, pointerIndex: Int ->
      if (model.dragGeneration == generation) {
        // The pointer-array overload, because it identifies each pointer; the second
        // finger is the last entry.
        val properties =
          Array(xs.size) { index ->
            MotionEvent.PointerProperties().apply {
              id = index
              toolType = MotionEvent.TOOL_TYPE_FINGER
            }
          }
        val coordinates =
          Array(xs.size) { index ->
            MotionEvent.PointerCoords().apply {
              x = xs[index]
              y = midY
              size = 1f
              pressure = 1f
            }
          }
        val event =
          MotionEvent.obtain(
            downTime,
            android.os.SystemClock.uptimeMillis(),
            action or (pointerIndex shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            xs.size,
            properties,
            coordinates,
            0,
            0,
            1f,
            1f,
            0,
            0,
            InputDevice.SOURCE_TOUCHSCREEN,
            0,
          )
        try {
          host.dispatchTouchEvent(event)
          dispatched += 1
        } finally {
          event.recycle()
        }
      }
    }
    val at = { fraction: Double -> width * fraction.toFloat() }
    val finish = {
      pointerStreamReport =
        "#${++pointerStreamCount} mode=$mode: dispatched $dispatched event(s), " +
          "enabled=${model.enabled}"
    }

    when (mode) {
      0 -> {
        turn { send(MotionEvent.ACTION_DOWN, floatArrayOf(at(0.30)), 0) }
        for (step in 1..3) {
          turn { send(MotionEvent.ACTION_MOVE, floatArrayOf(at(0.38 + 0.08 * step)), 0) }
        }
        // The batch: the last MOVE and the release, in one turn, with no message
        // between them for the app to draw a frame in.
        turn {
          send(MotionEvent.ACTION_MOVE, floatArrayOf(at(0.86)), 0)
          send(MotionEvent.ACTION_UP, floatArrayOf(at(0.86)), 0)
          finish()
        }
      }
      1 -> {
        turn { send(MotionEvent.ACTION_DOWN, floatArrayOf(at(0.30)), 0) }
        turn {
          send(MotionEvent.ACTION_CANCEL, floatArrayOf(at(0.30)), 0)
          finish()
        }
      }
      3 -> {
        // The touch slop is crossed in the same batch as the release.
        turn {
          send(MotionEvent.ACTION_DOWN, floatArrayOf(at(0.30)), 0)
          send(MotionEvent.ACTION_MOVE, floatArrayOf(at(0.55)), 0)
          send(MotionEvent.ACTION_UP, floatArrayOf(at(0.55)), 0)
          finish()
        }
      }
      2 -> {
        turn { send(MotionEvent.ACTION_DOWN, floatArrayOf(at(0.30)), 0) }
        turn {
          send(MotionEvent.ACTION_POINTER_DOWN, floatArrayOf(at(0.30), at(0.62)), 1)
        }
        turn {
          send(MotionEvent.ACTION_MOVE, floatArrayOf(at(0.40), at(0.72)), 0)
        }
        turn {
          send(MotionEvent.ACTION_POINTER_UP, floatArrayOf(at(0.40), at(0.72)), 1)
        }
        turn {
          send(MotionEvent.ACTION_MOVE, floatArrayOf(at(0.44)), 0)
          send(MotionEvent.ACTION_UP, floatArrayOf(at(0.44)), 0)
          finish()
        }
      }
      else -> {
        pointerStreamReport = "#${++pointerStreamCount} mode=$mode: no such canned stream"
        return
      }
    }
  }

  private fun runTestAccessibilityStep(up: Boolean) {
    // A hosted control's semantics live in the Host's Compose view, so search from there.
    val compositionOwner = if (host.isHostedByParent) host.parent as? View else null
    val root = findComposeRoot(compositionOwner ?: host)
    if (root == null) {
      reportAccessibilityStep("no Compose root (RootForTest) under the host")
      return
    }
    // Compose builds semantics only while an accessibility service is connected. Must come
    // first: the semantics owner is null until semantics are enabled.
    root.forceAccessibilityForTesting(true)
    // Declared non-null, but null until semantics exist.
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      reportAccessibilityStep("no SemanticsOwner, even after forcing accessibility on")
      return
    }
    // The merged tree is what a reader sees: `clearAndSetSemantics` hides Material's own node.
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val candidates = nodes.filter { it.config.contains(SemanticsActions.SetProgress) }
    val node = candidates.firstOrNull()
    if (node == null) {
      reportAccessibilityStep(
        "no node publishes SetProgress; nodes=" +
          nodes.joinToString(" ") { "#${it.id}[${it.config.joinToString(",") { e -> e.key.name }}]" },
      )
      return
    }
    if (candidates.size > 1) {
      // Inside a Host, two Sliders share one semantics tree and cannot be told apart here.
      reportAccessibilityStep("ambiguous: ${candidates.size} nodes publish SetProgress")
      return
    }
    val nodeDisabled = node.config.contains(SemanticsProperties.Disabled)
    val range = node.config.getOrElseNullable(SemanticsProperties.ProgressBarRangeInfo) { null }
    if (range == null) {
      reportAccessibilityStep(
        "#${node.id} has SetProgress but no range to move along; disabled=$nodeDisabled",
      )
      return
    }
    val action = node.config.getOrElseNullable(SemanticsActions.SetProgress) { null }
    if (action == null) {
      reportAccessibilityStep(
        "#${node.id} lost its action between looking and acting; disabled=$nodeDisabled",
      )
      return
    }
    // The delegate's stride for a scroll: the range over (ticks + 1), or over 20 without ticks.
    val width = range.range.endInclusive - range.range.start
    val stride =
      if (range.steps > 0) {
        width / (range.steps + 1)
      } else {
        width / 20f
      }
    val target = range.current + if (up) stride else -stride
    val from = model.displayed
    action.action?.invoke(target)
    reportAccessibilityStep(
      "performed SetProgress($target) on #${node.id} " +
        "range=${range.range.start}..${range.range.endInclusive}@${range.current} " +
        "$from->${model.displayed} disabled=$nodeDisabled",
    )
  }

  private fun reportAccessibilityStep(report: String) {
    // Numbered, so two identical outcomes still produce different report strings.
    model.accessibilityStepCount += 1
    model.accessibilityStepReport = "#${model.accessibilityStepCount} $report"
  }

  // `AndroidComposeView` is internal; `RootForTest` is the public interface it implements.
  private fun findComposeRoot(root: View): RootForTest? {
    val queue = ArrayDeque<View>()
    queue.add(root)
    while (queue.isNotEmpty()) {
      val node = queue.removeFirst()
      if (node is RootForTest) {
        return node
      }
      if (node is ViewGroup) {
        for (index in 0 until node.childCount) {
          queue.add(node.getChildAt(index))
        }
      }
    }
    return null
  }
}
