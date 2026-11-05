package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
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
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.absoluteValue

/*
 * The SegmentedControl component: the Material 3 single-choice segmented button
 * row on the core runtime. The structure is the Switch's
 * (`HybridNitroUiSwitch.kt`) because it is the same kind of control - a
 * user-editable value behind the event-count handshake - plus the Button's
 * sizing story (`HybridNitroUiButton.kt`) because this control's width comes
 * from its props: the labels *are* the width. Compose observes the model,
 * recomposes, and its own measure pass reports the new size, so unlike iOS no
 * extra "the size may have moved" call is needed (sizing.md section 5).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one SegmentedControl. See [NitroUiModel] for the shape this has to have. */
internal class SegmentedControlModel : NitroUiModel() {
  /**
   * The segment labels, in order.
   *
   * Observed: they are both what renders and what decides the control's width.
   * Written only through a content check (see the `options` setter), so a React
   * render that re-sends an equal list costs no recomposition.
   */
  var options by mutableStateOf(emptyArray<String>())

  /**
   * The selected index the composable renders.
   *
   * A mirror of [state]'s `displayed` as an `Int`, because that is what a list
   * index and the `selected` argument want, and observed because writing the
   * handshake is invisible to Compose - `NitroUiControlledValue` is plain state,
   * and only a write to snapshot state reaches the UI. Every write to one happens
   * next to a write of the other (the Switch does the same with `displayed`).
   */
  var displayed by mutableStateOf(0)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the selected segment, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * `accessibilityLabel`, read by the composable so the label can go on the row.
   * For this control the group is the thing a label describes - the segments are
   * its children - and the host container is never the labelled node
   * (`docs/architecture/core.md` section 3).
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The size configuration React sent. The sizing engine reads the key out of
   * Fabric state itself; the host only needs to hear that it changed (see
   * [NitroComposeHost.noteSizingKeyChanged]).
   */
  var sizingKey = ""

  /**
   * Event-count handshake, over the selected index.
   *
   * A `Double` rather than an `Int` for the same reason Slider's `value` is one:
   * the handshake stores what React sent *raw*, and a raw number is not a legal
   * index before it has been normalised against [options] - which can arrive in
   * this same batch, after it (`docs/architecture/core.md` section 3).
   * `afterUpdate()` normalises both `js` and `displayed`, so everything the
   * composable reads is already whole and in range.
   * Not observed: it drives [displayed], it never renders directly.
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in units of [options]. Applied once, in `afterUpdate()`. */
  var defaultSelectedIndex: Double = 0.0

  var didApplyDefault = false

  /**
   * What the last pixel probe saw, as one line, or empty before the first one.
   *
   * Written on the UI thread by [HybridNitroUiSegmentedControl.nuiTestPixelProbe] and
   * read from any thread by [HybridNitroUiSegmentedControl.nuiTestPixelReport]: a
   * Nitro method may not block for the UI thread, so the answer travels as a stored
   * string exactly as iOS's does (`SegmentedControlModel.publishPixelReport`). Plain
   * rather than observable, because nothing may recompose because a test reading moved.
   *
   * The `n=` prefix counts probes, which is the only way a test can tell a fresh
   * answer from the previous one when the probe is asynchronous. Cleared with the rest
   * of the model: a recycled view that still reported another owner's pixels would let
   * a test credit a hit that is not its control's.
   */
  var pixelReport = ""
    private set

  private val pixelReportLock = Any()

  /** How many probes have reported, under [pixelReportLock]. */
  private var pixelProbes = 0

  /** Store what a probe found, numbered. Safe from any thread. */
  fun publishPixelReport(report: String) {
    synchronized(pixelReportLock) {
      pixelProbes += 1
      pixelReport = "n=$pixelProbes $report"
    }
  }

  /**
   * What the row of segments is drawing as its selection, as one line.
   *
   * Written by [recordDrawnIndex] in the composable, so it is a reading of the hosted
   * control and not an echo of the `selectedIndex` prop: a commit that stored the index
   * without repainting the row fails here and passes on the prop. That distinction is
   * the whole reason this read-out exists (F6, closing X4's blind spot): the handle's
   * `selectedIndex` answers `state.js`, which is what React sent, and the pixel probe
   * answers a colour, so neither could tell a recycled SegmentedControl that re-painted
   * at index 0 from one that merely stopped being told otherwise.
   *
   * Answers `displayed=<index>`, or `displayed=none` before the composable has run - a
   * distinct word rather than `-1` so a test cannot mistake "never drawn" for a legal
   * index that happens to be negative.
   */
  var drawnIndexReport = "displayed=none"
    private set

  /**
   * Record what the drawing code was handed.
   *
   * Not observed, and deliberately so: writing snapshot state from the measure/draw
   * path would dirty the node that is drawing and ask for the recomposition that just
   * happened. The lock is because `nuiTestDisplayedIndex` may be read from the JS
   * thread.
   */
  fun recordDrawnIndex(index: Int) {
    synchronized(pixelReportLock) {
      drawnIndexReport = "displayed=$index"
    }
  }

  /** What the row displays, as one line. Safe from any thread. */
  fun readDrawnIndex(): String {
    synchronized(pixelReportLock) { return drawnIndexReport }
  }

  /** The last probe's report. Safe from any thread. */
  fun readPixelReport(): String {
    synchronized(pixelReportLock) { return pixelReport }
  }

  /**
   * `onValueChange`, as Nitro delivered it. The generated spec types the prop as a
   * plain Kotlin function, which `Func_double_double` implements.
   */
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
    // Test state too: a recycled view that still reported another owner's pixels
    // would let a test read a hit that is not its control's. Same for the drawn
    // index: it goes back to "never drawn" so a second mount has to draw before it
    // can answer, and the answer it gives is then this mount's.
    pixelReport = ""
    synchronized(pixelReportLock) {
      drawnIndexReport = "displayed=none"
    }
  }

  /**
   * A segment index that exists in [options], as a whole number in range.
   *
   * The one rule of this component: `options` and the selection arrive in one
   * batch in no particular order, so neither can be checked against the other in
   * a setter - this runs in `afterUpdate()`, where the batch is finished. Anything
   * that is not a usable number goes to the first segment; a number past the end
   * goes to the last one. An empty [options] has no valid index at all, and the
   * answer there is only ever read by a row that draws no segments.
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
 * The library's `SegmentedButtonColors`, so that a *tinted* SegmentedControl costs
 * one colour set per (colour scheme, tint) instead of one per recomposition.
 *
 * The rule is `docs/architecture/core.md` ("Shared objects"): a hosted control is
 * its own composition, so `remember` cannot share anything between controls, and
 * anything derived from the theme has to be a process-wide keyed cache. Material 3
 * 1.4 already memoises the *untinted* set per `ColorScheme`
 * (`SegmentedButtonDefaults.colors()` reads a `defaultSegmentedButtonColorsCached`
 * field), so the only allocation left is ours: the tinted set, which without this
 * cache is one 12-colour object per recomposition per mounted control - on the
 * exact path the `update` bench scenario exercises.
 *
 * Bounded and self-clearing, exactly like [ButtonColorsCache]: one scheme at a time
 * (identity is the key because identity is what Material's own memo reads), at most
 * [MAX_TINTED_ENTRIES] tinted sets, and a scheme change drops everything.
 */
private object SegmentedColorsCache {
  /**
   * Tinted sets to remember before starting over. An app tints a handful of
   * controls; the cap is what stops a component that derives a colour per list row
   * from growing this for the life of the process.
   */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  /** The untinted set - one slot, filled once per scheme. */
  private var untinted: SegmentedButtonColors? = null

  /** Tinted sets, keyed by ARGB int. */
  private var tinted: HashMap<Int, SegmentedButtonColors>? = null

  /**
   * The cached colours for this scheme and tint, or `null` on a miss - which the
   * caller fills by *calling the composable*, because building them is a composable
   * read of the scheme and cannot be handed here as a lambda.
   *
   * Synchronised for the same reason [SwitchColorsCache] is: a second window can
   * compose against another `Choreographer`, and a half-written entry would show
   * one control wearing a stale theme. One uncontended monitor per recomposition,
   * paid for by the object it avoids.
   */
  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): SegmentedButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  /** Record a colour set the caller just built. */
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
 * The control's colours for [tint] (an ARGB int, or `null` for the scheme's own),
 * served by [SegmentedColorsCache].
 *
 * The tint replaces the **selected segment's container and border**, which is this
 * control's analogue of iOS `.tint()`: on a SwiftUI segmented `Picker` the tint
 * paints the chosen segment. Every other role - the unselected labels, the
 * disabled states - keeps the scheme's colours, the same one-role trade the Switch
 * (`checkedTrackColor`) and Button (`containerColor`) make. Material 3's own
 * default for both fields is transparent, so an untinted control is the stock M3
 * look, untouched.
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

/**
 * The control's host: [NitroComposeHost] plus this component's composable.
 *
 * [Content] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class SegmentedControlHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SegmentedControlModel,
) : NitroComposeHost<SegmentedControlModel>(context, activity, model) {
  /**
   * A `<Host>` composes this control (H2b).
   *
   * The same allowlist line the controls before it have (`HybridNitroUiSwitch.kt`,
   * `HybridNitroUiSlider.kt`), with the matching JS row in
   * `src/components/Host/HostChildren.ts`. This control has no popup and no dialog -
   * one row of `SegmentedButton`s and nothing else - so it joins the Host on the
   * mechanism H1 built and nothing more. The measurement behind the claim is
   * `docs/components/host.md`.
   */
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: SegmentedControlModel) {
    val options = model.options
    val selectedIndex = model.displayed
    // The reading of the hosted row that `nuiTestDisplayedIndex()` answers with: taken
    // from the value this composition is about to paint, not from a prop getter.
    model.recordDrawnIndex(selectedIndex)
    val enabled = model.enabled
    val tint = model.tintColor
    val label = model.accessibilityLabel
    val colors = segmentedColors(tint)
    val group = segmentGroupValues()
    val resting = group.resting
    val labelStyle = group.labelStyle
    val contentPadding = group.contentPadding
    // The label goes on the row, because for this control the group is what a
    // label describes: the segments are its children, each announced with M3's
    // `Role.RadioButton` inside the row's own `selectableGroup()`. Putting it on
    // the host View instead would add a second, focusable empty box around the
    // group (`docs/architecture/core.md` section 3).
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    // Material 3 Expressive replaced the segmented track with a connected button
    // group: the same row of choices, drawn with `ButtonGroupDefaults`' 2 dp gap and
    // its connected leading / middle / trailing corners.
    Row(
      modifier =
        labelModifier
          // The row is measured from its contents, as the segmented row was: the
          // labels are the width, and a stretched row would be a 420 dp control with
          // three boxes in it (see `SELF_SIZING_BASE_STYLE` on the JS side).
          .width(IntrinsicSize.Max)
          // One group, so an announcements reads "1 of 3" - the position comes from
          // here, the role and the selected state from each item below.
          .selectableGroup(),
      horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
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
              options.size == 1 -> ButtonGroupDefaults.connectedLeadingButtonShapes(resting)
              index == 0 -> ButtonGroupDefaults.connectedLeadingButtonShapes(resting)
              index == options.size - 1 -> ButtonGroupDefaults.connectedTrailingButtonShapes(resting)
              else -> ButtonGroupDefaults.connectedMiddleButtonShapes(resting)
            },
          labelStyle = labelStyle,
          contentPadding = contentPadding,
          // Weight only: the selected state and the role are published by the
          // item's own `selectable` below, so the row does not also assert them
          // (a second `selected` here wins the merge, and the a11y checks in
          // `scripts/real-input/android.mjs` would then read this line instead of
          // the selection the item actually has).
          modifier = Modifier.weight(1f),
          onClick = {
            // A tap on the segment that is already selected reports nothing.
            // Foundation's `selectable` fires for a press on a selected node only
            // when it is not already in its group's selection, but the group is
            // ours and a rebuild can re-present the same index - so the guard is
            // explicit, exactly as it was on `SegmentedButton`. It is also the only
            // thing that makes a real-input snap-back observable: the second tap of
            // `scripts/real-input` lands on the segment a rejected change is supposed
            // to have returned to, and it must report nothing until the revert has
            // landed.
            if (index == model.displayed) {
              return@ConnectedSegment
            }
            // Native is optimistic: paint the new segment now, before React has
            // seen the event, so there is no visual latency (core.md section 4).
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
 * One item of the connected group.
 *
 * Its own node, drawn by this file, rather than Material's `ToggleButton`:
 * `ToggleButton` publishes `Role.Checkbox` from its own semantics lambda, and a
 * nested node cannot have that overridden from the outside - the semantics closer
 * to the content win. This control is a radio group in its API and in
 * `docs/components/segmented-control.md` ("each segment as a `RadioButton`-class
 * node ... the chosen one reports selected"), and a TalkBack announcement that
 * called every segment a checkbox would make that sentence false. So the item
 * takes Material's *geometry* - the connected corners, the 2 dp gap, the height's
 * padding and label style - and puts them on `Modifier.selectable(role =
 * Role.RadioButton)`, which is the same semantics Material's own segmented button
 * published. The press morph survives: the connected pressed shape replaces the
 * resting one while the item is held.
 */
@Composable
private fun androidx.compose.foundation.layout.RowScope.ConnectedSegment(
  text: String,
  checked: Boolean,
  enabled: Boolean,
  colors: SegmentedButtonColors,
  shapes: ToggleButtonShapes,
  labelStyle: TextStyle,
  contentPadding: PaddingValues,
  modifier: Modifier,
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
      modifier
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
 * The group's shared resting corner, its label style and its padding.
 *
 * All three come from the *medium* rung, the one `Button` maps `size='medium'` to:
 * the M3 small container height (40 dp) decides the padding and the label style, and
 * the box is the 48 dp touch target a `medium` Button is laid out at - so a row of
 * segments and a row of buttons sit on the same line, and a segment is no harder to
 * hit with a thumb than a button is. Q8 Appendix A row 2 read the group as 40 dp
 * tall; `SegmentedButton`, what this replaces, measured 48, so the target is what
 * stays here and the tokens are what arrives.
 *
 * The rest of Q8's point stands: once the size is a height, the padding, the type and
 * the corner all follow from it instead of being three tables. Built once per `Component` call, not per
 * item, and the corner is [buttonShapes]' cached value rather than a fresh one.
 */
@Composable
private fun segmentGroupValues(): SegmentGroupValues =
  SegmentGroupValues(
    resting = buttonShapes(ButtonShape.Round, ButtonScale.Medium).shape,
    labelStyle = buttonLabelStyle(ButtonScale.Medium),
    contentPadding = ButtonDefaults.contentPaddingFor(ButtonDefaults.MinHeight),
  )

/** The three values [segmentGroupValues] answers with. */
private class SegmentGroupValues(
  val resting: Shape,
  val labelStyle: TextStyle,
  val contentPadding: PaddingValues,
)

/** The Hybrid View React renders as `NitroUiSegmentedControl`. */
class HybridNitroUiSegmentedControl(
  reactContext: ThemedReactContext,
) : HybridNitroUiSegmentedControlSpec(), RecyclableView {

  private val model = SegmentedControlModel()
  private val host = SegmentedControlHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which
    // is the point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiSegmentedControlComponentName`
     * in the generated C++, and `getName()` in the generated manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiSegmentedControl"

    /**
     * The size to lay a SegmentedControl out with before anything has been measured,
     * in dp.
     *
     * Like a Button this component has many configurations (one per option list)
     * while the engine's fallback is keyed by component alone, so this can only be
     * one number: three short labels at this platform's control height. Every other
     * option list is a first instance of *its own* configuration and gets corrected
     * the turn it measures (`docs/architecture/sizing.md` section 9).
     *
     * Measured on the AVD this library's tests run on (the lease's `nitroui_a`,
     * pixel_9 profile at 420 dpi, API 35) with `options = ["One", "Two", "Three"]`:
     * 208.38 x 48.0 dp on E1's connected group, against 256.0 x 48.0 for the
     * `SingleChoiceSegmentedButtonRow` it replaces. The height did not move: the
     * group is laid out on the same 48 dp touch target a `medium` Button is, which
     * is also why it is not the 40 dp `ContainerHeight` the token names.
     *
     * The width moved because the row no longer reserves a leading icon slot per
     * item (`SegmentedButton`'s `icon = {}` still took the space) - 49.90 dp for one
     * short segment, 281.52 dp for four labels that used to be clamped to the
     * window. A
     * wrong fallback costs a cold configuration a single frame's horizontal gap.
     * Rounded *up* rather than to nearest: a box smaller than the control is the
     * dead-touch story in `core.md` section 7.
     * `docs/components/segmented-control.md` has the measured table.
     */
    private const val FALLBACK_WIDTH_DP = 208.4
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One `JNI` call per process, before the first SegmentedControl can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a
     * Fabric measure can happen before this class has ever been instantiated, so a
     * fallback declared from `init` is one measure too late for the first instance
     * (T14) - and from `init` as the backstop. The two calls land on different
     * threads, hence the atomic.
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
      // Content, not identity: React re-sends the array on every render that
      // rebuilds it, and an equal list must not cost a recomposition - still less
      // a re-measure of a size that did not move.
      if (next.contentEquals(model.options)) {
        return
      }
      model.options = next
      // The labels are the control's width. Compose recomposes, its own measure
      // pass reports the new width, and the host hands it to the engine - Android
      // needs no explicit "the size may have moved" call (sizing.md section 5).
      host.markDirty()
    }

  override var selectedIndex: Variant_NullType_Double
    get() =
      model.state.js?.let {
        Variant_NullType_Double.Second(model.clampToDouble(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up, and the number only means something once `options` is
      // known. Both happen in `afterUpdate()`.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultSelectedIndex: Double
    get() = model.defaultSelectedIndex
    set(next) {
      // Stored raw. A Switch applies its `defaultValue` in the setter because a
      // Bool has nothing to normalise against; an index has `options`, which may
      // arrive in this same batch after it (core.md section 3).
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
    // Same as RN's own `BaseViewManager.setTestID`: the tag is what
    // `findNodeByName`/testID matchers read on Android.
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
      // Rendered, not bookkeeping: the label goes on the row's semantics node, so
      // it needs a commit or a late-set label never reaches TalkBack.
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
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback; the new option list may measure exactly what the old
      // one did, and that is the size the host's dedupe would swallow the correcting
      // report against (review F1). Guarded, because React re-sends an unchanged key
      // on every render and the reset costs a measure.
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
    // `options`, `selectedIndex` and `defaultSelectedIndex` can all land in one
    // batch in any order, so none of them is interpreted until the batch is
    // complete - an index of 4 only means something once the option list it belongs
    // to is known (core.md section 3, and Slider's `value` does the same thing
    // against its range).
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
    // The event-count handshake decides whether React's index wins over what the
    // user just tapped - including a change JS rejected (core.md section 4).
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // An option list that shrank under an existing selection can leave the shown
    // index past the end. The same rule, and idempotent, so an index that is
    // already legal comes back unchanged.
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
    // `host.perfInstanceId` is cleared inside `host.prepareForRecycle()`, after it has
    // marked the recycle: clearing it here would hide that mark.
    // Not cleared here: `host.prepareForRecycle()` releases the sizing instance
    // (which needs the id to tell the engine), and `onDropView` has already run.
    // It also resets the model. The composition does not survive a recycle
    // (core.md section 6); what recycling saves is this object graph.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this control, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (core.md section 5).
   */
  override fun measureContent(): NitroUiSegmentedControlSize {
    val size = host.contentSize ?: return NitroUiSegmentedControlSize(0.0, 0.0)
    return NitroUiSegmentedControlSize(size.width, size.height)
  }

  /**
   * Count the pixels this control draws that are [color], and store the answer for
   * [nuiTestPixelReport].
   *
   * Posted to the UI thread rather than run inline: reading pixels needs the view
   * drawn, and a Nitro method may not block for it, so the answer is stored and read
   * back. Same shape on iOS (`SegmentedControlModel.publishPixelReport`).
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

  /** What the row is displaying - see `NitroUiSegmentedControlMethods.nuiTestDisplayedIndex`. */
  override fun nuiTestDisplayedIndex(): String = model.readDrawnIndex()
}

// MARK: - Pixel probe (test-only)

/** Per-channel-sum budget for "this pixel is the colour"; see the iOS constant. */
private const val NITRO_UI_PIXEL_TOLERANCE = 30

/**
 * What the pixels this view is drawing say about [color], as one line for a test's
 * failure message. The shape is shared with iOS (`nitroUiSamplePixels`), so one harness
 * test can read both.
 *
 * `draw(Canvas)` on the host view: Compose renders into this view tree, so the drawing
 * pass is what the screen shows - the only reading that can tell a tint the platform
 * applied from one it dropped. `draw` rather than a pixel copy from the window because a
 * hybrid view has no surface of its own to copy.
 *
 * The same neutral mid-grey backdrop iOS uses, for the same reason: a fill that comes
 * back translucent must still be comparable, and a middle backdrop treats a light tint
 * and a dark one alike.
 */
private fun View.nitroUiSamplePixels(color: Double): String {
  val width = width
  val height = height
  val argb = color.toLong()
  val red = (argb shr 16 and 0xff).toInt()
  val green = (argb shr 8 and 0xff).toInt()
  val blue = (argb and 0xff).toInt()
  if (width < 2 || height < 2) {
    return "size=${width}x$height no pixels"
  }
  val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  try {
    val canvas = Canvas(bitmap)
    canvas.drawColor(0xFF808080.toInt())
    draw(canvas)
    var hits = 0
    var redSum = 0L
    var greenSum = 0L
    var blueSum = 0L
    var closestDistance = Int.MAX_VALUE
    var closestRed = 0
    var closestGreen = 0
    var closestBlue = 0
    for (row in 0 until height) {
      for (column in 0 until width) {
        val pixel = bitmap.getPixel(column, row)
        val pixelRed = pixel shr 16 and 0xff
        val pixelGreen = pixel shr 8 and 0xff
        val pixelBlue = pixel and 0xff
        redSum += pixelRed
        greenSum += pixelGreen
        blueSum += pixelBlue
        val distance =
          (pixelRed - red).absoluteValue + (pixelGreen - green).absoluteValue +
          (pixelBlue - blue).absoluteValue
        if (distance <= NITRO_UI_PIXEL_TOLERANCE) {
          hits += 1
        }
        if (distance < closestDistance) {
          closestDistance = distance
          closestRed = pixelRed
          closestGreen = pixelGreen
          closestBlue = pixelBlue
        }
      }
    }
    val area = (width * height).toLong()
    val mean = (redSum / area shl 16) or (greenSum / area shl 8) or (blueSum / area)
    return "size=${width}x$height want=#%02X%02X%02X hits=$hits mean=#%06X closest=#%02X%02X%02X"
      .format(red, green, blue, mean, closestRed, closestGreen, closestBlue)
  } finally {
    bitmap.recycle()
  }
}
