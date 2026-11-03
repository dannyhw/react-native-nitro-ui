package com.margelo.nitro.nitroui

import android.view.View
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.concurrent.atomic.AtomicInteger

/*
 * The rows of a Material 3 menu, shared by `Menu` and `ContextMenu` (DECISIONS D36 item
 * 4): the parsed shape of the wrapper's flat `NitroUiMenuRow` array, the row and header
 * composables, the entries loop that lays them out (a submenu inline under a divider,
 * D29), and the popup's witness. Both menus draw the same rows from the same array, so a
 * change here is a change to both, and both harness suites re-run for it.
 *
 * Moved out of `HybridNitroUiMenu.kt` unchanged; only the witness gained an interface,
 * because its two owners keep their popup bookkeeping in different models.
 */

/** One pickable row, as the popup draws it. */
internal data class MenuActionItem(
  val id: String,
  val title: String,
  val disabled: Boolean,
  val destructive: Boolean,
)

/** A row that opens a second level - which on Android does not: see [MenuModel.entries]. */
internal data class MenuSubmenuItem(
  val id: String,
  val title: String,
  val items: List<MenuActionItem>,
)

/** A titled group. A null [title] is a group that is only a divider. */
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
 * becomes a divider, a header and its items inline (D29); a section becomes the same
 * with its own title, or just a divider when it has none. An unknown `parentId`
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

/**
 * The widest any one child of a `Menu`'s popup may ask to be.
 *
 * Material caps a *row* at 280 dp (`DropdownMenuItemDefaultMaxWidth`, which
 * `DropdownMenuItemContent` puts in the row's own `sizeIn`), and the popup's width is
 * whatever its widest child wants now that it no longer matches the trigger's. So a
 * child that is not a row needs the same cap or it becomes the one thing that can
 * stretch the list: that was `MenuHeader`, whose submenu title could be any length.
 * Material's own token is private, so this is the one number in this file that mirrors
 * a constant instead of reading it, and `Menu.harness.tsx`'s cap assertion is what says
 * it still matches.
 */
internal val MENU_CONTENT_MAX_DP = 280.dp

/** One pickable row of the list. */
@Composable
internal fun MenuRow(
  item: MenuActionItem,
  groupEnabled: Boolean,
  onPick: () -> Unit,
) {
  DropdownMenuItem(
    text = {
      Text(
        text = item.title,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        // Destructive rows are the scheme's error colour. Set on the text rather
        // than through `MenuDefaults.itemColors()`, which Q1 §4 names as a
        // per-recomposition allocation; `Color.Unspecified` for a disabled row
        // keeps Material's own disabled treatment.
        color =
          if (item.destructive && !item.disabled) {
            MaterialTheme.colorScheme.error
          } else {
            ComposeColor.Unspecified
          },
      )
    },
    onClick = onPick,
    enabled = groupEnabled && !item.disabled,
  )
}

/**
 * A group's title: drawn, and deliberately not a row.
 *
 * The width cap is the same one the rows live under. A header is not a `Row`, so it
 * does not inherit a row's measure, and once the popup stopped matching the trigger's
 * width its width is whatever its widest child asks for - so an uncapped header was the
 * one child that could stretch the list past the width a Material menu is meant to
 * stop at. Ellipsised like a row, because a header that cannot be read in full is a
 * worse outcome than a menu that cannot say the whole name.
 */
@Composable
internal fun MenuHeader(title: String) {
  Text(
    text = title,
    style = MaterialTheme.typography.labelSmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier = Modifier
      .widthIn(max = MENU_CONTENT_MAX_DP)
      .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
  )
}

/**
 * The menu's rows, in order: an action is a row; a submenu is a divider, its title as a
 * header and its items inline (D29); a section is a divider, its title when it has one,
 * and its items. A header draws as a header rather than as a row that does nothing,
 * because a row that does nothing reads as a bug to the person using a screen reader.
 *
 * [onRowsComposed] hears how many pickable rows *this* composition drew, published after
 * the composition rather than written during it: the witness for a `group` that changed
 * while the menu was open.
 */
@Composable
internal fun MenuEntries(
  entries: List<MenuEntry>,
  enabled: Boolean,
  onPick: (String) -> Unit,
  onRowsComposed: (Int) -> Unit,
) {
  var pickableRows = 0
  for (entry in entries) {
    when (entry) {
      is MenuEntry.Action -> {
        pickableRows += 1
        MenuRow(
          item = entry.item,
          groupEnabled = enabled,
          onPick = { onPick(entry.item.id) },
        )
      }
      is MenuEntry.Submenu -> {
        // D29: the items come inline under a divider, and the submenu's own
        // title becomes the header. It draws as a header rather than as a
        // row that does nothing, because a row that does nothing reads as a
        // bug to the person using a screen reader.
        HorizontalDivider()
        MenuHeader(entry.item.title)
        for (item in entry.item.items) {
          pickableRows += 1
          MenuRow(
            item = item,
            groupEnabled = enabled,
            onPick = { onPick(item.id) },
          )
        }
      }
      is MenuEntry.Section -> {
        HorizontalDivider()
        if (entry.item.title != null) {
          MenuHeader(entry.item.title)
        }
        for (item in entry.item.items) {
          pickableRows += 1
          MenuRow(
            item = item,
            groupEnabled = enabled,
            onPick = { onPick(item.id) },
          )
        }
      }
    }
  }
  // How many pickable rows *this* popup composed, published after the
  // composition rather than written during it: the witness for a `group` that
  // changed while the menu was open.
  SideEffect { onRowsComposed(pickableRows) }
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
