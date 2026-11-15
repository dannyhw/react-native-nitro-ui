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

// Material 3 `Checkbox`, or `TriStateCheckbox` while `indeterminate`. Must stay in this
// package: the generated manager finds the implementation through a wildcard import of it.

internal class CheckboxModel : NitroUiModel() {
  var displayed by mutableStateOf(false)

  var indeterminate by mutableStateOf(false)

  var label by mutableStateOf<String?>(null)

  /** Stored for the getter only: Android always draws Material's checkbox. Not observed. */
  var iosStyle: String = "circle"

  var enabled by mutableStateOf(true)

  /** ARGB int for the checked colour, or `null` for Material 3's own. */
  var tint by mutableStateOf<Int?>(null)

  /** `null` falls back to [label]. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultChecked: Boolean? = null
  var didApplyDefault = false

  var onCheckedChange: ((Boolean, Double) -> Unit)? = null

  /** Test-only read-outs, behind one lock. */
  private val reportLock = Any()
  private var drawn = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"

  /**
   * `<dp>,<dp>`: how far the label's middle sits from the row's middle, and how much taller
   * the row is than the text. `none` when no label is drawn.
   */
  private var labelBox = "none"

  /** `mixed` while Material draws the indeterminate dash. */
  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  fun recordMerged(value: String) {
    synchronized(reportLock) { merged = value }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  fun recordLabelBox(value: String) {
    synchronized(reportLock) { labelBox = value }
  }

  /** Safe from any thread. */
  fun stateReport(): String =
    synchronized(reportLock) {
      "displayed=$drawn;probes=$probes;merged=$merged;a11y=$accessibilityReport;labelBox=$labelBox"
    }

  override fun reset() {
    displayed = false
    indeterminate = false
    iosStyle = "circle"
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

/** [tint] is an ARGB int, or `null` for the scheme's own colours. */
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

private class CheckboxHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: CheckboxModel,
) : NitroComposeHost<CheckboxModel>(context, activity, model) {
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * The platform throws when sent an accessibility event while no service is enabled, which
   * happens once the test probe has forced Compose semantics on.
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
   * A press that toggles. From the indeterminate dash this lands on checked, because the dash
   * is only shown while `displayed` is false.
   */
  fun press() {
    press(!model.displayed)
  }

  /** A press asking for [requested], as a tap on the box does. Ignored while disabled. */
  fun press(requested: Boolean) {
    if (!model.enabled) {
      return
    }
    // Optimistic: show the new value before React has seen the event.
    val eventCount = model.state.user(requested)
    model.displayed = requested
    model.onCheckedChange?.invoke(requested, eventCount.toDouble())
  }

  @Composable
  override fun Component(model: CheckboxModel) {
    // Recorded for tests, in Material's order: the dash is only on screen while the value is
    // off, so `displayed` is read before `indeterminate`.
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
      // A bare box: Material's own node is the one a reader acts on, so the name goes on it.
      CheckboxBox(
        model,
        if (name != null) Modifier.semantics { contentDescription = name } else Modifier,
        colors,
        interactive = true,
      )
    } else {
      // One merged node for the row, with the role, state, name and label text, as Material's
      // own labelled checkbox does. A click on the box and label instead would leave a dead gap
      // between them, and Compose will not merge a node whose descendants are actionable.
      Row(
        // `Row` aligns its children to the top by default, and this row is taller than the
        // label because the box asks for a 48 dp touch target.
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
        // Presentational: the row already publishes the toggle, so the box's semantics are
        // cleared. The 48 dp touch target comes with the box's own toggleable modifier, so it
        // has to be asked for again.
        CheckboxBox(
          model,
          Modifier.clearAndSetSemantics {}.minimumInteractiveComponentSize(),
          colors,
          interactive = false,
        )
        Spacer(Modifier.width(8.dp))
        // One line, truncated: a narrower `width` shortens the label instead of overflowing.
        Text(
          modifier =
            Modifier.onGloballyPositioned { where ->
              val row = where.parentLayoutCoordinates
              model.recordLabelBox(
                if (row == null) {
                  "none"
                } else {
                  // In dp, rounded to 1/100.
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
   * [interactive] decides who owns the tap. A bare box does. A labelled box is handed `null`
   * callbacks, Material 3's way to say "draw it, do not make it actionable", because the row
   * around it carries the toggle.
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

class HybridNitroUiCheckbox(
  reactContext: ThemedReactContext,
) : HybridNitroUiCheckboxSpec(), RecyclableView {

  private val model = CheckboxModel()
  private val host = CheckboxHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    /** Must match `getName()` in the generated manager. */
    private const val SIZING_COMPONENT_NAME = "NitroUiCheckbox"

    /**
     * The size used before anything has been measured, in dp. One size per component: 48 dp is
     * the minimum touch target, so the height holds for every configuration; the width is a
     * bare box's, and a label makes it wider.
     */
    private const val FALLBACK_WIDTH_DP = 48.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One JNI call per process. */
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
      // `displayed` follows in `afterUpdate()`, once the event count says JS has caught up.
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
      // A different composable: Compose's own measure pass reports the new size.
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
      // A label changes the width; Compose's own measure pass reports it.
      host.markDirty()
    }

  /** Stored for the getter only: nothing on Android observes it, so no `markDirty()`. */
  override var iosStyle: String
    get() = model.iosStyle
    set(next) {
      model.iosStyle = next
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
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
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
    // The view tag is what testID matchers read.
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
      // A new key needs a fresh measure and a report, even if the size is unchanged.
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
    // The handshake decides whether React's `checked` wins over what the user just did.
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle; this also resets the model.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onCheckedChange = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiCheckboxSize {
    val size = host.contentSize ?: return NitroUiCheckboxSize(0.0, 0.0)
    return NitroUiCheckboxSize(size.width, size.height)
  }

  /** Posts to the UI thread and returns at once. */
  override fun nuiTestToggle() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Posts to the UI thread and returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      model.recordAccessibility(describeAccessibility())
    }
  }

  /** The lifetime counters survive a recycle, so `recycles>=1` identifies a reused view. */
  override fun nuiTestStateReport(): String =
    model.stateReport() +
    ";drops=${host.lifetimeDrops};recycles=${host.lifetimeRecycles}"

  /**
   * Compose builds semantics only while an accessibility service is connected, so they are
   * forced on for this view first.
   */
  private fun describeAccessibility(): String {
    val root = findComposeRoot(host) ?: return "no Compose root"
    root.forceAccessibilityForTesting(true)
    // Declared non-null, but null until semantics exist.
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

  /** The Compose view under [root]: `AndroidComposeView` implements [RootForTest]. */
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
