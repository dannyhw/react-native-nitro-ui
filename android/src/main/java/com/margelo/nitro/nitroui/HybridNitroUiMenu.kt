package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/*
 * The Menu component: a button that opens a list of actions. The trigger is the
 * same Material 3 button the `Button` component draws - same variant switch, same
 * colours cache, same label style and content padding, so the box *is* a Button's
 * box (`docs/components/menu.md`) - and the list is a `DropdownMenu`, which is a
 * Compose `Popup` with a `PopupWindow` of its own.
 *
 * The popup engineering is `HybridNitroUiPicker.kt`'s, because it is the same
 * problem H2b solved: a window that belongs to a composition has to agree with a
 * box React Native moves under it (`docs/components/host.md`), it has to be
 * witnessed rather than assumed (`MenuWitness`), and its a11y has to be one node
 * (`clearAndSetSemantics`, G6 review M3). What is new here is only that a submenu's
 * items come inline under a divider instead of nesting: a second popup needs a
 * second anchor and a second witness, and DECISIONS D29 spends this round on the
 * divider instead.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
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

/** State of one Menu. See [NitroUiModel] for the shape this has to have. */
internal class MenuModel : NitroUiModel() {
  /** The trigger's label. Observed: it is what the trigger draws and sizes. */
  var title by mutableStateOf("")

  /** The trigger's role. Observed, and shared with `Button` by name and by number. */
  var variant by mutableStateOf(ButtonVariant.Filled)

  /** The trigger's scale, same enum `Button` uses. */
  var scale by mutableStateOf(ButtonScale.Medium)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB int of the trigger's accent, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * The trigger's SF Symbol name. Stored, never drawn.
   *
   * `systemImage` is iOS-only (the name is a symbol name, and Material has no
   * symbol set to map it onto), which is what `docs/components/menu.md` says and what
   * `Button` already does with the same prop. It is kept here so the prop round-trips
   * through the handle like every other one, and so the answer cannot drift from the
   * documentation without the harness noticing.
   */
  var systemImage by mutableStateOf<String?>(null)

  /** The items, as the popup draws them. Observed: writing them recomposes the list. */
  var entries by mutableStateOf<List<MenuEntry>>(emptyList())

  /**
   * The last array the `rows` setter was handed, kept for that setter's own
   * equality guard.
   *
   * Not observed and never drawn: [entries] is what Compose reads. Keeping the
   * source array rather than re-deriving it is what lets the guard be a
   * `contentEquals` over structs with value equality.
   */
  var rawRows: Array<NitroUiMenuRow> = emptyArray()

  /**
   * Whether a `primaryAction` was passed. Stored, never used.
   *
   * iOS reads it to choose `Menu`'s other `init` - tap acts, long-press opens. On
   * Android a tap opens and the callback is never called, so the flag has no
   * Compose-side meaning; keeping it costs one field and keeps the prop's round-trip
   * honest.
   */
  var hasPrimaryAction by mutableStateOf(false)

  /** `accessibilityLabel`, on the trigger - the rows are in a window of their own. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /** Whether the popup is showing. The one piece of this outside the host's window. */
  var expanded by mutableStateOf(false)

  /** `nuiSizingKey`, which the engine reads out of Fabric state itself. */
  var sizingKey = ""

  var onSelect: ((String) -> Unit)? = null

  /** Whether the menu opened. Android calls this; iOS cannot (see its `onOpen`). */
  var onOpen: (() -> Unit)? = null

  /** Whether the menu closed. Android calls this; iOS cannot (see its `onOpen`). */
  var onClose: (() -> Unit)? = null

  /** Never called on Android. See [hasPrimaryAction]. */
  var primaryAction: (() -> Unit)? = null

  // --- Popup geometry, for `nuiTestMenuReport`. None of it is rendered from. ---

  /** The anchor's box inside the composition's own view, in px, or -1 unread. */
  private var anchorLeft = -1f
  private var anchorTop = -1f
  private var anchorRight = -1f
  private var anchorBottom = -1f

  /** Where the composition's own view sits on screen, or -1 unread. */
  private var compositionLeft = -1
  private var compositionTop = -1

  /** The open menu's window on screen, or -1 when no menu is composed. */
  private var menuLeft = -1
  private var menuTop = -1
  private var menuRight = -1
  private var menuBottom = -1

  /** How many rows the menu listed at its last recomposition. */
  private var menuRowCount = 0

  /** The popup's view, for as long as its composition group is composed. */
  private var menuView: View? = null

  private val reportLock = Any()

  /**
   * The rows a pick can name - what `nuiTestMenuReport` answers for `rows`.
   *
   * A submenu's children count and its parent row does not, because the parent is not
   * pickable here (it draws a header), which is the same answer [applyPick] gives.
   */
  val actionableRowCount: Int
    get() {
      var count = 0
      for (entry in entries) {
        when (entry) {
          is MenuEntry.Action -> count += 1
          is MenuEntry.Submenu -> count += entry.item.items.size
          is MenuEntry.Section -> count += entry.item.items.size
        }
      }
      return count
    }

  /**
   * Open or close the menu, and report the change once.
   *
   * The single writer for `expanded` that a *gesture or a rule* causes, so the two
   * halves of the observed-state promise cannot come apart: every `onOpen` is
   * followed by exactly one `onClose`, including when the close is caused by a pick,
   * by the control being disabled (D29), by the anchor moving, or by the popup's
   * composition going away. Idempotent by the transition test rather than by each
   * caller remembering whether it already closed, which is why the anchor's press,
   * `menuAnchor`'s own press handling and Material's dismissal callbacks can all
   * report the same request without the harness seeing it twice.
   *
   * [reset] writes `expanded` directly: a recycled control has no mount left to
   * report a close to.
   */
  fun setOpen(
    open: Boolean,
  ) {
    if (expanded == open) {
      return
    }
    expanded = open
    if (open) {
      onOpen?.invoke()
    } else {
      onClose?.invoke()
    }
  }

  /** Record the anchor's box, and close an open menu if that box moved. */
  fun noteAnchorBox(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    val moved = anchorMoved(anchorLeft, anchorTop, left, top)
    anchorLeft = left
    anchorTop = top
    anchorRight = right
    anchorBottom = bottom
    if (moved) {
      dropOpenMenu()
    }
  }

  /** Record where the composition's own view is on screen - px. UI-thread only. */
  fun noteCompositionOrigin(
    left: Int,
    top: Int,
  ) {
    val moved =
      anchorMoved(
        compositionLeft.toFloat(),
        compositionTop.toFloat(),
        left.toFloat(),
        top.toFloat(),
      )
    compositionLeft = left
    compositionTop = top
    if (moved) {
      dropOpenMenu()
    }
  }

  /**
   * A box that *moved*, as opposed to one being read for the first time (-1) or changing
   * size in place. See `PickerModel.anchorMoved` - same rule, same reason.
   */
  private fun anchorMoved(
    wasLeft: Float,
    wasTop: Float,
    left: Float,
    top: Float,
  ): Boolean = wasLeft >= 0f && (wasLeft != left || wasTop != top)

  /** The anchor moved so the window under it would point at the wrong place: down it goes. */
  private fun dropOpenMenu() {
    if (menuView != null && expanded) {
      setOpen(false)
    }
  }

  /** Record where the open menu's window is on screen. */
  fun noteMenuFrame(
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    menuLeft = left
    menuTop = top
    menuRight = right
    menuBottom = bottom
  }

  /** Forget the menu's rect: no popup of this mount is composed any more. */
  fun clearMenuFrame() {
    menuLeft = -1
    menuTop = -1
    menuRight = -1
    menuBottom = -1
    menuRowCount = 0
  }

  /** How many rows the menu is listing. */
  fun noteMenuRows(rows: Int) {
    menuRowCount = rows
  }

  /** The open menu's view, for as long as its composition group is composed. */
  fun noteMenuView(view: View?) {
    menuView = view
  }

  /**
   * Re-read the open menu's window after the composition's own view moved.
   *
   * A window moved by the window manager does not re-run its view's `layout()`, so the
   * witness's listener stays quiet and the published rect would be where the menu was
   * last laid out. Same as `PickerModel.refreshMenuFrame`.
   */
  fun refreshMenuFrame(where: IntArray) {
    val view = menuView ?: return
    view.getLocationOnScreen(where)
    noteMenuFrame(where[0], where[1], where[0] + view.width, where[1] + view.height)
  }

  /**
   * `expanded=<0|1>;live=<n>;anchor=<l>,<t>,<r>,<b>;menu=<l>,<t>,<r>,<b>;rows=<n>`.
   *
   * The anchor half is the composition-relative box plus the composition's own place on
   * screen, summed here rather than stored. Formatted under a lock because the seam may
   * be called from the JS thread while the UI thread writes the fields; the `live` half
   * is process-wide because a mount dropped mid-menu has nothing left to ask (`Q3` §2 is
   * why a harness assertion then reads a *delta* of it, not a number).
   */
  fun readMenuReport(): String {
    val open = expanded
    val live = liveMenus.get()
    val boxLeft = anchorLeft
    val boxTop = anchorTop
    val boxRight = anchorRight
    val boxBottom = anchorBottom
    val originLeft = compositionLeft
    val originTop = compositionTop
    val anchored = boxLeft >= 0f && originLeft >= 0
    return synchronized(reportLock) {
      "expanded=${if (open) 1 else 0};live=$live" +
        ";anchor=" +
        if (anchored) {
          "${(boxLeft + originLeft).toInt()},${(boxTop + originTop).toInt()}," +
            "${(boxRight + originLeft).toInt()},${(boxBottom + originTop).toInt()}"
        } else {
          "-1,-1,-1,-1"
        } +
        ";menu=$menuLeft,$menuTop,$menuRight,$menuBottom;rows=$menuRowCount" +
        // `nuiTestMenuProbe`'s field, which only iOS can answer (see that method).
        ";drawn=-1"
    }
  }

  /**
   * A row was picked, however it was picked.
   *
   * The choice is reported first and the popup closes after it (DECISIONS D32), so a
   * listener that acts on the pick is never handed a menu that is still up. The
   * close itself happens on every path - a pick, a disabled control, a disabled row,
   * a submenu header and an unknown id all take the window down, because a press is a
   * press and the menu must not survive one. Only the reporting is refused: a disabled
   * control, a disabled row, a submenu header and an unknown id report nothing, and a
   * submenu header is not in [entries] as a pickable row at all. There is no value to
   * store and no handshake to answer: [onSelect] reports a gesture and that is the end
   * of it (`docs/architecture/core.md` section 12).
   *
   * Which is why the close is the one statement outside the refusal branches rather
   * than a line in each of them: a press that reports nothing still takes the window
   * down, and `MenuModelTest` in `android/src/test` keeps it that way.
   */
  fun applyPick(id: String) {
    if (enabled) {
      for (entry in entries) {
        val candidates: List<MenuActionItem> =
          when (entry) {
            is MenuEntry.Action -> listOf(entry.item)
            is MenuEntry.Submenu -> entry.item.items
            is MenuEntry.Section -> entry.item.items
          }
        val row = candidates.firstOrNull { it.id == id } ?: continue
        if (!row.disabled) {
          onSelect?.invoke(row.id)
        }
        break
      }
    }
    setOpen(false)
  }

  override fun reset() {
    // First, ahead of the rows and the trigger (`docs/tasks/Q1-menu-design.md` §5): a
    // popup that survived a recycle would hang over the next row's content, and the
    // next mount would find it already open. Everything below is closed by the time
    // this model answers anything again.
    expanded = false
    title = ""
    variant = ButtonVariant.Filled
    scale = ButtonScale.Medium
    enabled = true
    tintColor = null
    systemImage = null
    entries = emptyList()
    rawRows = emptyArray()
    hasPrimaryAction = false
    accessibilityLabel = null
    clearMenuFrame()
    anchorLeft = -1f
    anchorTop = -1f
    anchorRight = -1f
    anchorBottom = -1f
    compositionLeft = -1
    compositionTop = -1
    menuView = null
    sizingKey = ""
    onSelect = null
    onOpen = null
    onClose = null
    primaryAction = null
  }

  companion object {
    /**
     * How many menus this process has open right now.
     *
     * Process-wide rather than per mount for the reason `PickerModel.liveMenus` gives:
     * the property under test is "no popup outlives the composition that opened it",
     * and a mount dropped mid-menu cannot report its own leak. [MenuHost.MenuWitness]
     * counts itself in a `DisposableEffect`, and a harness assertion reads the *change*
     * in this rather than the number (Q3 section 2), because other mounted controls
     * share the process.
     */
    val liveMenus = AtomicInteger(0)
  }
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
private val MENU_CONTENT_MAX_DP = 280.dp

/**
 * The Menu's host: [NitroComposeHost] plus this component's composable.
 *
 * [Component] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class MenuHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: MenuModel,
) : NitroComposeHost<MenuModel>(context, activity, model) {

  /**
   * A `<Host>` composes this control, popup and all.
   *
   * The allowlist line the other controls have, with the matching JS row in
   * `src/components/Host/HostChildren.ts`. What it buys here is the harder claim
   * Picker's line makes, because a Menu's whole reason to exist is its list: the
   * list is a window, and a window opened from inside a shared composition has to
   * agree with a rectangle React Native moves. `example/__tests__/Menu.harness.tsx`
   * measures that pair for a hosted Menu, the way `HostPopups.harness.tsx` does for
   * a hosted Picker.
   */
  override val isHostable: Boolean
    get() = true

  /**
   * The user picked the row named [id].
   *
   * The one entry point for "a row was pressed", so a real row and the
   * `nuiTestSelectRow` hook cannot diverge. Nothing is held against the next
   * batch: unlike a Picker's pick, a Menu pick paints nothing that changes the
   * trigger's box - the title is the same before and after - so there is no late
   * size report to file against the right content
   * (`NitroComposeHost.holdSizingReports`).
   */
  fun choose(id: String) {
    model.applyPick(id)
  }

  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  override fun Component(model: MenuModel) {
    val entries = model.entries
    val expanded = model.expanded
    val enabled = model.enabled
    val accessibilityLabel = model.accessibilityLabel
    // The trigger's name: an explicit `accessibilityLabel`, else the visible
    // `title`. The rows are in a window of their own, so the label belongs here.
    val spokenLabel = accessibilityLabel ?: model.title
    // The view that owns *this composition*: the control's own when it is mounted
    // alone, the `<Host>`'s `AndroidComposeView` when it is hosted. Everything the
    // popup has to agree with is read relative to it, which is why one reading
    // serves both cases (`HybridNitroUiPicker.Component` walks it for the same
    // reason, and `placedViewOf` says why the listener cannot live on this view).
    val compositionView = LocalView.current
    val screenPoint = remember(compositionView) { IntArray(2) }
    val placedView = remember(compositionView) { placedViewOf(compositionView) }
    DisposableEffect(placedView) {
      val listener =
        View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
          compositionView.getLocationOnScreen(screenPoint)
          model.noteCompositionOrigin(screenPoint[0], screenPoint[1])
          model.refreshMenuFrame(screenPoint)
        }
      compositionView.getLocationOnScreen(screenPoint)
      model.noteCompositionOrigin(screenPoint[0], screenPoint[1])
      placedView.addOnLayoutChangeListener(listener)
      onDispose { placedView.removeOnLayoutChangeListener(listener) }
    }
    // An anchor that opens a popup, rather than `Modifier.clickable` beside a plain
    // `DropdownMenu`. The reason is Material's contract: `ExposedDropdownMenuBox` hands
    // the popup the *anchor's* rectangle, while a plain `DropdownMenu` is positioned
    // against its container. G7b tried to reproduce the second form's mis-anchoring
    // inside a `<Host>` four ways (the anchor dropped inside the box, a `clickable` +
    // `DropdownMenu`, that pair inside a `fillMaxSize` Box, and a 300 dp
    // `Modifier.offset` on the list's content) and none of them moved the popup's
    // window off the button, so on this Material version (1.4.0) the mis-anchoring this
    // anchor exists to prevent does not reproduce. `menuAnchor` stays because it is the
    // documented way to say "positioned against *this* control" rather than relying on
    // what a container happens to be, and `Menu.harness.tsx` bounds the gap so a
    // Material that does move the popup is caught: a plain `DropdownMenu` with
    // `offset = DpOffset(0.dp, 64.dp)` moves the window and turns that bound red,
    // which is what shows the reading is live. Numbers and both mutant recipes are in
    // `example/__tests__/Menu.harness.tsx` and `docs/tasks/G7b-menu-finish.report.md`.
    ExposedDropdownMenuBox(
      expanded = expanded,
      // The anchor reports the request, including the dismissals it decides on
      // itself - outside tap and the back gesture - and stops reporting for an
      // anchor whose `enabled` went false.
      onExpandedChange = { request ->
        model.setOpen(request && enabled)
      },
    ) {
      val anchorModifier =
        Modifier
          .menuAnchor(
            ExposedDropdownMenuAnchorType.PrimaryNotEditable,
            enabled = enabled,
          )
          .onGloballyPositioned { coordinates ->
            // Where the trigger ended up, inside the composition's own view: the
            // space a popup is positioned in. A layout callback, so it costs no
            // recomposition and writes no observed state.
            val box = coordinates.boundsInRoot()
            model.noteAnchorBox(box.left, box.top, box.right, box.bottom)
          }
          // One accessibility node, carrying name, value, role and state - the
          // `clearAndSetSemantics` fix, not `semantics`, for the reason
          // `HybridNitroUiPicker` records from `uiautomator dump` (G6 review M3):
          // the M3 button's own node would be a second, nameless focus stop. The
          // clear also drops the action the anchor contributes, so it is restated
          // here; pointer input is untouched.
          .clearAndSetSemantics {
            contentDescription = spokenLabel
            this[SemanticsProperties.Text] = listOf(AnnotatedString(model.title))
            stateDescription = if (model.expanded) "expanded" else "collapsed"
            role = Role.DropdownList
            if (enabled) {
              onClick {
                model.setOpen(true)
                true
              }
            } else {
              disabled()
            }
          }
      NitroUiM3Button(
        title = model.title,
        variant = model.variant,
        scale = model.scale,
        enabled = enabled,
        tint = model.tintColor,
        modifier = anchorModifier,
        // A tap opens the list. With a `primaryAction` passed, iOS runs that on tap
        // and opens on a long-press; Material 3 has no such split, so Android always
        // opens and never calls the callback (`docs/components/menu.md`).
        onClick = { model.setOpen(true) },
      )
      // `matchAnchorWidth = false`, which switches off the `exposedDropdownSize()`
      // this call would otherwise get *inside* Material: that modifier sets
      // `minWidth = maxWidth = anchorWidth`, so with the default the list came back
      // exactly as wide as the button and any label longer than the title lost its
      // tail. Left to its content, the list is as wide as its items need — between
      // Material's own 112 dp floor and the 280 dp a row's content caps at — which
      // is what iOS's menu does.
      ExposedDropdownMenu(
        expanded = expanded,
        matchAnchorWidth = false,
        onDismissRequest = {
          // Everything that closes a popup without a choice: outside tap, the
          // system back gesture, the composition going away.
          model.setOpen(false)
        },
      ) {
        // Must be first: it reads `LocalView`, which inside this lambda is the
        // *popup's* view.
        MenuWitness(model)
        var pickableRows = 0
        for (entry in entries) {
          when (entry) {
            is MenuEntry.Action -> {
              pickableRows += 1
              MenuRow(
                item = entry.item,
                groupEnabled = enabled,
                onPick = { choose(entry.item.id) },
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
                  onPick = { choose(item.id) },
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
                  onPick = { choose(item.id) },
                )
              }
            }
          }
        }
        // How many pickable rows *this* popup composed, published after the
        // composition rather than written during it: the witness for a `group` that
        // changed while the menu was open.
        SideEffect { model.noteMenuRows(pickableRows) }
      }
    }
  }

  /** One pickable row of the list. */
  @Composable
  private fun MenuRow(
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
  private fun MenuHeader(title: String) {
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
   * The popup's own witness, composed only while the menu is open.
   *
   * The three jobs are `PickerHost.MenuWitness`'s, unchanged: prove there is a menu
   * ([MenuModel.liveMenus], process-wide, so a mount dropped mid-menu cannot hide a
   * leak), say where its window is, and make sure `expanded` does not survive a
   * popup that already left the composition. The last one is why a hosted Menu that
   * leaves and re-enters its Host's child list does not open a window nobody asked
   * for.
   */
  @Composable
  private fun MenuWitness(model: MenuModel) {
    val menuView = LocalView.current
    DisposableEffect(menuView) {
      val live = MenuModel.liveMenus
      live.incrementAndGet()
      val where = IntArray(2)
      model.noteMenuView(menuView)
      val listener =
        View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
          view.getLocationOnScreen(where)
          model.noteMenuFrame(
            where[0],
            where[1],
            where[0] + view.width,
            where[1] + view.height,
          )
        }
      menuView.addOnLayoutChangeListener(listener)
      onDispose {
        menuView.removeOnLayoutChangeListener(listener)
        model.noteMenuView(null)
        model.clearMenuFrame()
        live.decrementAndGet()
        model.setOpen(false)
      }
    }
  }
}

/** The Hybrid View React renders as `NitroUiMenu`. */
class HybridNitroUiMenu(
  reactContext: ThemedReactContext,
) : HybridNitroUiMenuSpec(), RecyclableView {

  private val model = MenuModel()
  private val host = MenuHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which is
    // the point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiMenuComponentName`
     * in the generated C++, and `getName()` in the generated manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiMenu"

    /**
     * The size to lay a Menu out with before anything has been measured, in dp.
     *
     * One pair for the component, which is all the engine can hold, and the trigger
     * is a Button's box - so the same shape of guess applies: this is a medium
     * filled trigger with a five-letter title. `docs/components/menu.md` has the
     * measured table.
     *
     * Deliberately *not* the fixture's measured size: a fallback that equals the
     * answer makes a failed correction invisible (AGENTS.md, quality bar). The
     * harness's sizing test measures a `Short` trigger and asserts the box is not
     * these numbers as well as that it is the measured ones.
     */
    private const val FALLBACK_WIDTH_DP = 118.0
    private const val FALLBACK_HEIGHT_DP = 52.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process, before the first Menu can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a
     * Fabric measure can happen before this class has ever been instantiated, so a
     * fallback declared from `init` is one measure too late for the first instance
     * (T14) - and from `init` as the backstop. The two calls land on different
     * threads, hence the atomic.
     */
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
  // Setters only store and mark dirty; everything observable is applied by Compose's
  // own recomposition once `afterUpdate()` commits the batch.

  override var title: String
    get() = model.title
    set(next) {
      if (next == model.title) {
        return
      }
      model.title = next
      // The trigger's label decides its width, and Compose's next measure reports
      // the new size - Android needs no explicit "the size may have moved" call.
      host.markDirty()
    }

  override var variant: String
    get() = model.variant.wireName
    set(next) {
      val resolved = ButtonVariant.from(next)
      if (resolved == model.variant) {
        return
      }
      model.variant = resolved
      host.markDirty()
    }

  override var size: String
    get() = model.scale.wireName
    set(next) {
      val resolved = ButtonScale.from(next)
      if (resolved == model.scale) {
        return
      }
      model.scale = resolved
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
      if (!enabled) {
        // D29: a disabled Menu is not showing a list. Reported through the funnel
        // so the app that opened it also hears it close.
        //
        // `menuAnchor(enabled = false)` also stops the popup being composed, so a
        // mutation of this line alone may well leave the gate green - the gate is an
        // outcome gate ("a disabled control is not showing a list of choices"). The
        // write stays because it is what makes that the control's rule rather than
        // the widget library's, and because this control's own `expanded` is what
        // `nuiTestMenuReport` answers. Same reasoning `HybridNitroUiPicker.disabled`
        // records, including that it was not measured as the sole route.
        model.setOpen(false)
      }
      // Repaints only: a disabled control is the same size.
      host.markDirty()
    }

  override var rows: Array<NitroUiMenuRow>
    get() = model.rawRows
    set(next) {
      // Content, not identity: React re-sends the array whenever the caller rebuilds
      // it, and an equal menu must not cost a recomposition. `Menu.tsx` keeps the
      // identity stable for exactly this, and the generated C++ compares the
      // converted vector before calling at all - this is the third guard, cheap
      // because the row structs have value equality.
      if (next.contentEquals(model.rawRows)) {
        return
      }
      model.rawRows = next
      model.entries = parseMenuRows(next)
      // The list is a window: it never changes the trigger's box, so no sizing
      // signal - only the popup's content, and only when the popup is composed.
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var systemImage: Variant_NullType_String
    get() =
      model.systemImage?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never rendered: v0.1 ignores the SF Symbol on Android
      // (`docs/components/menu.md`). No `markDirty()` - nothing observes it.
      model.systemImage = next.asSecondOrNull()
    }

  override var hasPrimaryAction: Boolean
    get() = model.hasPrimaryAction
    set(next) {
      // Stored, never used: iOS chooses `Menu`'s other `init` from it (tap acts,
      // long-press opens). Material 3 has no such split, so on Android a tap opens
      // and the callback is never called.
      model.hasPrimaryAction = next
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // Same as RN's own `BaseViewManager.setTestID`: the tag is what
    // `findNodeByName`/testID matchers read on Android.
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val text = next.asSecondOrNull()
      if (text == model.accessibilityLabel) {
        return
      }
      // Rendered, not bookkeeping: the label goes on the trigger's semantics node,
      // so it needs a commit or a late-set label never reaches TalkBack.
      model.accessibilityLabel = text
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
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback; the new configuration may measure exactly what the old
      // one did, and that is the size the host's dedupe would swallow the correcting
      // report against (F1). Guarded, because React re-sends an unchanged key.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId =
        if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onSelect: ((id: String) -> Unit)?
    get() = model.onSelect
    set(next) {
      model.onSelect = next
    }

  override var onOpen: (() -> Unit)?
    get() = model.onOpen
    set(next) {
      model.onOpen = next
    }

  override var onClose: (() -> Unit)?
    get() = model.onClose
    set(next) {
      model.onClose = next
    }

  override var primaryAction: (() -> Unit)?
    get() = model.primaryAction
    set(next) {
      // Stored, never called: see [hasPrimaryAction].
      model.primaryAction = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // No controlled value and no handshake, so there is nothing to reconcile: one
    // commit per React commit (`docs/architecture/core.md` section 12). A pick
    // changes no rendered box either, so no size report is held against a batch.
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // `host.perfInstanceId` is cleared inside `host.prepareForRecycle()`, after it has
    // marked the recycle: clearing it here would hide that mark.
    // `host.sizingPolicy` is not reset: this control never changes it, so a recycled
    // host cannot be left on another policy - unlike Picker's, whose `wheel` variant
    // does. What does get reset is the model, by `host.prepareForRecycle()`, and the
    // first field it clears is `expanded`.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onSelect = null
    model.onOpen = null
    model.onClose = null
    model.primaryAction = null
    // Ends the composition, which dismisses the popup with it - the one "unmount
    // while the menu is open" case that has to hold on both platforms.
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this control, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (core.md section 5).
   */
  override fun measureContent(): NitroUiMenuSize {
    val size = host.contentSize ?: return NitroUiMenuSize(0.0, 0.0)
    return NitroUiMenuSize(size.width, size.height)
  }

  /**
   * Press the row named [id], through the same path a real row press takes.
   *
   * Test-only; see the spec for why it exists. Props arrive on the UI thread and a
   * `hybridRef` call can arrive on the JS thread; the model is UI-thread state, so
   * this hops when needed and runs inline when the call is already where the model
   * lives. Never a synchronous wait: JS must not block on the UI thread.
   *
   * It presses a *row*, not the trigger: the injector reaches the app's window and
   * stops there, so opening is a real press on the anchor and only the list inside
   * the popup's own window needs a hook.
   */
  override fun nuiTestSelectRow(id: String) {
    val run = {
      host.choose(id)
      // The half a press gets for free: its handler runs inside Compose's input
      // handling, which applies the snapshot the handler wrote. This is a plain
      // UI-thread post, so without the apply the pick would not paint until the next
      // props batch - a different ordering from a press, which is the one thing a
      // test hook may not be.
      host.applyModelWrites()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  /**
   * What the popup and its anchor are, as the composition measured them.
   *
   * Test-only; see `NitroUiMenuMethods.nuiTestMenuReport` for the format and for why
   * a hosted popup needs a witness of its own. Reads a lock-protected snapshot of a
   * few integers, so it is safe on the JS thread and never waits for the UI thread.
   */
  override fun nuiTestMenuReport(): String = model.readMenuReport()

  /**
   * A no-op here: the probe asks iOS's second renderer (UIKit's `UIMenu`) what it
   * built, and Android has none - `rows` in the report is already counted from the
   * rows the popup composed, so `drawn` answers `-1`. See
   * `NitroUiMenuMethods.nuiTestMenuProbe`.
   */
  override fun nuiTestMenuProbe() = Unit
}
