package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Looper
import android.view.View
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButtonColors
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.ToggleButtonShapes
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// Material 3's single-choice connected button group. Must stay in this package: the
// generated manager finds the implementation through a wildcard import of it.

internal class SegmentedControlModel : NitroUiModel() {
  /** The segment labels: what renders and what decides the control's width. */
  var options by mutableStateOf(emptyArray<String>())

  /**
   * [state]'s `displayed` as an `Int`. Observed, because the handshake is plain state and only
   * a write to snapshot state reaches Compose; the two are always written together.
   */
  var displayed by mutableStateOf(0)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the selected segment, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  var sizingKey = ""

  /**
   * Event-count handshake over the selected index. A `Double` because it stores what React
   * sent raw: an index is only legal once clamped against [options], which may arrive later
   * in the same batch. Not observed.
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in units of [options]. Applied once, in `afterUpdate()`. */
  var defaultSelectedIndex: Double = 0.0

  var didApplyDefault = false

  /**
   * What the last pixel probe saw, prefixed `n=<count>` so a test can tell a fresh answer
   * from the previous one. Written on the UI thread and read from any thread; not observed.
   */
  var pixelReport = ""
    private set

  private val pixelReportLock = Any()

  private var pixelProbes = 0

  /** Safe from any thread. */
  fun publishPixelReport(report: String) {
    synchronized(pixelReportLock) {
      pixelProbes += 1
      pixelReport = "n=$pixelProbes $report"
    }
  }

  /**
   * `displayed=<index>` as the composable last drew it, or `displayed=none` before it has
   * run. A reading of what is on screen, not of the prop.
   */
  var drawnIndexReport = "displayed=none"
    private set

  /**
   * Not snapshot state: writing that while composing would invalidate the composition that
   * is writing it. Locked because tests read it from the JS thread.
   */
  fun recordDrawnIndex(index: Int) {
    synchronized(pixelReportLock) {
      drawnIndexReport = "displayed=$index"
    }
  }

  /** Safe from any thread. */
  fun readDrawnIndex(): String {
    synchronized(pixelReportLock) { return drawnIndexReport }
  }

  /** Safe from any thread. */
  fun readPixelReport(): String {
    synchronized(pixelReportLock) { return pixelReport }
  }

  var onChange: ((Double, Double) -> Unit)? = null

  override fun reset() {
    options = emptyArray()
    displayed = 0
    enabled = true
    tintColor = null
    accessibilityLabel = null
    sizingKey = ""
    state.displayed = 0.0
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultSelectedIndex = 0.0
    didApplyDefault = false
    onChange = null
    // Test read-outs too, so a recycled view cannot report its previous owner's.
    pixelReport = ""
    synchronized(pixelReportLock) {
      drawnIndexReport = "displayed=none"
    }
  }

  /**
   * [index] as a whole number inside [options]: not-a-number goes to the first segment, past
   * the end to the last. Call it from `afterUpdate()`: `options` and the selection arrive in
   * one batch in no particular order.
   */
  fun clamp(index: Double): Int {
    val count = options.size
    if (count <= 0 || !index.isFinite()) {
      return 0
    }
    val rounded = index.toInt()
    if (rounded < 0) {
      return 0
    }
    return if (rounded > count - 1) count - 1 else rounded
  }

  /** [clamp] for the raw handshake value, which is what gets stored back. */
  fun clampToDouble(index: Double): Double = clamp(index).toDouble()
}

/**
 * One tinted `SegmentedButtonColors` per (colour scheme, tint) instead of one per
 * recomposition. Each hosted control is its own composition, so `remember` cannot share it.
 * Holds one scheme at a time, keyed by identity as Material's own cache is.
 */
private object SegmentedColorsCache {
  /** The tinted sets are cleared when they reach this many. */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private var untinted: SegmentedButtonColors? = null

  private var tinted: HashMap<Int, SegmentedButtonColors>? = null

  /**
   * `null` on a miss, which the caller fills by building the colours in composition.
   * Synchronised because another window may compose at the same time.
   */
  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): SegmentedButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: SegmentedButtonColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, SegmentedButtonColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  /** Called with the lock held. */
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
 * [tint] (an ARGB int, or `null`) replaces the selected segment's container and border;
 * every other role keeps the scheme's colours.
 */
@Composable
private fun segmentedColors(tint: Int?): SegmentedButtonColors {
  val scheme = MaterialTheme.colorScheme
  SegmentedColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val base = SegmentedButtonDefaults.colors()
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      base
    } else {
      base.copy(activeContainerColor = color, activeBorderColor = color)
    }
  SegmentedColorsCache.put(scheme, tint, built)
  return built
}

private class SegmentedControlHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SegmentedControlModel,
) : NitroComposeHost<SegmentedControlModel>(context, activity, model) {
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: SegmentedControlModel) {
    val options = model.options
    val selectedIndex = model.displayed
    model.recordDrawnIndex(selectedIndex)
    val enabled = model.enabled
    val tint = model.tintColor
    val label = model.accessibilityLabel
    val colors = segmentedColors(tint)
    val group = segmentGroupValues()
    val labelStyle = group.labelStyle
    val contentPadding = group.contentPadding
    // The label goes on the row: the group is what it describes. On the host view it would
    // add a second, empty focusable box around the group.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    // Material 3 Expressive draws this as a connected button group. The connected-shape
    // helpers are called with no arguments: their first parameter is the whole resting
    // shape, and passing the control's stadium would make every item a separate pill.
    ConnectedRow(
      modifier =
        labelModifier
        // One group, so an announcement reads "1 of 3".
        .selectableGroup(),
    ) {
      options.forEachIndexed { index, text ->
        val isSelected = index == selectedIndex
        ConnectedSegment(
          text = text,
          checked = isSelected,
          enabled = enabled,
          colors = colors,
          shapes =
            when {
              // One option has no neighbour to connect to, so it takes the full resting corner.
              options.size == 1 -> group.lone
              index == 0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
              index == options.size - 1 -> ButtonGroupDefaults.connectedTrailingButtonShapes()
              else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            },
          labelStyle = labelStyle,
          contentPadding = contentPadding,
          // No `modifier`: the item's own `selectable` publishes the role and the selected
          // state, and a second `selected` here would win the semantics merge.
          onClick = {
            // A tap on the selected segment reports nothing. Explicit, because a rebuild can
            // present the same index to `selectable` again.
            if (index == model.displayed) {
              return@ConnectedSegment
            }
            // Optimistic: paint the new segment before React has seen the event.
            val eventCount = model.state.user(index.toDouble())
            model.displayed = index
            model.onChange?.invoke(index.toDouble(), eventCount.toDouble())
          },
        )
      }
    }
  }
}

/**
 * A row laid out at the sum of its items' intrinsic widths. `Modifier.weight` cannot do
 * this: an equal share is also each item's ceiling, so the widest label is truncated. Only
 * a row that does not fit shares its width, equally, so no segment ends up with none.
 */
@Composable
private fun ConnectedRow(
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  val gap = with(LocalDensity.current) { ButtonGroupDefaults.ConnectedSpaceBetween.roundToPx() }
  Layout(modifier = modifier, content = content) { measurables, constraints ->
    if (measurables.isEmpty()) {
      return@Layout layout(constraints.minWidth, constraints.minHeight) {}
    }
    val count = measurables.size
    val gaps = gap * (count - 1)
    // Intrinsics, because each `Measurable` may be measured only once per pass.
    val natural = measurables.sumOf { it.maxIntrinsicWidth(0) } + gaps
    // The row is its labels, clamped into the box the caller actually has.
    val rowWidth = natural.coerceIn(constraints.minWidth, constraints.maxWidth)
    // Negative means "nothing is shared out" - every row whose labels fit.
    val share =
      if (natural > rowWidth) ((rowWidth - gaps) / count).coerceAtLeast(0) else -1
    val placeables = ArrayList<Placeable>(count)
    var used = 0
    measurables.forEachIndexed { index, measurable ->
      val trailing = if (index < count - 1) gap else 0
      val room = (rowWidth - used - trailing).coerceAtLeast(0)
      val maxWidth = if (share < 0) room else minOf(share, room)
      val placeable = measurable.measure(Constraints(minWidth = 0, maxWidth = maxWidth))
      placeables += placeable
      used += placeable.width + gap
    }
    val rowHeight =
      placeables.maxOf { it.height }.coerceIn(constraints.minHeight, constraints.maxHeight)
    layout(rowWidth, rowHeight) {
      var x = 0
      for (placeable in placeables) {
        placeable.placeRelative(x, 0)
        x += placeable.width + gap
      }
    }
  }
}

/**
 * One item of the group, drawn here rather than with Material's `ToggleButton`, which
 * publishes `Role.Checkbox` that cannot be overridden from outside; this is a radio group.
 * The pressed and checked shapes swap instantly: Material's shape animator is internal.
 */
@Composable
private fun ConnectedSegment(
  text: String,
  checked: Boolean,
  enabled: Boolean,
  colors: SegmentedButtonColors,
  shapes: ToggleButtonShapes,
  labelStyle: TextStyle,
  contentPadding: PaddingValues,
  onClick: () -> Unit,
) {
  val interaction = remember { MutableInteractionSource() }
  val pressed by interaction.collectIsPressedAsState()
  val shape =
    when {
      pressed -> shapes.pressedShape
      checked -> shapes.checkedShape
      else -> shapes.shape
    }
  val container = if (checked) colors.activeContainerColor else colors.inactiveContainerColor
  val content = if (checked) colors.activeContentColor else colors.inactiveContentColor
  val borderColor = if (checked) colors.activeBorderColor else colors.inactiveBorderColor
  Box(
    modifier =
      Modifier
        .height(MinTouchTargetHeight)
        // Clip first, so the ripple and the container both take the connected
        // corner instead of painting a square one over it.
        .clip(shape)
        .selectable(
          selected = checked,
          onClick = onClick,
          enabled = enabled,
          role = Role.RadioButton,
          interactionSource = interaction,
        )
        .background(container)
        .border(SegmentedButtonDefaults.borderStroke(borderColor), shape)
        .padding(contentPadding),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = text,
      style = labelStyle.copy(color = content),
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/**
 * The label style and padding of Material's 40 dp container height, in a 48 dp touch
 * target, so a row of segments lines up with a row of `medium` Buttons.
 */
@Composable
private fun segmentGroupValues(): SegmentGroupValues =
  SegmentGroupValues(
    lone = loneSegmentShapes(),
    labelStyle = buttonLabelStyle(ButtonScale.Medium),
    contentPadding = ButtonDefaults.contentPaddingFor(ButtonDefaults.MinHeight),
  )

private class SegmentGroupValues(
  val lone: ToggleButtonShapes,
  val labelStyle: TextStyle,
  val contentPadding: PaddingValues,
)

/** A group of one has nothing to connect to: it takes a round Button's shapes at this height. */
@Composable
private fun loneSegmentShapes(): ToggleButtonShapes {
  val rounded = buttonShapes(ButtonShape.Round, ButtonScale.Medium)
  return ToggleButtonShapes(
    shape = rounded.shape,
    pressedShape = rounded.pressedShape,
    checkedShape = rounded.shape,
  )
}

class HybridNitroUiSegmentedControl(
  reactContext: ThemedReactContext,
) : HybridNitroUiSegmentedControlSpec(), RecyclableView {

  private val model = SegmentedControlModel()
  private val host = SegmentedControlHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // A backstop: fallbacks are normally declared at package init.
    declareFallback()
  }

  companion object {
    /** Must match the name in the generated C++ and in the generated manager's `getName()`. */
    private const val SIZING_COMPONENT_NAME = "NitroUiSegmentedControl"

    /**
     * The size used before anything has been measured, in dp: three short labels. Fallbacks
     * are keyed by component, so other option lists are corrected after their first measure.
     * The width is rounded up, because a box smaller than the control cannot be touched.
     */
    private const val FALLBACK_WIDTH_DP = 187.9
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process. Called at package init, because Fabric can measure before this
     * class is first instantiated, and from `init` as a backstop, on a different thread.
     */
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

  override var options: Array<String>
    get() = model.options
    set(next) {
      // Compared by content: React re-sends an equal array on every render.
      if (next.contentEquals(model.options)) {
        return
      }
      model.options = next
      // The labels are the width; Compose's own measure pass reports the new size.
      host.markDirty()
    }

  override var selectedIndex: Variant_NullType_Double
    get() =
      model.state.js?.let {
        Variant_NullType_Double.Second(model.clampToDouble(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // `afterUpdate()` applies it: the index only means something once `options` is known.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultSelectedIndex: Double
    get() = model.defaultSelectedIndex
    set(next) {
      // Stored raw: `options` may arrive after it in the same batch.
      model.defaultSelectedIndex = next
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      // Repaints only: a disabled control is the same size.
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
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
      // The label is on the row's semantics node, so a change needs a commit.
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
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((Double, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    val optionCount = model.options.size
    // The props of one batch arrive in any order, so they are interpreted here.
    model.state.js?.let { js ->
      val clamped = model.clampToDouble(js)
      if (clamped != js) {
        model.state.js = clamped
      }
    }
    if (model.state.js == null && !model.didApplyDefault && optionCount > 0) {
      model.didApplyDefault = true
      val seeded = model.clamp(model.defaultSelectedIndex)
      if (seeded != model.displayed) {
        model.state.displayed = seeded.toDouble()
        model.displayed = seeded
        host.markDirty()
      }
    }
    // The handshake decides whether React's index wins over what the user just tapped.
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // A list that shrank can leave the shown index past the end.
    val shown = model.clamp(model.state.displayed)
    if (shown != model.displayed) {
      model.state.displayed = shown.toDouble()
      model.displayed = shown
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // Resets the model and releases the sizing instance; the composition does not survive.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiSegmentedControlSize {
    val size = host.contentSize ?: return NitroUiSegmentedControlSize(0.0, 0.0)
    return NitroUiSegmentedControlSize(size.width, size.height)
  }

  /** Posted to the UI thread: reading pixels needs the view drawn, and this may not block. */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.readPixelReport()

  override fun nuiTestDisplayedIndex(): String = model.readDrawnIndex()
}
