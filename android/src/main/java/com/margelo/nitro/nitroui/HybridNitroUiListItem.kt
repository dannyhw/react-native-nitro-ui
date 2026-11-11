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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
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

/*
 * The ListItem component: Material 3's `ListItem` content on the core runtime
 * (DECISIONS D46).
 *
 * The row *content*, not the row. `Form.Row` is the cell, and this is the leaf an app puts
 * inside one so a settings screen reads like the platform's instead of like React Native
 * `Text` approximating it. Standalone it draws the list's own insets; inside a row it draws
 * none, because the cell has already paid for them (D46 item 2).
 *
 * Three measured things decided this file's shape, all read out of the material3
 * 1.5.0-beta02 sources this builds on:
 *
 * - `InteractiveListItem` **always** paints `.background(containerColor, shape)` and the
 *   default container colour is `ColorScheme.Surface` — opaque, at `CornerNone`. A
 *   `ListItem` inside a `Form.Row` with the defaults therefore paints a full-width band
 *   behind the row's own segmented shape: the "ListItem inside a ListItem" bug Q10
 *   Appendix A found in `@expo/ui`, in a different shape. `containerColor = Transparent`
 *   is what makes "the row owns the shape" true by construction, and [nuiTestLayoutReport]
 *   answers `shape=` from the colour the row was actually configured with.
 * - the interactive overload passes `applySemantics = {}`, so it publishes neither a
 *   button role nor a disabled state: a disabled item would stay a live button to TalkBack
 *   unless this file adds both.
 * - the plain overload passes `{ if (!enabled) disabled() }` and no `onClick`, so the press
 *   and its ink are this file's to install. That is deliberate: the interactive overload's
 *   own answer to a press is `combinedClickable(indication = ripple(bounded = false))` plus
 *   a morph of the container it paints, and this row paints none, so on the device it drew
 *   *nothing* — the first real run held a real gesture on a 996x189 px row and read
 *   0.9880 luma at rest and 0.9880 luma 900 ms later, over a 5x3 grid, while the row's own
 *   `onClick` fired twice. The standalone row therefore gets Material's bounded `ripple()`
 *   through its own `clickable`, the way [HybridNitroUiFormSection] installs its rows'
 *   indication; inside a `Form.Row` the indication is `null`, because the cell's highlight
 *   is the highlight and a second one would be a band inside a band again. The floor the
 *   interactive overload enforces is 48 dp, which never binds on a row Material lays out at
 *   56 dp or 72 dp.
 *
 * Heights come from Material rather than from this file: `ListTokens.ItemOneLineContainer-
 * Height` (56 dp) and `ItemTwoLineContainerHeight` (72 dp) are applied as a minimum *only
 * when the incoming `minHeight` is 0*, which is what `NitroUiMeasuredRoot` hands a
 * `fillWidth` control — so the row is free to grow past them and cannot shrink below them.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated manager
 * resolves the implementation through a wildcard import of exactly that package. Core
 * helpers live in `...nitroui.core`.
 */

/** The trailing edge of an item. Anything unrecognised is `none` (Button's rule). */
internal enum class ListItemAccessory(val wireName: String) {
  None("none"),
  Disclosure("disclosure");

  companion object {
    fun from(value: String): ListItemAccessory =
      entries.firstOrNull { it.wireName == value } ?: None
  }
}

/** State of one ListItem. See [NitroUiModel] for the shape this has to have. */
internal class ListItemModel : NitroUiModel() {
  /** The headline. Observed: it renders, and it is read by a screen reader. */
  var title by mutableStateOf<String?>(null)

  /** The supporting line. Observed: it renders, and it is the prop that moves the height. */
  var subtitle by mutableStateOf<String?>(null)

  /** The trailing value, drawn on the headline's own line. Observed: it renders. */
  var value by mutableStateOf<String?>(null)

  /** The SF Symbol name. Ignored on Android, as a Button's is (`docs/components/button.md`):
   * stored, not observed, because nothing draws it. */
  var systemImage: String? = null

  /** The Android glyph, in the wire form the wrapper built (G19/G43's path). Stored; the
   * composition draws [androidIconContent]. */
  var androidIcon: String? = null

  /**
   * Everything derived from [androidIcon]: the same [NitroUiIconSlot] `ButtonModel`,
   * `ChipModel` and `MenuModel` use, so "resolve once per change, reserve a file's slot
   * before it lands, retire an in-flight load on a recycle, draw nothing for artwork that
   * cannot be resolved" is written in one place for every control that has an icon.
   */
  val iconSlot = NitroUiIconSlot()

  /** What the leading slot draws. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  /** Apply [androidIcon] if it is not what [androidIconContent] already is. */
  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

  /** The trailing chevron. Observed: it renders. */
  var accessory by mutableStateOf(ListItemAccessory.None)

  /** Whether `onPress` is wired: the row's indication and its button role. */
  var pressable by mutableStateOf(false)

  /**
   * Whether a `Form.Row` is drawing this item. Its cell owns the insets, the shape and the
   * press, so the leaf draws its content edge-to-edge in the box it is given, with no
   * container and no indication of its own (DECISIONS D46 item 2).
   */
  var insideRow by mutableStateOf(false)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** `accessibilityLabel`, put on the item itself (never the container, core.md §3). */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  var onPress: (() -> Unit)? = null

  /** Test-only read-outs, behind one lock and never observed. */
  private val reportLock = Any()
  private var drawn = "none"
  private var presses = 0
  private var probes = 0
  private var accessibilityReport = "none"
  private var layout = "pending"

  /**
   * The colour the leading glyph was painted with, as `#RRGGBB`, or `-` when no glyph drew.
   *
   * Test-only, for the reason `ListItemModel.recordIconTint` gives: Material's icon colour
   * comes from the device's dynamic palette on Android 12+, so a harness cannot write the
   * RGB down and has to be handed the one the row used.
   */
  private var iconTint = "-"

  /** Record what the composable was handed: `<title>|<subtitle>|<value>|<accessory>`. */
  fun recordDrawn(report: String) {
    synchronized(reportLock) { drawn = report }
  }

  /** Count an accepted press. Called from the press seam, never from a prop. */
  fun recordPress() {
    synchronized(reportLock) { presses += 1 }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /**
   * Which press path drew this row: `own` (the leaf's own `clickable`, with Material's ripple),
   * `cell` (inside a `Form.Row`, whose cell owns the highlight) or `none`.
   *
   * Recorded at the branch that picks the painter, not from `insideRow`, so the answer is
   * the path that ran — the harness's "inside a row the leaf draws no shape or highlight of
   * its own" is then a reading of the composition rather than an echo of the prop.
   */
  private var pressPath = "pending"

  fun recordPressPath(
    path: String,
  ) {
    synchronized(reportLock) { pressPath = path }
  }

  /** Whether this leaf paints a container or a press of its own — the `shape=` answer. */
  fun paintsOwn(): Boolean =
    synchronized(reportLock) { pressPath == "own" }

  /** Record where the row put its content, as `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>`. */
  fun recordLayout(report: String) {
    synchronized(reportLock) { layout = report }
  }

  /**
   * Record the colour the leading slot's glyph is being tinted with, from the same
   * `LocalContentColor` the glyph takes it from — a reading of what will be painted, not of
   * a prop. `null` says nothing drew, which the harness reads as "nothing to sample".
   */
  fun recordIconTint(
    tint: ComposeColor?,
  ) {
    synchronized(reportLock) { iconTint = tint?.let { "#${it.toRgbHex()}" } ?: "-" }
  }

  /**
   * `displayed=<…>;presses=<n>;probes=<n>;a11y=<…>;iconTint=<#RRGGBB|->`. Safe from any
   * thread. iOS answers the last field `-` because it has no sampler to feed.
   */
  fun stateReport(): String =
    synchronized(reportLock) {
      "displayed=$drawn;presses=$presses;probes=$probes;a11y=$accessibilityReport;iconTint=$iconTint"
    }

  fun layoutReport(): String = synchronized(reportLock) { layout }

  /** Back to "nothing yet", for recycling: a reused row whose report still described the
   * previous owner's item would let a test read that owner's content. */
  fun clearReports() {
    synchronized(reportLock) {
      drawn = "none"
      presses = 0
      probes = 0
      accessibilityReport = "none"
      layout = "pending"
      iconTint = "-"
      pressPath = "pending"
    }
  }

  override fun reset() {
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

  /** The gap kept between the headline and the value that trails it on its own line. */
  val ValueGap = 8.dp
}

/**
 * The item's host: [NitroComposeHost] plus this component's composable. [Component] is
 * fixed for the lifetime of the view — there is no `setContent` after construction.
 */
private class ListItemHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ListItemModel,
) : NitroComposeHost<ListItemModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one — the Slider
   * host's guard, for the Slider's reason: [nuiTestProbeAccessibility] forces Compose's
   * semantics on with no reader connected, Compose then announces every later change up
   * the parent chain, and [AccessibilityManager] answers an announcement with no recipient
   * by throwing. Inert when a reader is connected.
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
   * One press, through the path a tap takes — Material's `onClick`, and the `nuiTestPress`
   * hook — so the two cannot disagree about what a press means. Refused while disabled or
   * unwired, as a tap is, and the counter only moves for an accepted one.
   */
  fun press() {
    if (!model.enabled || !model.pressable) {
      return
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

    // The reading `nuiTestStateReport()` answers with: taken where the row composes, so it
    // is what Material is handed rather than what React sent.
    model.recordDrawn(
      "${model.title ?: "-"}|${model.subtitle ?: "-"}|${model.value ?: "-"}|${accessory.wireName}",
    )

    // No container of the leaf's own: Material paints one by default (the file header),
    // and the two colours have to be squared together or a disabled row paints it again.
    // Read back out of the colours the row is *being configured with* to answer `shape=`,
    // the way Chip reads `LocalContentColor` to answer `iconTint=`: a reading of what will
    // be painted, taken at the same place the painter takes it, not of a prop.
    val colors =
      ListItemDefaults.colors(
        containerColor = ComposeColor.Transparent,
        disabledContainerColor = ComposeColor.Transparent,
      )
    val paintsContainer =
      colors.containerColor(enabled = enabled, selected = false, dragged = false).alpha > 0f

    // The list's own horizontal inset, or none inside a row. The vertical insets stay
    // Material's either way: a row's *height* is its content's, and the row's own vertical
    // chrome is the Form's 4 dp — halving ours to dodge it would tie this leaf to a
    // constant in another component and make a row shorter than the platform's.
    val inset = if (insideRow) 0.dp else ListItemMetrics.Inset
    val defaults = ListItemDefaults.ContentPadding
    val contentPadding =
      PaddingValues(
        start = inset,
        end = inset,
        top = defaults.calculateTopPadding(),
        bottom = defaults.calculateBottomPadding(),
      )

    // One element for the whole row. Material merges the descendants itself
    // (`semantics(mergeDescendants = true)`), which covers the *text*; what the interactive
    // overload does not do is say the row is a button or that it is disabled — it passes
    // `applySemantics = {}`. Both are this file's job, and the harness's a11y case reads
    // the answer off the merged node.
    val label = model.accessibilityLabel
    val rowSemantics =
      Modifier.semantics {
        if (pressable) {
          role = Role.Button
        }
        if (!enabled) {
          disabled()
        }
        if (label != null) {
          contentDescription = label
        }
      }

    // Where the content landed, in the view's own box, for `nuiTestLayoutReport`. Both
    // readings come from the layout that drew: the item's box and the content column's box
    // inside it. Written as plain storage (`recordLayout`), so a layout pass never asks for
    // a recomposition.
    val density = LocalDensity.current
    val box = remember { FloatArray(4) }
    val content = remember { FloatArray(3) }
    val publish = {
      if (box[2] > 0f && content[2] >= 0f) {
        // `shape=`: a container of the leaf's own, or the leaf's own press — inside a
        // `Form.Row` neither is painted, and the row that owns the cell can be told.
        model.recordLayout(
          ListItemLayout.report(
            box,
            content,
            paintsContainer || model.paintsOwn(),
            density,
          ),
        )
      }
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
      val interactionSource = remember { MutableInteractionSource() }
      // The row's content: the headline, with the value trailing it *on the same line*.
      // Material's `trailingContent` slot is vertically centred against the whole row,
      // which on a two-line item puts the value between the lines rather than beside the
      // headline — and UIKit's own value slot is on the headline's line, which is what a
      // settings row reads as. Same slot, same line, both platforms.
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
            modifier = Modifier.weight(1f, fill = false),
          )
          val value = model.value
          if (value != null) {
            Spacer(modifier = Modifier.width(ListItemMetrics.ValueGap))
            Text(
              text = value,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              // The platform's value role: Material's supporting-text colour rather than the
              // headline's, because a value is the row's answer, not its name. UIKit draws
              // exactly this distinction through `.valueCell()`'s secondary text.
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }

      val leading: (@Composable () -> Unit)? =
        if (model.androidIconContent == NitroUiIconContent.Absent) {
          // Nothing in the slot, so nothing painted: the harness's probe has to be able to
          // tell "this row has no glyph" from "the glyph's colour was never recorded".
          model.recordIconTint(null)
          null
        } else {
          {
            model.recordIconTint(LocalContentColor.current)
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
            )
          }
        } else {
          null
        }

      // One row, two indications. The plain overload draws the content either way and the
      // press is installed here, because Material's interactive overload has no ink this
      // row can show (the file header): it morphs a container this row keeps transparent
      // and its `ripple(bounded = false)` drew nothing measurable across the whole row.
      // `ripple()` is still the platform's own indication rather than a colour this file
      // chose, bounded so the wash stays inside the row instead of leaking over its
      // neighbours.
      model.recordPressPath(if (!pressable) "none" else if (insideRow) "cell" else "own")
      val ownClick =
        if (!pressable) {
          Modifier
        } else {
          Modifier.clickable(
            interactionSource = interactionSource,
            // Inside a row the cell owns the highlight, so the leaf's clickable is silent.
            indication = if (insideRow) null else ripple(),
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
            { Text(text = supporting, maxLines = 1, overflow = TextOverflow.Ellipsis) }
          },
        colors = colors,
        contentPadding = contentPadding,
        content = headline,
      )
    }
  }
}

/**
 * The one accessibility node this row publishes, as one line:
 * `role=<role>,disabled=<bool>,clickable=<bool>,label=<text>`.
 *
 * The node is the merged one Material builds for the row. Compose builds semantics only
 * while an accessibility service is connected and a harness run has none, so it is forced
 * on for this view first — the Slider's and Chip's probe does the same, and says why.
 */
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

/** Everything a merged node says as text: its content descriptions, then its text. */
private fun textOf(
  node: SemanticsNode,
): String {
  val described = node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
  val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }
  return listOfNotNull(described, text).joinToString(" ")
}

/** The Compose view under [root], as [RootForTest] (`HybridNitroUiSlider.findComposeRoot`). */
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

/** Turns the two measured boxes into the report, in points. */
private object ListItemLayout {
  fun report(
    box: FloatArray,
    content: FloatArray,
    paintsContainer: Boolean,
    density: Density,
  ): String {
    val leading = (content[0] - box[0]).toDp(density)
    val trailing = (box[0] + box[2] - content[0] - content[2]).toDp(density)
    return "insets=" +
      leading.fmt() + "," + trailing.fmt() +
      ";shape=" + (if (paintsContainer) 1 else 0) +
      ";box=" + box[2].toDp(density).fmt() + "x" + box[3].toDp(density).fmt()
  }

  private fun Float.toDp(density: Density): Float = with(density) { this@toDp.toDp().value }

  private fun Float.fmt(): String = String.format(java.util.Locale.ROOT, "%.2f", this)
}

/** The Hybrid View React renders as `NitroUiListItem`. */
class HybridNitroUiListItem(
  reactContext: ThemedReactContext,
) : HybridNitroUiListItemSpec(),
  RecyclableView {
  private val model = ListItemModel()
  private val host = ListItemHost(reactContext, reactContext.currentActivity, model)

  /**
   * The control's half of icon resolution, bound to this control's `Context`. Held rather
   * than built per commit — a prop commit is not a place to allocate (G19's rule), and the
   * `Context` it captures is the one [host] already holds.
   */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  /** The Nitro `view` — created once here and never replaced. */
  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // The width is the box's: a list row is as wide as the list it is in, and an
    // `intrinsic` row would report the width its text wants and be clamped into a box it
    // draws outside of.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine (`getName()` in the generated manager). */
    private const val SIZING_COMPONENT_NAME = "NitroUiListItem"

    /**
     * The height to lay a ListItem out with before anything has been measured, in dp:
     * `ListTokens.ItemOneLineContainerHeight` (56 dp), which is what the title-only
     * configuration measures — the row an app's first mount almost always is, and the one
     * the conformance fixture mounts.
     *
     * Only the height is the control's own: a `fillWidth` entry files the height alone, and
     * a wrong height moves every row on a cold first frame (D17). The conformance rule
     * checks this number against the measured default, and the harness measures every other
     * configuration from a *poisoned* fallback so a failed correction cannot hide.
     */
    private const val FALLBACK_HEIGHT_DP = 56.0

    /** What a stretched row is laid out at before it is measured (dp). */
    private const val FALLBACK_WIDTH_DP = 300.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One `JNI` call per process; `NitroUiDeclaredFallbacks` calls it at package init. */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        // The width a `fillWidth` entry files is never read as a width, but the engine
        // still lays the first frame out at it, so a wide box is the honest answer for a
        // control that stretches.
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied by the composition, once per
  // commit. A slot that can move the height is observed, so the recomposition that draws it
  // is also the measure that reports the new height.

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
      // The one prop that moves the height on its own (a supporting line makes Material's
      // two-line row), so the recomposition it causes is also the measure.
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
      // Stored, never drawn: Android has no SF Symbols and draws `androidIcon` instead, and
      // the wrapper drops a name no runtime has so nothing half-draws.
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
      // The insets move, the height does not (see the composable), so this is a redraw —
      // but Material's padding is a composition input, so it has to be applied.
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
      // The engine has no answer for a key it has not seen, and a new configuration may
      // measure what the old one did (Button's F1) — so the host is asked for a fresh
      // measure and a report the dedupe must not swallow.
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
    // The glyph first, once per commit, before the composition below reads it: Button's
    // order and Button's reason — a resource resolved here is drawn by this commit, and a
    // file that has to be read reserves its slot in this commit and fills it later, so the
    // row's box never waits for the bytes.
    model.resolveAndroidIcon(iconArtwork)
    // Nothing to reconcile: a press is not a value, so there is no handshake here
    // (`docs/architecture/core.md` §12, the shape Progress established).
    host.commit()
  }

  override fun prepareForRecycle() {
    // A recycled row must not answer for its previous owner's pixels or its previous
    // owner's `testID`, the same way its model must not answer with the previous owner's
    // title. The model reset runs inside `host.prepareForRecycle()`.
    pixelProbes.clear()
    host.tag = null
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Material measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  /** Press through the tap's path, on the UI thread (see the spec). Returns at once. */
  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Read the row's semantics node on the UI thread (see the spec). Returns at once. */
  override fun nuiTestProbeAccessibility() {
    val title = model.title
    Handler(Looper.getMainLooper()).post {
      model.recordAccessibility(describeAccessibility(host, title))
    }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  override fun nuiTestLayoutReport(): String = model.layoutReport()

  private val pixelProbes = NitroUiPixelProbes()

  /**
   * Sample what this row is drawing for [color], and store the answer.
   *
   * Posted rather than run inline: reading pixels needs the view drawn, and a Nitro method
   * may not block for the UI thread. The same sampler as Button's and Chip's, so one
   * harness helper reads all three — and the same oracle for `androidIcon`, which is a
   * drawing contract that every other reading of it echoes.
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

  /** What this host object has been through, for the conformance suite's recycle rule. */
  override fun nuiTestLifetimeReport(): String = host.lifetimeReport()
}
