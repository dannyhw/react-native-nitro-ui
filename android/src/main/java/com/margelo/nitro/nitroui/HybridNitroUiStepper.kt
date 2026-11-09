package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/*
 * The Stepper component.
 *
 * Material has no stepper (D38 item 1), so Android gets one built out of Material's
 * own controls: two `FilledTonalIconButton`s with an 8 dp gap, each disabled at its
 * bound, drawing Google's `remove` and `add` glyphs (D43). `docs/components/stepper.md`
 * says this plainly, because a reader is entitled to know which half of the pair is
 * not a platform control - and which behaviour iOS has and this one does not
 * (hold-to-repeat, in v1).
 *
 * The container, colours, shapes and touch target are IconButton's, shared rather than
 * copied (`nitroUiIconButtonContainer`, `iconButtonColors`, `iconButtonShapes`): a
 * second copy is two controls that drift. The value rules are Slider's
 * (`NitroUiSliderValue`), for the same reason - `0.1` steps have to mean the same
 * thing in both controls, and the moment two implementations exist they don't.
 *
 * The accessibility story is the opposite of the visual one: what a reader meets is
 * not two buttons but one adjustable value, so the row publishes a
 * `ProgressBarRangeInfo` with a `setProgress` action and the two buttons clear their
 * own semantics away. That is how a TalkBack swipe steps it, and how it matches
 * iOS's single adjustable element.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one Stepper. See [NitroUiModel] for the shape this has to have. */
internal class StepperModel : NitroUiModel() {
  /** What the control shows. Snapshot-observed: writing it recomposes. */
  var displayed by mutableStateOf(0.0)

  var minimumValue by mutableStateOf(0.0)

  var maximumValue by mutableStateOf(100.0)

  var step by mutableStateOf(1.0)

  /** `!disabled`, spelled positively for M3. Observed: it picks the disabled colours. */
  var enabled by mutableStateOf(true)

  /** The control's name. The *value* is what the range info carries. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Double>(0.0)

  var defaultValue: Double? = null

  var didApplyDefault = false

  var onValueChange: ((Double, Double) -> Unit)? = null

  /** Test-only read-outs, behind one lock: probes are posted to main, reports read from JS. */
  private val reportLock = Any()
  private var drawn = "none"
  private var up = "none"
  private var down = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"
  private var pixelProbes = 0
  private var pixelReport = ""
  private var stepCount = 0
  private var stepReport = "none"

  /**
   * Record what the drawing code was handed: the number the control is showing, and
   * which half a tap could still move it.
   *
   * The two halves are recorded *here*, from the same answer the two buttons were
   * given, so `up=0` is evidence about the plus button's own `enabled` rather than a
   * second calculation that could agree with the model and disagree with the screen.
   * iOS records the same two fields from the same rule
   * (`HybridNitroUiStepper.swift`), which is what lets one assertion cover both.
   */
  fun recordDrawn(
    value: String,
    canStepUp: Boolean,
    canStepDown: Boolean,
  ) {
    synchronized(reportLock) {
      drawn = value
      up = if (canStepUp) "1" else "0"
      down = if (canStepDown) "1" else "0"
    }
  }

  /** Store what an accessibility probe found, numbered and counted. */
  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** Store what a pixel probe found, numbered, so a test can tell it from an earlier one. */
  fun publishPixelReport(report: String) {
    synchronized(reportLock) {
      pixelProbes += 1
      pixelReport = "n=$pixelProbes $report"
    }
  }

  fun readPixelReport(): String = synchronized(reportLock) { pixelReport }

  /** `displayed=…;probes=…;merged=…;pixel=…;a11y=…`. Safe from any thread. */
  fun stateReport(): String {
    synchronized(reportLock) {
      return "displayed=$drawn;up=$up;down=$down;probes=$probes;merged=$merged;" +
        "pixel=$pixelReport;a11y=$accessibilityReport"
    }
  }

  /**
   * Store an adjust-action report and count it, so two reports that do the same thing
   * - the no-op at a bound - are still two different strings for a test waiting on
   * "the report changed" (Slider's reason).
   */
  fun noteStepReport(report: String) {
    synchronized(reportLock) {
      stepCount += 1
      stepReport = "#$stepCount $report"
    }
  }

  fun currentStepReport(): String = synchronized(reportLock) { stepReport }

  /** Store how many nodes a reader is offered. */
  fun recordMerged(count: String) {
    synchronized(reportLock) { merged = count }
  }

  override fun reset() {
    displayed = 0.0
    minimumValue = 0.0
    maximumValue = 100.0
    step = 1.0
    enabled = true
    accessibilityLabel = null
    sizingKey = ""
    state.displayed = 0.0
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultValue = null
    didApplyDefault = false
    onValueChange = null
    synchronized(reportLock) {
      drawn = "none"
      up = "none"
      down = "none"
      probes = 0
      merged = "none"
      accessibilityReport = "none"
      pixelProbes = 0
      pixelReport = ""
      stepCount = 0
      stepReport = "none"
    }
  }

  // The value rules, which are Slider's.

  fun quantize(raw: Double): Double =
    NitroUiSliderValue.quantize(raw, minimumValue, maximumValue, step)

  /**
   * The range to publish to a reader: always ordered, because a reader has no way to
   * read an inverted one, and a float range because that is what
   * `ProgressBarRangeInfo` takes.
   *
   * The float conversion is not free: a `0.1` grid past 2^24 would round-trip through
   * 32 bits and land somewhere the model never holds. That is Slider's
   * [trackRange]'s problem too and the reason it widens a degenerate range instead
   * of publishing an empty one, which is kept here - an empty range puts NaN in
   * whatever divides by its width.
   */
  fun trackRange(): ClosedFloatingPointRange<Float> {
    if (!minimumValue.isFinite() || !maximumValue.isFinite()) {
      return 0f..1f
    }
    val low = minOf(minimumValue, maximumValue).toFloat()
    val high = maxOf(minimumValue, maximumValue).toFloat()
    if (!low.isFinite() || !high.isFinite()) {
      return 0f..1f
    }
    if (high > low) {
      return low..high
    }
    val widened = low + 1f
    return if (widened.isFinite()) low..widened else 0f..1f
  }

  /** The next legal value in one direction, or the bound when there is none. */
  fun stepped(from: Double, up: Boolean): Double =
    NitroUiSliderValue.stepped(from, up, minimumValue, maximumValue, step)

  /** Whether a step in [up] would change anything - which is what disables that half. */
  fun canStep(up: Boolean): Boolean = enabled && stepped(displayed, up) != displayed

  /** The reader's own number of intermediate stops, from the same grid. */
  fun progressSteps(): Int {
    val division = NitroUiSliderValue.division(minimumValue, maximumValue, step) ?: return 0
    // `ProgressBarRangeInfo.steps` counts the stops *between* the ends, so a range of
    // `wholeSteps` intervals publishes `wholeSteps - 1`. That is also the number
    // Compose's accessibility delegate divides the range by (`stride = width /
    // (steps + 1)`), so publishing the real grid is what makes one of its scrolls
    // land on one of our steps rather than on a twentieth of the span.
    return maxOf(0, division.wholeSteps.toInt() - 1)
  }

  /**
   * The value the control now displays, asked for by a tap or a reader's action.
   *
   * Native is optimistic: show the new value now, before React has seen the event,
   * so there is no visual latency (§4). Asking for the value already shown reports
   * nothing, which is what makes "a tap at a bound does nothing" true on both
   * platforms rather than a claim about one button's `enabled` flag.
   */
  fun userStep(to: Double): Boolean {
    val next = quantize(to)
    if (next == displayed) {
      return false
    }
    val eventCount = state.user(next)
    displayed = next
    onValueChange?.invoke(next, eventCount.toDouble())
    return true
  }

  /** One step, refused while disabled, as M3 refuses a tap on a disabled button. */
  fun step(up: Boolean): Boolean {
    if (!enabled) {
      return false
    }
    return userStep(stepped(displayed, up))
  }

  /**
   * The reader's `setProgress`, which is handed a *target* rather than a direction.
   *
   * The direction is read from the target against the progress this node publishes,
   * and one step of *this* control is then taken - not a jump to the target, which on
   * a range that does not end on a step is a number the grid has never had
   * (`SliderModel.accessibilityStepToward` is the same answer for the same reason).
   *
   * Returns whether anything moved, because that is the action's contract.
   */
  fun accessibilityStepToward(
    target: Double,
    publishedProgress: Double,
  ): Boolean {
    val up =
      when {
        target > publishedProgress -> true
        target < publishedProgress -> false
        else -> return false
      }
    return step(up)
  }
}

/**
 * The Stepper's host: [NitroComposeHost] plus this component's composable.
 *
 * [Component] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda.
 */
private class StepperHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: StepperModel,
) : NitroComposeHost<StepperModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one - the
   * Chip, Slider and IconButton hosts' guard: `nuiTestProbeAccessibility` forces
   * Compose's semantics on with no reader connected, and an announcement with no
   * recipient throws `Accessibility off. Did you forget to check that?`.
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
  override fun Component(model: StepperModel) {
    val enabled = model.enabled
    val displayed = model.displayed
    val label = model.accessibilityLabel
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the controls are handed rather than what React sent.
    val range = model.trackRange()
    val progressSteps = model.progressSteps()
    // The two halves ask the same question the tap answers: would a step this way
    // change anything? At a bound it would not, and M3 draws the disabled colours and
    // refuses the click - iOS's Stepper does the same thing to its own half, which is
    // what keeps one rule for the pair.
    val canStepDown = model.canStep(up = false)
    val canStepUp = model.canStep(up = true)
    model.recordDrawn(nitroUiStepperValueText(displayed), canStepUp, canStepDown)

    Row(
      verticalAlignment = Alignment.CenterVertically,
      modifier =
        // One node, whose progress action belongs to native - Slider's structure,
        // because the requirement is the same: a reader must meet one adjustable
        // value, not two buttons. `mergeDescendants` makes this row that one node, and
        // each button clears its own semantics away, so neither offers a click a
        // reader could take (which is what `nuiTestProbeAccessibility` counts).
        Modifier.semantics(mergeDescendants = true) {
          if (label != null) {
            contentDescription = label
          }
          progressBarRangeInfo =
            ProgressBarRangeInfo(
              displayed.toFloat(),
              range,
              progressSteps,
            )
          // The direction comes from the target; the distance is always one step of
          // this control's own grid, decided against the progress *this* node
          // publishes (the number the delegate built its target from).
          setProgress { target ->
            model.accessibilityStepToward(target.toDouble(), publishedProgress = displayed)
          }
          // `clearAndSetSemantics` on the buttons took M3's own `disabled()` away with
          // them, so a disabled stepper has to restate it here. Without it TalkBack
          // reads an inert control as a live, adjustable one - and iOS marks the same
          // element `.notEnabled` (`HybridNitroUiStepper.swift`).
          if (!enabled) {
            disabled()
          }
        },
    ) {
      StepperHalf(
        model = model,
        iconRes = R.drawable.nitroui_remove,
        enabled = canStepDown,
        onClick = { model.step(up = false) },
      )
      // The gap the design asks for, between the two 48 dp targets.
      Spacer(Modifier.width(8.dp))
      StepperHalf(
        model = model,
        iconRes = R.drawable.nitroui_add,
        enabled = canStepUp,
        onClick = { model.step(up = true) },
      )
    }
  }
}

/**
 * One half of the control: a Material 3 filled tonal icon button, at the rung the
 * container helper fixes, drawing one of the library's own Material Symbols.
 *
 * Its semantics are cleared rather than merely unused: the row publishes the one
 * adjustable node a reader should meet, and a button that keeps its own node is a
 * second focus stop with a click on it that no reader should be offered.
 */
@Composable
private fun StepperHalf(
  model: StepperModel,
  iconRes: Int,
  enabled: Boolean,
  onClick: () -> Unit,
) {
  FilledTonalIconButton(
    onClick = onClick,
    modifier =
      nitroUiIconButtonContainer(
        scale = IconButtonScale.Medium,
        width = IconButtonWidth.Uniform,
        leading = Modifier.clearAndSetSemantics {},
      ),
    enabled = enabled,
    colors = iconButtonColors(IconButtonVariant.Tonal, tint = null),
    shapes = iconButtonShapes(IconButtonScale.Medium, IconButtonCorner.Round),
  ) {
    NitroUiIconGlyph(
      painter = rememberVectorPainter(nitroUiIcon(iconRes)),
      size = IconButtonScale.Medium.iconSize(),
      tint = LocalContentColor.current,
      // No description: the row names the control, and a second description would be
      // read twice by TalkBack - and these halves are not focus stops anyway.
      contentDescription = null,
    )
  }
}

/** The Hybrid View React renders as `NitroUiStepper`. */
class HybridNitroUiStepper(
  reactContext: ThemedReactContext,
) : HybridNitroUiStepperSpec(),
  RecyclableView {
  private val model = StepperModel()
  private val host = StepperHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine (`getName()` in the generated manager). */
    private const val SIZING_COMPONENT_NAME = "NitroUiStepper"

    /**
     * The size to lay a Stepper out with before anything has been measured, in dp:
     * two 48 dp touch targets and the 8 dp between them, 48 dp tall.
     *
     * Each half is a 40 dp container inside a 48 dp target, so the target - not the
     * container - is what the row measures, for IconButton's reason: Compose will not
     * publish a smaller touch target than the platform asks for. Measured, not
     * inferred: `Stepper.harness.tsx`'s sizing cases compare the laid-out box with
     * this number, and a declaration that is wrong is a wrong first frame on every
     * cold mount (D17).
     */
    private const val FALLBACK_WIDTH_DP = 104.0

    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One `JNI` call per process; `NitroUiDeclaredFallbacks` calls it at package init. */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_INTRINSIC,
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
      // Not visual on its own: `displayed` only follows once the event count says JS
      // has caught up. See `afterUpdate()`.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValue: Variant_NullType_Double
    get() =
      model.defaultValue?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Stored raw: the range it has to be quantised against may arrive in the same
      // batch, and Nitro does not order props inside one.
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
      // Repaints and re-enables; the box is the same either way, which is what
      // `Stepper.harness.tsx`'s one-box case checks rather than assumes.
      model.enabled = enabled
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // The host's tag, which is what RN's testID matchers read on Android — IconButton's
      // answer, and the reason the prop exists on this platform at all: the
      // generated manager forwards props to this class and nothing else, so a
      // stored-only `testID` leaves the node invisible to every harness query.
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
      // Rendered (it is the node's name), and never a measure: a name is not width.
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
      host.perfInstanceId =
        if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      model.sizingKey = next
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = next.toLong()
    }

  override var onValueChange: ((Double, Double) -> Unit)?
    get() = model.onValueChange
    set(next) {
      model.onValueChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // `value`, `defaultValue`, `minimumValue`, `maximumValue` and `step` can all land
    // in one batch in any order, so none of them is interpreted until the batch is
    // complete (Slider's rule, and the same reason).
    model.state.js?.let { js ->
      val quantised = model.quantize(js)
      if (quantised != js) {
        model.state.js = quantised
      }
    }
    if (model.state.js == null && !model.didApplyDefault) {
      model.defaultValue?.let { default ->
        model.didApplyDefault = true
        model.displayed = model.quantize(default)
        host.markDirty()
      }
    }
    // The handshake decides whether React's write wins over what the user just
    // stepped to (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A range or step that moved under an existing value can leave the shown value
    // outside it. Idempotent, so a value that is already legal comes back unchanged.
    val shown = model.quantize(model.displayed)
    if (shown != model.displayed) {
      model.displayed = shown
      model.state.displayed = shown
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle (core.md §6), and
    // `host.prepareForRecycle()` resets the model - including the handshake counters
    // the next owner's first `value` write is judged against.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onValueChange = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiStepperSize {
    val size = host.contentSize ?: return NitroUiStepperSize(0.0, 0.0)
    return NitroUiStepperSize(size.width, size.height)
  }

  /** One step through the tap's path, on the UI thread (see the spec). Returns at once. */
  override fun nuiTestStep(direction: Double) {
    val up = direction >= 0.0
    Handler(Looper.getMainLooper()).post { model.step(up) }
  }

  /**
   * Perform the reader's own action on the merged node, test-only.
   *
   * There is deliberately **no fallback**: with no node publishing `SetProgress` the
   * probe does nothing and says so. Calling `model.step(…)` instead would move the
   * value either way and prove nothing about the path a screen reader takes, which is
   * the whole thing under test (Slider's rule).
   */
  override fun nuiTestAccessibilityStep(direction: Double) {
    val up = direction >= 0.0
    Handler(Looper.getMainLooper()).post { runTestAccessibilityStep(up) }
  }

  override fun nuiTestAccessibilityStepReport(): String = model.currentStepReport()

  /** Read the control's semantics node on the UI thread (see the spec). Returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      // One walk of the tree, two fields: the count is the half that says the two
      // buttons are not quiet focus stops, and the line says what the one node tells
      // a reader.
      val (merged, detail) = describeAccessibility()
      model.recordMerged(merged)
      model.recordAccessibility(detail)
    }
  }

  /**
   * Sample the pixels this control draws for [color] (an ARGB `processColor` int).
   *
   * Android is the platform with something to sample: these two halves draw the
   * Material Symbols the library ships, and "the glyphs are drawn" is a drawing
   * contract no prop echo answers (IconButton's probe is the sampler).
   */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.readPixelReport()

  override fun nuiTestStateReport(): String = model.stateReport()

  /**
   * The merged node a reader is handed, as `(<nodes publishing SetProgress>,
   * <one line about it>)`.
   *
   * The count is in the report because "the buttons are cleared from the tree" is half
   * of what the accessibility rule claims, and a report about one node says nothing if
   * there are quietly two.
   */
  private fun describeAccessibility(): Pair<String, String> {
    val root = findComposeRoot(host) ?: return "none" to "no Compose root"
    root.forceAccessibilityForTesting(true)
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      return "none" to "no SemanticsOwner, even after forcing accessibility on"
    }
    // The merged tree, because that is the tree a reader is given (Slider's reason).
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val candidates = nodes.filter { it.config.contains(SemanticsActions.SetProgress) }
    val clickable = nodes.count { it.config.contains(SemanticsActions.OnClick) }
    val node: SemanticsNode =
      when (candidates.size) {
        0 -> {
          return "${nodes.size} nodes; ${clickable} clickable" to
            "no node publishes SetProgress; nodes=" +
            nodes.joinToString(" ") { "#" + it.id + "[" + it.config.joinToString(",") { e -> e.key.name } + "]" }
        }
        1 -> candidates[0]
        else -> return "${candidates.size} nodes" to "ambiguous: ${candidates.size} nodes publish SetProgress"
      }
    val config = node.config
    val range = config.getOrNull(SemanticsProperties.ProgressBarRangeInfo)
    val disabled = config.contains(SemanticsProperties.Disabled)
    val label =
      config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
        ?: ""
    val rangeText =
      if (range == null) {
        "none"
      } else {
        "${nitroUiStepperValueText(range.range.start.toDouble())}" +
      "..${nitroUiStepperValueText(range.range.endInclusive.toDouble())}" +
      "@${nitroUiStepperValueText(range.current.toDouble())}/steps=${range.steps}"
      }
    // The value as the *node* carries it, not as the model remembers it: a reader
    // hears the progress this node publishes, and iOS spells its own
    // `accessibilityValue` the same way, so the two platforms can be read alike.
    val valueText =
      range?.let { nitroUiStepperValueText(it.current.toDouble()) } ?: "none"
    return candidates.size.toString() to
      "range=$rangeText,value=$valueText,clickable=$clickable,disabled=$disabled," +
      "label=$label"
  }

  private fun runTestAccessibilityStep(up: Boolean) {
    val root = findComposeRoot(host)
    if (root == null) {
      model.noteStepReport("no Compose root (RootForTest) under the host")
      return
    }
    root.forceAccessibilityForTesting(true)
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      model.noteStepReport("no SemanticsOwner, even after forcing accessibility on")
      return
    }
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val candidates = nodes.filter { it.config.contains(SemanticsActions.SetProgress) }
    val node = candidates.firstOrNull()
    if (node == null) {
      model.noteStepReport(
        "no node publishes SetProgress; nodes=" +
          nodes.joinToString(" ") { "#" + it.id + "[" + it.config.joinToString(",") { e -> e.key.name } + "]" },
      )
      return
    }
    if (candidates.size > 1) {
      model.noteStepReport("ambiguous: ${candidates.size} nodes publish SetProgress")
      return
    }
    val range = node.config.getOrNull(SemanticsProperties.ProgressBarRangeInfo)
    if (range == null) {
      model.noteStepReport("#${node.id} has SetProgress but no range to move along")
      return
    }
    val action = node.config.getOrNull(SemanticsActions.SetProgress)
    if (action == null) {
      model.noteStepReport("#${node.id} lost its action between looking and acting")
      return
    }
    // The delegate's own stride for a scroll forward/back, from `performActionHelper`:
    // the range divided by the tick count plus the two ends, or into twenty when there
    // are no ticks. Sent from the progress the node publishes - the delegate's start,
    // not the model's.
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
    model.noteStepReport(
      "performed SetProgress(${nitroUiStepperValueText(target.toDouble())}) on #${node.id} " +
        "range=${nitroUiStepperValueText(range.range.start.toDouble())}" +
        "..${nitroUiStepperValueText(range.range.endInclusive.toDouble())}" +
        "@${nitroUiStepperValueText(range.current.toDouble())} " +
        "${nitroUiStepperValueText(from)}->${nitroUiStepperValueText(model.displayed)} " +
        "disabled=${node.config.contains(SemanticsProperties.Disabled)}",
    )
  }

  /**
   * The Compose view under [root], as [RootForTest] rather than as
   * `AndroidComposeView`: that class is internal to Compose's own module, so the
   * public interface it implements is the only legal handle on it - which is also the
   * one that carries [RootForTest.getSemanticsOwner].
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

/**
 * The number the control was handed, without a float's noise: `4.0` reads as `4` and
 * `0.1` stays `0.1`. The iOS twin is `StepperModel/accessibilityValueText`, and the
 * harness compares what each platform *drew*, so the two spellings have to agree.
 */
internal fun nitroUiStepperValueText(value: Double): String =
  if (value.isFinite() && value % 1.0 == 0.0 && abs(value) < 1e15) {
    value.toLong().toString()
  } else {
    value.toString()
  }
