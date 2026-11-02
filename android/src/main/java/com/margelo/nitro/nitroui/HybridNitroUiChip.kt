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
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
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
import com.margelo.nitro.nitroui.core.NitroUiSizing
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
 * (`NitroComposeHost.holdSizingReports`).
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

  /** Record what the composable was handed. Plain storage, never observed. */
  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** `displayed=<0|1|none>;probes=<n>;a11y=<...>`. Safe from any thread. */
  fun stateReport(): String =
    synchronized(reportLock) { "displayed=$drawn;probes=$probes;a11y=$accessibilityReport" }

  override fun reset() {
    label = ""
    variant = ChipVariant.Filter
    displayed = false
    enabled = true
    accessibilityLabel = null
    systemImage = null
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
    }
  }
}

/**
 * The leading check of a selected filter chip, which Material 3 asks for and
 * `FilterChip` leaves to the caller.
 *
 * The geometry of Material's `Icons.Filled.Check` (Apache 2.0, the 24-unit
 * viewport), written out because this library does not depend on
 * `material-icons-core` for one glyph. Built once per process and shared, because a
 * hosted control is its own composition and `remember` cannot share anything between
 * two of them (`docs/architecture/core.md`, "Shared objects").
 */
private val ChipCheckIcon: ImageVector by lazy {
  ImageVector.Builder(
    name = "NitroUiChipCheck",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
  ).path(fill = SolidColor(ComposeColor.Black)) {
    moveTo(9f, 16.17f)
    lineTo(4.83f, 12f)
    lineToRelative(-1.42f, 1.41f)
    lineTo(9f, 19f)
    lineTo(21f, 7f)
    lineToRelative(-1.41f, -1.41f)
    close()
  }.build()
}

/** The check, at the chip's own icon size. One lambda for the process. */
private val ChipLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = ChipCheckIcon,
    contentDescription = null,
    modifier = Modifier.size(FilterChipDefaults.IconSize),
  )
}

/**
 * The leading slot of an *unselected* filter chip: present, and zero wide.
 *
 * Material 3 1.4 draws every selectable chip through `AnimatingChipContent`, which
 * wraps the leading icon in `AnimatedVisibility(leadingIcon != null)` with an
 * `expandHorizontally`/`shrinkHorizontally` spring. Passing `null` when unselected is
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
    when (variant) {
      ChipVariant.Filter ->
        FilterChip(
          selected = selected,
          onClick = { press() },
          label = content,
          modifier = labelModifier,
          enabled = model.enabled,
          leadingIcon = if (selected) ChipLeadingCheck else ChipLeadingSlotEmpty,
        )
      ChipVariant.Assist ->
        AssistChip(
          onClick = { press() },
          label = content,
          modifier = labelModifier,
          enabled = model.enabled,
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
    // The handshake decides whether React's `selected` wins over what the user just
    // did - including a toggle JS refused (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // The batch a held size report was waiting for has landed. It is the batch that
    // report belongs to only if what the toggle painted is still what is shown: the
    // same selection (a refused toggle has just been rolled back above), label and
    // variant. Otherwise the held width is a fact about other content and is
    // dropped; the rollback re-measures in the ordinary course.
    val stamp = model.toggleStamp
    model.toggleStamp = null
    host.releaseSizingReports(
      stamp != null &&
        stamp.selected == model.displayed &&
        stamp.label == model.label &&
        stamp.variant == model.variant,
    )
    host.commit()
  }

  override fun prepareForRecycle() {
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
