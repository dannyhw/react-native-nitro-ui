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
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What the overflow control announces when the caller names it nothing: the title iOS's
 * `Label` draws for the same control, so one word covers both platforms. File-level
 * because the composable that draws the indicator and the Hybrid View that owns the
 * model are different types, and only a top-level name is visible to both.
 */
private const val DEFAULT_OVERFLOW_LABEL = "More"

/*
 * The ButtonGroup component: a row of commands, optionally with independent
 * toggles, that moves the items it cannot fit into an overflow menu
 * (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` Appendix B, DECISIONS
 * D42).
 *
 * Android has the control natively — Material 3 Expressive's `ButtonGroup` — so
 * the composition is thin and the interesting decisions are about which of its
 * item builders to use and how to see what it decided:
 *
 * - **`customItem` for every item.** `clickableItem` always composes a filled
 *   `Button` and `toggleableItem` a filled `ToggleButton` (read off the artifact),
 *   so neither can carry `variant`, `size`, `tintColor` or the connected corners
 *   this control takes. `customItem` hands us both content slots and leaves the
 *   button to us: an action item is [NitroUiM3Button] — *the* Button, so a group's
 *   item and a lone Button are the same composition — and a toggle item is
 *   [NitroUiM3ToggleButton] beside it.
 * - **Overflow is Material's own.** The `overflowIndicator` slot and the
 *   `DropdownMenu` `ButtonGroup` opens for it come from the control itself, because
 *   *which* items overflowed lives in `ButtonGroupOverflowState`, which the artifact
 *   keeps private: nothing outside it can draw a "More" button for the right items.
 *   The rows inside that menu are E2's [MenuRow], so an overflow row looks like a
 *   Menu row (it is one).
 * - **What overflowed is read from placement, not from state.** The harness witness
 *   is a ledger that each item stamps when the measure policy *places* it (see
 *   [RowPlacementLedger]) — composed is not the same as shown, because the group
 *   composes every item so it can measure the ones it is going to hide.
 *
 * The value half is a *set*: [ButtonGroupCheckedSet] is the event-count handshake
 * (`docs/architecture/core.md` §4) for many toggles at once, which is why it is not
 * a `NitroUiControlledValue`.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of that package.
 */

/** How the items sit together. */
internal enum class ButtonGroupAppearance(val wireName: String) {
  /** 12 dp of space; each item keeps its own corner. */
  Standard("standard"),

  /** 2 dp apart, with Material's connected leading/middle/trailing corners. */
  Connected("connected"),
  ;

  companion object {
    /** The arrangement for a wire string; anything unrecognised is `standard`. */
    fun from(value: String): ButtonGroupAppearance =
      entries.firstOrNull { it.wireName == value } ?: Standard
  }
}

/** Which half of an item's label the group draws. */
internal enum class ButtonGroupLabelStyle(val wireName: String) {
  /** Icon and title — Android's own default, which is *not* iOS's connected default. */
  Automatic("automatic"),
  TitleOnly("titleOnly"),
  IconOnly("iconOnly"),
  TitleAndIcon("titleAndIcon"),
  ;

  companion object {
    /** The style for a wire string; anything unrecognised is `automatic`. */
    fun from(value: String): ButtonGroupLabelStyle =
      entries.firstOrNull { it.wireName == value } ?: Automatic
  }

  /** Whether the glyph is drawn. */
  val showsGlyph: Boolean
    get() = this != TitleOnly

  /** Whether the title is drawn. On Android every style but `iconOnly` draws it. */
  val showsTitle: Boolean
    get() = this != IconOnly

  /** The [ButtonGlyph] the shared label composition is asked for. */
  val glyph: ButtonGlyph
    get() =
      when (this) {
        TitleOnly -> ButtonGlyph.TitleOnly
        IconOnly -> ButtonGlyph.IconOnly
        else -> ButtonGlyph.Both
      }
}

/** One item, as the composition draws it. Immutable, so a new list is a new state. */
internal data class ButtonGroupItemState(
  val id: String,
  val title: String,
  /** Stored, never drawn: Android has no SF Symbols (`Button`'s rule). */
  val systemImage: String?,
  /** The resolved glyph string, or `null`; [iconContent] is what draws. */
  val androidIcon: String?,
  val disabled: Boolean,
  val toggle: Boolean,
)

/**
 * The event-count handshake for a *set* of toggles (core.md §4).
 *
 * The single-value twin is `NitroUiControlledValue`; it cannot serve here because
 * the control owns a set that several items move independently:
 *
 * - [js] is the whole checked set React sent, and only for the ids in [controlled] —
 *   ids outside [controlled] are uncontrolled and no write may move them, which is
 *   what lets controlled and uncontrolled items share one group;
 * - a write is stale while `jsEvents < nativeEvents`, exactly as in the single case,
 *   so a flip JS refused (the next render's set unchanged) reverts instead of
 *   stranding the item;
 * - one counter for the whole group, not one per item: per-item counts would let one
 *   item's stale write be accepted on the strength of another item's event.
 */
internal class ButtonGroupCheckedSet {
  /** What the row shows. A set of item ids. */
  var displayed: Set<String> = emptySet()

  /** The last checked set React sent, or `null` while nothing in the group is controlled. */
  var js: Set<String>? = null

  /** The ids a write to [js] may move. */
  var controlled: Set<String> = emptySet()

  /** How many flips native emitted. */
  var nativeEvents: Int = 0

  /** How many of those JS confirmed it processed. */
  var jsEvents: Int = 0

  /** The user flipped [id]. Returns the new event count to emit. */
  fun user(id: String): Pair<Set<String>, Int> {
    val next = if (displayed.contains(id)) displayed - id else displayed + id
    displayed = next
    nativeEvents += 1
    return next to nativeEvents
  }

  /**
   * Apply a pending React write. Returns whether [displayed] changed.
   *
   * Only the [controlled] ids move: an uncontrolled item that the user has flipped
   * keeps its state through a write, which is the whole point of sending
   * [controlled] at all.
   */
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

/** State of one ButtonGroup. See [NitroUiModel] for why this is not `@Published`. */
internal class ButtonGroupModel : NitroUiModel() {
  /** Observed: the whole row is the control's size, so a new list is a new layout. */
  var items by mutableStateOf<List<ButtonGroupItemState>>(emptyList())

  var appearance by mutableStateOf(ButtonGroupAppearance.Standard)
  var variant by mutableStateOf(ButtonVariant.Filled)
  var scale by mutableStateOf(ButtonScale.Medium)
  var labelStyle by mutableStateOf(ButtonGroupLabelStyle.Automatic)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** The tint (`processColor`'s ARGB int), or `null` for the scheme's own roles. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel: String? = null

  /** What a reader is told the "More" control is. Unused on Android (Material's own label). */
  var overflowAccessibilityLabel: String? = null

  /** The checked set on display, observed. Written by the handshake and by a flip. */
  var displayed by mutableStateOf<Set<String>>(emptySet())

  /** The handshake. Not observed: it drives [displayed], never renders. */
  val state = ButtonGroupCheckedSet()

  /** The ids whose `defaultChecked` has already been applied, so it is applied once. */
  private val seeded = HashSet<String>()

  /**
   * Seed the uncontrolled toggles, once per id.
   *
   * Re-applying the seed on every batch would let any re-render undo the tap that
   * just happened, which is the bug the `defaultChecked` rule exists to prevent
   * (`Switch`'s `defaultChecked` setter has the same one-shot guard).
   */
  fun applyDefaults(ids: List<String>) {
    for (id in ids) {
      if (seeded.add(id)) {
        state.displayed = state.displayed + id
        displayed = state.displayed
      }
    }
  }

  /**
   * Forget items that are gone.
   *
   * An id that is no longer a toggle item cannot be shown, and a checked id with no
   * item behind it would be reported by `nuiTestStateReport()` as a state the row is
   * not drawing.
   */
  fun pruneChecked() {
    val toggles = items.filter { it.toggle }.map { it.id }.toSet()
    val kept = state.displayed.filter { toggles.contains(it) }.toSet()
    if (kept != state.displayed) {
      state.displayed = kept
      displayed = kept
    }
  }

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  var onPress: ((String) -> Unit)? = null
  var onCheckedChange: ((String, Boolean, Double) -> Unit)? = null

  // MARK: - Icons (G19's path, one slot per item position)

  /** One slot per item index, so each item observes its own glyph. */
  private val iconSlots = ArrayList<NitroUiIconSlot>()

  /** What item [index] draws: artwork, an empty reserved slot, or nothing. */
  fun iconContent(index: Int): NitroUiIconContent =
    iconSlots.getOrNull(index)?.content ?: NitroUiIconContent.Absent

  /** Resolve every item's glyph, once per batch and never in composition. */
  fun resolveAndroidIcons(artwork: NitroUiIconArtwork) {
    while (iconSlots.size < items.size) {
      iconSlots.add(NitroUiIconSlot())
    }
    // Slots for items that are gone are retired, not kept: a retired slot bumps its
    // generation, which is what drops an in-flight dev-server load's answer.
    while (iconSlots.size > items.size) {
      iconSlots.removeAt(iconSlots.size - 1).reset()
    }
    for (index in items.indices) {
      iconSlots[index].resolve(items[index].androidIcon, artwork)
    }
  }

  // MARK: - Test witnesses

  private val reportLock = Any()

  /** The last row probe's answer: `visible=<n>;overflow=<0|1>`. */
  private var rowReport = "visible=none;overflow=none"

  /** The last accessibility probe's answer. */
  private var accessibilityReport = "none"

  /** How many probes have answered, so a test can tell its own from the previous one's. */
  private var probes = 0

  /** The placement ledger, which the composition writes and a probe reads. */
  val ledger = RowPlacementLedger()

  /** What the row drew, as one line, or empty before the first probe. */
  fun stateReport(): String =
    synchronized(reportLock) {
      val checked =
        if (displayed.isEmpty()) {
          "none"
        } else {
          // Item order, not insertion order: two runs must print one string.
          items.filter { displayed.contains(it.id) }.joinToString(",") { it.id }
        }
      "checked=$checked;$rowReport;menu=${if (menuOpen) "open" else "closed"};" +
        "probes=$probes;a11y=$accessibilityReport"
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

  /**
   * Whether the overflow menu is open.
   *
   * Recorded rather than asked: Material hands the `ButtonGroupMenuState` to the
   * indicator's own composable and to each overflowed item's menu content, so the
   * composition is the only place it can be seen; it is not a snapshot state this
   * model may hold on to across recompositions.
   */
  var menuOpen = false
    private set

  fun recordMenuOpen(open: Boolean) {
    synchronized(reportLock) { menuOpen = open }
  }

  /** The live menu state, so `disabled` and a recycle can close it (D29). */
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
    // The reset the brief asks for: a recycled control that still held its previous
    // owner's glyphs, ledger or open menu would show them before its first prop.
    for (index in iconSlots.indices) {
      iconSlots[index].reset()
    }
    iconSlots.clear()
    ledger.reset()
    menuState = null
    synchronized(reportLock) {
      rowReport = "visible=none;overflow=none"
      accessibilityReport = "none"
      menuOpen = false
      // Chip's and IconButton's line: `probes` is how a test tells its own answer
      // from the previous owner's, so a count carried over makes a remount's first
      // probe look like somebody else's.
      probes = 0
    }
  }
}

/**
 * The placement ledger: which items the group's measure policy actually laid out.
 *
 * It is the only honest answer to "did this item overflow?" on Android. It cannot
 * come from Material's own state (`ButtonGroupOverflowState` is package-private in
 * the artifact), and it cannot come from composition either: `ButtonGroup` composes
 * every item's `buttonGroupContent` so that it can *measure* the ones it is about to
 * hide (`ButtonGroupKt` composes `ButtonGroupContent` over the whole item list), so
 * "the composable ran" says nothing. What does say something is `onPlaced`: the
 * measure policy builds its placement list from the visible items plus the overflow
 * indicator, so an item that was dropped is never placed and never stamps.
 *
 * The ledger is plain state behind a lock, not snapshot state — a measure block may
 * not write snapshot state, and nothing may recompose because a test read a value.
 * [beginPass] runs at the top of the group's own measure, so a stamp is always
 * stamped against the pass it belongs to and a row that *narrows* (an item that
 * stops fitting) loses the stamps of the items it dropped.
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

/**
 * The group's own measure hook, so [RowPlacementLedger] can open a pass.
 *
 * A `Layout` with one child, measured with the constraints it is handed and laid out
 * at the size it asked for: transparent to measurement on purpose, because the
 * `fillWidth` contract (`docs/architecture/sizing.md`) is between
 * `NitroUiMeasuredRoot` and the group, and a wrapper that resized anything would put
 * itself in that conversation. It exists only so the ledger knows where a pass
 * starts.
 */
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
 * One toggle item: the `ToggleButton` family, one composable per variant.
 *
 * `text` maps to the **outlined** toggle: Material has no text toggle button, and an
 * item that changes its own state needs a state to show, which a borderless control
 * cannot do — the nearest M3 control is the outlined one, and
 * `docs/components/button-group.md` prints the mapping rather than inventing a
 * borderless toggle (D38 item 1: build it from the platform's real controls).
 *
 * Sits beside [NitroUiM3Button] rather than inside it because the two are different
 * M3 components with different colour, shape and padding tables; what they share is
 * the label ([NitroUiButtonLabel]) and the size ladder, which is what makes them
 * line up in one row.
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
  val colors = toggleButtonColors(variant, tint)
  val contentPadding: PaddingValues =
    ToggleButtonDefaults.contentPaddingFor(
      buttonHeight = scale.layoutHeight,
      hasStartIcon = showsGlyph,
    )
  val content: @Composable RowScope.() -> Unit = {
    NitroUiButtonLabel(title = title, scale = scale, icon = icon, glyph = glyph)
  }
  when (variant) {
    // `filled` and `text` both land on the plain `ToggleButton`: `text` has no
    // toggle of its own and takes the outlined *shapes* and border below.
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
        border = toggleOutlinedBorder(variant, tint, checked, !enabled),
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
 * The toggle colours for one variant and tint, cached per scheme like Button's.
 *
 * `ToggleButtonDefaults.colors()` is the filled answer; the other three variants
 * have their own `…ToggleButtonDefaults`. A tint replaces the container where there
 * is one and the content where the container is transparent by design — Button's
 * rule, and the checked pair is tinted with it, because a tinted toggle that went
 * back to the scheme's colour the moment it was switched on would read as two
 * different controls ([iconToggleColors] has the same reasoning for IconButton).
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

/** The `outlined`/`text` toggle's hairline, in the control's tint when it has one. */
@Composable
private fun toggleOutlinedBorder(
  variant: ButtonVariant,
  tint: Int?,
  checked: Boolean,
  disabled: Boolean,
): androidx.compose.foundation.BorderStroke? {
  if (variant != ButtonVariant.Outlined && variant != ButtonVariant.Text) {
    return null
  }
  val color = tint?.let { ComposeColor(it) } ?: return null
  val base = OutlinedToggleButtonDefaults.border(checked = checked, enabled = !disabled)
  // Material's own hairline width, which it may withhold for one of its own reasons;
  // with nothing to copy, the token's 1 dp is what every other M3 hairline uses.
  return BorderStroke(base?.width ?: 1.dp, color)
}

/** [toggleButtonColors]' store: one scheme at a time, [ButtonVariant] x tint entries. */
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

  /** Drop what a different scheme invalidates. Called with the lock held. */
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
 * The corner one item draws with.
 *
 * `standard` gives every item the variant's own Button corner; `connected` gives the
 * first item [ButtonGroupDefaults.connectedLeadingButtonShapes], the last the
 * trailing answer and the middle the middle one — **called with no arguments**, which
 * is E1's lesson written down once more (`HybridNitroUiSegmentedControl`): the first
 * parameter is the *complete resting shape*, so handing these the control's own
 * stadium keeps the connected pressed/checked corners but rests every item on a full
 * pill, which is a row of separate pills 2 dp apart and not a connected group.
 *
 * A one-item group is not a group: it takes the variant's own corner, as
 * `loneSegmentShapes` does for the segmented control.
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

/** The [ButtonShapes] an action item draws with: its [ToggleButtonShapes]' corners for a connected group. */
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

/** The host: the row, its overflow menu, and the one press path a tap and a test share. */
private class ButtonGroupHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ButtonGroupModel,
) : NitroComposeHost<ButtonGroupModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one — the
   * Chip/IconButton guard: `nuiTestProbeAccessibility` forces Compose's semantics on
   * with no reader connected, and an announcement with no recipient throws.
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
   * One press of item [id], through the path a tap takes. Refused while the group or
   * the item is disabled, as M3 refuses the tap, and *not* routed through the menu:
   * a harness has no way to open a window, and what the test asks is what an item
   * does when it is pressed, from the row or from an overflow row alike.
   */
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

  /**
   * The user's flip of one toggle. Native is optimistic: show the new state now,
   * before React has seen the event, so there is no visual latency (§4), and emit
   * the count that lets a refused change be snapped back.
   */
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

    // The group's name goes on the container, with `isTraversalGroup`, so a reader
    // can step over the row as one thing; the *items* keep their own names (each M3
    // button publishes its title, and an icon-only item is given its title below).
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
      // An empty group is an empty row. Material's own `ButtonGroup` with no items
      // still lays out a box, so the row composes nothing and the height the engine
      // files is the empty one.
      return
    }

    // `standard` is Material's own spacing for the group (12 dp); `connected` is the
    // 2 dp the connected corners are drawn to sit at.
    val arrangement =
      if (appearance == ButtonGroupAppearance.Standard) {
        ButtonGroupDefaults.HorizontalArrangement
      } else {
        Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)
      }

    LedgerLayout(onPass = { model.ledger.beginPass() }) {
      ButtonGroup(
        overflowIndicator = { state ->
          // The menu's open state can only be seen from the composition Material
          // hands the state to, and it is not a snapshot value this model may hold:
          // a flow reads it whenever the control changes it, which is also what lets
          // `disabled` and a recycle close the menu and the witness see it.
          SideEffect { model.menuState = state }
          LaunchedEffect(state) {
            snapshotFlow { state.isShowing }
              .collect { open -> model.recordMenuOpen(open) }
          }
          ButtonGroupDefaults.OverflowIndicator(
            menuState = state,
            // The label is this control's only name. Material draws an ellipsis with
            // `contentDescription = null`, so a reader reaching a group that has
            // overflowed is offered a button that says nothing - and the person who
            // needs the menu most is the one who cannot find it. "More" is the title
            // iOS draws on the same control, so the default word is one word and
            // `overflowAccessibilityLabel` replaces it on both platforms.
            modifier =
              Modifier
                .onPlaced { model.ledger.recordIndicatorPlaced() }
                .clearAndSetSemantics {
                  // Material's indicator already carries "More options", and a second
                  // description in the same modifier chain *concatenates* — measured as
                  // `label=More More options`, which is what a reader would hear. The
                  // Menu split button's fix (MenuSplitButton.halfModifier) is the house
                  // answer: clear the subtree's semantics, say the label once, and
                  // restate what the clear drops — the role and the press action.
                  contentDescription = model.overflowAccessibilityLabel ?: DEFAULT_OVERFLOW_LABEL
                  role = Role.Button
                  onClick(label = null, action = {
                    if (state.isShowing) state.dismiss() else state.show()
                    true
                  })
                },
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
              // Material's own press behaviour: an item widens while it is held and
              // squeezes its neighbours, which is `animateWidth` over the item's own
              // interaction source.
              val interaction = remember { MutableInteractionSource() }
              val itemModifier =
                Modifier
                  .animateWidth(interaction)
                  .onPlaced { model.ledger.recordPlaced(item.id) }
              // An icon-only item still has a name, and it is the title the caller
              // wrote for it: the glyph is `contentDescription = null`, so the button
              // would otherwise be announced nameless.
              val namedModifier =
                if (labelStyle.showsTitle) {
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
                  icon = model.iconContent(index),
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
                  icon = model.iconContent(index),
                  onClick = { model.onPress?.invoke(item.id) },
                )
              }
            },
            menuContent = { menuState ->
              // E2's row, in Material's own dropdown: which items overflowed is the
              // group's private business, so the popup is the group's and only the
              // rows are shared (`docs/components/button-group.md` says so).
              MenuRow(
                item =
                  MenuActionItem(
                    id = item.id,
                    title = item.title,
                    disabled = item.disabled,
                    destructive = false,
                    checked = if (item.toggle) checked.contains(item.id) else null,
                  ),
                // Material gives the menu-content lambda no position, so the row
                // cannot know its place in the list it was not asked about; the
                // single-item shape is the one answer that is never wrong about a
                // corner it cannot see.
                index = 0,
                count = 1,
                groupEnabled = enabled,
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

/** The Hybrid View React renders as `NitroUiButtonGroup`. */
class HybridNitroUiButtonGroup(
  reactContext: ThemedReactContext,
) : HybridNitroUiButtonGroupSpec(),
  RecyclableView {
  private val model = ButtonGroupModel()
  private val host = ButtonGroupHost(reactContext, reactContext.currentActivity, model)

  /**
   * The control's half of icon resolution, bound to this control's `Context`. Held
   * rather than built per commit — a prop commit is not a place to allocate (G19's
   * rule), and the `Context` it captures is the one [host] already holds.
   */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // The width is the box's, because overflow can only be decided at the width the
    // row is given: an `intrinsic` group would be measured unbounded, never overflow,
    // and then be clamped by Yoga into a box it draws outside of (Q9 Appendix A
    // measured exactly that: 396 pt of content in a 369 pt box).
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine (`getName()` in the generated manager). */
    private const val SIZING_COMPONENT_NAME = "NitroUiButtonGroup"

    /**
     * The height to lay a ButtonGroup out with before anything has been measured, in
     * dp: the `medium` rung's laid-out button height (48 dp), which is what the
     * default configuration measures on this device family (E1's ladder: 48 / 48 / 56
     * dp for small / medium / large, floored at Material's 48 dp touch target).
     *
     * Only the height matters: a `fillWidth` entry files the height alone, and a wrong
     * height moves every row on a cold first frame (D17). The conformance rule checks
     * this number against the measured default, and the harness measures from a
     * *poisoned* fallback so a failed correction cannot hide.
     */
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One `JNI` call per process; `NitroUiDeclaredFallbacks` calls it at package init. */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        // The width a `fillWidth` entry files is never read as a width, but the
        // engine still lays the first frame out at it, so a wide box is the honest
        // answer for a control that stretches.
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }

    /** What a stretched row is laid out at before it is measured (dp). */
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
      // The row *is* the size: a different item list is a different height, and no
      // bounds or trait change is coming to say so (sizing.md §5's Compose half, which
      // observes the write and reports the new size from its own measure pass).
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
      // Whether a title is drawn moves the row's height only through the text line
      // height, which Compose's own measure pass reports; nothing extra to ask for.
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
      // Repaints only: a disabled row is the same size.
      model.enabled = enabled
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` on Android hands back the ARGB int as a double; going via
      // `toLong()` keeps the bit pattern (D10).
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
      // Not visual on its own: `displayed` follows in `afterUpdate()`, once the
      // event count says JS has caught up (§4).
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

  /** The seed waiting for the batch it belongs to. */
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
      // Stored, not applied: Android's overflow indicator carries Material's own
      // localised label and tooltip, so there is nothing here to rename. iOS reads
      // it (`HybridNitroUiButtonGroup.swift`).
      model.overflowAccessibilityLabel = next.asSecondOrNull()
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
      // Rendered: it is the container node's name.
      model.accessibilityLabel = value
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // The host's tag, which is what RN's testID matchers read on Android — Button's
    // answer, and the reason the prop exists on this platform at all.
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
    // The icons first, if they changed: a resource resolved here is drawn in this
    // commit, and a file that has to be read reserves its slot in this commit and
    // fills it later (G19's rule, and AGENTS' perf contract).
    model.resolveAndroidIcons(iconArtwork)
    // An item that left the list must not stay checked.
    model.pruneChecked()
    // The seed, once per id, after the items it names exist.
    (pendingDefaults ?: emptyList()).let { model.applyDefaults(it) }
    pendingDefaults = null
    // The handshake: whether React's set wins over what the user just did, a
    // refused flip included (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    // D29's rule, the same one Menu keeps: a control that answers nothing cannot own
    // a live popup. Android owns this window, so Android can close it (on iOS the
    // system owns the presentation and nothing here can dismiss it).
    if (!model.enabled) {
      model.menuState?.dismiss()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle (core.md §6), and
    // `host.prepareForRecycle()` resets the model — items, checked set, controlled
    // ids, both event counts, the seeded set, the ledger, the glyph slots and both
    // callbacks.
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

  /** The size Compose measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiButtonGroupSize {
    val size = host.contentSize ?: return NitroUiButtonGroupSize(0.0, 0.0)
    return NitroUiButtonGroupSize(size.width, size.height)
  }

  /** Press one item through the tap's path, on the UI thread. Returns at once. */
  override fun nuiTestPressItem(id: String) {
    Handler(Looper.getMainLooper()).post { host.press(id) }
  }

  /** Read what the row laid out, on the UI thread. Returns at once. */
  override fun nuiTestProbeRow() {
    Handler(Looper.getMainLooper()).post {
      val order = model.items.map { it.id }
      val visible = model.ledger.visibleIds(order)
      val overflow = if (model.ledger.indicatorPlaced()) 1 else 0
      model.publishRowReport(
        "visible=${visible.size};overflow=$overflow;" +
          "shown=${if (visible.isEmpty()) "none" else visible.joinToString(",")}"
      )
    }
  }

  /** Read the group's semantics nodes, on the UI thread. Returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post {
      model.publishAccessibilityReport(describeAccessibility())
    }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  /**
   * Every node a reader can press, in tree order, as one line — IconButton's shape
   * extended to the whole row, because the row is the control here and an overflowed
   * item must *not* be in the list (it is not on screen until the menu opens).
   *
   * This is how "a toggle item reads as a checkbox", "an action reads as a button"
   * and "an icon-only item is still named by its title" are proved on Android: the
   * nodes are the ones M3 publishes, `ToggleableState` is what TalkBack turns into
   * "selected"/"not selected", and `ContentDescription` is the name it reads.
   */
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
        val label =
          config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
            ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { text -> text.text }
            ?: ""
        "$index[$role,$toggle,disabled=$disabled,label=$label]"
      }
    return "nodes=${clickable.size};${parts.joinToString(";")}"
  }

  /** The Compose view under [root], as [RootForTest] (the Slider's helper). */
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

