package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderColors
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
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

/*
 * The Slider component: Material 3 `Slider` on the core runtime, with the drag
 * owned natively. The value rules are in `NitroUiSliderValue.kt`; everything here
 * is about *when* a value is reported.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * `HybridNitroUiSliderManager` resolves `HybridNitroUiSlider` through a wildcard
 * import of exactly that package. Core helpers live in `...nitroui.core`.
 */

/**
 * The frame ticker one Slider's drag borrows: at most one emitted
 * `onValueChange` per frame (`docs/architecture/core.md` §11).
 *
 * An interface for two reasons. The probe has to be able to say whether a pump
 * outlived its drag, which [ChoreographerFramePump.isArmed] answers and nothing
 * in the event stream can - a pump with nothing pending emits nothing while it
 * ticks - and `SliderModelTest` has to drive a drag without a `Choreographer`,
 * which does not exist on the JVM.
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

/**
 * The Android pump: a `Choreographer` frame callback, which is one-shot - so a
 * drag re-posts it per sample ([SliderModel.dragTo]) and it goes away when the
 * samples do.
 *
 * [isArmed] is the pump's own lifecycle rather than a peek at the looper's queue:
 * between one callback firing and the next sample re-posting it, nothing is
 * queued, but the drag is still being served - and the question the probe exists
 * to answer is "did this outlive its drag", which reads the same either way.
 */
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

/** State of one Slider. See [NitroUiModel] for the shape this has to have. */
internal class SliderModel(
  private val pump: NitroUiFramePump = ChoreographerFramePump(),
) : NitroUiModel() {
  /** What the Slider shows. Snapshot-observed, so writing it recomposes. */
  var displayed by mutableStateOf(0.0)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the thumb and filled track, or `null` for the scheme's. */
  var tintColor by mutableStateOf<Int?>(null)

  /** `accessibilityLabel`, read by the composable - see the a11y rule in `docs/architecture/core.md`. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The range and step, observed: unlike a Switch's props these decide what the
   * control *is* (how far the thumb travels, whether it clicks), so a change has
   * to recompose it. Read together, in the one composable that draws the track.
   */
  var minimumValue by mutableStateOf(0.0)
  var maximumValue by mutableStateOf(1.0)
  var step by mutableStateOf(0.0)

  /** The size configuration React sent. Nothing native reads it. */
  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Double>(0.0)

  var defaultValue: Double? = null
  var didApplyDefault = false

  var onChange: ((Double, Double) -> Unit)? = null
  var onSlidingStart: ((Double, Double) -> Unit)? = null
  var onSlidingComplete: ((Double, Double) -> Unit)? = null

  // The un-emitted drag sample is NitroUiControlledValue.unreported - part of the
  // handshake itself rather than a Slider field, so "a React write may not
  // overtake a sample JS has not been told about" is one rule for every control
  // (core.md §4, §11). It stays unobserved because nothing renders it: what the
  // composable reads is [displayed], which [dragTo] also writes at sample time.

  /** Whether a drag is in flight. */
  var dragging = false

  /**
   * Bumped whenever an in-flight drag is abandoned, so work queued for that drag can
   * recognise itself and stop. A real touch stream cannot outlive its view;
   * [nuiTestDrag] queues its moves on the main looper and `prepareForRecycle`/
   * `onDropView` may run before every one of them lands, which would otherwise hand
   * the next owner of this instance somebody else's drag - the exact bug
   * [prepareForRecycle] exists to prevent.
   */
  var dragGeneration = 0
    private set

  /** Made once: [dragTo] hands it to the pump on every sample. */
  private val onFrame: () -> Unit = { deliverUnreported() }

  /** The value rule of [NitroUiSliderValue], applied to this Slider's range. */
  fun quantize(raw: Double): Double =
    NitroUiSliderValue.quantize(raw, minimumValue, maximumValue, step)

  /**
   * How many in-between tick marks M3's `steps` should draw, or 0 to hand the
   * range to the control continuous.
   *
   * Material 3 counts *stops between the endpoints*, so a range of n whole steps
   * has n - 1 of them, and it only draws the endpoints as stops when the range
   * ends on a step - the same condition iOS checks before handing SwiftUI a
   * `step:`. A range that does not end on one stays continuous here and is
   * quantised by [quantize], which keeps `maximumValue` reachable.
   */
  fun steppedTicks(): Int {
    val division = NitroUiSliderValue.division(minimumValue, maximumValue, step) ?: return 0
    if (!division.endsOnStep || division.wholeSteps < 1) {
      return 0
    }
    return maxOf(0, division.wholeSteps.toInt() - 1)
  }

  /** The next legal value above (or below) the one on screen. */
  fun stepped(
    from: Double,
    up: Boolean,
  ): Double = NitroUiSliderValue.stepped(from, up, minimumValue, maximumValue, step)

  /**
   * A screen reader asked for a value *toward* [target] - one gesture's worth of
   * callbacks (start, one change, complete), because an app cannot tell an
   * increment from a thumb release and must not have to.
   *
   * Only the *direction* comes from the platform. The destination is [stepped],
   * and that is the fix: M3's own action moves by a twentieth of the range, which
   * on a range that does not end on a step - `0..10 step 3`, the docs' own
   * example - quantises back to where it started, so the action reports success
   * and the thumb never moves while a start/change/complete triple is emitted for
   * nothing.
   *
   * The drag is opened and closed here rather than left to Compose: nothing
   * promises that an a11y write arrives with the pair of gesture callbacks a
   * finger produces, and on iOS a write that opened a drag without a matching end
   * left the frame pump running for the life of the view.
   *
   * Returns whether anything moved. At a bound there is no next value, and
   * emitting a triple for a value that did not change is the bug above wearing a
   * different hat.
   */
  fun accessibilityStepToward(target: Double): Boolean {
    if (!enabled) {
      return false
    }
    val from = displayed
    val up =
      when {
        target > from -> true
        target < from -> false
        else -> return false
      }
    val to = stepped(from, up)
    if (to == from) {
      return false
    }
    beginDrag()
    dragTo(to)
    endDrag()
    return true
  }

  /** Whether the frame pump is alive. Readable from any thread. */
  val isFramePumpArmed: Boolean
    get() = pump.isArmed

  /**
   * What the last a11y step probe did, as one line. The probe cannot answer
   * synchronously - it has to run on the UI thread, and a Nitro method may not
   * block for it - so it writes what happened here and JS reads it back, hence
   * `@Volatile`.
   */
  @Volatile var accessibilityStepReport: String = ""

  /**
   * How many a11y step probes have reported, used to number their reports.
   *
   * Written on the UI thread, which is the only thread a probe runs on (the seam
   * may not block for it), and read only to format the string above.
   */
  var accessibilityStepCount = 0

  /** A drag began. Reports the value it began from. */
  fun beginDrag() {
    if (dragging) {
      return
    }
    dragging = true
    startFramePump()
    onSlidingStart?.invoke(displayed, state.nativeEvents.toDouble())
  }

  /**
   * The finger moved. Displays at once, emits on the next frame.
   *
   * [displayed] is written here rather than at delivery so the thumb is under the
   * finger with no extra frame of latency, and so the quantised value - not the
   * raw position the control passed in, which has been through a float - is what
   * the next recomposition reads back.
   */
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
   * The finger lifted. The final value always reaches JS.
   *
   * Idempotent, and the guard is the event contract: only a drag that started may
   * end. Material 3 calls [onValueChangeFinished] for a tap that changed nothing
   * and Compose infers the start from the first value change ([dragTo]), so
   * without this a complete can arrive with no start; a late end after a
   * [cancelDrag] would deliver one to the next owner of a recycled instance.
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

  /**
   * Abandon an in-flight drag without reporting it: the view is being recycled or
   * dropped, and a callback delivered to whoever owned this instance before is a
   * callback delivered to the wrong app.
   */
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

  /**
   * The frame tick: one event for everything the finger did since the last one.
   *
   * The callback removes itself when it runs, so this is a heartbeat only while a
   * drag keeps sampling. It writes [state] and calls into JS, and writes no
   * observed state: [displayed] already holds this value, written when the finger
   * moved, and it can only hold it because no React write was applied in the
   * meantime - [NitroUiControlledValue.unreported] refuses those. Calling
   * `Snapshot.sendApplyNotifications()` here would be wrong twice over - it
   * belongs to the props path ([NitroComposeHost.commit]), and there is nothing
   * in this batch for anyone to see.
   */
  private fun deliverUnreported() {
    val value = state.unreported ?: return
    state.unreported = null
    // Exactly once per emitted event: this is what increments `nativeEvents`, and
    // JS echoes the count back, so an increment nobody emitted would leave the
    // handshake permanently behind and freeze every later `value` write.
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
 * The Slider's host: [NitroComposeHost] plus this component's composable.
 *
 * [Component] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda.
 */
/**
 * The library's `SliderColors`, so a tinted Slider costs one object per
 * (colour scheme, tint) instead of one per recomposition.
 *
 * A copy of `SwitchColorsCache` for the rule main added to
 * `docs/architecture/core.md` ("Shared objects"): a hosted control is its own
 * composition, so `remember` shares nothing between controls, and
 * `SliderDefaults.colors(...)` is a factory that builds a fresh object per call -
 * once per recomposition per mounted Slider, on the UI thread, in the middle of
 * what D15 measures. `SliderColors` is an interface in Material 3 1.4 with no
 * `equals`, so there is not even a cheap comparison to fall back on.
 */
private object SliderColorsCache {
  /** Tints to remember before starting over. See the Switch's cache. */
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

  /** Drop what a different scheme invalidates. Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

/**
 * The Slider's colours for [tint] (an ARGB int, or `null` for the scheme's own),
 * served by [SliderColorsCache]; the Switch's copy of this reasoning is in
 * `HybridNitroUiSwitch.kt`, including why the composable call stays on the miss.
 */
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
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one.
   *
   * [HybridNitroUiSlider.nuiTestAccessibilityStep] asks Compose to build its
   * semantics tree with no reader connected - that is how a harness reaches the
   * action a reader would use. Compose then announces every later semantics
   * change up this view's parent chain, and [AccessibilityManager] answers an
   * announcement it has no recipient for with
   * `IllegalStateException: Accessibility off. Did you forget to check that?`
   * rather than with a refusal, which takes the app down mid-test. Refusing here
   * is the outcome the platform was reaching anyway - no reader, no recipient -
   * without the exception, and it is inert when a reader really is connected,
   * because then the check passes and [super] runs.
   */
  override fun requestSendAccessibilityEvent(
    child: View,
    event: AccessibilityEvent,
  ): Boolean {
    if (systemAccessibility?.isEnabled != true) {
      return false
    }
    return super.requestSendAccessibilityEvent(child, event)
  }

  @Composable
  override fun Component(model: SliderModel) {
    // Everything that decides what the control *is* is read in [SliderTrack],
    // including the value a drag moves, so a drag frame invalidates one
    // composable rather than everything around it (`docs/architecture/core.md`,
    // §11 Recomposition scoping).
    SliderTrack(
      model = model,
      enabled = model.enabled,
      colors = sliderColors(model.tintColor),
    )
  }
}

/**
 * The one composable that reads the value a drag moves. Everything else in this
 * component reads props that only change at the ends of a gesture.
 */
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
  // One accessibility node, whose progress action belongs to native.
  //
  // `clearAndSetSemantics` rather than an extra `semantics { }` beside M3's own:
  // M3's `sliderSemantics` publishes a `setProgress` that moves by a twentieth of
  // the range, and two nodes offering that action on one control is an
  // ambiguity - plus, on a range that does not end on a step, M3's version
  // quantises back to where it started (`SliderModel.accessibilityStepToward`).
  // Clearing the subtree leaves exactly one node, publishing exactly one rule.
  //
  // It has to *say* what it is, too. M3 1.4's Slider publishes a `setProgress`,
  // a `contentDescription` and a percentage `stateDescription`, but no progress
  // range - so clearing takes away the action and leaves the range to be stated
  // here. The range is what the accessibility delegate reads to decide where a
  // scroll forward lands (`performActionHelper` divides it into strides), so it
  // has to be this Slider's real range and current value.
  Box(
    modifier =
      Modifier.clearAndSetSemantics {
        if (label != null) {
          contentDescription = label
        }
        progressBarRangeInfo = ProgressBarRangeInfo(displayed.toFloat(), range, ticks)
        setProgress { target -> model.accessibilityStepToward(target.toDouble()) }
        // M3's `sliderSemantics` is where `disabled()` lived, and the line above
        // clears that subtree, so a disabled Slider has to restate it. Without it
        // TalkBack reads an inert control - the action is refused - as a live,
        // adjustable one. iOS marks the same element `.notEnabled`
        // (`HybridNitroUiSlider.swift`).
        if (!enabled) {
          disabled()
        }
      },
  ) {
    Slider(
      value = displayed.toFloat(),
      onValueChange = { position -> model.dragTo(position.toDouble()) },
      enabled = enabled,
      valueRange = range,
      steps = ticks,
      // Compose has no drag-start callback, so the first value change is the start
      // (`docs/architecture/core.md` §11) - `SliderModel.dragTo` opens the drag.
      onValueChangeFinished = { model.endDrag() },
      colors = colors,
    )
  }
}

/**
 * The range to hand M3, as a valid non-empty float range.
 *
 * Material 3 divides by the width of this range, so an empty one would put NaN in
 * the thumb offset, and an inverted one is app data rather than a crash. Such a
 * range has one value - the minimum, which stays inside what is passed either
 * way - so the thumb sits at an end and every interaction lands back on it.
 */
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

/** The Hybrid View React renders as `NitroUiSlider`. */
class HybridNitroUiSlider(
  reactContext: ThemedReactContext,
) : HybridNitroUiSliderSpec(), RecyclableView {

  private val model = SliderModel()
  private val host = SliderHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine. */
    private const val SIZING_COMPONENT_NAME = "NitroUiSlider"

    /**
     * The size to lay a Slider out with before anything has been measured, in dp.
     *
     * Only the height is really ours: for a `fillWidth` control the shadow node
     * replaces the width with the Yoga box's whenever that box is finite
     * (`cpp/NitroUiIntrinsic.hpp:208`). The width still has to be a plausible
     * number, because an unbounded parent is the one case where it survives - a
     * Slider in a horizontal scroller lays out at this width until its own
     * measurement arrives.
     *
     * The height is measured on the task's emulator, not read out of the spec
     * (DECISIONS D14): Material 3's `Slider` measures **48 dp** tall as Compose
     * lays it out here - the visible track is a few dp of that, and the rest is
     * `minimumInteractiveComponentSize`, Material's 48 dp touch target, which the
     * control includes in its own size. A box any smaller clips the thumb.
     *
     * 48 is also the number the harness asserts (`Slider.harness.tsx`'s
     * `EXPECTED_HEIGHT`), and the first build of this component declared 40 -
     * which the old clamped measurement could not contradict, because a box 40 dp
     * tall reports 40 dp back. See `NitroUiMeasuredRoot`: the height has to be
     * measured free for the declared number to be checkable at all.
     */
    private const val FALLBACK_WIDTH_DP = 328.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private var fallbackDeclared = false

    /** One JNI call per process, before the first Slider can be measured. */
    private fun declareFallback() {
      if (fallbackDeclared) {
        return
      }
      fallbackDeclared = true
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
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValue: Variant_NullType_Double
    get() =
      model.defaultValue?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Stored raw. `afterUpdate()` is where it becomes a value, because the range
      // it has to be quantised against may arrive in the same batch, and Nitro
      // does not order props inside one.
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
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates, so an
      // opaque colour above `Int.MAX_VALUE` would become `Int.MAX_VALUE`.
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

  // The three callbacks are one contract, so they are wired the same way: store,
  // never mark dirty, and never read back - a callback is not state.
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
    // `value`, `defaultValue`, `minimumValue`, `maximumValue` and `step` can all
    // land in one batch, in any order, so none of them is interpreted until the
    // batch is complete. A `value` of 0.3 is only a legal number once the range it
    // belongs to is known - reading it in the `value` setter would mean quantising
    // against last batch's range.
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
    // The handshake decides whether React's write wins over what the user just
    // dragged to - which mid-drag it legitimately does not (§11).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A range or step that moved under an existing value can leave the shown value
    // outside it. The same rule, and idempotent, so a value that is already legal
    // - including one a drag is holding - comes back unchanged.
    val shown = model.quantize(model.state.displayed)
    if (shown != model.state.displayed) {
      model.state.displayed = shown
      model.displayed = shown
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // [SliderModel.reset] cancels the drag first: a recycled row that resumes
    // somebody else's drag is a real bug, and the frame callback would still be
    // posted to emit it.
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

  /**
   * The size Compose measured for this Slider at the width Yoga gave it, in dp.
   * Never calls into Compose, so it is safe on the JS thread (§1.4).
   */
  override fun measureContent(): NitroUiSliderSize {
    val size = host.contentSize ?: return NitroUiSliderSize(0.0, 0.0)
    return NitroUiSliderSize(size.width, size.height)
  }

  /**
   * Drive one drag through the real interaction pipeline. Test-only; see the spec's
   * doc comment for why it exists.
   *
   * `msPerStep` 0 runs every move in **one** main-thread turn, so no frame passes
   * between them and no frame callback can run: a pipeline that emitted per move
   * would report [steps] events here and reports one. With a positive `msPerStep`
   * each move waits its turn on the looper, frames pass between them, and the same
   * pipeline reports several - which is what stops the first case from passing for
   * the wrong reason.
   */
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
    // A disabled control is inert: M3 does not call `onValueChange`, so a simulated
    // drag must not either. Skipping here is what lets the harness assert "disabled
    // emits nothing" at all, since the harness has no drag synthesiser to make the
    // control itself move.
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

  /**
   * Perform the platform's own adjust action on the node this control publishes:
   * the `SetProgress` semantics action an a11y service reaches through
   * `ACTION_SCROLL_FORWARD`/`BACKWARD`, with the target the Compose accessibility
   * delegate computes for that gesture - the current progress plus or minus a
   * twentieth of the published range. Test-only; see the spec's doc comment.
   *
   * There is deliberately **no fallback**: with no node offering the action, this
   * does nothing and says so in the report. Calling
   * [SliderModel.accessibilityStepToward] directly would move the value either way
   * and prove nothing about the path TalkBack actually takes, which is the thing
   * under test.
   */
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

  private fun runTestAccessibilityStep(up: Boolean) {
    val root = findComposeRoot(host)
    if (root == null) {
      reportAccessibilityStep("no Compose root (RootForTest) under the host")
      return
    }
    // Compose builds its semantics tree only while an accessibility service is
    // connected, and a harness run has none. This is how Compose's own tests ask
    // for the tree; it stays on for this view afterwards, which a test-only seam
    // may do. It has to come first: the owner is a field that only exists once
    // semantics are enabled, so reading it before this reads null.
    root.forceAccessibilityForTesting(true)
    // Declared non-null, nullable in fact - the field behind it is null until
    // semantics exist - so it is read into a nullable val rather than compared.
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      reportAccessibilityStep("no SemanticsOwner, even after forcing accessibility on")
      return
    }
    // The merged tree, because that is the tree a reader is given: a node whose
    // subtree was cleared by `clearAndSetSemantics` is a merging boundary, so the
    // merged walk stops at ours and never shows the wrapped M3 `Slider`'s own node.
    // The unmerged walk shows both - two nodes publishing `SetProgress`, only one
    // of them carrying this control's rule - which is exactly the ambiguity the
    // check below reports when it appears.
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
      // Two nodes offering one action is the ambiguity `clearAndSetSemantics`
      // exists to remove; saying so here is what stops a passing test from hiding
      // a control whose *other* action is the wrong rule.
      reportAccessibilityStep("ambiguous: ${candidates.size} nodes publish SetProgress")
      return
    }
    // Whether the node the reader is handed carries the `Disabled` flag. `SliderTrack`
    // owns this via `if (!enabled) disabled()`; `clearAndSetSemantics` clears M3's own
    // `sliderSemantics` (where that flag used to come from), so this is the one place
    // the harness can see whether a disabled Slider still tells a reader it is
    // disabled rather than looking like a live, adjustable control.
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
    // The delegate's own stride for a scroll forward/back, from
    // `performActionHelper`: the range divided by the tick count plus the two
    // ends, or into twenty when there are no ticks. Sent from the progress the
    // node publishes - the delegate's start, not the model's.
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
    // The counter makes every report a new string. Without it, two steps that do
    // the same thing - the no-op at a bound, or a step on a one-value range - are
    // byte-identical, and a harness waiting for "the report changed" cannot tell
    // "the probe ran and nothing moved" from "the probe has not run yet".
    model.accessibilityStepCount += 1
    model.accessibilityStepReport = "#${model.accessibilityStepCount} $report"
  }

  /**
   * The Compose view under [root], found as [RootForTest] rather than as
   * `AndroidComposeView`: that class is internal to Compose's own module, so the
   * public interface it implements is the only legal handle on it - which is also
   * the one that carries [RootForTest.getSemanticsOwner].
   */
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
