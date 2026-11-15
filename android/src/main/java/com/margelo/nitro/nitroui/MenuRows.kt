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

// The popup, groups and rows shared by Menu and ContextMenu (and, in part, Picker). The
// popup is Material 3 Expressive's `DropdownMenuPopup`, which has no surface of its own.

internal data class MenuActionItem(
  val id: String,
  val title: String,
  val disabled: Boolean,
  val destructive: Boolean,
  val subtitle: String? = null,
  /** `null` for a plain row; otherwise a checkable row, and whether it is checked. */
  val checked: Boolean? = null,
  /**
   * The wire string (a drawable name or a `url:` string), never the artwork: this class is
   * compared by value and used as a `remember` key. [MenuRowIcons] resolves it.
   */
  val androidIcon: String? = null,
)

/** Drawn inline on Android, as a titled group. */
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
 * Children name their parent in `parentId` and are drawn by it. A submenu becomes a group
 * titled with its own title; an unknown `kind` draws nothing.
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
 * Adjacent top-level actions share one untitled group; each submenu and section is its own.
 * A group with neither a title nor a row is dropped.
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
 * One [NitroUiIconSlot] per row, keyed by row id. [apply] runs from `afterUpdate()`, the
 * only place artwork may be resolved: a lookup can take a lock or open a socket. A removed
 * row's slot is reset, which retires a file load still in flight.
 */
internal class MenuRowIcons {
  /** What the composition draws, per row id. Observed: a late file lands in it. */
  var slots by mutableStateOf<Map<String, NitroUiIconSlot>>(emptyMap())
    private set

  /** [items] is every row's `(id, androidIcon)` pair in menu order. */
  fun apply(
    items: List<Pair<String, String?>>,
    artwork: NitroUiIconArtwork,
  ) {
    val next = HashMap<String, NitroUiIconSlot>(items.size)
    for ((id, raw) in items) {
      if (raw == null) {
        continue
      }
      // A row keeps its slot and its loaded artwork, so an unchanged menu writes an equal
      // map, which `mutableStateOf` drops without recomposing.
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

  fun contentOf(
    id: String,
  ): NitroUiIconContent = slots[id]?.content ?: NitroUiIconContent.Absent

  /**
   * Test-only: `<id>#<RRGGBB>` for each row that drew a glyph. Material's icon colour comes
   * from the device's dynamic palette, so a test has to ask what was drawn. Written on the UI
   * thread in composition and read from any thread.
   */
  private val tints = ConcurrentHashMap<String, String>()

  fun noteTint(
    id: String,
    tint: ComposeColor,
  ) {
    tints[id] = tint.toRgbHex()
  }

  /** `-` when no row has drawn a glyph. */
  fun tintsReport(): String =
    if (tints.isEmpty()) {
      "-"
    } else {
      tints.entries.joinToString(",") { (id, hex) -> "$id#$hex" }
    }

  fun reset() {
    for (slot in slots.values) {
      slot.reset()
    }
    slots = emptyMap()
    tints.clear()
  }
}

/**
 * Pass this to Material only when the row has something to draw: a non-null but empty
 * `leadingIcon` still takes its slot and moves the label.
 */
@Composable
internal fun MenuRowIcon(content: NitroUiIconContent) {
  NitroUiIconSlotGlyph(content, MenuDefaults.LeadingIconSize)
}

/** The leading check of a checked row, shared with Picker. One lambda for the process. */
internal val MenuLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = nitroUiIcon(R.drawable.nitroui_check),
    contentDescription = null,
    modifier = Modifier.size(MenuDefaults.LeadingIconSize),
  )
}

/** Test tags that [describeMenuSemantics] finds groups and labels by. */
internal const val MENU_GROUP_TAG = "nitroui.menu.group"
internal const val MENU_GROUP_LABEL_TAG = "nitroui.menu.group.label"
internal const val MENU_TITLE_TAG = "nitroui.menu.title"

/**
 * One pickable row. A press is always a pick, never a local toggle: the menu holds no value,
 * so a row's check is whatever the app sends next. On a checkable row the check replaces
 * [icon] while the row is checked.
 */
@Composable
internal fun MenuRow(
  item: MenuActionItem,
  index: Int,
  count: Int,
  groupEnabled: Boolean,
  icon: NitroUiIconContent = NitroUiIconContent.Absent,
  onIconTint: ((ComposeColor) -> Unit)? = null,
  onPick: () -> Unit,
) {
  val enabled = groupEnabled && !item.disabled
  val text: @Composable () -> Unit = {
    Text(
      text = item.title,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      // Set on the text rather than through `MenuDefaults.itemColors()`, which allocates on
      // every recomposition. `Unspecified` keeps Material's own disabled colour.
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
  // `Absent` must reach Material as a `null` slot, or the empty slot still moves the label.
  val leadingIcon: (@Composable () -> Unit)? =
    if (icon == NitroUiIconContent.Absent) {
      null
    } else {
      {
        // Reported as it draws, for tests: the colour comes from the device's dynamic palette.
        onIconTint?.invoke(LocalContentColor.current)
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

/** A group's label or the menu's title: a heading to a screen reader, and not a row. */
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
 * Scrolls when the groups are taller than the window: `DropdownMenuPopup`'s column does
 * not scroll by itself. [menuTitle] is the first group's top label. [onRowsComposed] hears,
 * after each composition, how many pickable rows it drew.
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
              icon = icons.contentOf(item.id),
              onIconTint = { icons.noteTint(item.id, it) },
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

/** The menu window both menus open, with the [MenuWitness] first inside it. */
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
 * Set by the first test report or probe call. Until then the popup's semantics tree is not
 * walked on each layout, so an app never pays for it.
 */
internal object MenuDrawnWitness {
  @Volatile var wanted = false
}

/**
 * The open menu as its merged semantics tree, or `null` when [view] is not a composition
 * root. A row is `title[@subtitle]`, with `+` selected, `=` an unselected checkbox and `~`
 * disabled; a group is `(<label>:<rows>)` and the menu's title `#<title>`.
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

/** What a popup's witness reports to: the owning control's model. */
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

  /** The open popup's semantics tree ([describeMenuSemantics]). Kept after the popup closes. */
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
 * Composed first inside the open popup, where `LocalView` is the popup's own view. Counts
 * live popups, reports the window's frame, and tells the sink when the popup leaves the
 * composition so `expanded` cannot outlive it.
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
