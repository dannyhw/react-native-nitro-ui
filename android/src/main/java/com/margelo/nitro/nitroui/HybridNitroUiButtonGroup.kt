package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ButtonGroupMenuState
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ElevatedToggleButton
import androidx.compose.material3.ElevatedToggleButtonDefaults
import androidx.compose.material3.FilledTonalToggleButton
import androidx.compose.material3.FilledTonalToggleButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedToggleButtonDefaults
import androidx.compose.material3.OutlinedToggleButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonColors
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.ToggleButtonShapes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.NitroUiPixelProbes
import com.margelo.nitro.nitroui.core.toRgbHex
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// The ButtonGroup component: Material 3 Expressive's `ButtonGroup`, which moves the items
// that do not fit into an overflow menu. Must stay in this package (generated manager).

internal enum class ButtonGroupAppearance(val wireName: String) {
  /** 12 dp of space; each item keeps its own corner. */
  Standard("standard"),

  /** 2 dp apart, with Material's connected leading/middle/trailing corners. */
  Connected("connected"),
  ;

  companion object {
    fun from(value: String): ButtonGroupAppearance =
      entries.firstOrNull { it.wireName == value } ?: Standard
  }
}

internal enum class ButtonGroupLabelStyle(val wireName: String) {
  /** Icon and title on Android. */
  Automatic("automatic"),
  TitleOnly("titleOnly"),
  IconOnly("iconOnly"),
  TitleAndIcon("titleAndIcon"),
  ;

  companion object {
    fun from(value: String): ButtonGroupLabelStyle =
      entries.firstOrNull { it.wireName == value } ?: Automatic
  }

  val showsGlyph: Boolean
    get() = this != TitleOnly

  val showsTitle: Boolean
    get() = this != IconOnly

  val glyph: ButtonGlyph
    get() =
      when (this) {
        TitleOnly -> ButtonGlyph.TitleOnly
        IconOnly -> ButtonGlyph.IconOnly
        else -> ButtonGlyph.Both
      }
}

internal data class ButtonGroupItemState(
  val id: String,
  val title: String,
  /** Stored, never drawn: Android has no SF Symbols. */
  val systemImage: String?,
  val androidIcon: String?,
  val disabled: Boolean,
  val toggle: Boolean,
)

/**
 * The event-count handshake for a set of toggles. A React write moves only the ids in
 * [controlled], so controlled and uncontrolled items can share a group. One counter for
 * the group: per-item counts would let one item's event validate another's stale write.
 */
internal class ButtonGroupCheckedSet {
  var displayed: Set<String> = emptySet()

  /** The last checked set React sent, or `null` while nothing in the group is controlled. */
  var js: Set<String>? = null

  /** The ids a write to [js] may move. */
  var controlled: Set<String> = emptySet()

  var nativeEvents: Int = 0

  var jsEvents: Int = 0

  /** The user flipped [id]. Returns the new set and the event count to emit. */
  fun user(id: String): Pair<Set<String>, Int> {
    val next = if (displayed.contains(id)) displayed - id else displayed + id
    displayed = next
    nativeEvents += 1
    return next to nativeEvents
  }

  /** Applies a pending React write to the [controlled] ids. Returns whether [displayed] changed. */
  fun reconcile(): Boolean {
    val pending = js ?: return false
    if (jsEvents < nativeEvents) {
      return false
    }
    val kept = displayed.filterNot { controlled.contains(it) }
    val next = (kept + pending.filter { controlled.contains(it) }).toSet()
    if (next == displayed) {
      return false
    }
    displayed = next
    return true
  }
}

internal class ButtonGroupModel : NitroUiModel() {
  var items by mutableStateOf<List<ButtonGroupItemState>>(emptyList())

  var appearance by mutableStateOf(ButtonGroupAppearance.Standard)
  var variant by mutableStateOf(ButtonVariant.Filled)
  var scale by mutableStateOf(ButtonScale.Medium)
  var labelStyle by mutableStateOf(ButtonGroupLabelStyle.Automatic)

  var enabled by mutableStateOf(true)

  /** The tint (`processColor`'s ARGB int), or `null` for the scheme's own roles. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel: String? = null

  /** The overflow control's name, or `null` to keep Material's localised one. Observed. */
  var overflowAccessibilityLabel by mutableStateOf<String?>(null)

  var displayed by mutableStateOf<Set<String>>(emptySet())

  /** The handshake. Not observed: it drives [displayed], never renders. */
  val state = ButtonGroupCheckedSet()

  private val seeded = HashSet<String>()

  /** Seeds uncontrolled toggles once per id. Re-seeding on a re-render would undo a tap. */
  fun applyDefaults(ids: List<String>) {
    for (id in ids) {
      if (seeded.add(id)) {
        state.displayed = state.displayed + id
        displayed = state.displayed
      }
    }
  }

  fun pruneChecked() {
    val toggles = items.filter { it.toggle }.map { it.id }.toSet()
    val kept = state.displayed.filter { toggles.contains(it) }.toSet()
    if (kept != state.displayed) {
      state.displayed = kept
      displayed = kept
    }
  }

  var sizingKey = ""

  var onPress: ((String) -> Unit)? = null
  var onCheckedChange: ((String, Boolean, Double) -> Unit)? = null

  // MARK: - Icons

  private val iconSlots = ArrayList<NitroUiIconSlot>()

  fun iconContent(index: Int): NitroUiIconContent =
    iconSlots.getOrNull(index)?.content ?: NitroUiIconContent.Absent

  /**
   * What each overflow row last tinted its glyph with, as `<id>#<RRGGBB>`. A row's icon colour
   * comes from the device's dynamic palette, so a test has to ask the row what it drew.
   */
  private val overflowIconTints = LinkedHashMap<String, String>()

  /** The item icons and label style [overflowIconTints] was recorded against. */
  private var overflowIconKey = ""

  /** Recorded from composition, as an overflow row draws its glyph. */
  fun noteOverflowIconTint(
    id: String,
    tint: ComposeColor,
  ) {
    synchronized(reportLock) { overflowIconTints[id] = tint.toRgbHex() }
  }

  /** Resolve every item's glyph, once per batch and never in composition. */
  fun resolveAndroidIcons(artwork: NitroUiIconArtwork) {
    // A row that would draw something different retires its previous answer rather than
    // reporting it as if it had just drawn again.
    val iconKey =
      "${labelStyle.showsGlyph};" +
        items.joinToString(",") { item -> "${item.id}:${item.androidIcon ?: ""}" }
    if (iconKey != overflowIconKey) {
      overflowIconKey = iconKey
      synchronized(reportLock) { overflowIconTints.clear() }
    }
    while (iconSlots.size < items.size) {
      iconSlots.add(NitroUiIconSlot())
    }
    // Resetting a removed slot bumps its generation, which drops an in-flight load's answer.
    while (iconSlots.size > items.size) {
      iconSlots.removeAt(iconSlots.size - 1).reset()
    }
    for (index in items.indices) {
      iconSlots[index].resolve(items[index].androidIcon, artwork)
    }
  }

  // MARK: - Test witnesses

  private val reportLock = Any()

  // The last row probe: `visible=<n>;overflow=<0|1>;row=<r>;shown=<ids|none>`. `row` is
  // always `standard` here; iOS has two kinds of row and reports which one it drew.
  private var rowReport = "visible=none;overflow=none;row=none;shown=none"

  private var accessibilityReport = "none"

  /** How many probes have answered, so a test can tell its own from the previous one's. */
  private var probes = 0

  val ledger = RowPlacementLedger()

  fun stateReport(): String =
    synchronized(reportLock) {
      val checked =
        if (displayed.isEmpty()) {
          "none"
        } else {
          // Item order, not insertion order: two runs must print one string.
          items.filter { displayed.contains(it.id) }.joinToString(",") { it.id }
        }
      val overflowIcons =
        if (overflowIconTints.isEmpty()) {
          "-"
        } else {
          items.mapNotNull { item -> overflowIconTints[item.id]?.let { tint -> "${item.id}#$tint" } }
            .joinToString(",")
            .ifEmpty { "-" }
        }
      "checked=$checked;$rowReport;menu=${if (menuOpen) "open" else "closed"};" +
        "overflowIcons=$overflowIcons;probes=$probes;a11y=$accessibilityReport"
    }

  fun publishRowReport(report: String) {
    synchronized(reportLock) {
      probes += 1
      rowReport = report
    }
  }

  fun publishAccessibilityReport(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** The pixel probe's answer, on its own count so a row probe cannot be read as one. */
  private val pixelProbes = NitroUiPixelProbes()

  fun publishPixelReport(report: String) {
    pixelProbes.publish(report)
  }

  fun readPixelReport(): String = pixelProbes.read()

  // Recorded from the composition, the only place Material exposes the menu's state.
  var menuOpen = false
    private set

  fun recordMenuOpen(open: Boolean) {
    synchronized(reportLock) { menuOpen = open }
  }

  /** The live menu state, so `disabled` and a recycle can close the menu. */
  @Volatile
  var menuState: ButtonGroupMenuState? = null

  override fun reset() {
    items = emptyList()
    appearance = ButtonGroupAppearance.Standard
    variant = ButtonVariant.Filled
    scale = ButtonScale.Medium
    labelStyle = ButtonGroupLabelStyle.Automatic
    enabled = true
    tintColor = null
    accessibilityLabel = null
    overflowAccessibilityLabel = null
    displayed = emptySet()
    state.displayed = emptySet()
    state.js = null
    state.controlled = emptySet()
    state.nativeEvents = 0
    state.jsEvents = 0
    seeded.clear()
    sizingKey = ""
    onPress = null
    onCheckedChange = null
    for (index in iconSlots.indices) {
      iconSlots[index].reset()
    }
    iconSlots.clear()
    overflowIconKey = ""
    ledger.reset()
    menuState = null
    synchronized(reportLock) {
      rowReport = "visible=none;overflow=none;row=none;shown=none"
      accessibilityReport = "none"
      menuOpen = false
      overflowIconTints.clear()
      probes = 0
    }
    pixelProbes.clear()
  }
}

/**
 * Which items the group's measure policy placed. `ButtonGroup` composes every item so it
 * can measure the ones it hides, and keeps its overflow state private, so `onPlaced` is
 * the only signal. Plain state behind a lock: a measure block may not write snapshot state.
 */
internal class RowPlacementLedger {
  private val lock = Any()
  private var pass = 0
  private val placedAt = HashMap<String, Int>()
  private var indicatorAt = -1

  fun beginPass() {
    synchronized(lock) { pass += 1 }
  }

  fun recordPlaced(id: String) {
    synchronized(lock) { placedAt[id] = currentPass() }
  }

  fun recordIndicatorPlaced() {
    synchronized(lock) { indicatorAt = currentPass() }
  }

  /** Ids placed in the latest pass, in [order]. */
  fun visibleIds(order: List<String>): List<String> {
    synchronized(lock) {
      val now = pass
      return order.filter { placedAt[it] == now }
    }
  }

  fun indicatorPlaced(): Boolean = synchronized(lock) { indicatorAt == pass }

  fun reset() {
    synchronized(lock) {
      placedAt.clear()
      indicatorAt = -1
      pass = 0
    }
  }

  /** Called with [lock] held. */
  private fun currentPass(): Int = pass
}

/** A pass-through `Layout` that only tells the ledger where a measure pass starts. */
@Composable
private fun LedgerLayout(
  onPass: () -> Unit,
  content: @Composable () -> Unit,
) {
  Layout(content = content) { measurables, constraints ->
    onPass()
    val placeable = measurables.firstOrNull()?.measure(constraints)
    if (placeable == null) {
      layout(constraints.minWidth, constraints.minHeight) {}
    } else {
      layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
    }
  }
}

/**
 * One toggle item. `text` uses the outlined toggle: Material has no text toggle button.
 * Shares its label and size ladder with [NitroUiM3Button], so the two line up in a row.
 */
@Composable
internal fun NitroUiM3ToggleButton(
  title: String,
  variant: ButtonVariant,
  scale: ButtonScale,
  checked: Boolean,
  enabled: Boolean,
  tint: Int?,
  modifier: Modifier,
  shapes: ToggleButtonShapes,
  onCheckedChange: (Boolean) -> Unit,
  glyph: ButtonGlyph = ButtonGlyph.Both,
  icon: NitroUiIconContent = NitroUiIconContent.Absent,
) {
  val showsGlyph = glyph != ButtonGlyph.TitleOnly && icon != NitroUiIconContent.Absent
  // A start-icon inset only when both a glyph and a title are drawn.
  val drawsTitle = buttonGlyphDrawsTitle(glyph, icon)
  val colors = toggleButtonColors(variant, tint)
  val contentPadding: PaddingValues =
    ToggleButtonDefaults.contentPaddingFor(
      buttonHeight = scale.layoutHeight,
      hasStartIcon = showsGlyph && drawsTitle,
    )
  val content: @Composable RowScope.() -> Unit = {
    NitroUiButtonLabel(title = title, scale = scale, icon = icon, glyph = glyph)
  }
  when (variant) {
    ButtonVariant.Filled ->
      ToggleButton(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        shapes = shapes,
        colors = colors,
        contentPadding = contentPadding,
        content = content,
      )
    ButtonVariant.Tonal ->
      FilledTonalToggleButton(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        shapes = shapes,
        colors = colors,
        contentPadding = contentPadding,
        content = content,
      )
    ButtonVariant.Outlined, ButtonVariant.Text ->
      OutlinedToggleButton(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        shapes = shapes,
        colors = colors,
        border = toggleOutlinedBorder(variant, tint, checked, enabled),
        contentPadding = contentPadding,
        content = content,
      )
    ButtonVariant.Elevated ->
      ElevatedToggleButton(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        shapes = shapes,
        colors = colors,
        contentPadding = contentPadding,
        content = content,
      )
  }
}

/**
 * The toggle colours per variant and tint, cached per scheme. The tint also replaces the
 * checked colour, so a tinted toggle does not fall back to the scheme when switched on.
 */
@Composable
internal fun toggleButtonColors(
  variant: ButtonVariant,
  tint: Int?,
): ToggleButtonColors {
  val scheme = MaterialTheme.colorScheme
  ToggleColorsCache.get(scheme, variant, tint)?.let { cached -> return cached }
  val base =
    when (variant) {
      ButtonVariant.Filled -> ToggleButtonDefaults.colors()
      ButtonVariant.Tonal -> FilledTonalToggleButtonDefaults.colors()
      ButtonVariant.Outlined, ButtonVariant.Text -> OutlinedToggleButtonDefaults.colors()
      ButtonVariant.Elevated -> ElevatedToggleButtonDefaults.colors()
    }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      base
    } else if (variant == ButtonVariant.Outlined || variant == ButtonVariant.Text) {
      base.copy(contentColor = color, checkedContentColor = color)
    } else {
      base.copy(containerColor = color, checkedContainerColor = color)
    }
  ToggleColorsCache.put(scheme, variant, tint, built)
  return built
}

/**
 * The explicit border both the `outlined` and the `text` item take, as Material draws it for the
 * state: a tint replaces only the hue, and where Material draws none -- `text`, or a toggle that is
 * on -- none is drawn.
 */
@Composable
private fun toggleOutlinedBorder(
  variant: ButtonVariant,
  tint: Int?,
  checked: Boolean,
  enabled: Boolean,
): BorderStroke? {
  if (variant != ButtonVariant.Outlined) {
    return null
  }
  val base = OutlinedToggleButtonDefaults.border(checked = checked, enabled = enabled)
    ?: return null
  val color = tint?.let { ComposeColor(it) } ?: return base
  val strength = (base.brush as? SolidColor)?.value?.alpha ?: 1f
  return BorderStroke(base.width, color.copy(alpha = color.alpha * strength))
}

private object ToggleColorsCache {
  private var scheme: ColorScheme? = null
  private val untinted = arrayOfNulls<ToggleButtonColors>(ButtonVariant.entries.size)
  private var tinted: HashMap<Long, ToggleButtonColors>? = null
  private const val MAX_TINTED_ENTRIES = 24

  private fun key(
    variant: ButtonVariant,
    tint: Int,
  ): Long = (variant.ordinal.toLong() shl 32) or (tint.toLong() and 0xFFFF_FFFFL)

  @Synchronized
  fun get(
    scheme: ColorScheme,
    variant: ButtonVariant,
    tint: Int?,
  ): ToggleButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted[variant.ordinal] else tinted?.get(key(variant, tint))
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    variant: ButtonVariant,
    tint: Int?,
    colors: ToggleButtonColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted[variant.ordinal] = colors
      return
    }
    val entries = tinted ?: HashMap<Long, ToggleButtonColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[key(variant, tint)] = colors
  }

  // Call with the lock held.
  private fun adopt(next: ColorScheme) {
    if (scheme === next) {
      return
    }
    scheme = next
    for (index in untinted.indices) {
      untinted[index] = null
    }
    tinted?.clear()
  }
}

/**
 * The corner one item draws. The connected shapes are called with no arguments: their
 * first parameter is the whole resting shape, and passing the control's own pill would
 * draw separate pills. A one-item group keeps the variant's own corner.
 */
@Composable
private fun groupToggleShapes(
  appearance: ButtonGroupAppearance,
  scale: ButtonScale,
  index: Int,
  count: Int,
): ToggleButtonShapes {
  if (appearance == ButtonGroupAppearance.Standard || count == 1) {
    return ToggleButtonDefaults.shapesFor(scale.layoutHeight)
  }
  return when {
    index == 0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
    index == count - 1 -> ButtonGroupDefaults.connectedTrailingButtonShapes()
    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
  }
}

@Composable
private fun groupActionShapes(
  appearance: ButtonGroupAppearance,
  variant: ButtonVariant,
  scale: ButtonScale,
  index: Int,
  count: Int,
): ButtonShapes? {
  if (appearance == ButtonGroupAppearance.Standard || count == 1) {
    return null
  }
  val connected = groupToggleShapes(appearance, scale, index, count)
  return ButtonShapes(shape = connected.shape, pressedShape = connected.pressedShape)
}

private class ButtonGroupHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ButtonGroupModel,
) : NitroComposeHost<ButtonGroupModel>(context, activity, model) {
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  // The accessibility test probe turns Compose semantics on with no reader connected, and
  // sending an event with no accessibility service enabled throws.
  override fun requestSendAccessibilityEvent(
    child: View,
    event: AccessibilityEvent,
  ): Boolean {
    if (systemAccessibility?.isEnabled != true) {
      return false
    }
    return super.requestSendAccessibilityEvent(child, event)
  }

  // The path a tap takes, for tests: they cannot open the overflow menu's window.
  fun press(id: String) {
    val item = model.items.firstOrNull { it.id == id } ?: return
    if (!model.enabled || item.disabled) {
      return
    }
    if (item.toggle) {
      toggleTo(id)
    } else {
      model.onPress?.invoke(id)
    }
  }

  // Optimistic: show the new state before React has seen the event.
  fun toggleTo(id: String) {
    if (!model.enabled) {
      return
    }
    val (next, eventCount) = model.state.user(id)
    model.displayed = next
    model.onCheckedChange?.invoke(id, next.contains(id), eventCount.toDouble())
  }

  @Composable
  override fun Component(model: ButtonGroupModel) {
    val items = model.items
    val appearance = model.appearance
    val labelStyle = model.labelStyle
    val variant = model.variant
    val scale = model.scale
    val enabled = model.enabled
    val tint = model.tintColor
    val checked = model.displayed

    // The group's name goes on the container, as a traversal group, so a screen reader
    // can step over the row. Items keep their own names.
    val label = model.accessibilityLabel
    val labelModifier =
      if (label != null) {
        Modifier.semantics {
          contentDescription = label
          isTraversalGroup = true
        }
      } else {
        Modifier.semantics { isTraversalGroup = true }
      }

    if (items.isEmpty()) {
      // Material's `ButtonGroup` with no items still lays out a box.
      return
    }

    val arrangement =
      if (appearance == ButtonGroupAppearance.Standard) {
        ButtonGroupDefaults.HorizontalArrangement
      } else {
        Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)
      }

    LedgerLayout(onPass = { model.ledger.beginPass() }) {
      ButtonGroup(
        overflowIndicator = { state ->
          // Material exposes the menu state only to this composable, so capture it here.
          SideEffect { model.menuState = state }
          LaunchedEffect(state) {
            snapshotFlow { state.isShowing }
              .collect { open -> model.recordMenuOpen(open) }
          }
          ButtonGroupDefaults.OverflowIndicator(
            menuState = state,
            modifier =
              Modifier
                .onPlaced { model.ledger.recordIndicatorPlaced() }
                .then(
                  // Renamed only when the caller names it, so Material's localised name stays the
                  // default. A second description in one modifier chain concatenates, so clear the
                  // subtree and restate the role and the press action the clear drops.
                  model.overflowAccessibilityLabel?.let { label ->
                    Modifier.clearAndSetSemantics {
                      contentDescription = label
                      role = Role.Button
                      onClick(label = null, action = {
                        if (state.isShowing) state.dismiss() else state.show()
                        true
                      })
                    }
                  }
                    ?: Modifier,
                ),
            enabled = enabled,
          )
        },
        modifier = labelModifier,
        horizontalArrangement = arrangement,
      ) {
        val count = items.size
        items.forEachIndexed { index, item ->
          val itemEnabled = enabled && !item.disabled
          val glyph = labelStyle.glyph
          customItem(
            buttonGroupContent = {
              // Material's press behaviour: a held item widens and squeezes its neighbours.
              val interaction = remember { MutableInteractionSource() }
              val itemModifier =
                Modifier
                  .animateWidth(interaction)
                  .onPlaced { model.ledger.recordPlaced(item.id) }
              val icon = model.iconContent(index)
              // An icon-only item's glyph has no description, so name the button by its title.
              // Not when the title is drawn as text: the reader would say it twice.
              val namedModifier =
                if (labelStyle.showsTitle || icon == NitroUiIconContent.Absent) {
                  itemModifier
                } else {
                  itemModifier.semantics { contentDescription = item.title }
                }
              if (item.toggle) {
                NitroUiM3ToggleButton(
                  title = item.title,
                  variant = variant,
                  scale = scale,
                  checked = checked.contains(item.id),
                  enabled = itemEnabled,
                  tint = tint,
                  modifier = namedModifier,
                  shapes = groupToggleShapes(appearance, scale, index, count),
                  glyph = glyph,
                  icon = icon,
                  onCheckedChange = { toggleTo(item.id) },
                )
              } else {
                NitroUiM3Button(
                  title = item.title,
                  variant = variant,
                  scale = scale,
                  enabled = itemEnabled,
                  tint = tint,
                  modifier = namedModifier,
                  shapes = groupActionShapes(appearance, variant, scale, index, count),
                  glyph = glyph,
                  icon = icon,
                  onClick = { model.onPress?.invoke(item.id) },
                )
              }
            },
            menuContent = { menuState ->
              MenuRow(
                item =
                  MenuActionItem(
                    id = item.id,
                    title = item.title,
                    disabled = item.disabled,
                    destructive = false,
                    checked = if (item.toggle) checked.contains(item.id) else null,
                  ),
                // Material gives this lambda no position, so each row uses the single-item shape.
                index = 0,
                count = 1,
                groupEnabled = enabled,
                // A row's title is always drawn, so `titleOnly` costs the row its glyph but
                // not its item. An item with no icon passes nothing: a non-null empty leading
                // slot would still move the label.
                icon =
                  if (labelStyle.showsGlyph) {
                    model.iconContent(index)
                  } else {
                    NitroUiIconContent.Absent
                  },
                onIconTint = { tint -> model.noteOverflowIconTint(item.id, tint) },
                onPick = {
                  if (!itemEnabled) {
                    return@MenuRow
                  }
                  if (item.toggle) {
                    toggleTo(item.id)
                  } else {
                    model.onPress?.invoke(item.id)
                  }
                  menuState.dismiss()
                },
              )
            },
          )
        }
      }
    }
  }
}

class HybridNitroUiButtonGroup(
  reactContext: ThemedReactContext,
) : HybridNitroUiButtonGroupSpec(),
  RecyclableView {
  private val model = ButtonGroupModel()
  private val host = ButtonGroupHost(reactContext, reactContext.currentActivity, model)

  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // Fill-width, because overflow can only be decided at the width the row is given:
    // measured unbounded, the group would never overflow and would draw outside its box.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
  }

  companion object {
    // Must match `getName()` in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiButtonGroup"

    // The height before anything is measured, in dp: the `medium` button height.
    private const val FALLBACK_HEIGHT_DP = 48.0

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

    private const val FALLBACK_WIDTH_DP = 300.0
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var items: Array<NitroUiButtonGroupItem>
    get() = model.items.map { item ->
      NitroUiButtonGroupItem(
        id = item.id,
        title = item.title,
        systemImage =
          item.systemImage?.let { Variant_NullType_String.Second(it) }
            ?: Variant_NullType_String.First(NullType.NULL),
        androidIcon =
          item.androidIcon?.let { Variant_NullType_String.Second(it) }
            ?: Variant_NullType_String.First(NullType.NULL),
        disabled = item.disabled,
        toggle = item.toggle,
      )
    }.toTypedArray()
    set(next) {
      val parsed =
        next.map { item ->
          ButtonGroupItemState(
            id = item.id,
            title = item.title,
            systemImage = item.systemImage?.asSecondOrNull(),
            androidIcon = item.androidIcon?.asSecondOrNull(),
            disabled = item.disabled,
            toggle = item.toggle,
          )
        }
      if (parsed == model.items) {
        return
      }
      model.items = parsed
      host.markDirty()
    }

  override var appearance: String
    get() = model.appearance.wireName
    set(next) {
      val value = ButtonGroupAppearance.from(next)
      if (value == model.appearance) {
        return
      }
      model.appearance = value
      host.markDirty()
    }

  override var variant: String
    get() = model.variant.wireName
    set(next) {
      val value = ButtonVariant.from(next)
      if (value == model.variant) {
        return
      }
      model.variant = value
      host.markDirty()
    }

  override var size: String
    get() = model.scale.wireName
    set(next) {
      val value = ButtonScale.from(next)
      if (value == model.scale) {
        return
      }
      model.scale = value
      host.markDirty()
    }

  override var labelStyle: String
    get() = model.labelStyle.wireName
    set(next) {
      val value = ButtonGroupLabelStyle.from(next)
      if (value == model.labelStyle) {
        return
      }
      model.labelStyle = value
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
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` passes the ARGB int as a double; `toLong()` keeps the bit pattern.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var checkedIds: Array<String>
    get() = model.state.js?.toTypedArray() ?: emptyArray()
    set(next) {
      // Not visual by itself: `displayed` follows in `afterUpdate()`, once JS has caught up.
      model.state.js = next.toSet()
    }

  override var controlledIds: Array<String>
    get() = model.state.controlled.toTypedArray()
    set(next) {
      model.state.controlled = next.toSet()
    }

  override var defaultCheckedIds: Array<String>
    get() = emptyArray()
    set(next) {
      // Applied in `afterUpdate()`, where the items it names already exist.
      pendingDefaults = next.toList()
    }

  private var pendingDefaults: List<String>? = null

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var overflowAccessibilityLabel: Variant_NullType_String
    get() =
      model.overflowAccessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.overflowAccessibilityLabel) {
        return
      }
      model.overflowAccessibilityLabel = value
      host.markDirty()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value == model.accessibilityLabel) {
        return
      }
      model.accessibilityLabel = value
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // The host's tag is what RN's testID matchers read on Android.
    set(next) {
      host.tag = next.asSecondOrNull()
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
      // A new configuration may measure what the old one did; the host must not
      // swallow that report against its dedupe.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId =
        if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onPress: ((String) -> Unit)?
    get() = model.onPress
    set(next) {
      model.onPress = next
    }

  override var onCheckedChange: ((String, Boolean, Double) -> Unit)?
    get() = model.onCheckedChange
    set(next) {
      model.onCheckedChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    model.resolveAndroidIcons(iconArtwork)
    model.pruneChecked()
    (pendingDefaults ?: emptyList()).let { model.applyDefaults(it) }
    pendingDefaults = null
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // A disabled control must not keep its menu open.
    if (!model.enabled) {
      model.menuState?.dismiss()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.prepareForRecycle()
    pendingDefaults = null
  }

  override fun onDropView() {
    model.menuState?.dismiss()
    model.onPress = null
    model.onCheckedChange = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size, so it is safe on the JS thread.
  override fun measureContent(): NitroUiButtonGroupSize {
    val size = host.contentSize ?: return NitroUiButtonGroupSize(0.0, 0.0)
    return NitroUiButtonGroupSize(size.width, size.height)
  }

  override fun nuiTestPressItem(id: String) {
    Handler(Looper.getMainLooper()).post { host.press(id) }
  }

  // Opens the overflow menu as the indicator's tap does, so a test need not guess where it is.
  override fun nuiTestOpenOverflow() {
    Handler(Looper.getMainLooper()).post { model.menuState?.show() }
  }

  override fun nuiTestProbeRow() {
    Handler(Looper.getMainLooper()).post {
      val order = model.items.map { it.id }
      val visible = model.ledger.visibleIds(order)
      val overflow = if (model.ledger.indicatorPlaced()) 1 else 0
      model.publishRowReport(
        "visible=${visible.size};overflow=$overflow;row=standard;" +
          "shown=${if (visible.isEmpty()) "none" else visible.joinToString(",")}"
      )
    }
  }

  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      model.publishAccessibilityReport(describeAccessibility())
    }
  }

  // Posted: reading pixels needs the UI thread, and a Nitro method may not block for it.
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.readPixelReport()

  override fun nuiTestStateReport(): String = model.stateReport()

  // Every pressable semantics node in tree order, as one line. Overflowed items are absent.
  private fun describeAccessibility(): String {
    val root = findComposeRoot(host) ?: return "no Compose root"
    root.forceAccessibilityForTesting(true)
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      return "no SemanticsOwner"
    }
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val clickable = nodes.filter { it.config.contains(SemanticsActions.OnClick) }
    if (clickable.isEmpty()) {
      return "nodes=0 (${nodes.size} nodes)"
    }
    val parts =
      clickable.mapIndexed { index, node ->
        val config = node.config
        val role = config.getOrNull(SemanticsProperties.Role)?.toString() ?: "none"
        val toggle = config.getOrNull(SemanticsProperties.ToggleableState)?.toString() ?: "none"
        val disabled = config.contains(SemanticsProperties.Disabled)
        // Reported apart: `text` is a title Compose drew, `desc` a name set on a title-less button.
        val text =
          config.getOrNull(SemanticsProperties.Text)
            ?.joinToString(" ") { value -> value.text }
            ?: "none"
        val desc =
          config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
            ?: "none"
        "$index[$role,$toggle,disabled=$disabled,text=$text,desc=$desc]"
      }
    return "nodes=${clickable.size};${parts.joinToString(";")}"
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

