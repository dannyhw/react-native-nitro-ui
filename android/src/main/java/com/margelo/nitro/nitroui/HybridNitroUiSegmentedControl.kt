package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonColors
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
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
    // would let a test read a hit that is not its control's.
    pixelReport = ""
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
    val enabled = model.enabled
    val tint = model.tintColor
    val label = model.accessibilityLabel
    val colors = segmentedColors(tint)
    // The label goes on the row, because for this control the group is what a
    // label describes: the segments are its children, each announced with M3's
    // `Role.RadioButton` inside the row's own `selectableGroup()`. Putting it on
    // the host View instead would add a second, focusable empty box around the
    // group (`docs/architecture/core.md` section 3).
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    SingleChoiceSegmentedButtonRow(modifier = labelModifier) {
      options.forEachIndexed { index, text ->
        val isSelected = index == selectedIndex
        SegmentedButton(
          selected = isSelected,
          onClick = {
            // A tap on the segment that is already selected reports nothing.
            // Material 3 hands `onClick` to a plain clickable Box, so it fires for
            // every press - including one on the selected segment - while a
            // SwiftUI `Picker` binding only writes when the selection moves.
            // Suppressing it here is what makes the two platforms report the same
            // events (`docs/components/segmented-control.md`), and it is the only
            // thing that makes a real-input snap-back observable: the second tap
            // of `scripts/real-input` lands on the segment a rejected change is
            // supposed to have returned to, and it must report nothing until the
            // revert has landed.
            if (index == model.displayed) {
              return@SegmentedButton
            }
            // Native is optimistic: paint the new segment now, before React has
            // seen the event, so there is no visual latency (core.md section 4).
            val eventCount = model.state.user(index.toDouble())
            model.displayed = index
            model.onChange?.invoke(index.toDouble(), eventCount.toDouble())
          },
          modifier = Modifier.semantics { selected = isSelected },
          enabled = enabled,
          // Required, with no default: Material 3 gives each segment the corners
          // its position earns - only the ends of the row are rounded; it is one
          // track. Recomposing this is a shape transform on the index and count,
          // which is what `itemShape` is, and unlike the colours it is not derived
          // from the theme, so there is nothing to cache.
          shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
          colors = colors,
          // Spelled out to choose the overload: Material 3 1.4 has a 12-parameter
          // `SegmentedButton` and a deprecated 11-parameter one without
          // `contentPadding`. Naming a default only the longer signature has forces
          // the compiler to it; leaving it out, resolution prefers the shorter one.
          contentPadding = SegmentedButtonDefaults.ContentPadding,
          // Label only, deliberately: Material 3's default `icon` renders a check
          // mark *on the selected segment only*, so the row's measured width would
          // change with the selection - and a size that moves when the selection
          // moves would have to put the selection in `nuiSizingKey`, which is both
          // a cache fragmenter and a re-measure per tap. iOS's segmented `Picker`
          // has no such icon, so label-only is also the cross-platform match.
          icon = {},
          label = { Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        )
      }
    }
  }
}

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
     * Measured on the AVD this library's tests run on (`nitroui_t02`, 420 dpi,
     * API 35) with `options = ["One", "Two", "Three"]`: 256.0 x 48.0 dp. The
     * height is the half that belongs here: Material 3 makes every segment of a
     * segmented button row the same height whatever it says, measured 48 dp for
     * one option and for four long ones alike. (Not the 40 dp of
     * `ContainerHeight` the token names - the row is laid out inside a 48 dp
     * touch target, and it is the box Yoga is told that has to be right.)
     *
     * The width moves with the labels - 75.05 dp for one short segment (a segment
     * never shrinks below `ButtonDefaults.MinWidth`), and four long labels want
     * more than this AVD's 411.43 dp window: that number is the box Yoga clamped
     * the row to, not a measured row width (the row reports what it wants and is
     * laid out at the box - `NitroUiMeasuredRoot`, and
     * `docs/components/segmented-control.md`, Limits). A
     * wrong fallback costs a cold configuration a single frame's horizontal gap.
     * Rounded *up* rather than to nearest: a box smaller than the control is the
     * dead-touch story in `core.md` section 7.
     * `docs/components/segmented-control.md` has the measured table.
     */
    private const val FALLBACK_WIDTH_DP = 256.0
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
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
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
