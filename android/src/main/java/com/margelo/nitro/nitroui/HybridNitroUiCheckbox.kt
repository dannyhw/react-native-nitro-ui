package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxColors
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.TriStateCheckbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/*
 * The Checkbox component: Material 3 `Checkbox`, and `TriStateCheckbox` while
 * `indeterminate`, on the core runtime.
 *
 * It is Switch's structure (`HybridNitroUiSwitch.kt`: the event-count handshake on
 * a boolean) with Chip's label rule (`HybridNitroUiChip.kt`: the label is content,
 * so it is in the sizing key and a new one re-measures). What is its own is the
 * a11y node: a checkbox has to be *announced* as a checkbox - `Role.Checkbox` with
 * its toggleable state, on one merged node when a label is shown, so TalkBack gets
 * "checkbox, checked, Email me offers" from one focus stop rather than a nameless
 * box and a separate piece of text.
 *
 * Indeterminate is Android-only: iOS has no checkbox at all, so there is no third
 * glyph to draw there (`docs/components/checkbox.md`).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one Checkbox. See [NitroUiModel] for the shape this has to have. */
internal class CheckboxModel : NitroUiModel() {
  /** What the box shows. Snapshot-observed, so writing it recomposes. */
  var displayed by mutableStateOf(false)

  /** Material 3's third state. Observed: it picks the composable *and* what it draws. */
  var indeterminate by mutableStateOf(false)

  /** The label beside the box, or `null`. Observed: it is content, and width. */
  var label by mutableStateOf<String?>(null)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the "on" accent, or `null` for Material 3's own. */
  var tint by mutableStateOf<Int?>(null)

  /**
   * `accessibilityLabel`, or `null` to fall back to [label]. Put on the box itself
   * (never the container, core.md §3), because the box is the node a reader acts on.
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultChecked: Boolean? = null
  var didApplyDefault = false

  var onCheckedChange: ((Boolean, Double) -> Unit)? = null

  /** Test-only read-outs (`nuiTestStateReport`), behind one lock. */
  private val reportLock = Any()
  private var drawn = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"

  /**
   * The label's centring, as `labelOff=<dp>,<dp>`: how far the text's middle sits from the
   * row's middle (negative means it rides high), and how much taller the row is than the
   * text. Both `none` when no label is drawn.
   *
   * A labelled Checkbox is a `Row` of box, spacer and text, and the height of that row is
   * set by the box's 48 dp touch target, so a `Row` that aligns its children to the top
   * draws the label along the top of a row that looks 48 dp tall. That is invisible to a
   * measurement - the box, the row and the screenshot all come back 48 dp - and visible to
   * anybody reading the screen, so it is measured in the one place that knows both boxes:
   * the label's own layout coordinates, against its parent's.
   *
   * The second number is what stops the first from proving nothing. Text as tall as its
   * row is centred by every alignment there is, so a `labelOff` of `0` measured in a row
   * that snug as the text is a tautology; the harness reads the gap before it believes the
   * offset.
   */
  private var labelBox = "none"

  /**
   * Record what the composable was handed: `mixed` while Material draws the third
   * state, so a test can tell "indeterminate" from "checked" and from "never drew".
   */
  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  /** Record how many nodes a reader is offered for this control (`merged` read-out). */
  fun recordMerged(value: String) {
    synchronized(reportLock) { merged = value }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** Record [labelBox] from the label's own layout pass. */
  fun recordLabelBox(value: String) {
    synchronized(reportLock) { labelBox = value }
  }

  /** `displayed=…;probes=…;merged=…;a11y=…;labelBox=…`. Safe from any thread. */
  fun stateReport(): String =
    synchronized(reportLock) {
      "displayed=$drawn;probes=$probes;merged=$merged;a11y=$accessibilityReport;labelBox=$labelBox"
    }

  override fun reset() {
    displayed = false
    indeterminate = false
    label = null
    enabled = true
    tint = null
    accessibilityLabel = null
    sizingKey = ""
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultChecked = null
    didApplyDefault = false
    onCheckedChange = null
    synchronized(reportLock) {
      drawn = "none"
      probes = 0
      merged = "none"
      accessibilityReport = "none"
      labelBox = "none"
    }
  }
}

/**
 * The Checkbox's colours for [tint] (an ARGB int, or `null` for the scheme's own).
 *
 * The checked box is the closest analogue of iOS `.tint()`, which is Switch's choice
 * for the same prop (`HybridNitroUiSwitch.kt`'s `switchColors`). Built in the
 * composable, so it reads the live `MaterialTheme`; a Checkbox has no animation to
 * preserve, so nothing is cached - M3 builds these from five color slots.
 */
@Composable
private fun checkboxColors(tint: Int?): CheckboxColors {
  val accent = if (tint != null) ComposeColor(tint) else null
  return if (accent == null) {
    CheckboxDefaults.colors()
  } else {
    CheckboxDefaults.colors(
      checkedColor = accent,
      checkmarkColor = MaterialTheme.colorScheme.onPrimary,
    )
  }
}

/**
 * The Checkbox's host: [NitroComposeHost] plus this component's composable.
 * [Component] is fixed for the lifetime of the view - there is no `setContent`
 * after construction.
 */
private class CheckboxHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: CheckboxModel,
) : NitroComposeHost<CheckboxModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one - the
   * Chip/Slider host's guard, for their reason: `nuiTestProbeAccessibility` forces
   * Compose's semantics on with no reader connected, Compose then announces every
   * later change up the parent chain, and [AccessibilityManager] answers an
   * announcement with no recipient by throwing. Inert when a reader is connected.
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

  /**
   * One press with nothing to say about the value: the label's `clickable` and the
   * `nuiTestToggle` harness hook, which ask for what a tap on the box would ask for.
   *
   * `!displayed` is also Material's own cycle for the states this component can be
   * in: `TriStateCheckbox` shows the dash only while `displayed` is false (see
   * [CheckboxBox]), so the one press from the dash is the press that lands on
   * checked - and the one from checked is unchecked, which is the whole of a
   * checkbox's other half. A press that asked for "checked" whatever the box showed
   * would make an Android checkbox impossible to uncheck by tapping it, which
   * `Checkbox.harness.tsx`'s second toggle and `real-input:android`'s second tap
   * both measure.
   */
  fun press() {
    press(!model.displayed)
  }

  /**
   * One press asking for [requested], through the path a tap takes - M3's
   * `onCheckedChange` hands this half its own answer, so a tap on the box is the
   * composable's value and not a second opinion. Refused while disabled, as M3
   * refuses the tap.
   *
   * Neither M3 state changes the box's size (a checkbox is a fixed-size control;
   * only its label is content), so unlike Chip's `press` this holds no size report:
   * the harness measures that checked and unchecked measure the same.
   */
  fun press(requested: Boolean) {
    if (!model.enabled) {
      return
    }
    // Native is optimistic: show the new value now, before React has seen the
    // event, so there is no visual latency (§4).
    val eventCount = model.state.user(requested)
    model.displayed = requested
    model.onCheckedChange?.invoke(requested, eventCount.toDouble())
  }

  @Composable
  override fun Component(model: CheckboxModel) {
    // The reading `nuiTestStateReport()` answers with: taken in the composable, so
    // it is what the control is handed rather than what React sent.
    // What Material will actually draw, in the order it draws it:
    // `CheckboxBox` picks `TriStateCheckbox` for `indeterminate` and hands it
    // `displayed ? On : Indeterminate`, so the dash is only on screen while the value
    // is off. Reading `indeterminate` first here would report `mixed` after the tap
    // that turned the dash into a check mark, which is the one transition the harness
    // case for the third state watches.
    model.recordDrawn(
      when {
        model.displayed -> "1"
        model.indeterminate -> "mixed"
        else -> "0"
      },
    )
    val label = model.label
    val name = model.accessibilityLabel ?: label
    val colors = checkboxColors(model.tint)
    val density = LocalDensity.current
    if (label == null) {
      // A bare box: Material's own node is the one a reader acts on, and the name
      // goes on it (Chip's rule: the name belongs on the actionable node).
      CheckboxBox(
        model,
        if (name != null) Modifier.semantics { contentDescription = name } else Modifier,
        colors,
        interactive = true,
      )
    } else {
      // The label is part of the control and of its size, so the row - not just the
      // box - is what a reader gets: one node with `Role.Checkbox`, its toggleable
      // state, the name and the label's text, instead of a nameless box and a
      // separate piece of text. Material publishes a labelled control this way in
      // its own `CheckboxWithLabel`: the *row* carries the toggle and the box is
      // presentational.
      //
      // Putting the click on the box and the label instead (measured, G15) is the
      // shape that goes wrong twice over. Compose refuses to merge a node whose
      // descendants are actionable, so the row keeps its own inert node - the name
      // then sits on two nodes, one of them with no actions at all, which is what
      // the a11y rule reports as "announced twice, and only one of those stops
      // carries the value". And with the box 48 dp wide, an 8 dp spacer and a
      // clickable label, the middle of the row is *nothing*: a press at the box's
      // own centre - what a caller, a test and TalkBack all aim at - lands in the
      // gap and does nothing.
      Row(
        // Centre the label against the box. `Row` aligns its children to the top by
        // default, and this row is 48 dp tall because the box asks for a 48 dp touch
        // target - so the default draws a ~24 dp label along the top of a row that still
        // measures 48 dp, with its middle 12 dp above the row's. Every size assertion is
        // blind to that: box, row and screenshot all come back 48 dp. Material's own
        // labelled checkbox centres its text for the same reason, and
        // `Checkbox.harness.tsx`'s centring case measures this row's label to prove it.
        verticalAlignment = Alignment.CenterVertically,
        modifier =
          Modifier.semantics(mergeDescendants = true) {
            role = Role.Checkbox
            toggleableState =
              when {
                model.indeterminate && !model.displayed -> ToggleableState.Indeterminate
                model.displayed -> ToggleableState.On
                else -> ToggleableState.Off
              }
            if (name != null) contentDescription = name
          }.clickable(
            enabled = model.enabled,
            role = Role.Checkbox,
            onClick = { press() },
          ),
      ) {
        // Presentational here: the row already carries the toggle and the state, and
        // a second toggleable node inside it is the second focus stop again. Its own
        // semantics are cleared rather than merely unused: the row already publishes the
        // one toggle a reader should meet, and a second node with one is the second focus
        // stop this file exists to avoid.
        //
        // The 48 dp touch target comes with the box's *own* toggleable modifier, so a
        // presentational box loses it - measured here as a labelled checkbox 24 dp
        // tall against a bare one at 48. Asking for it back is what keeps the two
        // configurations the same height, and keeps the row a touch target rather
        // than a line of text.
        CheckboxBox(
          model,
          Modifier.clearAndSetSemantics {}.minimumInteractiveComponentSize(),
          colors,
          interactive = false,
        )
        Spacer(Modifier.width(8.dp))
        // One line, tail-truncated: the checkbox's intrinsic width is the row's, and
        // a caller's narrower `width` truncates the label instead of painting outside.
        Text(
          modifier =
            Modifier.onGloballyPositioned { where ->
              // Both boxes in the Row's own space: the label's middle against the
              // middle of the height it was laid out in.
              val row = where.parentLayoutCoordinates
              model.recordLabelBox(
                if (row == null) {
                  "none"
                } else {
                  // Both numbers in dp: the offset from the row's middle, and the room
                  // the row leaves around the text. Rounded to 1/100 dp, which is well
                  // inside what either number is asserting.
                  val fromMiddle =
                    row.localPositionOf(where, Offset.Zero).y +
                      where.size.height / 2f - row.size.height / 2f
                  val room = (row.size.height - where.size.height).toFloat()
                  fun dp(value: Float): String =
                    ((with(density) { value.toDp().value } * 100f).roundToInt() / 100f)
                      .toString()
                  "${dp(fromMiddle)},${dp(room)}"
                },
              )
            },
          text = label,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          style = MaterialTheme.typography.bodyLarge,
        )
      }
    }
  }

  /**
   * The box itself: M3's `TriStateCheckbox` while `indeterminate`, `Checkbox`
   * otherwise.
   *
   * [interactive] decides who owns the tap. A bare box owns it: M3 is asked for the
   * press (`onCheckedChange` / `onClick`), which is what makes the box's own node the
   * one a reader acts on - `Role.Checkbox` with its toggleable state, published by
   * Material rather than asserted by us. A labelled box does not: the row around it
   * carries the toggle, the name and the state (see [Component]), so `Checkbox` is
   * handed a `null` `onCheckedChange` - which is M3's own way to say "draw it, do not
   * make it actionable" - and `TriStateCheckbox` is handed the same `null` for the same
   * answer. Its `onClick` has been nullable since Material 3 1.2 and this repo ships 1.5,
   * so neither box publishes a click of its own once the row owns the tap. Round 1's comment
   * claimed it insists on a non-null `onClick`, which is why it kept one - and an `onClick`
   * installs the box's own interaction handling, whose ripple is bounded by the 48 dp box,
   * while a labelled control's press belongs to the row it is in.
   */
  @Composable
  private fun CheckboxBox(
    model: CheckboxModel,
    modifier: Modifier,
    colors: CheckboxColors,
    interactive: Boolean,
  ) {
    if (model.indeterminate) {
      TriStateCheckbox(
        state =
          when {
            model.displayed -> ToggleableState.On
            else -> ToggleableState.Indeterminate
          },
        onClick = if (interactive) ({ press() }) else null,
        modifier = modifier,
        enabled = model.enabled,
        colors = colors,
      )
    } else {
      Checkbox(
        checked = model.displayed,
        onCheckedChange = if (interactive) ({ requested -> press(requested) }) else null,
        modifier = modifier,
        enabled = model.enabled,
        colors = colors,
      )
    }
  }
}

/** The Hybrid View React renders as `NitroUiCheckbox`. */
class HybridNitroUiCheckbox(
  reactContext: ThemedReactContext,
) : HybridNitroUiCheckboxSpec(), RecyclableView {

  private val model = CheckboxModel()
  private val host = CheckboxHost(reactContext, reactContext.currentActivity, model)

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
    private const val SIZING_COMPONENT_NAME = "NitroUiCheckbox"

    /**
     * The size to lay a Checkbox out with before anything has been measured, in dp.
     *
     * One number for every configuration, for Button's reason (fallbacks are keyed by
     * component), so each axis says what it can promise.
     *
     * The height is not a guess. `minimumInteractiveComponentSize` will not publish a
     * touch target smaller than 48 dp, so bare, labelled, checked and indeterminate are all
     * 48 dp tall - measured 48.00 bare and 48.00 labelled - and the conformance run compares
     * this constant with that box.
     *
     * The width is a bare box's measured 48 dp, and is not claimed for the labelled one: `Checkbox` measures
     * 48 dp wide with nothing beside it and 131.05 dp with a label, and the engine keys
     * fallbacks by component alone. `docs/components/checkbox.md` has the table;
     * `Checkbox.harness.tsx` is where a label's effect on width is measured.
     */
    private const val FALLBACK_WIDTH_DP = 48.0
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

  override var checked: Variant_Boolean_NullType
    get() =
      model.state.js?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` follows once the event count says JS has
      // caught up. See `afterUpdate()`.
      model.state.js = next.asFirstOrNull()
    }

  override var defaultChecked: Variant_Boolean_NullType
    get() =
      model.defaultChecked?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val seed = next.asFirstOrNull()
      model.defaultChecked = seed
      if (model.state.js != null || model.didApplyDefault || seed == null) {
        return
      }
      model.didApplyDefault = true
      if (seed != model.state.displayed) {
        model.state.displayed = seed
        model.displayed = seed
        host.markDirty()
      }
    }

  override var indeterminate: Variant_Boolean_NullType
    get() =
      model.indeterminate.let { Variant_Boolean_NullType.First(it) }
    set(next) {
      val next_ = next.asFirstOrNull() == true
      if (next_ == model.indeterminate) {
        return
      }
      model.indeterminate = next_
      // `TriStateCheckbox` is a different composable, so the measure is asked for
      // again - the key changed with it on Android (`Checkbox.tsx`), and a new
      // configuration must not be answered from the old one's cache entry. On
      // Compose the recomposition's own measure pass is what reports the new size
      // (`HybridNitroUiChip.kt`'s `label` setter); there is nothing to notify.
      host.markDirty()
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var label: Variant_NullType_String
    get() =
      model.label?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val next_ = next.asSecondOrNull()
      if (next_ == model.label) {
        return
      }
      model.label = next_
      // The composable recomposes and Compose's own measure pass reports the new
      // width (sizing.md §5). A label is content: it is the whole width difference.
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
      // Repaints only: a disabled checkbox is the same size.
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tint?.let { Variant_NullType_Double.Second(it.toLong().toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates, so an
      // opaque colour above `Int.MAX_VALUE` would become `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tint) {
        return
      }
      model.tint = argb
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // RN's own `BaseViewManager.setTestID`: the tag is what testID matchers read.
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
      host.perfInstanceId =
        if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      if (next == model.sizingKey) {
        return
      }
      model.sizingKey = next
      // The engine has no answer for a key it has not seen, and a new configuration
      // may measure what the old one did (Button's F1) - so the host is asked for a
      // fresh measure and a report that the dedupe must not swallow.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId =
        if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onCheckedChange: ((Boolean, Double) -> Unit)?
    get() = model.onCheckedChange
    set(next) {
      model.onCheckedChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The handshake decides whether React's `checked` wins over what the user just
    // did - including a change JS refused (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle (core.md §6), and
    // `host.prepareForRecycle()` resets the model and releases the sizing instance.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onCheckedChange = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiCheckboxSize {
    val size = host.contentSize ?: return NitroUiCheckboxSize(0.0, 0.0)
    return NitroUiCheckboxSize(size.width, size.height)
  }

  /** Toggle through the tap's path, on the UI thread (see the spec). Returns at once. */
  override fun nuiTestToggle() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Read the control's semantics on the UI thread (see the spec). Returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      model.recordAccessibility(describeAccessibility())
    }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  /**
   * The control's accessibility, as two facts in one line:
   * `role=<role>,checked=<bool|none>,toggle=<state|none>,disabled=<bool>,clickable=<bool>,label=<text>`
   * plus the count of nodes a reader is offered, filed under `merged=`
   * (`1` = the labelled control is one focus stop, which is what it has to be).
   *
   * Compose builds semantics only while an accessibility service is connected, and a
   * harness run has none, so they are forced on for this view first (the Slider's and
   * Chip's probes do the same, and say why).
   */
  private fun describeAccessibility(): String {
    val root = findComposeRoot(host) ?: return "no Compose root"
    root.forceAccessibilityForTesting(true)
    // Declared non-null, nullable in fact until semantics exist (the Slider's note).
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      return "no SemanticsOwner"
    }
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val actionable = nodes.filter { it.config.contains(SemanticsActions.OnClick) }
    model.recordMerged(
      when (actionable.size) {
        0 -> "0-of-${nodes.size}"
        1 -> "1"
        else -> "${actionable.size}-of-${nodes.size}"
      },
    )
    val node: SemanticsNode =
      when (actionable.size) {
        0 -> return "no node publishes a toggle (${nodes.size} nodes)"
        1 -> actionable[0]
        else -> return "ambiguous: ${actionable.size} nodes publish a toggle"
      }
    val config = node.config
    val role = config.getOrNull(SemanticsProperties.Role)?.toString() ?: "none"
    val toggle = config.getOrNull(SemanticsProperties.ToggleableState)?.toString() ?: "none"
    val disabled = config.contains(SemanticsProperties.Disabled)
    val label =
      config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
        ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }
        ?: ""
    val checked =
      when (toggle) {
        "On" -> "true"
        "Off" -> "false"
        "Indeterminate" -> "indeterminate"
        else -> "none"
      }
    return "role=$role,checked=$checked,toggle=$toggle,disabled=$disabled," +
      "clickable=${config.contains(SemanticsActions.OnClick)},label=$label"
  }

  /**
   * The Compose view under [root], as [RootForTest] - the public interface
   * `AndroidComposeView` implements (`HybridNitroUiSlider.findComposeRoot`).
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
