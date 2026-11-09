package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ChipShapes
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiPixelProbes
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.nitroui.core.toRgbHex
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

/*
 * The Chip component: Material 3 `FilterChip` and `AssistChip` on the core runtime.
 *
 * Two siblings meet here. The value is the Switch's (`HybridNitroUiSwitch.kt`: the
 * event-count handshake), and the size is the Button's (`HybridNitroUiButton.kt`:
 * label-sized, so the sizing key names the label). What is new is that a *user's*
 * toggle moves the size: M3's selected filter chip gains a leading check, so the chip
 * grows the moment native paints the selection - before React has re-keyed it. That
 * is Picker's situation (G6 review M1), and it gets Picker's answer: the size report
 * is held from the toggle until the props batch that names the new selection lands
 * (`NitroComposeHost.holdSizingReports`) - recognised by its echoed event count, so a
 * batch made before the newest toggle cannot end the hold.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** What the chip is for. Anything unrecognised is `filter` (Button's rule). */
internal enum class ChipVariant(val wireName: String) {
  Filter("filter"),
  Assist("assist");

  companion object {
    fun from(value: String): ChipVariant = entries.firstOrNull { it.wireName == value } ?: Filter
  }
}

/**
 * What a user's toggle painted, so the batch that follows it can be checked against
 * it before the held size is filed (see [HybridNitroUiChip.afterUpdate]).
 */
internal data class ChipToggleStamp(
  val selected: Boolean,
  val label: String,
  val variant: ChipVariant,
)

/** State of one Chip. See [NitroUiModel] for the shape this has to have. */
internal class ChipModel : NitroUiModel() {
  /** The label text. Observed: it is what renders and what decides the width. */
  var label by mutableStateOf("")

  /** Which M3 chip to compose. */
  var variant by mutableStateOf(ChipVariant.Filter)

  /** What a filter chip shows. Snapshot-observed, so writing it recomposes. */
  var displayed by mutableStateOf(false)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** `accessibilityLabel`, put on the chip itself (never the container, core.md §3). */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The SF Symbol name. Ignored on Android, as a Button's is
   * (`docs/components/button.md`): stored, not observed, because nothing draws it.
   */
  var systemImage: String? = null

  /**
   * The chip's Android glyph, in the wire form the wrapper built: a resource name, or a
   * `url:` string for a file to read (`NitroUiIconSource`). Button's prop, spelled the
   * same and resolved the same way - see [iconSlot] for what is derived from it.
   *
   * Stored, not observed: the composition draws [androidIconContent].
   */
  var androidIcon: String? = null

  /**
   * Everything derived from [androidIcon]: the same [NitroUiIconSlot] `ButtonModel` and
   * `MenuModel` use, so "resolve once per change, reserve a file's slot before it
   * lands, retire an in-flight load on a recycle, draw nothing for artwork that cannot
   * be resolved" is written in one place for every control that has an icon.
   */
  val iconSlot = NitroUiIconSlot()

  /** What the chip lays its label beside. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  /** Apply [androidIcon] if it is not what [androidIconContent] already is. */
  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultSelected: Boolean? = null
  var didApplyDefault = false

  /** The toggle whose size report is being held, until its batch lands. */
  var toggleStamp: ChipToggleStamp? = null

  var onSelectedChange: ((Boolean, Double) -> Unit)? = null
  var onPress: (() -> Unit)? = null

  /** Test-only read-outs (`nuiTestStateReport`), behind one lock. */
  private val reportLock = Any()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"
  private var iconTint = "-"

  /** Record what the composable was handed. Plain storage, never observed. */
  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  /**
   * Record the colour the `androidIcon` slot was tinted with, or `-` when no glyph drew.
   *
   * Test-only, for the reason `MenuRowIcons.noteTint` gives at length: Material's chip
   * icon colour comes from the device's dynamic palette on Android 12+, so a harness
   * cannot write the RGB down. It is recorded in the composable, from the same
   * `LocalContentColor` the glyph is tinted with, and `nuiTestPixelProbe` samples for
   * that - a reading of what was drawn, not of what was sent.
   */
  fun recordIconTint(
    tint: ComposeColor?,
  ) {
    synchronized(reportLock) { iconTint = tint?.let { "#${it.toRgbHex()}" } ?: "-" }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /**
   * `displayed=<0|1|none>;probes=<n>;a11y=<...>;iconTint=<#RRGGBB|->`.
   * Safe from any thread.
   */
  fun stateReport(): String =
    synchronized(reportLock) {
      "displayed=$drawn;probes=$probes;a11y=$accessibilityReport;iconTint=$iconTint"
    }

  override fun reset() {
    label = ""
    variant = ChipVariant.Filter
    displayed = false
    enabled = true
    accessibilityLabel = null
    systemImage = null
    androidIcon = null
    // The same reset Button's and Menu's triggers do: the resolved name is forgotten, a
    // file load the previous owner started is retired, and the slot is empty again.
    iconSlot.reset()
    sizingKey = ""
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultSelected = null
    didApplyDefault = false
    toggleStamp = null
    onSelectedChange = null
    onPress = null
    synchronized(reportLock) {
      drawn = "none"
      probes = 0
      accessibilityReport = "none"
      iconTint = "-"
    }
  }
}

/**
 * The chip's corners, on Material 3 1.5's `ChipShapes` overload.
 *
 * A *selected* filter chip gets a corner of its own - the pill Material draws for
 * the chosen one - while the resting corner and the press morph stay Material's:
 * `pressedShape` is read from the defaults so the morph to the square corner on
 * press is still the theme's motion scheme's business, not this file's. The
 * corner is a paint, not a layout input, so no measured size moves here.
 */
@Composable
private fun chipShapes(): ChipShapes {
  val motion = MaterialTheme.motionScheme
  ChipShapesCache.get(motion)?.let { cached -> return cached }
  val base = FilterChipDefaults.shapes()
  val built = ChipShapes(shape = base.shape, selectedShape = CircleShape, pressedShape = base.pressedShape)
  ChipShapesCache.put(motion, built)
  return built
}

/** [chipShapes]' store: one motion scheme at a time, because the corner is its to build. */
private object ChipShapesCache {
  private var motion: MotionScheme? = null
  private var shapes: ChipShapes? = null

  @Synchronized
  fun get(motion: MotionScheme): ChipShapes? = if (this.motion === motion) shapes else null

  @Synchronized
  fun put(
    motion: MotionScheme,
    shapes: ChipShapes,
  ) {
    this.motion = motion
    this.shapes = shapes
  }
}

/**
 * The leading check of a selected filter chip, which Material 3 asks for and
 * `FilterChip` leaves to the caller: Google's Material Symbols `check`
 * (`nitroui_check`, `core/NitroUiIcons.kt`), parsed once per process, at the
 * chip's own icon size. One lambda for the process.
 */
private val ChipLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = nitroUiIcon(R.drawable.nitroui_check),
    contentDescription = null,
    modifier = Modifier.size(FilterChipDefaults.IconSize),
  )
}

/**
 * The leading slot of an *unselected* filter chip: present, and zero wide.
 *
 * Material 3 draws every selectable chip through an `AnimatedVisibility` of the
 * leading icon with an `expandHorizontally`/`shrinkHorizontally` spring - still true
 * of the 1.5.0-beta02 chip this builds on, re-checked for E1 rather than assumed:
 * `ChipKt` in that artifact still names both visibility transformers. Passing `null` when unselected is
 * therefore a *width animation* on every toggle, and the host cannot follow one:
 * measured on `nitroui_t03`, a toggle reported seven widths frame by frame
 * (89.5 -> 91.8 -> 96 -> ... -> 106.3 dp), each one a layout correction, and the last
 * frames were never reported at all - content that outgrows the box it was just given
 * is placed at that box (`NitroUiOverWidePlacement`) and Compose has no reason to
 * measure it again - so the chip settled 1.1 dp narrower than a chip mounted selected
 * (106.29 against 107.43) with its label ellipsised.
 *
 * A slot that is always there keeps that visibility `true`, so nothing animates and a
 * toggle is one size change, which the hold in [ChipHost.press] files under the right
 * key. The two end states are M3's own: the row is `8 + icon + 8 + label + 16` dp, so
 * a zero-wide icon is exactly the unselected chip's width, and the check is M3's
 * selected chip. What is lost is the check's slide-in (`docs/components/chip.md`,
 * "Limits").
 */
private val ChipLeadingSlotEmpty: @Composable () -> Unit = {
  Spacer(Modifier.width(0.dp))
}

/**
 * The chip's `androidIcon`, in the slot Material sizes and colours.
 *
 * [FilterChipDefaults.IconSize] for both variants: `AssistChipTokens.IconSize` and
 * `FilterChipTokens.IconSize` are the same 18 dp, so an assist chip's glyph and a
 * filter chip's are one size - and one size with the check that takes the filter chip's
 * slot when it is selected, which is the pair the toggle round trip must not move.
 *
 * The colour comes from `LocalContentColor`, which the chip has already set to its own
 * leading-icon colour before composing this: it follows the variant, the selection and
 * `enabled` without this file knowing Material's colour roles, and a glyph painted in a
 * constant would sit at full strength on a disabled chip (G19's finding on Button).
 */
@Composable
internal fun ChipLeadingIcon(content: NitroUiIconContent) {
  NitroUiIconSlotGlyph(content, FilterChipDefaults.IconSize)
}

/**
 * The Chip's host: [NitroComposeHost] plus this component's composable. [Component]
 * is fixed for the lifetime of the view - there is no `setContent` after construction.
 */
private class ChipHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ChipModel,
) : NitroComposeHost<ChipModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one - the
   * Slider host's guard (`HybridNitroUiSlider.kt`), for the Slider's reason:
   * `nuiTestProbeAccessibility` forces Compose's semantics on with no reader
   * connected, Compose then announces every later change up the parent chain, and
   * [AccessibilityManager] answers an announcement with no recipient by throwing
   * `Accessibility off. Did you forget to check that?` (measured here: the probe took
   * the app down one test later). Inert when a reader is connected.
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
   * One press, through the path a tap takes - M3's `onClick`, and the
   * `nuiTestPress` harness hook - so the two cannot disagree about what a press
   * means. Refused while disabled, as M3 refuses the tap.
   *
   * A filter chip's toggle paints a new size (the leading check comes or goes), and
   * the key that names it only arrives with the next props batch, so the report its
   * measure causes is held until then. Taken after the emit, as Picker's `choose`
   * does: nothing can measure between the emit and the end of this handler.
   */
  fun press() {
    if (!model.enabled) {
      return
    }
    when (model.variant) {
      ChipVariant.Filter -> {
        val requested = !model.displayed
        // Native is optimistic: show the new value now, before React has seen the
        // event, so there is no visual latency (§4).
        val eventCount = model.state.user(requested)
        model.displayed = requested
        model.onSelectedChange?.invoke(requested, eventCount.toDouble())
        model.toggleStamp = ChipToggleStamp(requested, model.label, model.variant)
        holdSizingReports()
      }
      ChipVariant.Assist -> model.onPress?.invoke()
    }
  }

  @Composable
  override fun Component(model: ChipModel) {
    val variant = model.variant
    val selected = model.displayed
    // The reading `nuiTestStateReport()` answers with: taken in the composable, so
    // it is what the chip is handed rather than what React sent.
    model.recordDrawn(
      if (variant == ChipVariant.Filter) (if (selected) "1" else "0") else "none",
    )
    val label = model.accessibilityLabel
    // The label goes on the chip, which is the node TalkBack focuses. On the
    // container instead, the empty box becomes a second focus stop.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    val text = model.label
    val content: @Composable () -> Unit = {
      // One line, tail-truncated: the chip's intrinsic width is the label's, and a
      // caller's narrower `width` truncates it instead of painting outside.
      Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    // The leading slot, which is the whole of this chip's icon story. The check wins it
    // on a selected filter chip - a selected chip means "checked", and a glyph beside a
    // check would say it twice - and the app's glyph holds it otherwise.
    //
    // An assist chip with nothing to draw gets `null` rather than the empty spacer: it
    // has no selection, so nothing toggles Material's `AnimatedVisibility`, and `null`
    // is what it was handed before this prop existed - "a name that does not resolve
    // leaves the chip exactly its no-icon self" is then true by construction rather than
    // by a zero-wide spacer. The filter chip keeps the spacer for [ChipLeadingSlotEmpty]'s
    // reason, which is a reason about its selection animation and not about icons.
    val icon = model.androidIconContent
    val glyph: @Composable () -> Unit = {
      model.recordIconTint(LocalContentColor.current)
      ChipLeadingIcon(icon)
    }
    val emptyGlyph: @Composable () -> Unit = {
      model.recordIconTint(null)
      ChipLeadingSlotEmpty()
    }
    val check: @Composable () -> Unit = {
      model.recordIconTint(null)
      ChipLeadingCheck()
    }
    when (variant) {
      ChipVariant.Filter ->
        FilterChip(
          selected = selected,
          onClick = { press() },
          label = content,
          modifier = labelModifier,
          enabled = model.enabled,
          shapes = chipShapes(),
          leadingIcon =
            when {
              selected -> check
              icon == NitroUiIconContent.Absent -> emptyGlyph
              else -> glyph
            },
        )
      ChipVariant.Assist ->
        AssistChip(
          onClick = { press() },
          label = content,
          modifier = labelModifier,
          enabled = model.enabled,
          leadingIcon =
            if (icon == NitroUiIconContent.Absent) {
              null
            } else {
              glyph
            },
        )
    }
  }
}

/** The Hybrid View React renders as `NitroUiChip`. */
class HybridNitroUiChip(
  reactContext: ThemedReactContext,
) : HybridNitroUiChipSpec(), RecyclableView {

  private val model = ChipModel()
  private val host = ChipHost(reactContext, reactContext.currentActivity, model)

  /** The app's resources and the dev server, behind the one resolver every `androidIcon` uses. */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  /** The probe pair - Button's, for Button's reason: a drawn glyph is a fact pixels hold. */
  private val pixelProbes = NitroUiPixelProbes()

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
    private const val SIZING_COMPONENT_NAME = "NitroUiChip"

    /**
     * The size to lay a Chip out with before anything has been measured, in dp.
     *
     * One number for every configuration, for Button's reason (fallbacks are keyed
     * by component). The height is the part worth getting right, and it is 48 dp for
     * every chip: M3's chip is 32 dp tall inside the 48 dp minimum interactive size.
     * The width is inside `docs/components/chip.md`'s measured table: "Sized" is
     * 66.29 dp unselected, "Re-keyed" 89.52 and "Measured" 94.10 (Android 15 emulator).
     */
    private const val FALLBACK_WIDTH_DP = 96.0
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

  override var label: String
    get() = model.label
    set(next) {
      if (next == model.label) {
        return
      }
      model.label = next
      // The composable recomposes and Compose's own measure pass reports the new
      // width (sizing.md §5).
      host.markDirty()
    }

  override var variant: String
    get() = model.variant.wireName
    set(next) {
      val resolved = ChipVariant.from(next)
      if (resolved == model.variant) {
        return
      }
      model.variant = resolved
      host.markDirty()
    }

  override var selected: Variant_Boolean_NullType
    get() =
      model.state.js?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` follows once the event count says JS has
      // caught up. See `afterUpdate()`.
      model.state.js = next.asFirstOrNull()
    }

  override var defaultSelected: Variant_Boolean_NullType
    get() =
      model.defaultSelected?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val seed = next.asFirstOrNull()
      model.defaultSelected = seed
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
      // Repaints only: a disabled chip is the same size.
      host.markDirty()
    }

  override var systemImage: Variant_NullType_String
    get() =
      model.systemImage?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never rendered (Button's rule). No `markDirty()` - nothing observes it.
      model.systemImage = next.asSecondOrNull()
    }

  /**
   * `androidIcon`: the glyph to draw before the label - an app drawable's resource name,
   * or a `url:` string naming a file to read. Button's prop and Button's rules
   * (`HybridNitroUiButton.androidIcon` says them): the setter stores the string React
   * sent and marks dirty, and [afterUpdate] resolves it, because a name is a lock on a
   * shared resource table and a file is a socket.
   *
   * Stored verbatim so `hybridRef` reports the string back exactly as the harness built
   * it - the marker is part of that string's identity, not noise to normalise away.
   */
  override var androidIcon: Variant_NullType_String
    get() =
      model.androidIcon?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val name = next.asSecondOrNull()
      if (name == model.androidIcon) {
        return
      }
      model.androidIcon = name
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

  override var onSelectedChange: ((Boolean, Double) -> Unit)?
    get() = model.onSelectedChange
    set(next) {
      model.onSelectedChange = next
    }

  override var onPress: (() -> Unit)?
    get() = model.onPress
    set(next) {
      model.onPress = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The glyph first, once per commit, before the composition below reads it: Button's
    // order and Button's reason - a resource resolved here is drawn by this commit, and a
    // file that has to be read reserves its slot in this commit and fills it later, so
    // the chip's box never waits for the bytes.
    model.resolveAndroidIcon(iconArtwork)
    // The handshake decides whether React's `selected` wins over what the user just
    // did - including a toggle JS refused (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A held size report waits for the batch that has seen the toggle - every
    // toggle: `jsEvents` is the count the wrapper echoed, controlled or not
    // (`Chip.tsx`). A batch that is behind carries a key made before the newest
    // toggle - a second toggle landed before the first one's render arrived, or an
    // unrelated render was already on its way - and filing the held width under it
    // would put one state's size in the other state's cache entry (G12 review,
    // fix round 1). So that batch leaves the hold on, stamp and all; the one that
    // catches up decides.
    //
    // That batch is the one the report belongs to only if what the toggle painted
    // is still what is shown: the same selection (a refused toggle has just been
    // rolled back above), label and variant. Otherwise the held width is a fact
    // about other content and is dropped; the rollback re-measures in the ordinary
    // course.
    val stamp = model.toggleStamp
    val caughtUp = model.state.jsEvents >= model.state.nativeEvents
    if (stamp == null || caughtUp) {
      model.toggleStamp = null
      host.releaseSizingReports(
        stamp != null &&
          stamp.selected == model.displayed &&
          stamp.label == model.label &&
          stamp.variant == model.variant,
      )
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    // A recycled chip must not answer for its previous owner's pixels, the same way its
    // model must not answer with its previous owner's `selected`.
    pixelProbes.clear()
    host.tag = null
    // The composition does not survive a recycle (core.md §6), and
    // `host.prepareForRecycle()` resets the model and releases the sizing instance.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onSelectedChange = null
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  /**
   * Sample what this chip is drawing for [color], and store the answer.
   *
   * Posted rather than run inline, like every other probe here: reading pixels needs the
   * view drawn, and a Nitro method may not block for the UI thread. The same sampler as
   * Button's and SegmentedControl's, so one harness helper reads all three.
   */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { pixelProbes.publish(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = pixelProbes.read()

  /** The size Compose measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiChipSize {
    val size = host.contentSize ?: return NitroUiChipSize(0.0, 0.0)
    return NitroUiChipSize(size.width, size.height)
  }

  /** Press through the tap's path, on the UI thread (see the spec). Returns at once. */
  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Read the chip's semantics node on the UI thread (see the spec). Returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post { model.recordAccessibility(describeAccessibility()) }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  /**
   * The merged node a reader is handed for this chip, as one line:
   * `role=<role>,selected=<bool|none>,toggle=<state|none>,disabled=<bool>,clickable=<bool>,label=<text>`.
   *
   * The node is the one that publishes the click action - M3's chip surface. Compose
   * builds semantics only while an accessibility service is connected, and a harness
   * run has none, so it is forced on for this view first (the Slider's probe does the
   * same, and says why).
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
    val clickable = nodes.filter { it.config.contains(SemanticsActions.OnClick) }
    val node: SemanticsNode =
      when (clickable.size) {
        0 -> return "no node publishes OnClick (${nodes.size} nodes)"
        1 -> clickable[0]
        else -> return "ambiguous: ${clickable.size} nodes publish OnClick"
      }
    val config = node.config
    val role = config.getOrNull(SemanticsProperties.Role)?.toString() ?: "none"
    val selected = config.getOrNull(SemanticsProperties.Selected)?.toString() ?: "none"
    val toggle = config.getOrNull(SemanticsProperties.ToggleableState)?.toString() ?: "none"
    val disabled = config.contains(SemanticsProperties.Disabled)
    val label =
      config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
        ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }
        ?: ""
    return "role=$role,selected=$selected,toggle=$toggle,disabled=$disabled," +
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
