package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ripple
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiPixelProbes
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.nitroui.core.toRgbHex
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// The ListItem component: Material 3's `ListItem` content, with no insets or press of its
// own inside a `Form.Row`. Must stay in this package, which the generated manager imports.

internal enum class ListItemAccessory(val wireName: String) {
  None("none"),
  Disclosure("disclosure");

  companion object {
    fun from(value: String): ListItemAccessory =
      entries.firstOrNull { it.wireName == value } ?: None
  }
}

internal class ListItemModel : NitroUiModel() {
  var title by mutableStateOf<String?>(null)

  var subtitle by mutableStateOf<String?>(null)

  var value by mutableStateOf<String?>(null)

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

  var accessory by mutableStateOf(ListItemAccessory.None)

  /** Whether `onPress` is wired: the row's indication and its button role. */
  var pressable by mutableStateOf(false)

  /** Whether a `Form.Row` draws this item: its cell then owns insets, shape and press. */
  var insideRow by mutableStateOf(false)

  var enabled by mutableStateOf(true)

  var accessibilityLabel by mutableStateOf<String?>(null)

  var sizingKey = ""

  var onPress: (() -> Unit)? = null

  /** Test-only read-outs, behind one lock and never observed. */
  private val reportLock = Any()
  private var drawn = "none"
  private var presses = 0
  private var probes = 0
  private var accessibilityReport = "none"

  // Leading inset, trailing inset and box in dp, or null before the first layout.
  private var geometry: FloatArray? = null

  // The colour each slot is painted with, by slot name, as `#rrggbbaa` or `none`. A slot
  // that never ran reads `pending`.
  private val slotColours = HashMap<String, String>()

  // Whether the item's own press indication ran for the last press. False inside a `Form.Row`.
  private var highlightPainted = false

  /** The live `clickable`'s interaction source, so a test press can emit what a finger does. */
  @Volatile var ownInteractionSource: MutableInteractionSource? = null

  // The colour the leading glyph was painted with, or `-`. Material's icon colour comes
  // from the dynamic palette on Android 12+, so a test has to be told it.
  private var iconTint = "-"

  /** Record what the composable was handed: `<title>|<subtitle>|<value>|<accessory>`. */
  fun recordDrawn(report: String) {
    synchronized(reportLock) { drawn = report }
  }

  fun recordPress() {
    synchronized(reportLock) { presses += 1 }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  fun recordGeometry(
    leading: Float,
    trailing: Float,
    width: Float,
    height: Float,
  ) {
    synchronized(reportLock) { geometry = floatArrayOf(leading, trailing, width, height) }
  }

  fun recordSlotColour(
    slot: String,
    report: String,
  ) {
    synchronized(reportLock) { slotColours[slot] = report }
  }

  private fun coloursReport(): String =
    listOf("text", "secondary", "image", "chevron", "value").joinToString(",") { slot ->
      "$slot=${slotColours[slot] ?: "pending"}"
    }

  fun recordHighlightPainted(
    painted: Boolean,
  ) {
    synchronized(reportLock) { highlightPainted = painted }
  }

  fun recordIconTint(
    tint: ComposeColor?,
  ) {
    synchronized(reportLock) { iconTint = tint?.let { "#${it.toRgbHex()}" } ?: "-" }
  }

  /** `displayed=<…>;presses=<n>;probes=<n>;a11y=<…>;iconTint=<#RRGGBB|->;colours=<…>`. */
  fun stateReport(): String =
    synchronized(reportLock) {
      "displayed=$drawn;presses=$presses;probes=$probes;a11y=$accessibilityReport;" +
        "iconTint=$iconTint;colours=${coloursReport()}"
    }

  /** `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>`, or `pending` before the first layout. */
  fun layoutReport(): String =
    synchronized(reportLock) {
      val measured = geometry ?: return "pending"
      "insets=" +
        measured[0].fmt() + "," + measured[1].fmt() +
        ";shape=" + (if (highlightPainted) 1 else 0) +
        ";box=" + measured[2].fmt() + "x" + measured[3].fmt()
    }

  fun clearReports() {
    synchronized(reportLock) {
      drawn = "none"
      presses = 0
      probes = 0
      accessibilityReport = "none"
      geometry = null
      slotColours.clear()
      highlightPainted = false
      iconTint = "-"
    }
  }

  override fun reset() {
    // The interaction source belongs to a composition that is going away with this instance.
    ownInteractionSource = null
    title = null
    subtitle = null
    value = null
    systemImage = null
    androidIcon = null
    iconSlot.reset()
    accessory = ListItemAccessory.None
    pressable = false
    insideRow = false
    enabled = true
    accessibilityLabel = null
    sizingKey = ""
    onPress = null
    clearReports()
  }
}

/** Material's own metrics, spelled out because material3 keeps the tokens internal. */
internal object ListItemMetrics {
  /** `ListTokens.ItemLeadingSpace` / `ItemTrailingSpace`: the list's own horizontal inset. */
  val Inset = 16.dp

  /** `ListTokens.ItemLeadingIconSize`, the size Material gives a leading glyph. */
  val LeadingIconSize = 24.dp

  /** The gap Material keeps between a leading glyph and the text (`ItemBetweenSpace`). */
  val IconTextGap = 12.dp

  val ValueGap = 8.dp
}

/** Material's disabled-content alpha, which material3 keeps internal. */
private const val DisabledContentAlpha = 0.38f

private class ListItemHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ListItemModel,
) : NitroComposeHost<ListItemModel>(context, activity, model) {
  // The row's cell installs no `clickable` for an item inside it and presses for it, so the row
  // keeps a tap that lands here.
  override val pressOwnedByRow: Boolean
    get() = model.insideRow

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

  // The path a tap takes; also used by tests. A test press also emits the press
  // interaction a finger would, because the ripple is driven by the interaction source.
  // The release is posted so the indication has a frame or two to draw.
  fun press() {
    if (!model.enabled || !model.pressable) {
      return
    }
    model.ownInteractionSource?.let { source ->
      val press = PressInteraction.Press(Offset.Zero)
      source.tryEmit(press)
      postDelayed({ source.tryEmit(PressInteraction.Release(press)) }, 50L)
    }
    model.recordPress()
    model.onPress?.invoke()
  }

  @Composable
  override fun Component(model: ListItemModel) {
    val accessory = model.accessory
    val pressable = model.pressable
    val insideRow = model.insideRow
    val enabled = model.enabled

    // Read by tests: what Material is handed, not what React sent.
    model.recordDrawn(
      "${model.title ?: "-"}|${model.subtitle ?: "-"}|${model.value ?: "-"}|${accessory.wireName}",
    )

    // Transparent: Material's `ListItem` paints an opaque `surface` container by default,
    // which would draw a band behind the shape of the row that holds this item.
    val colors =
      ListItemDefaults.colors(
        containerColor = ComposeColor.Transparent,
        disabledContainerColor = ComposeColor.Transparent,
      )
    // Material's own colour functions, so a disabled row dims every slot as Material does.
    val headlineColor = colors.contentColor(enabled = enabled, selected = false, dragged = false)
    val supportingColor =
      colors.supportingContentColor(enabled = enabled, selected = false, dragged = false)
    val chevronColor =
      colors.trailingContentColor(enabled = enabled, selected = false, dragged = false)
    // Material's supporting-text colour, at its disabled-content alpha when disabled.
    val valueColor =
      MaterialTheme.colorScheme.onSurfaceVariant.let {
        if (enabled) it else it.copy(alpha = DisabledContentAlpha)
      }
    model.recordSlotColour(
      "text",
      when (model.title) {
        null -> "none"
        else -> hexOf(headlineColor)
      },
    )
    model.recordSlotColour(
      "secondary",
      when (model.subtitle) {
        null -> "none"
        else -> hexOf(supportingColor)
      },
    )
    model.recordSlotColour(
      "chevron",
      when (accessory) {
        ListItemAccessory.Disclosure -> hexOf(chevronColor)
        else -> "none"
      },
    )
    model.recordSlotColour(
      "value",
      when (model.value) {
        null -> "none"
        else -> hexOf(valueColor)
      },
    )

    // The list's horizontal inset, or none inside a row. The vertical insets stay Material's.
    val inset = if (insideRow) 0.dp else ListItemMetrics.Inset
    val defaults = ListItemDefaults.ContentPadding
    val contentPadding =
      PaddingValues(
        start = inset,
        end = inset,
        top = defaults.calculateTopPadding(),
        bottom = defaults.calculateBottomPadding(),
      )

    // Material merges the row's text but publishes no button role, no disabled state and
    // no fixed reading order, so they are stated here: title, subtitle, value.
    val label =
      model.accessibilityLabel
        ?: listOfNotNull(model.title, model.subtitle, model.value).joinToString(", ")
          .ifEmpty { null }
    val rowSemantics =
      Modifier.semantics {
        // Inside a `Form.Row` the cell publishes the button; a nested one would be an extra stop.
        if (pressable && !insideRow) {
          role = Role.Button
        }
        if (!enabled) {
          disabled()
        }
        if (label != null) {
          contentDescription = label
        }
      }

    // Plain storage, so a layout pass never causes a recomposition.
    val density = LocalDensity.current
    val box = remember { FloatArray(4) }
    val content = remember { FloatArray(3) }
    val publish = {
      if (box[2] > 0f && content[2] >= 0f) {
        val measured = ListItemLayout.geometry(box, content, density)
        model.recordGeometry(measured[0], measured[1], measured[2], measured[3])
      }
    }
    val interactionSource = remember { MutableInteractionSource() }

    // Inside a `Form.Row` the cell is the touch target and receives this item's `onPress`.
    val ownsClick = pressable && !insideRow

    // Test witness: a press that reached the source the indication draws from. A cancel
    // takes it back.
    LaunchedEffect(interactionSource, ownsClick) {
      interactionSource.interactions.collect { interaction ->
        when (interaction) {
          is PressInteraction.Press -> if (ownsClick) model.recordHighlightPainted(true)
          is PressInteraction.Cancel -> model.recordHighlightPainted(false)
          else -> {}
        }
      }
    }
    DisposableEffect(interactionSource, ownsClick) {
      model.ownInteractionSource = interactionSource.takeIf { ownsClick }
      onDispose { model.ownInteractionSource = null }
    }

    Box(
      modifier =
        Modifier
          .fillMaxWidth()
          .onGloballyPositioned { coords ->
            val origin = coords.positionInRoot()
            box[0] = origin.x
            box[1] = origin.y
            box[2] = coords.size.width.toFloat()
            box[3] = coords.size.height.toFloat()
            publish()
          },
    ) {
      // The value trails the headline on the same line. Material's `trailingContent` slot
      // is centred against the whole row, which on a two-line item puts it between the lines.
      val headline: @Composable () -> Unit = {
        Row(
          modifier =
            Modifier
              .fillMaxWidth()
              .onGloballyPositioned { coords ->
                val origin = coords.positionInRoot()
                content[0] = origin.x
                content[1] = origin.y
                content[2] = coords.size.width.toFloat()
                publish()
              },
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(
            text = model.title ?: "",
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = headlineColor,
            // The headline takes the leftover width, pushing the value to the trailing edge.
            modifier = Modifier.weight(1f),
          )
          val value = model.value
          if (value != null) {
            Spacer(modifier = Modifier.width(ListItemMetrics.ValueGap))
            Text(
              text = value,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              color = valueColor,
            )
          }
        }
      }

      val leading: (@Composable () -> Unit)? =
        if (model.androidIconContent == NitroUiIconContent.Absent) {
          model.recordIconTint(null)
          model.recordSlotColour("image", "none")
          null
        } else {
          {
            val tint = LocalContentColor.current
            model.recordIconTint(tint)
            model.recordSlotColour("image", hexOf(tint))
            NitroUiIconSlotGlyph(model.androidIconContent, ListItemMetrics.LeadingIconSize)
          }
        }

      val trailing: (@Composable () -> Unit)? =
        if (accessory == ListItemAccessory.Disclosure) {
          {
            Icon(
              imageVector = nitroUiIcon(R.drawable.nitroui_chevron_right),
              contentDescription = null,
              modifier = Modifier.size(ListItemMetrics.LeadingIconSize),
              tint = chevronColor,
            )
          }
        } else {
          null
        }

      // The press is installed here on the plain overload: Material's interactive
      // overload morphs a container this row keeps transparent, so its ink shows nothing.
      // Inside a row no `clickable` is installed at all: even with a null indication it
      // would take the touch from the cell.
      val ownClick =
        if (!ownsClick) {
          Modifier
        } else {
          Modifier.clickable(
            interactionSource = interactionSource,
            indication = ripple(),
            enabled = enabled,
            role = Role.Button,
            onClick = { press() },
          )
        }
      ListItem(
        modifier = Modifier.fillMaxWidth().then(ownClick).then(rowSemantics),
        enabled = enabled,
        leadingContent = leading,
        trailingContent = trailing,
        supportingContent =
          model.subtitle?.let { supporting ->
            {
              Text(
                text = supporting,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = supportingColor,
              )
            }
          },
        colors = colors,
        contentPadding = contentPadding,
        content = headline,
      )
    }
  }
}

// The row's merged accessibility node, as one line. Compose builds semantics only
// while an accessibility service is connected, so they are forced on first.
private fun describeAccessibility(
  host: View,
  title: String?,
): String {
  val root = findComposeRoot(host) ?: return "no Compose root"
  root.forceAccessibilityForTesting(true)
  val owner: SemanticsOwner? = root.semanticsOwner
  if (owner == null) {
    return "no SemanticsOwner"
  }
  val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
  val clickable = nodes.filter { it.config.contains(SemanticsActions.OnClick) }
  val named =
    nodes.filter { node ->
      title != null && textOf(node).contains(title)
    }
  val candidates = clickable.ifEmpty { named }
  val node: SemanticsNode =
    when {
      candidates.isEmpty() -> return "no node names this item (${nodes.size} nodes)"
      candidates.size > 1 -> return "ambiguous: ${candidates.size} nodes name this item"
      else -> candidates.first()
    }
  val config = node.config
  val role = config.getOrNull(SemanticsProperties.Role)?.toString() ?: "none"
  val disabled = config.contains(SemanticsProperties.Disabled)
  val label =
    config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
      ?: textOf(node)
  return "role=$role,disabled=$disabled,clickable=${config.contains(SemanticsActions.OnClick)}," +
    "label=$label"
}

private fun textOf(
  node: SemanticsNode,
): String {
  val described = node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
  val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }
  return listOfNotNull(described, text).joinToString(" ")
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

private object ListItemLayout {
  fun geometry(
    box: FloatArray,
    content: FloatArray,
    density: Density,
  ): FloatArray {
    val leading = (content[0] - box[0]).toDp(density)
    val trailing = (box[0] + box[2] - content[0] - content[2]).toDp(density)
    return floatArrayOf(
      leading,
      trailing,
      box[2].toDp(density),
      box[3].toDp(density),
    )
  }

  private fun Float.toDp(density: Density): Float = with(density) { this@toDp.toDp().value }

}

private fun Float.fmt(): String = String.format(java.util.Locale.ROOT, "%.2f", this)

// `#rrggbbaa`: `toArgb()` is `0xAARRGGBB`, so the bytes are reordered.
private fun hexOf(
  color: ComposeColor,
): String {
  val argb = color.toArgb()
  return String.format(
    java.util.Locale.ROOT,
    "#%02x%02x%02x%02x",
    argb shr 16 and 0xFF,
    argb shr 8 and 0xFF,
    argb and 0xFF,
    argb ushr 24 and 0xFF,
  )
}

class HybridNitroUiListItem(
  reactContext: ThemedReactContext,
) : HybridNitroUiListItemSpec(),
  RecyclableView {
  private val model = ListItemModel()
  private val host = ListItemHost(reactContext, reactContext.currentActivity, model)

  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // Fill-width: a row is as wide as its list. Measured unbounded it would report the
    // width its text wants and draw outside its box.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
  }

  companion object {
    // Must match `getName()` in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiListItem"

    // The height before anything is measured, in dp: Material's one-line item height.
    private const val FALLBACK_HEIGHT_DP = 56.0

    private const val FALLBACK_WIDTH_DP = 300.0

    private val fallbackDeclared = AtomicBoolean(false)

    // Called at package init, before Fabric can measure, and again from `init`.
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        // Not used as a width, but the first frame is laid out at it.
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; the composition applies everything once per commit.

  override var title: Variant_NullType_String
    get() = model.title?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.title) {
        return
      }
      model.title = value
      host.markDirty()
    }

  override var subtitle: Variant_NullType_String
    get() = model.subtitle?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.subtitle) {
        return
      }
      model.subtitle = value
      host.markDirty()
    }

  override var value: Variant_NullType_String
    get() = model.value?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.value) {
        return
      }
      model.value = value
      host.markDirty()
    }

  override var systemImage: Variant_NullType_String
    get() = model.systemImage?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never drawn: Android has no SF Symbols.
      model.systemImage = next.asSecondOrNull()
    }

  override var androidIcon: Variant_NullType_String
    get() = model.androidIcon?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      model.androidIcon = next.asSecondOrNull()
    }

  override var accessory: String
    get() = model.accessory.wireName
    set(next) {
      val value = ListItemAccessory.from(next)
      if (value == model.accessory) {
        return
      }
      model.accessory = value
      host.markDirty()
    }

  override var pressable: Boolean
    get() = model.pressable
    set(next) {
      if (next == model.pressable) {
        return
      }
      model.pressable = next
      host.markDirty()
    }

  override var insideRow: Boolean
    get() = model.insideRow
    set(next) {
      if (next == model.insideRow) {
        return
      }
      model.insideRow = next
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      if (next == !model.enabled) {
        return
      }
      model.enabled = !next
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() = (host.tag as String?)?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    // RN's own `BaseViewManager.setTestID`: the tag is what testID matchers read.
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() = model.accessibilityLabel?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.accessibilityLabel) {
        return
      }
      model.accessibilityLabel = value
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
      // A new configuration may measure the same size, which the host's dedupe would drop.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onPress: (() -> Unit)?
    get() = model.onPress
    set(next) {
      model.onPress = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    model.resolveAndroidIcon(iconArtwork)
    host.commit()
  }

  override fun prepareForRecycle() {
    pixelProbes.clear()
    host.tag = null
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size, so it is safe on the JS thread.
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  override fun nuiTestProbeAccessibility() {
    val title = model.title
    Handler(Looper.getMainLooper()).post {
      model.recordAccessibility(describeAccessibility(host, title))
    }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  override fun nuiTestLayoutReport(): String = model.layoutReport()

  private val pixelProbes = NitroUiPixelProbes()

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

  override fun nuiTestLifetimeReport(): String = host.lifetimeReport()
}
