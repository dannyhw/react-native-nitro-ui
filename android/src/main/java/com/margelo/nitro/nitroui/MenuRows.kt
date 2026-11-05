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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorPosition
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
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
import androidx.compose.ui.unit.dp
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
 * Material's `Icons.Filled.Check` (Apache 2.0, the 24-unit viewport), the leading check
 * of a checked menu row and of Picker's selected row.
 *
 * Written out because this library does not depend on `material-icons-core` for one
 * glyph - the geometry `HybridNitroUiChip.kt` writes out for its own check. Built once
 * per process and shared, because a hosted control is its own composition and
 * `remember` cannot share anything between two of them.
 */
private val MenuCheckIcon: ImageVector by lazy {
  ImageVector.Builder(
    name = "NitroUiMenuCheck",
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

/** The check, at Material's leading-icon size. One lambda for the process. */
internal val MenuLeadingCheck: @Composable () -> Unit = {
  Icon(
    imageVector = MenuCheckIcon,
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
 */
@Composable
internal fun MenuRow(
  item: MenuActionItem,
  index: Int,
  count: Int,
  groupEnabled: Boolean,
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
  if (checked != null) {
    CheckableDropdownMenuItem(
      checked = checked,
      onCheckedChange = { onPick() },
      text = text,
      shapes = shapes,
      checkedLeadingIcon = MenuLeadingCheck,
      supportingText = supportingText,
      enabled = enabled,
    )
  } else {
    DropdownMenuItem(
      onClick = onPick,
      text = text,
      shape = shapes.shape,
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
 */
@Composable
internal fun MenuGroups(
  entries: List<MenuEntry>,
  menuTitle: String?,
  enabled: Boolean,
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
