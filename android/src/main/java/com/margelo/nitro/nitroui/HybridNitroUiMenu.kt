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

// A button that opens a list of actions: the same Material 3 button `Button` draws, with
// Material 3 Expressive's menu popup. Must stay in this package (the generated manager's).

internal class MenuModel : NitroUiModel(), MenuWitnessSink {
  var title by mutableStateOf("")

  var variant by mutableStateOf(ButtonVariant.Filled)

  var scale by mutableStateOf(ButtonScale.Medium)

  var enabled by mutableStateOf(true)

  /** ARGB int of the trigger's accent, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /** The SF Symbol name. Stored for the getter; Android draws [androidIcon]. */
  var systemImage by mutableStateOf<String?>(null)

  /** A drawable name or `url:` string. Not observed: composition reads [androidIconContent]. */
  var androidIcon: String? = null

  val iconSlot = NitroUiIconSlot()

  /** What the trigger lays its label next to. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

  /** One icon slot per row, keyed by row id. Fed from `afterUpdate()` by [resolveRowIcons]. */
  val rowIcons = MenuRowIcons()

  /** Only action rows: a submenu or section header is drawn as a group label, with no icon. */
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

  /** Pixel-probe results for the trigger. */
  val triggerProbes = NitroUiPixelProbes()

  /** Pixel-probe results for the open popup's window, where the rows are drawn. */
  val menuProbes = NitroUiPixelProbes()

  /** The open menu's own view, or `null`: the rows are drawn in that window, not this one. */
  val openMenuView: View?
    get() = menuView?.takeIf { expanded }

  var entries by mutableStateOf<List<MenuEntry>>(emptyList())

  /** The array the `rows` setter was last handed, for its equality guard. Not observed. */
  var rawRows: Array<NitroUiMenuRow> = emptyArray()

  /**
   * Whether a `primaryAction` was passed, which chooses the split trigger. A prop of its own
   * because a callback prop is always sent, so its presence cannot be the flag.
   */
  var hasPrimaryAction by mutableStateOf(false)

  /** `accessibilityLabel`, on the trigger - the rows are in a window of their own. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  var expanded by mutableStateOf(false)

  var sizingKey = ""

  var onSelect: ((String) -> Unit)? = null

  /** Android reports this; iOS cannot. */
  var onOpen: (() -> Unit)? = null

  /** Android reports this; iOS cannot. */
  var onClose: (() -> Unit)? = null

  /** Only called through [applyPrimaryAction], which refuses it while disabled. */
  var primaryAction: (() -> Unit)? = null

  // Split-trigger geometry, for the test report. None of it is rendered from.

  /**
   * Whether this mount's composition drew the split trigger: what was composed, not what JS
   * sent ([hasPrimaryAction]).
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

  // Popup geometry, for the test report. None of it is rendered from.

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

  override val livePopups: AtomicInteger
    get() = liveMenus

  override fun menuLeftComposition() {
    setOpen(false)
  }

  private val reportLock = Any()

  /** The rows a pick can name: a submenu's or section's children, never their header. */
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
   * The one writer of `expanded` for gestures and rules, so every `onOpen` is followed by
   * exactly one `onClose`, however many paths ask for the same close. [reset] writes
   * `expanded` directly: a recycled control has no mount to report to.
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

  /** A box that moved, as opposed to one read for the first time (-1). */
  private fun anchorMoved(
    wasLeft: Float,
    wasTop: Float,
    left: Float,
    top: Float,
  ): Boolean = wasLeft >= 0f && (wasLeft != left || wasTop != top)

  /** The popup would now point at the wrong place, so it closes. */
  private fun dropOpenMenu() {
    if (menuView != null && expanded) {
      setOpen(false)
    }
  }

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

  override fun clearMenuFrame() {
    menuLeft = -1
    menuTop = -1
    menuRight = -1
    menuBottom = -1
    menuRowCount = 0
  }

  fun noteMenuRows(rows: Int) {
    menuRowCount = rows
  }

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
   * Re-reads the open menu's window after the composition's view moved: a window moved by
   * the window manager does not re-run its view's `layout()`.
   */
  fun refreshMenuFrame(where: IntArray) {
    val view = menuView ?: return
    view.getLocationOnScreen(where)
    noteMenuFrame(where[0], where[1], where[0] + view.width, where[1] + view.height)
  }

  /**
   * All three rects are screen pixels: the composition-relative box plus the composition's
   * place on screen. Formatted under a lock because it may be read on the JS thread while
   * the UI thread writes. `live` is process-wide.
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
        ";drawn=${drawn ?: "-1"}" +
        // `split=0` with two unread boxes when no split trigger is drawn.
        ";split=${if (splitDrawn) 1 else 0}" +
        ";leading=${halfBox(leadingLeft, leadingTop, leadingRight, leadingBottom)}" +
        ";trailing=${halfBox(trailingLeft, trailingTop, trailingRight, trailingBottom)}" +
        // The colour each row tinted its glyph with, or `-`.
        ";iconTints=${rowIcons.tintsReport()}"
    }
  }

  /** One half's box as screen pixels, or `-1,-1,-1,-1` unread. */
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
   * Reports the pick, then closes. Every press closes the popup; only the report is refused,
   * for a disabled control, a disabled row or an unknown id.
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

  /** The leading half was pressed: runs the app's primary action and never opens the list. */
  fun applyPrimaryAction() {
    if (enabled) {
      primaryAction?.invoke()
    }
  }

  /**
   * The list half's accessibility action: toggles the list. A touch toggles through
   * Material's checked button; the semantics action bypasses it, so it toggles here.
   */
  fun applyListAction() {
    if (enabled) {
      setOpen(!expanded)
    }
  }

  fun noteSplitDrawn(drawn: Boolean) {
    splitDrawn = drawn
  }

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
    // First: a popup that survived a recycle would be open over the next owner's content.
    expanded = false
    title = ""
    variant = ButtonVariant.Filled
    scale = ButtonScale.Medium
    enabled = true
    tintColor = null
    systemImage = null
    androidIcon = null
    // Also retires any file load the previous owner started.
    iconSlot.reset()
    rowIcons.reset()
    triggerProbes.clear()
    menuProbes.clear()
    entries = emptyList()
    rawRows = emptyArray()
    hasPrimaryAction = false
    accessibilityLabel = null
    // The layout witness too: a recycled control must not report a split trigger its
    // next owner never asked for.
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
     * Menus open in this process right now. Process-wide, because a mount dropped mid-menu
     * cannot report its own leak; other mounted controls share it, so tests read its change.
     */
    val liveMenus = AtomicInteger(0)
  }
}

private class MenuHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: MenuModel,
) : NitroComposeHost<MenuModel>(context, activity, model) {

  override val isHostable: Boolean
    get() = true

  /** The one entry point for a row press, real or from the test hook. */
  fun choose(id: String) {
    model.applyPick(id)
  }

  @Composable
  override fun Component(model: MenuModel) {
    val entries = model.entries
    val expanded = model.expanded
    val enabled = model.enabled
    // The view that owns this composition: the control's own, or the `<Host>`'s when it
    // is hosted. The popup's geometry is read relative to it.
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
    val anchorModifier =
      Modifier.onGloballyPositioned { coordinates ->
        // A layout callback, so it costs no recomposition and writes no observed state.
        val box = coordinates.boundsInRoot()
        model.noteAnchorBox(box.left, box.top, box.right, box.bottom)
      }
    val popup: @Composable () -> Unit = {
      // `expanded && enabled`, so a disabled trigger never composes a list, even for one frame.
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
      // Material 3 Expressive's split button: the leading half runs `primaryAction`, the
      // trailing half opens the list.
      MenuSplitButton(model = model, popup = popup, modifier = anchorModifier)
    } else {
      PlainTrigger(model = model, popup = popup, modifier = anchorModifier)
    }
  }

  /** The single-button trigger of a Menu with no `primaryAction`. */
  @Composable
  private fun PlainTrigger(
    model: MenuModel,
    popup: @Composable () -> Unit,
    modifier: Modifier,
  ) {
    val enabled = model.enabled
    // The rows are in a window of their own, so the label belongs on the trigger.
    val spokenLabel = model.accessibilityLabel ?: model.title
    // The trigger and the popup share one `Box`: a Compose `Popup` is positioned against
    // the layout it is composed in, which anchors the list to the button.
    Box {
      val triggerModifier =
        modifier
          // One accessibility node: without the clear, the Material button's own node is a
          // second, nameless focus stop. The clear also drops its click action, so it is
          // restated here; pointer input is untouched.
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
        icon = model.androidIconContent,
        modifier = triggerModifier,
        onClick = { model.setOpen(true) },
      )
      popup()
    }
  }

}

class HybridNitroUiMenu(
  reactContext: ThemedReactContext,
) : HybridNitroUiMenuSpec(), RecyclableView {

  private val model = MenuModel()
  private val host = MenuHost(reactContext, reactContext.currentActivity, model)

  /** Resolves icons against the app's resources. Held, so a prop commit allocates nothing. */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // A backstop: fallbacks are normally declared at package init.
    declareFallback()
  }

  companion object {
    /** Must match the name in the generated C++ and in the generated manager's `getName()`. */
    private const val SIZING_COMPONENT_NAME = "NitroUiMenu"

    /**
     * The size used before anything has been measured, in dp: a medium button with a short
     * title. The height is deliberately not one this control measures (48 or 56), so a
     * correction that failed would be visible.
     */
    private const val FALLBACK_WIDTH_DP = 75.1
    private const val FALLBACK_HEIGHT_DP = 52.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process. Called at package init, because Fabric can measure before this
     * class is first instantiated, and from `init` as a backstop, on a different thread.
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
      // The label decides the width; Compose's own measure pass reports the new size.
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
        // A disabled Menu shows no list. Closed through `setOpen` so the app hears `onClose`.
        model.setOpen(false)
      }
      // Repaints only: a disabled control is the same size.
      host.markDirty()
    }

  override var rows: Array<NitroUiMenuRow>
    get() = model.rawRows
    set(next) {
      // Compared by content: React re-sends an equal array, and it must not recompose.
      if (next.contentEquals(model.rawRows)) {
        return
      }
      model.rawRows = next
      model.entries = parseMenuRows(next)
      // The list is a window: it never changes the trigger's size.
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
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
      // Stored, never drawn: nothing observes it, so no `markDirty()`.
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
      // Stored only: `afterUpdate()` resolves it.
      model.androidIcon = name
    }

  override var hasPrimaryAction: Boolean
    get() = model.hasPrimaryAction
    set(next) {
      if (next == model.hasPrimaryAction) {
        return
      }
      // Chooses the trigger's layout, which changes its width; Compose's measure reports it.
      model.hasPrimaryAction = next
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // The view tag is what testID matchers read.
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
      // The label is on the trigger's semantics node, so a change needs a commit.
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
      // A new key needs a fresh measure and a report, even if the size is unchanged.
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
      model.primaryAction = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // Icons are resolved here, once per batch, not in a setter: a lookup can take a lock
    // or open a socket. A resource is drawn in this commit; a file reserves its slot.
    model.resolveAndroidIcon(iconArtwork)
    model.resolveRowIcons(iconArtwork)
    // No controlled value to reconcile: one commit per turn is the whole update path.
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // Resets the model, `expanded` first. The sizing policy never changes, so it is not reset.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onSelect = null
    model.onOpen = null
    model.onClose = null
    model.primaryAction = null
    // Disposes the composition, which dismisses an open popup with it.
    host.drop()
  }

  /** Samples the trigger's pixels on the UI thread. */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.triggerProbes.publish(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.triggerProbes.read()

  /** Samples the open menu's window on the UI thread, or refuses when none is composed. */
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

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiMenuSize {
    val size = host.contentSize ?: return NitroUiMenuSize(0.0, 0.0)
    return NitroUiMenuSize(size.width, size.height)
  }

  /**
   * Test-only: presses a row by the path a real press takes. The model is UI-thread state,
   * so this posts when called from another thread and never waits.
   */
  override fun nuiTestSelectRow(id: String) {
    val run = {
      host.choose(id)
      // A real press runs inside Compose's input handling, which applies the snapshot
      // writes. A plain post does not, so apply them here.
      host.applyModelWrites()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  /** Test-only. Reads a locked snapshot, so it is safe on the JS thread. */
  override fun nuiTestMenuReport(): String {
    MenuDrawnWitness.wanted = true
    return model.readMenuReport()
  }

  /** Re-reads the open popup's semantics tree on the UI thread. */
  override fun nuiTestMenuProbe() {
    MenuDrawnWitness.wanted = true
    if (Looper.myLooper() == Looper.getMainLooper()) {
      model.refreshDrawn()
    } else {
      host.post { model.refreshDrawn() }
    }
  }
}
