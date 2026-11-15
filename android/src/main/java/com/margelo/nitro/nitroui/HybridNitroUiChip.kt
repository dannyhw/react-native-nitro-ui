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

// The Chip component: Material 3 `FilterChip` and `AssistChip`. Must stay in this package,
// which the generated view manager imports with a wildcard.

internal enum class ChipVariant(val wireName: String) {
  Filter("filter"),
  Assist("assist");

  companion object {
    fun from(value: String): ChipVariant = entries.firstOrNull { it.wireName == value } ?: Filter
  }
}

/** What a toggle painted, compared with the next props batch before its size is filed. */
internal data class ChipToggleStamp(
  val selected: Boolean,
  val label: String,
  val variant: ChipVariant,
)

internal class ChipModel : NitroUiModel() {
  var label by mutableStateOf("")

  var variant by mutableStateOf(ChipVariant.Filter)

  var displayed by mutableStateOf(false)

  var enabled by mutableStateOf(true)

  var accessibilityLabel by mutableStateOf<String?>(null)

  /** The SF Symbol name. Ignored on Android. */
  var systemImage: String? = null

  /** The icon string exactly as React sent it; [iconSlot] holds what it resolved to. */
  var androidIcon: String? = null

  val iconSlot = NitroUiIconSlot()

  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

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

  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  // Test-only. Material's chip icon colour comes from the dynamic palette on Android 12+,
  // so a test cannot know it: record the colour used and let the pixel probe sample for it.
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

/** Material's chip shapes, with a pill for a selected filter chip. Cached per motion scheme. */
@Composable
private fun chipShapes(): ChipShapes {
  val motion = MaterialTheme.motionScheme
  ChipShapesCache.get(motion)?.let { cached -> return cached }
  val base = FilterChipDefaults.shapes()
  val built = ChipShapes(shape = base.shape, selectedShape = CircleShape, pressedShape = base.pressedShape)
  ChipShapesCache.put(motion, built)
  return built
}

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

/** The check of a selected filter chip, which `FilterChip` leaves to the caller. */
private val ChipLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = nitroUiIcon(R.drawable.nitroui_check),
    contentDescription = null,
    modifier = Modifier.size(FilterChipDefaults.IconSize),
  )
}

/**
 * The leading slot of an unselected filter chip: present, and zero wide. Material animates
 * the slot's width when it appears, and the host cannot follow a width animation: each
 * frame is a size correction, and the chip settles narrower than one mounted selected.
 */
private val ChipLeadingSlotEmpty: @Composable () -> Unit = {
  Spacer(Modifier.width(0.dp))
}

/** The chip's `androidIcon`. Both chip variants use the same 18 dp icon size as the check. */
@Composable
internal fun ChipLeadingIcon(content: NitroUiIconContent) {
  NitroUiIconSlotGlyph(content, FilterChipDefaults.IconSize)
}

private class ChipHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ChipModel,
) : NitroComposeHost<ChipModel>(context, activity, model) {
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

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

  // The path a tap takes; also used by tests. A filter chip's toggle changes its size (the
  // check comes or goes) before React sends the matching sizing key, so reports are held.
  fun press() {
    if (!model.enabled) {
      return
    }
    when (model.variant) {
      ChipVariant.Filter -> {
        val requested = !model.displayed
        // Optimistic: show the new value before React has seen the event.
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
    // Read by tests: what the composable was handed, not what React sent.
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
      Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    // The check takes the slot on a selected filter chip. An assist chip with no icon gets
    // `null`: it has no selection, so there is no width animation to avoid.
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

class HybridNitroUiChip(
  reactContext: ThemedReactContext,
) : HybridNitroUiChipSpec(), RecyclableView {

  private val model = ChipModel()
  private val host = ChipHost(reactContext, reactContext.currentActivity, model)

  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  private val pixelProbes = NitroUiPixelProbes()

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    // Must match `getName()` in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiChip"

    // The size before anything is measured, in dp. Every chip is 48 dp tall: Material's
    // 32 dp chip inside the 48 dp minimum interactive size.
    private const val FALLBACK_WIDTH_DP = 96.0
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

  override var label: String
    get() = model.label
    set(next) {
      if (next == model.label) {
        return
      }
      model.label = next
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
      // Not visual by itself: `displayed` follows in `afterUpdate()`, once JS has caught up.
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
      host.markDirty()
    }

  override var systemImage: Variant_NullType_String
    get() =
      model.systemImage?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never rendered, so nothing is marked dirty.
      model.systemImage = next.asSecondOrNull()
    }

  // Stores and marks dirty only. Resolving takes a lock or starts a network read, so it
  // happens once per commit in [afterUpdate].
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
      // A new configuration may measure the same size, which the host's dedupe would drop.
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
    model.resolveAndroidIcon(iconArtwork)
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // Release the hold only for a batch that has seen every toggle: an earlier batch's key
    // predates the newest toggle and would file one state's size under the other's. The held
    // size is filed only if what the toggle painted is still what is shown.
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
    pixelProbes.clear()
    host.tag = null
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onSelectedChange = null
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  // Posted: reading pixels needs the UI thread, and a Nitro method may not block for it.
  override fun nuiTestPixelProbe(color: Double) {
    val run = { pixelProbes.publish(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = pixelProbes.read()

  // Reads the host's cached size, so it is safe on the JS thread.
  override fun measureContent(): NitroUiChipSize {
    val size = host.contentSize ?: return NitroUiChipSize(0.0, 0.0)
    return NitroUiChipSize(size.width, size.height)
  }

  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post { model.recordAccessibility(describeAccessibility()) }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  // The merged node that publishes the click action, as one line. Compose builds semantics
  // only while an accessibility service is connected, so they are forced on first.
  private fun describeAccessibility(): String {
    val root = findComposeRoot(host) ?: return "no Compose root"
    root.forceAccessibilityForTesting(true)
    // Declared non-null, but null until semantics exist.
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
