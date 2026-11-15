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
import androidx.compose.ui.semantics.stateDescription
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

// The Stepper component. Material has no stepper, so this is two filled tonal icon buttons
// that publish one adjustable accessibility node. Must stay in this package (generated manager).

internal class StepperModel : NitroUiModel() {
  var displayed by mutableStateOf(0.0)

  var minimumValue by mutableStateOf(0.0)

  var maximumValue by mutableStateOf(100.0)

  var step by mutableStateOf(1.0)

  var enabled by mutableStateOf(true)

  var accessibilityLabel by mutableStateOf<String?>(null)

  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Double>(0.0)

  var defaultValue: Double? = null

  var didApplyDefault = false

  /**
   * Adopts `defaultValue` once, while React has sent no `value`. Both [displayed] and
   * `state.displayed` move: the handshake compares React's next write against the latter.
   */
  fun applyDefaultOnce(): Boolean {
    if (state.js != null || didApplyDefault) {
      return false
    }
    val default = defaultValue ?: return false
    didApplyDefault = true
    val shown = quantize(default)
    displayed = shown
    state.displayed = shown
    return true
  }

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

  // Test-only: what the composable was handed, recorded where it is drawn.
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

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

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

  // Numbered, so two identical outcomes still produce different report strings.
  fun noteStepReport(report: String) {
    synchronized(reportLock) {
      stepCount += 1
      stepReport = "#$stepCount $report"
    }
  }

  fun currentStepReport(): String = synchronized(reportLock) { stepReport }

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

  /** An ordered, non-empty float range for `ProgressBarRangeInfo`: an empty one gives NaN. */
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

  fun stepped(from: Double, up: Boolean): Double =
    NitroUiSliderValue.stepped(from, up, minimumValue, maximumValue, step)

  /** Whether a step in [up] would change anything - which is what disables that half. */
  fun canStep(up: Boolean): Boolean = enabled && stepped(displayed, up) != displayed

  fun progressSteps(): Int {
    val division = NitroUiSliderValue.division(minimumValue, maximumValue, step) ?: return 0
    // `ProgressBarRangeInfo.steps` counts the stops between the ends. Compose's accessibility
    // delegate strides by width / (steps + 1), so this makes one scroll one step.
    return maxOf(0, division.wholeSteps.toInt() - 1)
  }

  /** Shows [to] at once and emits it. Returns false and emits nothing if it is unchanged. */
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

  fun step(up: Boolean): Boolean {
    if (!enabled) {
      return false
    }
    return userStep(stepped(displayed, up))
  }

  /**
   * A screen reader's `setProgress`. Only the direction is taken from [target]; the move is
   * one step of this control, because the target may not be on the step grid.
   */
  fun accessibilityStepToward(target: Double): Boolean {
    val published = publishedProgress
    val up =
      when {
        target > published -> true
        target < published -> false
        else -> return false
      }
    return step(up)
  }

  /**
   * [displayed] as the semantics node publishes it, through a `Float`. The reader's target is
   * computed from that, so compare in the same space: 0.3 through a `Float` is 0.30000001.
   */
  val publishedProgress: Double
    get() = displayed.toFloat().toDouble()
}

private class StepperHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: StepperModel,
) : NitroComposeHost<StepperModel>(context, activity, model) {
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

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

  @Composable
  override fun Component(model: StepperModel) {
    val enabled = model.enabled
    val displayed = model.displayed
    val label = model.accessibilityLabel
    val range = model.trackRange()
    val progressSteps = model.progressSteps()
    // At a bound a step would change nothing, so that half is disabled.
    val canStepDown = model.canStep(up = false)
    val canStepUp = model.canStep(up = true)
    model.recordDrawn(nitroUiStepperValueText(displayed), canStepUp, canStepDown)

    Row(
      verticalAlignment = Alignment.CenterVertically,
      modifier =
        // One merged node whose progress action is native's: a reader meets one adjustable
        // value, not two buttons. Each button clears its own semantics.
        Modifier.semantics(mergeDescendants = true) {
          if (label != null) {
            contentDescription = label
          }
          // Without a state description TalkBack reads the progress as a percentage
          // ("40 percent" for 4 on 0..10). The range info stays: it makes the node adjustable.
          stateDescription = nitroUiStepperValueText(displayed)
          progressBarRangeInfo =
            ProgressBarRangeInfo(
              displayed.toFloat(),
              range,
              progressSteps,
            )
          setProgress { target ->
            model.accessibilityStepToward(target.toDouble())
          }
          // The buttons' cleared semantics took Material's `disabled()` with them, so restate it.
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

/** One half: a filled tonal icon button. Its semantics are cleared; the row is the one node. */
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
      // No description: the row names the control.
      contentDescription = null,
    )
  }
}

class HybridNitroUiStepper(
  reactContext: ThemedReactContext,
) : HybridNitroUiStepperSpec(),
  RecyclableView {
  private val model = StepperModel()
  private val host = StepperHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    // Must match `getName()` in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiStepper"

    // The size before anything is measured, in dp: two 48 dp touch targets and an 8 dp gap.
    private const val FALLBACK_WIDTH_DP = 104.0

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

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // The host's tag is what RN's testID matchers read on Android.
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
    // Value, range and step can arrive in one batch in any order, so quantise only here.
    model.state.js?.let { js ->
      val quantised = model.quantize(js)
      if (quantised != js) {
        model.state.js = quantised
      }
    }
    if (model.applyDefaultOnce()) {
      host.markDirty()
    }
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A range or step change can leave the shown value outside the range.
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
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onValueChange = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size, so it is safe on the JS thread.
  override fun measureContent(): NitroUiStepperSize {
    val size = host.contentSize ?: return NitroUiStepperSize(0.0, 0.0)
    return NitroUiStepperSize(size.width, size.height)
  }

  override fun nuiTestStep(direction: Double) {
    val up = direction >= 0.0
    Handler(Looper.getMainLooper()).post { model.step(up) }
  }

  // Test-only. Performs the reader's action on the merged node. No fallback: calling the
  // model directly would not test the path a screen reader takes.
  override fun nuiTestAccessibilityStep(direction: Double) {
    val up = direction >= 0.0
    Handler(Looper.getMainLooper()).post { runTestAccessibilityStep(up) }
  }

  override fun nuiTestAccessibilityStepReport(): String = model.currentStepReport()

  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      val (merged, detail) = describeAccessibility()
      model.recordMerged(merged)
      model.recordAccessibility(detail)
    }
  }

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

  // Returns (how many nodes publish `SetProgress`, one line about the node).
  private fun describeAccessibility(): Pair<String, String> {
    val root = findComposeRoot(host) ?: return "none" to "no Compose root"
    root.forceAccessibilityForTesting(true)
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      return "none" to "no SemanticsOwner, even after forcing accessibility on"
    }
    // The merged tree is the one a reader is given.
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
    // `StateDescription` is what TalkBack speaks as the value of a progress node.
    val valueText = config.getOrNull(SemanticsProperties.StateDescription) ?: "none"
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
    model.noteStepReport(
      "performed SetProgress(${nitroUiStepperValueText(target.toDouble())}) on #${node.id} " +
        "range=${nitroUiStepperValueText(range.range.start.toDouble())}" +
        "..${nitroUiStepperValueText(range.range.endInclusive.toDouble())}" +
        "@${nitroUiStepperValueText(range.current.toDouble())} " +
        "${nitroUiStepperValueText(from)}->${nitroUiStepperValueText(model.displayed)} " +
        "disabled=${node.config.contains(SemanticsProperties.Disabled)}",
    )
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

/**
 * The value without a float's noise: `4.0` reads as `4`. Must match the iOS spelling,
 * because tests compare what each platform drew.
 */
internal fun nitroUiStepperValueText(value: Double): String =
  if (value.isFinite() && value % 1.0 == 0.0 && abs(value) < 1e15) {
    value.toLong().toString()
  } else {
    value.toString()
  }
