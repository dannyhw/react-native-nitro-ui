package com.margelo.nitro.nitroui

import android.view.View
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CheckableDropdownMenuItem
import androidx.compose.material3.DropdownMenuGroup
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenuPopup
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorPosition
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.nitroui.core.toRgbHex
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/*
 * The menus of the three menu-shaped controls, on Material 3 Expressive (E2, DECISIONS
 * D40): `Menu` and `ContextMenu` share the popup, the groups and the rows (D36 item 4),
 * and `Picker` shares the check, the row shapes and the witness. Both menus draw the
 * same rows from the same array, so a change here is a change to both, and both
 * harness suites re-run for it.
 *
 * The popup is `DropdownMenuPopup`, Expressive's menu window: unlike the baseline
 * `DropdownMenu` it has no surface of its own. Each group is a `DropdownMenuGroup`
 * surface, spaced by `MenuDefaults.GroupSpacing`, and a group and a row take the corner
 * shapes `MenuDefaults.groupShape`/`itemShape` give their place in the list. That
 * spacing is what replaced the dividers between sections.
 */

/** One pickable row, as the popup draws it. */
internal data class MenuActionItem(
  val id: String,
  val title: String,
  val disabled: Boolean,
  val destructive: Boolean,
  /** The row's second line, or `null` for none. */
  val subtitle: String? = null,
  /** `null` for a plain row; otherwise a checkable row, and whether it is checked. */
  val checked: Boolean? = null,
  /**
   * The row's `androidIcon` as the wrapper sent it - a drawable name or a `url:` string
   * (`NitroUiIconSource`) - or `null`.
   *
   * The wire string, never the artwork: artwork arrives, sometimes late, and this data
   * class is compared by value and `remember`ed as a list key. [MenuRowIcons] turns it
   * into what the row draws.
   */
  val androidIcon: String? = null,
)

/** A row that opens a second level - which on Android does not: see [MenuModel.entries]. */
internal data class MenuSubmenuItem(
  val id: String,
  val title: String,
  val items: List<MenuActionItem>,
)

/** A group with an optional header. A null [title] is a group with no label. */
internal data class MenuSectionItem(
  val id: String,
  val title: String?,
  val items: List<MenuActionItem>,
)

/** What the popup draws, in order. */
internal sealed class MenuEntry {
  data class Action(
    val item: MenuActionItem,
  ) : MenuEntry()

  data class Submenu(
    val item: MenuSubmenuItem,
  ) : MenuEntry()

  data class Section(
    val item: MenuSectionItem,
  ) : MenuEntry()
}

/**
 * The wrapper's flat array, as the rows the popup draws.
 *
 * `actions` first, then `sections`, with each parent's children following it and
 * naming it in `parentId` - the shape `Menu.tsx`'s `flattenGroup` sends. A submenu
 * becomes a group titled with its own title, its items inline (D29); a section becomes
 * a group with its title, or an untitled group when it has none ([menuGroupsOf]). An unknown `parentId`
 * reads as a top-level row rather than being dropped, and an unknown `kind` draws
 * nothing - the wrapper is the only writer, so either is a bug, and a row that draws
 * as the wrong thing hides a bug better than a missing one does.
 */
internal fun parseMenuRows(rows: Array<NitroUiMenuRow>): List<MenuEntry> {
  val children = HashMap<String, MutableList<MenuActionItem>>()

  fun toAction(row: NitroUiMenuRow): MenuActionItem =
    MenuActionItem(
      id = row.id,
      title = row.title,
      disabled = row.disabled,
      destructive = row.destructive,
      subtitle = row.subtitle?.asSecondOrNull()?.ifEmpty { null },
      checked = row.checked?.asFirstOrNull(),
      androidIcon = row.androidIcon?.asSecondOrNull(),
    )

  for (row in rows) {
    val parentId = row.parentId?.asSecondOrNull() ?: continue
    children.getOrPut(parentId) { mutableListOf() }.add(toAction(row))
  }

  val entries = ArrayList<MenuEntry>(rows.size)
  for (row in rows) {
    // Children are drawn by their parent, never on their own.
    if (row.parentId?.asSecondOrNull() != null) {
      continue
    }
    when (row.kind) {
      "action" -> entries.add(MenuEntry.Action(toAction(row)))
      "submenu" ->
        entries.add(
          MenuEntry.Submenu(
            MenuSubmenuItem(
              id = row.id,
              title = row.title,
              items = children[row.id] ?: emptyList(),
            )
          )
        )
      "section" ->
        entries.add(
          MenuEntry.Section(
            MenuSectionItem(
              id = row.id,
              title = row.title.ifEmpty { null },
              items = children[row.id] ?: emptyList(),
            )
          )
        )
      else -> Unit
    }
  }
  return entries
}

/** One Material menu group: a surface of its own, with an optional label over its rows. */
internal data class MenuGroupItem(
  /** Stable within one menu: the section's or submenu's id, or `actions:<n>`. */
  val key: String,
  val title: String?,
  val items: List<MenuActionItem>,
)

/**
 * The entries as Material groups, in order.
 *
 * Top-level actions next to each other share one untitled group; a submenu (inline on
 * Android, D29) and a section are each a group of their own, titled when they have a
 * title. A group with neither a title nor a row draws nothing: before E2 that was a
 * bare divider, and an empty surface would be a box with nothing in it.
 */
internal fun menuGroupsOf(entries: List<MenuEntry>): List<MenuGroupItem> {
  val groups = ArrayList<MenuGroupItem>()
  var loose: MutableList<MenuActionItem>? = null

  fun flush() {
    val rows = loose ?: return
    groups.add(MenuGroupItem(key = "actions:${groups.size}", title = null, items = rows))
    loose = null
  }

  fun add(
    key: String,
    title: String?,
    items: List<MenuActionItem>,
  ) {
    flush()
    if (title != null || items.isNotEmpty()) {
      groups.add(MenuGroupItem(key = key, title = title, items = items))
    }
  }
  for (entry in entries) {
    when (entry) {
      is MenuEntry.Action -> {
        val rows = loose ?: mutableListOf<MenuActionItem>().also { loose = it }
        rows.add(entry.item)
      }
      is MenuEntry.Submenu -> add(entry.item.id, entry.item.title, entry.item.items)
      is MenuEntry.Section -> add(entry.item.id, entry.item.title, entry.item.items)
    }
  }
  flush()
  return groups
}

/**
 * The rows' `androidIcon`s, resolved, for one menu.
 *
 * The Button and Menu's trigger each have one [NitroUiIconSlot]; a menu has one per
 * row, and this holds them, keyed by row id — the id the row is picked by, unique
 * across the menu, and the only thing here a re-ordered list keeps stable.
 *
 * [apply] runs from `afterUpdate()` with the array the wrapper sent, and it is the
 * *only* place artwork is resolved: a resource lookup reads a `synchronized` table and a
 * dev-server file opens a socket, so neither belongs in a prop setter or in a
 * composition (AGENTS' perf contract).
 *
 * A re-sent menu — the same rows, the same order, which is what every unrelated prop
 * batch hands `afterUpdate()` — is what makes two rules load-bearing here, and both
 * belong to someone else, which is why this class keeps no guard of its own.
 * [NitroUiIconSlot.resolve] compares the source it already holds, so re-applying an
 * unchanged menu asks the resource table nothing; and [slots] is `mutableStateOf`, whose
 * structural-equality policy drops a write of an equal map, so reusing each row's slot
 * instance below means an unchanged menu writes no state and recomposes nothing. Both
 * are asserted by `MenuRowIconsTest`, and a guard duplicated here would be a second
 * cache to invalidate — the stale half of which is exactly how a recycled view ends up
 * with no icons at all.
 *
 * A row that stops existing has its slot [reset][NitroUiIconSlot.reset] rather than
 * dropped: a file load its owner started is still in flight, and bumping the
 * generation is what retires it. The same class answers for `Menu` and for
 * `ContextMenu`, because both draw [MenuRow].
 */
internal class MenuRowIcons {
  /** What the composition draws, per row id. Observed: a late file lands in it. */
  var slots by mutableStateOf<Map<String, NitroUiIconSlot>>(emptyMap())
    private set

  /**
   * Resolve the rows' icons against [artwork], where [items] is every row's
   * `(id, androidIcon)` pair in menu order.
   */
  fun apply(
    items: List<Pair<String, String?>>,
    artwork: NitroUiIconArtwork,
  ) {
    val next = HashMap<String, NitroUiIconSlot>(items.size)
    for ((id, raw) in items) {
      if (raw == null) {
        continue
      }
      // A row that keeps its icon keeps its slot, and with it its loaded artwork, so a
      // re-sent menu draws its glyphs in the first frame rather than after a reload.
      val slot = next.getOrPut(id) { slots[id] ?: NitroUiIconSlot() }
      slot.resolve(raw, artwork)
    }
    for ((id, slot) in slots) {
      if (!next.containsKey(id)) {
        slot.reset()
      }
    }
    slots = next
  }

  /** What the row named [id] draws beside its title. Read in composition. */
  fun contentOf(
    id: String,
  ): NitroUiIconContent = slots[id]?.content ?: NitroUiIconContent.Absent

  /**
   * What each row that drew a glyph tinted it with, `<id>#<RRGGBB>` in row order.
   *
   * Test-only, and it exists because the harness has no other way to name the colour:
   * Material's leading-icon colour comes from the device's dynamic palette on Android
   * 12+, so a test cannot write the RGB down. [MenuRow] records it *as it draws*, from
   * the same `LocalContentColor` the glyph is tinted with, and
   * `nuiTestMenuPixelProbe` then samples for exactly that - which is what makes the
   * answer "these pixels of this colour are on screen" rather than an echo of a prop.
   *
   * A plain map, written on the UI thread inside composition and read from whichever
   * thread Nitro answers on: a stale read is a test polling once more, never a wrong
   * answer, and nothing may recompose because a test reading moved.
   */
  private val tints = ConcurrentHashMap<String, String>()

  /** Record that the row named [id] tinted its glyph with [tint]. */
  fun noteTint(
    id: String,
    tint: ComposeColor,
  ) {
    tints[id] = tint.toRgbHex()
  }

  /** [tints], in the order the rows were first drawn. `-` when no row has drawn one. */
  fun tintsReport(): String =
    if (tints.isEmpty()) {
      "-"
    } else {
      tints.entries.joinToString(",") { (id, hex) -> "$id#$hex" }
    }

  /** Hand these rows to the next owner of the view. */
  fun reset() {
    for (slot in slots.values) {
      slot.reset()
    }
    slots = emptyMap()
    tints.clear()
  }
}

/**
 * The `androidIcon` a row draws, sized for Material's own leading-icon slot.
 *
 * The lambda is passed to Material only when the row has something to draw: a
 * `leadingIcon` that is non-null but empty still takes the 20 dp
 * (`SegmentedMenuTokens.ItemLeadingIconSize`) and moves the label, which is precisely
 * what a name that does not resolve must not do. The checkable row gets the same
 * treatment in [MenuRow]'s `leadingIcon`, where the check keeps the slot when it is on.
 */
@Composable
internal fun MenuRowIcon(content: NitroUiIconContent) {
  NitroUiIconSlotGlyph(content, MenuDefaults.LeadingIconSize)
}

/**
 * The leading check of a checked menu row and of Picker's selected row, at Material's
 * leading-icon size: Google's Material Symbols `check` (`nitroui_check`,
 * `core/NitroUiIcons.kt`), parsed once per process. One lambda for the process.
 */
internal val MenuLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = nitroUiIcon(R.drawable.nitroui_check),
    contentDescription = null,
    modifier = Modifier.size(MenuDefaults.LeadingIconSize),
  )
}

/** Test tags the `drawn` witness reads a group and a label by ([describeMenuSemantics]). */
internal const val MENU_GROUP_TAG = "nitroui.menu.group"
internal const val MENU_GROUP_LABEL_TAG = "nitroui.menu.group.label"
internal const val MENU_TITLE_TAG = "nitroui.menu.title"

/**
 * One pickable row of the list.
 *
 * A plain row is Expressive's `DropdownMenuItem` with the shape of its place in the
 * group; a row with a `checked` is `CheckableDropdownMenuItem`, which draws a checked
 * row selected, with the leading check, and says `Role.Checkbox` plus `selected` to a
 * screen reader. Either way a press is a pick - [onPick] - and never a local toggle: the
 * menu has no value, so the check is whatever the app sends next.
 *
 * [icons] answers what the row's `androidIcon` resolved to, and a row with something to
 * draw hands Material a `leadingIcon` and takes Material's slot, colour and gap; a row
 * without one hands it `null` and is laid out exactly as it was before the prop
 * existed. On a checkable row the check keeps the slot when the row is checked -
 * Material's own `checkedLeadingIcon` - because the check is what the row means, and
 * the glyph is what an unchecked one shows.
 */
@Composable
internal fun MenuRow(
  item: MenuActionItem,
  index: Int,
  count: Int,
  groupEnabled: Boolean,
  icons: MenuRowIcons,
  onPick: () -> Unit,
) {
  val enabled = groupEnabled && !item.disabled
  val text: @Composable () -> Unit = {
    Text(
      text = item.title,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      // Destructive rows are the scheme's error colour. Set on the text rather than
      // through `MenuDefaults.itemColors()`, which Q1 §4 names as a per-recomposition
      // allocation; `Color.Unspecified` for a disabled row keeps Material's own
      // disabled treatment.
      color =
        if (item.destructive && enabled) {
          MaterialTheme.colorScheme.error
        } else {
          ComposeColor.Unspecified
        },
    )
  }
  val subtitle = item.subtitle
  val supportingText: (@Composable () -> Unit)? =
    if (subtitle == null) {
      null
    } else {
      { Text(text = subtitle, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
  val shapes = MenuDefaults.itemShape(index, count)
  val checked = item.checked
  // Read here, not inside the lambda: the slot either exists for this row's layout or
  // it does not, and `Absent` - the answer for "no icon", for a name the resource table
  // does not know, and for a file that failed to load - must reach `leadingIcon` as
  // `null`, which is the row's no-icon self down to the last dp.
  val icon = icons.contentOf(item.id)
  val leadingIcon: (@Composable () -> Unit)? =
    if (icon == NitroUiIconContent.Absent) {
      null
    } else {
      {
        // What the row tinted its glyph with, recorded as it draws: the harness cannot
        // name this device's dynamic Material palette, so it asks the row and then
        // samples for that colour (`nuiTestMenuReport`'s `iconTints=`).
        icons.noteTint(item.id, LocalContentColor.current)
        MenuRowIcon(icon)
      }
    }
  if (checked != null) {
    CheckableDropdownMenuItem(
      checked = checked,
      onCheckedChange = { onPick() },
      text = text,
      shapes = shapes,
      leadingIcon = leadingIcon,
      checkedLeadingIcon = MenuLeadingCheck,
      supportingText = supportingText,
      enabled = enabled,
    )
  } else {
    DropdownMenuItem(
      onClick = onPick,
      text = text,
      shape = shapes.shape,
      leadingIcon = leadingIcon,
      supportingText = supportingText,
      enabled = enabled,
    )
  }
}

/**
 * A group's label - or, tagged [MENU_TITLE_TAG], the menu's own title: drawn, a heading
 * to a screen reader, and deliberately not a row, because a row that does nothing reads
 * as a bug to the person using one. `DropdownMenuGroupLabel` caps it at the width a row
 * stops at (280 dp), so a long title cannot stretch the list.
 */
@Composable
private fun MenuGroupLabel(
  title: String,
  tag: String,
) {
  MenuDefaults.DropdownMenuGroupLabel(
    modifier = Modifier.testTag(tag).semantics { heading() },
  ) {
    Text(
      text = title,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/**
 * The menu's groups, in order: each [MenuGroupItem] is a `DropdownMenuGroup`, spaced by
 * `MenuDefaults.GroupSpacing` and shaped by its place in the list. [menuTitle] (a
 * ContextMenu's) is the first group's top label.
 *
 * Scrolls when the groups are taller than the window: `DropdownMenuPopup`'s column does
 * not scroll by itself, unlike the baseline `DropdownMenu`.
 *
 * [onRowsComposed] hears how many pickable rows *this* composition drew, published after
 * the composition rather than written during it: the witness for a `group` that changed
 * while the menu was open.
 *
 * [icons] is the popup's rows' resolved `androidIcon`s - the caller's model owns it,
 * because the slots have to outlive a recomposition and be retired by a recycle.
 */
@Composable
internal fun MenuGroups(
  entries: List<MenuEntry>,
  menuTitle: String?,
  enabled: Boolean,
  icons: MenuRowIcons,
  onPick: (String) -> Unit,
  onRowsComposed: (Int) -> Unit,
) {
  val groups = remember(entries) { menuGroupsOf(entries) }
  Column(
    modifier = Modifier.verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(MenuDefaults.GroupSpacing),
  ) {
    groups.forEachIndexed { index, group ->
      key(group.key) {
        DropdownMenuGroup(
          shapes = MenuDefaults.groupShape(index, groups.size),
          modifier = Modifier.testTag(MENU_GROUP_TAG),
        ) {
          if (index == 0 && menuTitle != null) {
            MenuGroupLabel(menuTitle, MENU_TITLE_TAG)
          }
          val title = group.title
          if (title != null) {
            MenuGroupLabel(title, MENU_GROUP_LABEL_TAG)
          }
          group.items.forEachIndexed { row, item ->
            MenuRow(
              item = item,
              index = row,
              count = group.items.size,
              groupEnabled = enabled,
              icons = icons,
              onPick = { onPick(item.id) },
            )
          }
        }
      }
    }
  }
  val pickableRows = groups.sumOf { it.items.size }
  SideEffect { onRowsComposed(pickableRows) }
}

/**
 * The menu window both menus open: Expressive's `DropdownMenuPopup`, placed by
 * `MenuDefaults.rememberDropdownMenuPopupPositionProvider` against the layout it is
 * composed in - the trigger's box for a Menu, a zero-size box at the finger for a
 * ContextMenu - with the [MenuWitness] first inside it.
 */
@Composable
internal fun NitroUiMenuPopup(
  expanded: Boolean,
  onDismissRequest: () -> Unit,
  witness: MenuWitnessSink,
  content: @Composable ColumnScope.() -> Unit,
) {
  DropdownMenuPopup(
    expanded = expanded,
    onDismissRequest = onDismissRequest,
    popupPositionProvider =
      MenuDefaults.rememberDropdownMenuPopupPositionProvider(MenuAnchorPosition.Below),
  ) {
    // Must be first: it reads `LocalView`, which inside this lambda is the *popup's*
    // view.
    MenuWitness(witness)
    content()
  }
}

/**
 * Whether any harness has asked a menu-shaped control for its report in this process.
 *
 * The `drawn` reading walks the popup's semantics tree on each layout of the popup's
 * window, which an app never needs: it is switched on by the first report or probe
 * call, so an app that never calls a test seam never pays for it.
 */
internal object MenuDrawnWitness {
  @Volatile var wanted = false
}

/**
 * The open menu as its own semantics tree says it is - the rows a screen reader and
 * `uiautomator` reach - in `Menu.nitro.ts`'s `drawn` notation, or `null` when [view] is
 * not a composition root.
 *
 * Read from the *merged* tree, as TalkBack reads it: a row is a node with a click
 * action, its title the first text and its subtitle the second (`@`); `+` is a row that
 * says `selected` with `Role.Checkbox` or `Role.RadioButton`, `=` a checkbox row that is
 * not selected, `~` a disabled row. A group is `(<label>:<rows>)` and a menu's own title
 * `#<title>`. Destructive is only a colour, nothing in the tree, so Android never writes
 * `!`.
 */
internal fun describeMenuSemantics(view: View): String? {
  val owner = (view as? RootForTest)?.semanticsOwner ?: return null
  return describeNodes(owner.rootSemanticsNode.children).joinToString(",")
}

/** Marks a group label inside [describeNodes]'s output; never a row's first character. */
private const val LABEL_MARK = "\u0000"

private fun describeNodes(nodes: List<SemanticsNode>): List<String> {
  val parts = ArrayList<String>()
  for (node in nodes) {
    val config = node.config
    val tag = config.getOrNull(SemanticsProperties.TestTag)
    when {
      tag == MENU_GROUP_TAG -> {
        var label = ""
        val rows = ArrayList<String>()
        for (part in describeNodes(node.children)) {
          when {
            part.startsWith(LABEL_MARK) -> label = part.removePrefix(LABEL_MARK)
            // A menu's title rides in its first group: written ahead of the group.
            part.startsWith("#") -> parts.add(part)
            else -> rows.add(part)
          }
        }
        parts.add("($label:${rows.joinToString(",")})")
      }
      tag == MENU_GROUP_LABEL_TAG -> parts.add(LABEL_MARK + textOf(node))
      tag == MENU_TITLE_TAG -> parts.add("#" + textOf(node))
      config.contains(SemanticsActions.OnClick) -> parts.add(describeRow(node))
      else -> parts.addAll(describeNodes(node.children))
    }
  }
  return parts
}

/** Every text at or under [node], in order. */
private fun textOf(node: SemanticsNode): String =
  node.config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text }
    ?: node.children.joinToString("") { textOf(it) }

private fun describeRow(node: SemanticsNode): String {
  val config = node.config
  val texts = config.getOrNull(SemanticsProperties.Text)?.map { it.text } ?: emptyList()
  val out = StringBuilder(texts.getOrNull(0) ?: "?")
  val subtitle = texts.getOrNull(1)
  if (subtitle != null) {
    out.append('@').append(subtitle)
  }
  val selected = config.getOrNull(SemanticsProperties.Selected) == true
  when (config.getOrNull(SemanticsProperties.Role)) {
    Role.Checkbox -> out.append(if (selected) '+' else '=')
    Role.RadioButton -> if (selected) out.append('+')
    else -> Unit
  }
  if (config.contains(SemanticsProperties.Disabled)) {
    out.append('~')
  }
  return out.toString()
}

/**
 * What a popup's witness reports to: the owning control's model.
 *
 * Menu and ContextMenu keep their popup geometry in their own models, so the witness
 * talks to this rather than to either of them.
 */
internal interface MenuWitnessSink {
  /** How many of this control's popups the process has composed right now. */
  val livePopups: AtomicInteger

  /** The open menu's view, for as long as its composition group is composed. */
  fun noteMenuView(view: View?)

  /** Where the open menu's window is on screen, px. */
  fun noteMenuFrame(
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  )

  /** No popup of this mount is composed any more. */
  fun clearMenuFrame()

  /** The popup left the composition: an `expanded` flag must not outlive it. */
  fun menuLeftComposition()

  /**
   * What the open popup's semantics tree holds, in `drawn` notation
   * ([describeMenuSemantics]); read on each layout of the popup's window once a harness
   * has asked ([MenuDrawnWitness]). Kept after the popup closes, like iOS's probe answer.
   */
  fun noteMenuDrawn(tree: String)
}

/** Read the popup's tree into [sink] now, if a harness wants it. UI thread. */
internal fun refreshMenuDrawn(
  view: View?,
  sink: MenuWitnessSink,
) {
  if (view == null || !MenuDrawnWitness.wanted) {
    return
  }
  describeMenuSemantics(view)?.let(sink::noteMenuDrawn)
}

/**
 * The popup's own witness, composed only while the menu is open, and first inside it:
 * it reads `LocalView`, which inside a `DropdownMenu`'s content is the *popup's* view.
 *
 * The three jobs are `PickerHost.MenuWitness`'s, unchanged: prove there is a menu
 * ([MenuWitnessSink.livePopups], process-wide, so a mount dropped mid-menu cannot hide a
 * leak), say where its window is, and make sure `expanded` does not survive a popup that
 * already left the composition. The last one is why a hosted Menu that leaves and
 * re-enters its Host's child list does not open a window nobody asked for.
 */
@Composable
internal fun MenuWitness(sink: MenuWitnessSink) {
  val menuView = LocalView.current
  DisposableEffect(menuView) {
    val live = sink.livePopups
    live.incrementAndGet()
    val where = IntArray(2)
    sink.noteMenuView(menuView)
    val listener =
      View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
        view.getLocationOnScreen(where)
        sink.noteMenuFrame(
          where[0],
          where[1],
          where[0] + view.width,
          where[1] + view.height,
        )
        refreshMenuDrawn(view, sink)
      }
    menuView.addOnLayoutChangeListener(listener)
    onDispose {
      menuView.removeOnLayoutChangeListener(listener)
      sink.noteMenuView(null)
      sink.clearMenuFrame()
      live.decrementAndGet()
      sink.menuLeftComposition()
    }
  }
}
