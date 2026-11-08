package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiPixelProbes
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/*
 * The Menu component: a button that opens a list of actions. The trigger is the
 * same Material 3 button the `Button` component draws - same variant switch, same
 * colours cache, same label style and content padding, so the box *is* a Button's
 * box (`docs/components/menu.md`) - and the list is Material 3 Expressive's
 * `DropdownMenuPopup` (E2), a Compose `Popup` with a `PopupWindow` of its own, drawn
 * as groups by `MenuRows.kt`'s shared [MenuGroups].
 *
 * The popup engineering is `HybridNitroUiPicker.kt`'s, because it is the same
 * problem H2b solved: a window that belongs to a composition has to agree with a
 * box React Native moves under it (`docs/components/host.md`), it has to be
 * witnessed rather than assumed (`MenuWitness`), and its a11y has to be one node
 * (`clearAndSetSemantics`, G6 review M3). What is new here is only that a submenu's
 * items come inline as a group of their own instead of nesting: a second popup needs
 * a second anchor and a second witness, and DECISIONS D29 spends that round on the
 * inline form instead.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one Menu. See [NitroUiModel] for the shape this has to have. */
internal class MenuModel : NitroUiModel(), MenuWitnessSink {
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

  /**
   * The trigger's Android glyph, in the wire form the wrapper built: a resource name,
   * or a `url:` string for a file to read (`NitroUiIconSource`).
   *
   * The same string `Button` is sent and resolved the same way, because the trigger
   * *is* a [NitroUiM3Button] — `docs/components/menu.md` promises a Menu's box is a
   * Button's box, and the glyph is the one thing about that box a Menu used to be
   * unable to ask for. Stored, not observed: the composition reads [androidIconContent].
   */
  var androidIcon: String? = null

  /**
   * Everything derived from [androidIcon] — the same [NitroUiIconSlot] `ButtonModel`
   * uses, so the rules about when an icon is resolved, when its slot is reserved, and
   * when a late answer has been retired by a recycle are written once for both
   * controls. See that class for the rules.
   */
  val iconSlot = NitroUiIconSlot()

  /** What the trigger lays its label next to. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  /** Apply [androidIcon] if it is not what [androidIconContent] already is. */
  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

  /**
   * The rows' `androidIcon`s, resolved, for this menu.
   *
   * One slot per row that asked for a glyph, not one slot for the menu: twenty rows can
   * name twenty different files, and a file arrives on its own schedule, so the row that
   * is waiting cannot share a slot with the row that already drew. The rows arrive as
   * one struct array, which is why this is keyed by row id rather than held on each
   * [MenuActionItem] - the item is compared by value and `remember`ed as a list key,
   * and artwork has neither.
   *
   * [resolveRowIcons] feeds it, from `afterUpdate()` only.
   */
  val rowIcons = MenuRowIcons()

  /**
   * Resolve every action row's `androidIcon`, once per change.
   *
   * Only action rows: Android draws a submenu's parent as its group's label and a
   * section's header as a label too, and a Material group label has no leading slot for
   * a glyph to live in - which is why `docs/components/menu.md` calls a submenu's
   * `androidIcon` iOS-only. Reading the glyph of a row nobody draws would open a socket
   * for artwork nobody sees.
   */
  fun resolveRowIcons(
    artwork: NitroUiIconArtwork,
  ) {
    rowIcons.apply(
      rawRows
        .filter { row -> row.kind == "action" }
        .map { row -> row.id to row.androidIcon?.asSecondOrNull() },
      artwork,
    )
  }

  /** The probe pair for the trigger - Button's pair, for the split button's leading half. */
  val triggerProbes = NitroUiPixelProbes()

  /** The probe pair for the open popup's window, which is where the rows are drawn. */
  val menuProbes = NitroUiPixelProbes()

  /**
   * The open menu's own view, or `null`.
   *
   * The rows are not in this control's view - a `DropdownMenuPopup` is a window of its
   * own - so sampling them means sampling the view [MenuWitness] recorded, and only
   * while the menu is actually composed: a dismissed popup's view would answer for a
   * window nobody can see.
   */
  val openMenuView: View?
    get() = menuView?.takeIf { expanded }

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
   * Whether a `primaryAction` was passed - the flag that chooses the trigger's layout.
   *
   * Observed, because it is drawn: iOS reads it to choose `Menu`'s other `init` (tap
   * runs the action, a long-press opens), and since E3 Android draws
   * [MenuSplitButton] - Material's split button - whenever it is set, and a plain
   * button when it is not (`docs/components/menu.md`, "Primary action"). That is why
   * the flag is a prop of its own rather than a test for a non-null callback: a
   * callback prop is always sent (D7b), so its presence cannot be the flag.
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

  /**
   * The app's primary action, fired by the leading half of the split trigger on
   * Android and by a tap on iOS (DECISIONS D29, as E3 lifts it for Android).
   *
   * Only ever called through [applyPrimaryAction], which is also what refuses it while
   * the control is disabled.
   */
  var primaryAction: (() -> Unit)? = null

  // --- Split-trigger geometry, for `nuiTestMenuReport`'s `split` / `leading` /
  // `trailing`. None of it is rendered from: the halves render themselves. ---

  /**
   * Whether this mount's composition drew the split trigger ([MenuSplitButton] reports
   * it in and out).
   *
   * Deliberately not `hasPrimaryAction`: that answers "what did JS send", this answers
   * "what did Android compose", and the harness assertion "with `primaryAction` set the
   * trigger *is* a split button" is about the second one. A recycle disposes the
   * composition, which clears it, so a reused control cannot report a layout its next
   * owner never asked for.
   */
  private var splitDrawn = false

  /** The leading half's box in the composition's own view, in px, or -1 unread. */
  private var leadingLeft = -1f
  private var leadingTop = -1f
  private var leadingRight = -1f
  private var leadingBottom = -1f

  /** The trailing half's box, same space, same unread marker. */
  private var trailingLeft = -1f
  private var trailingTop = -1f
  private var trailingRight = -1f
  private var trailingBottom = -1f

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

  /** The popup's semantics tree as last read, `drawn` notation, or `null` unread. */
  @Volatile private var drawn: String? = null

  /** The popup's view, for as long as its composition group is composed. */
  private var menuView: View? = null

  /** [MenuWitness]'s counter: this control's own, as Picker keeps its own. */
  override val livePopups: AtomicInteger
    get() = liveMenus

  /** [MenuWitness] saw the popup go: whatever is still open is not. */
  override fun menuLeftComposition() {
    setOpen(false)
  }

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
   * caller remembering whether it already closed, which is why the trigger's press, its
   * semantics click and Material's dismissal callback can all report the same request
   * without the harness seeing it twice.
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
  override fun noteMenuFrame(
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
  override fun clearMenuFrame() {
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
  override fun noteMenuView(view: View?) {
    menuView = view
  }

  override fun noteMenuDrawn(tree: String) {
    drawn = tree
  }

  /** Re-read the open popup's semantics now (`nuiTestMenuProbe`). UI thread. */
  fun refreshDrawn() {
    refreshMenuDrawn(menuView, this)
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
   * `expanded=<0|1>;live=<n>;anchor=<l>,<t>,<r>,<b>;menu=<l>,<t>,<r>,<b>;rows=<n>` +
   * `;drawn=<tree>;split=<0|1>;leading=<l>,<t>,<r>,<b>;trailing=<l>,<t>,<r>,<b>`.
   *
   * The anchor half is the composition-relative box plus the composition's own place on
   * screen, summed here rather than stored - and the two halves are summed the same way,
   * so all three rects are screen pixels and a harness can press one. `split` is whether
   * the composition drew the split trigger (see [splitDrawn] for why that is not
   * [hasPrimaryAction]). Formatted under a lock because the seam may be called from the JS
   * thread while the UI thread writes the fields; the `live` half is process-wide because
   * a mount dropped mid-menu has nothing left to ask (`Q3` §2 is why a harness assertion
   * then reads a *delta* of it, not a number).
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
        // The popup's own semantics tree, as it was last laid out (E2).
        ";drawn=${drawn ?: "-1"}" +
        // The split trigger, and where its two halves landed (E3). A control with no
        // `primaryAction` answers `split=0` with two unread boxes - "not drawn", which is
        // a different claim from the `-1` iOS answers for all three because iOS cannot
        // measure a layout it does not have (see its `nuiTestMenuReport`).
        ";split=${if (splitDrawn) 1 else 0}" +
        ";leading=${halfBox(leadingLeft, leadingTop, leadingRight, leadingBottom)}" +
        ";trailing=${halfBox(trailingLeft, trailingTop, trailingRight, trailingBottom)}" +
        // What each row that drew a glyph tinted it with (`MenuRowIcons.noteTint`), so a
        // harness can sample for a colour of this device's dynamic palette it cannot
        // otherwise name. `-` when no row has drawn one.
        ";iconTints=${rowIcons.tintsReport()}"
    }
  }

  /**
   * One half's composition-relative box as screen pixels, or `-1,-1,-1,-1` unread - the
   * same sum [readMenuReport] does for the anchor, and refused the same way: an unread
   * half must not read as a box at the origin.
   */
  private fun halfBox(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ): String =
    if (left >= 0f && compositionLeft >= 0) {
      "${(left + compositionLeft).toInt()},${(top + compositionTop).toInt()}," +
        "${(right + compositionLeft).toInt()},${(bottom + compositionTop).toInt()}"
    } else {
      "-1,-1,-1,-1"
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

  /**
   * The leading half was pressed: run the app's primary action, and open nothing.
   *
   * The one entry point for "the action half was pressed", so a real press and the
   * semantics action restated on the half cannot diverge. It never touches `expanded`:
   * on Android the split exists precisely so that a press on the action is not a press
   * on the list (`docs/components/menu.md`), and an `onOpen` here would be the app
   * watching a menu it did not open come up. A disabled control refuses, the same way
   * [applyPick] does - Material also keeps a disabled button inert, so this is the
   * model's own rule rather than a second line of defence.
   */
  fun applyPrimaryAction() {
    if (enabled) {
      primaryAction?.invoke()
    }
  }

  /**
   * The list half was reached through its accessibility action: open the list if it is
   * down, close it if it is up.
   *
   * A finger on the same half already toggles, because Material's trailing button is a
   * *checked* button whose `checked` is [expanded] (`MenuSplitButton.kt`), so the value
   * it reports back is `!expanded`. The semantics action the half restates is a separate
   * arm and does not go through Material at all, so it has to ask for the same
   * transition itself: a bare `setOpen(true)` there left TalkBack unable to dismiss the
   * list it had just opened (`docs/components/menu.md`, "Primary action"). A disabled
   * control refuses, the same rule [applyPrimaryAction] has.
   */
  fun applyListAction() {
    if (enabled) {
      setOpen(!expanded)
    }
  }

  /** Record that this mount's composition drew, or stopped drawing, the split trigger. */
  fun noteSplitDrawn(drawn: Boolean) {
    splitDrawn = drawn
  }

  /** Record where the leading half ended up, inside the composition's own view. */
  fun noteLeadingBox(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    leadingLeft = left
    leadingTop = top
    leadingRight = right
    leadingBottom = bottom
  }

  /** Record where the trailing half - the one the popup hangs off - ended up. */
  fun noteTrailingBox(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    trailingLeft = left
    trailingTop = top
    trailingRight = right
    trailingBottom = bottom
  }

  /** Forget both halves: no split trigger of this mount is composed any more. */
  fun clearSplitBoxes() {
    leadingLeft = -1f
    leadingTop = -1f
    leadingRight = -1f
    leadingBottom = -1f
    trailingLeft = -1f
    trailingTop = -1f
    trailingRight = -1f
    trailingBottom = -1f
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
    androidIcon = null
    // Clears the resolved source, retires any file load the previous owner started,
    // and puts the slot back to "nothing asked for" — the same reset `ButtonModel`
    // does, from the same class.
    iconSlot.reset()
    // Every row's slot too, with the file loads its previous owner started retired
    // along with them - a recycled menu that kept its rows' artwork would draw the
    // previous owner's glyphs beside the next owner's titles.
    rowIcons.reset()
    triggerProbes.clear()
    menuProbes.clear()
    entries = emptyList()
    rawRows = emptyArray()
    hasPrimaryAction = false
    accessibilityLabel = null
    // The split trigger's own layout witness. `hasPrimaryAction` above is the prop; this
    // is the layout, and a recycled control that kept it would report a second hit target
    // its next owner never asked for.
    //
    // Two paths clear the same pair, this line and the split composition's own `onDispose`,
    // so neither is visible alone: `Menu.harness.tsx`'s remount gate went red only with
    // *both* removed, and `MenuModelTest.aRecycleClearsTheSplitTriggerAndItsHalves` is the
    // test that guards this line by itself (rows 7, 9 and 10 of
    // `docs/tasks/E3/mutations.json`). Belt and braces is the point - the belt is just not
    // what the device sees.
    splitDrawn = false
    clearSplitBoxes()
    clearMenuFrame()
    anchorLeft = -1f
    anchorTop = -1f
    anchorRight = -1f
    anchorBottom = -1f
    compositionLeft = -1
    compositionTop = -1
    menuView = null
    drawn = null
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

  @Composable
  override fun Component(model: MenuModel) {
    val entries = model.entries
    val expanded = model.expanded
    val enabled = model.enabled
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
    // One callback for both triggers: where the *popup* is composed decides what the
    // list hangs off (see `PlainTrigger` and `MenuSplitButton`), and everything else
    // about the list - its rows, its witness, its dismissal - is one call site.
    val anchorModifier =
      Modifier.onGloballyPositioned { coordinates ->
        // Where the trigger ended up, inside the composition's own view: the
        // space a popup is positioned in. A layout callback, so it costs no
        // recomposition and writes no observed state.
        val box = coordinates.boundsInRoot()
        model.noteAnchorBox(box.left, box.top, box.right, box.bottom)
      }
    val popup: @Composable () -> Unit = {
      // The list is as wide as its rows need: Material's rows keep their own 112 dp
      // floor and 280 dp cap, and a group label is capped the same way, which is what
      // iOS's menu does. `expanded && enabled`, so a disabled trigger never composes a
      // list even for the frame before `disabled`'s close lands.
      NitroUiMenuPopup(
        expanded = expanded && enabled,
        onDismissRequest = {
          // Everything that closes a popup without a choice: outside tap, the
          // system back gesture, the composition going away.
          model.setOpen(false)
        },
        witness = model,
      ) {
        MenuGroups(
          entries = entries,
          menuTitle = null,
          enabled = enabled,
          icons = model.rowIcons,
          onPick = { id -> choose(id) },
          onRowsComposed = model::noteMenuRows,
        )
      }
    }
    if (model.hasPrimaryAction) {
      // Material 3 Expressive's split button: the leading half runs `primaryAction`,
      // the trailing half opens this list. iOS's answer to the same prop is the other
      // `Menu` init - tap acts, long-press opens - and each is the platform's own
      // idiom for one button with two jobs (DECISIONS D29, as E3 lifts it here).
      MenuSplitButton(model = model, popup = popup, modifier = anchorModifier)
    } else {
      PlainTrigger(model = model, popup = popup, modifier = anchorModifier)
    }
  }

  /**
   * The single-button trigger: what a Menu with no `primaryAction` draws, and the box
   * `docs/components/menu.md` measures against a `Button`'s. Split out so the two
   * triggers of one Menu read as the two components they are, each with its own popup
   * placement - which is the whole anchor difference between them.
   */
  @Composable
  private fun PlainTrigger(
    model: MenuModel,
    popup: @Composable () -> Unit,
    modifier: Modifier,
  ) {
    val enabled = model.enabled
    // The trigger's name: an explicit `accessibilityLabel`, else the visible
    // `title`. The rows are in a window of their own, so the label belongs here.
    val spokenLabel = model.accessibilityLabel ?: model.title
    // The trigger and the popup share one `Box`, and the box *is* the trigger: a
    // Compose `Popup` is positioned against the layout it is composed in, so this is
    // what anchors the list to the button rather than to whatever contains it - the
    // job `ExposedDropdownMenuBox`'s `menuAnchor` did before E2 (G7b). Expressive's
    // `DropdownMenuPopup` takes a position provider instead of an anchor modifier, and
    // `rememberDropdownMenuPopupPositionProvider(Below)` hands it this box's bounds.
    // `Menu.harness.tsx` bounds the gap between the button and the window, and the
    // G7b mutant (a 64 dp offset) is the recipe that shows the bound is live.
    Box {
      val triggerModifier =
        modifier
          // One accessibility node, carrying name, value, role and state - the
          // `clearAndSetSemantics` fix, not `semantics`, for the reason
          // `HybridNitroUiPicker` records from `uiautomator dump` (G6 review M3):
          // the M3 button's own node would be a second, nameless focus stop. The
          // clear also drops the button's own click action, so it is restated here;
          // pointer input is untouched.
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
        // The same slot, painter and empty-but-reserved `Pending` box a Button draws —
        // [NitroUiM3Button] is shared, which is what keeps `docs/components/menu.md`'s
        // "a Menu's box is a Button's box" true for a control with a glyph in it.
        icon = model.androidIconContent,
        modifier = triggerModifier,
        // No `primaryAction`, so a tap opens the list. With one, Android draws the
        // split trigger above instead - the two idioms never share a box.
        onClick = { model.setOpen(true) },
      )
      popup()
    }
  }

}

/** The Hybrid View React renders as `NitroUiMenu`. */
class HybridNitroUiMenu(
  reactContext: ThemedReactContext,
) : HybridNitroUiMenuSpec(), RecyclableView {

  private val model = MenuModel()
  private val host = MenuHost(reactContext, reactContext.currentActivity, model)

  /**
   * The control's half of icon resolution, exactly as `HybridNitroUiButton` holds it:
   * the app's resources and the shared file cache, bound to this control's `Context`
   * ([NitroUiIconArtwork]).
   *
   * Held rather than built per commit — a prop commit is not a place to allocate, and
   * the `Context` it captures is the one [host] already holds.
   */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

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
     * is [NitroUiM3Button]'s box - so the guess is Button's own, and this is literally
     * it: the width [HybridNitroUiButton] declares for a medium button with a
     * six-letter title. E1's size ladder is why it moved: that ladder cut 16 dp off a
     * medium trigger, so a measured `filled` `Variant` is 76.57 dp wide here where it
     * measured 92.57 before, and the old 118 was no longer even the right order of
     * guess. `docs/components/menu.md` has the measured table.
     *
     * The height stays 52 rather than taking Button's 48, and that gap is the point:
     * a fallback that equals a measured answer makes a failed correction invisible
     * (AGENTS.md, quality bar), and every box this control measures is 48 or 56 tall.
     * `Menu.harness.tsx`'s sizing test poisons all seven configurations and asserts
     * each box is neither the planted size nor these numbers.
     */
    private const val FALLBACK_WIDTH_DP = 75.1
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
        // The popup is composed with `expanded && enabled`, so it also stops being
        // composed without this line, and a mutation of it alone may well leave the
        // gate green - the gate is an
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

  override var androidIcon: Variant_NullType_String
    get() =
      model.androidIcon?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val name = next.asSecondOrNull()
      if (name == model.androidIcon) {
        return
      }
      // Stored only: the glyph is resolved in `afterUpdate()`, never here, and the
      // width it changes is reported by Compose's next measure.
      model.androidIcon = name
    }

  override var hasPrimaryAction: Boolean
    get() = model.hasPrimaryAction
    set(next) {
      if (next == model.hasPrimaryAction) {
        return
      }
      // Drawn, not bookkeeping: iOS chooses `Menu`'s other `init` from it (tap acts,
      // long-press opens) and Android chooses its trigger's *layout* - a split button
      // with a second hit target, which is wider than the single button it replaces.
      // Compose's next measure reports that new box, so - like `title`, whose label is
      // the other thing that moves it - the batch is marked dirty.
      model.hasPrimaryAction = next
      host.markDirty()
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
      // Stored, and run only by the leading half: see [hasPrimaryAction] and
      // [MenuModel.applyPrimaryAction].
      model.primaryAction = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The trigger's icon first, if it changed — the same order Button keeps, for the
    // same reason: a resource resolved here is drawn in this commit, and a file that
    // has to be read reserves its slot in this commit and fills it later. Doing it in
    // the setter would repeat a resource lookup or a socket read for every prop of the
    // batch (AGENTS' perf contract).
    model.resolveAndroidIcon(iconArtwork)
    // Then the rows', for the same reason and in the same batch: a name resolves here and
    // is drawn by the popup this commit composes; a file reserves its row's slot here and
    // fills it when the read lands. Kept out of the `rows` setter, which would pay a
    // resource table lookup per row per unrelated prop of the batch.
    model.resolveRowIcons(iconArtwork)
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

  /**
   * Sample the trigger, for Button's reasons (`docs/components/button.md`): whether a
   * glyph is painted in the control's content colour is a fact only its pixels hold, and
   * a split trigger's leading half is where the trigger's glyph now lives.
   */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.triggerProbes.publish(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.triggerProbes.read()

  /**
   * Sample the open menu's window, or refuse when no menu of this mount is composed.
   *
   * The popup's view is the one the witness already keeps for the menu's frame, so this
   * adds no new witness to tear down - and it is sampled on the UI thread, posted rather
   * than waited for, like every other probe here.
   */
  override fun nuiTestMenuPixelProbe(color: Double) {
    val run = {
      val view = model.openMenuView
      if (view == null) {
        model.menuProbes.refuse("no popup")
      } else {
        model.menuProbes.publish(view.nitroUiSamplePixels(color))
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestMenuPixelReport(): String = model.menuProbes.read()

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
  override fun nuiTestMenuReport(): String {
    MenuDrawnWitness.wanted = true
    return model.readMenuReport()
  }

  /**
   * Re-read the open popup's semantics tree into `drawn` now, on the UI thread. The
   * witness reads it on each layout of the popup's window anyway; this is for a change
   * that repaints without a layout. See `NitroUiMenuMethods.nuiTestMenuProbe`.
   */
  override fun nuiTestMenuProbe() {
    MenuDrawnWitness.wanted = true
    if (Looper.myLooper() == Looper.getMainLooper()) {
      model.refreshDrawn()
    } else {
      host.post { model.refreshDrawn() }
    }
  }
}
