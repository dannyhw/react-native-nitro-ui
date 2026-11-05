package com.margelo.nitro.nitroui

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.facebook.react.views.view.ReactViewGroup
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.hypot
import kotlin.math.roundToInt

/*
 * The ContextMenu (G16, DECISIONS D36/D37; design `docs/tasks/Q6-contextmenu-design.report.md`
 * Appendices C and D, measured by S3): a `ReactViewGroup` whose React Native children stay
 * in place and which opens a Material 3 `DropdownMenu` at the finger on a long press.
 *
 * - **The view.** [ContextMenuView] is RN's own `View` (its manager is a
 *   `ReactViewManager`, `NitroUiContextMenuViewManager`), so borders, radius, overflow,
 *   `pointerEvents`, `hitSlop` and the accessibility props all work as they do on a
 *   `View`. One more child - the menu's 0 x 0 [ContextMenuHost] - is kept last and hidden
 *   from Fabric's indices by the manager. `ReactViewGroup.requestLayout` is a no-op, so the
 *   wrapper lays that host out itself (S3 change 4).
 * - **Arbitration.** The wrapper watches `dispatchTouchEvent`. At the long-press timeout it
 *   hands the gesture to native - `NativeGestureUtil.notifyNativeGestureStarted`, so JS
 *   gets one CANCEL and the `Pressable` under the finger never presses - stops its
 *   ancestors intercepting, and intercepts the rest of the gesture itself (Q6 D3).
 *   Movement past slop, a second pointer, an ancestor's CANCEL or a child's
 *   disallow-intercept (a `ScrollView` inside starting to drag) drop the pending press.
 *   The deepest ContextMenu on a gesture's path is the one that may open
 *   ([ContextMenuGestureSlot]).
 * - **The anchor.** The popup is anchored to a zero-size box at the press point, written
 *   as snapshot state at recognition and read only in `offset {}`, so it costs a
 *   placement. S3 measured the popup's top-start at the press, 0 px off, and Material
 *   flipping it above the finger near the bottom edge. An open popup follows its anchor,
 *   so a layout that moves the wrapper closes the menu (S3 change 5).
 * - **Accessibility.** The wrapper's node carries `ACTION_LONG_CLICK` "Show menu", added in
 *   `onInitializeAccessibilityNodeInfo` - not `ViewCompat.replaceAccessibilityAction`,
 *   which installs a delegate of its own and dropped RN's (the node lost its `testID`,
 *   S3 change 3). TalkBack's double-tap-and-hold sends that action to the focused node,
 *   which `accessible` makes the wrapper (D36 item 1).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui` (the generated spec's).
 */

/**
 * The gesture slot: process-wide, keyed by the gesture's `downTime`.
 *
 * A parent ContextMenu's `dispatchTouchEvent` runs before its child's, so both arm on the
 * same DOWN. Each one on the path writes itself here, so the last writer - the deepest -
 * is the only one whose timer may open. UI thread only.
 */
internal object ContextMenuGestureSlot {
  private var downTime = -1L
  private var owner: WeakReference<View>? = null

  fun claim(
    downTime: Long,
    view: View,
  ) {
    this.downTime = downTime
    owner = WeakReference(view)
  }

  fun owns(
    downTime: Long,
    view: View,
  ): Boolean = this.downTime == downTime && owner?.get() === view

  fun release(view: View) {
    if (owner?.get() === view) {
      owner = null
      downTime = -1L
    }
  }

  /**
   * Take the slot back for an ancestor when the descendant that claimed it let go on the
   * same DOWN (it was not a touch target: `pointerEvents="none"`, or `"box-none"` with
   * nothing under the finger). A slot another view still holds for this gesture stays its.
   */
  fun claimIfFree(
    downTime: Long,
    view: View,
  ) {
    if (this.downTime != downTime || owner?.get() == null) claim(downTime, view)
  }
}

/** State of one ContextMenu. See [NitroUiModel] for the shape this has to have. */
internal class ContextMenuModel : NitroUiModel(), MenuWitnessSink {
  /** The rows, as the popup draws them. */
  var entries by mutableStateOf<List<MenuEntry>>(emptyList())

  /** The array the `rows` setter was last handed, for its equality guard. Not observed. */
  var rawRows: Array<NitroUiMenuRow> = emptyArray()

  /** The header over the rows, or `null`. */
  var title by mutableStateOf<String?>(null)

  /** `!disabled`. */
  var enabled by mutableStateOf(true)

  /** Whether the popup is showing. */
  var expanded by mutableStateOf(false)

  /** The press point inside the wrapper, px. Read only in the anchor's `offset {}`. */
  var pressX by mutableIntStateOf(0)
  var pressY by mutableIntStateOf(0)

  var onSelect: ((String) -> Unit)? = null
  var onOpen: (() -> Unit)? = null
  var onClose: (() -> Unit)? = null

  /**
   * The native side of every close, ahead of the app's `onClose`: the wrapper stops
   * watching the layout here, so no close path - a row press, an outside tap, Back, the
   * popup leaving the composition, `disabled`, a layout move or a drop - can leave its
   * pre-draw listener on the window. Installed once by the Hybrid and never reset.
   */
  var afterClose: (() -> Unit)? = null

  /** Counters, for the report. UI thread. */
  var opens = 0
  var closes = 0
  var selects = 0

  // --- Popup geometry, for the report. None of it is rendered from. ---
  private var menuView: View? = null
  private var menuLeft = -1
  private var menuTop = -1
  private var menuRight = -1
  private var menuBottom = -1
  private var menuRowCount = -1

  /** Whether a long press would open a menu: enabled, and something to pick. */
  val canOpen: Boolean
    get() = enabled && actionableRowCount > 0

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
   * Open or close the menu, and report the change once - Menu's `setOpen` rule: every
   * `onOpen` is followed by exactly one `onClose`, whatever closed it, and idempotent by the
   * transition test so Material's dismissal, a pick, `disabled`, a layout move and a drop
   * can all ask for the same close without a second report.
   */
  fun setOpen(open: Boolean) {
    if (expanded == open) {
      return
    }
    expanded = open
    if (open) {
      opens += 1
      onOpen?.invoke()
    } else {
      closes += 1
      afterClose?.invoke()
      onClose?.invoke()
    }
  }

  /** Open at a point inside the wrapper, px. The point is written before `expanded`. */
  fun openAt(
    x: Int,
    y: Int,
  ) {
    if (expanded || !canOpen) {
      return
    }
    pressX = x
    pressY = y
    setOpen(true)
  }

  /**
   * A row was picked, however it was picked: report it (when the control and the row
   * allow), then close - DECISIONS D32's order, and Menu's `applyPick` rule that a press
   * takes the window down whether or not it reported anything.
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
          selects += 1
          onSelect?.invoke(row.id)
        }
        break
      }
    }
    setOpen(false)
  }

  // MARK: MenuWitnessSink

  override val livePopups: AtomicInteger
    get() = liveMenus

  override fun noteMenuView(view: View?) {
    menuView = view
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
    menuRowCount = -1
  }

  override fun menuLeftComposition() {
    setOpen(false)
  }

  fun noteMenuRows(rows: Int) {
    menuRowCount = rows
  }

  /**
   * Whether a harness has asked this mount's Hybrid for a report
   * (`nuiTestContextMenuReport`). An app never does, so it never pays for one: the
   * report and the anchor witness are built only once this is set. A recycle clears it
   * with the counters, so a new owner is built for only once it is asked about.
   */
  @Volatile var reportsWanted = false

  /** Where Compose last placed the anchor, window px, and how often: test witness. */
  @Volatile var anchorPlaced = "-1"
    private set
  private var anchorPlacements = 0

  fun noteAnchor(x: Int, y: Int) {
    anchorPlacements += 1
    anchorPlaced = "$x,$y,$anchorPlacements"
  }

  /** `l,t,r,b` of the open popup's window, screen px, or `-1`. */
  val menuFrame: String
    get() = if (menuLeft < 0) "-1" else "$menuLeft,$menuTop,$menuRight,$menuBottom"

  /** The rows the open popup composed, else the model's own count. */
  val reportedRows: Int
    get() = if (menuRowCount >= 0) menuRowCount else actionableRowCount

  override fun reset() {
    // First (Q6 Appendix E, "Recycling"): a recycled view must never come back open.
    expanded = false
    entries = emptyList()
    rawRows = emptyArray()
    title = null
    enabled = true
    pressX = 0
    pressY = 0
    onSelect = null
    onOpen = null
    onClose = null
    opens = 0
    closes = 0
    selects = 0
    menuView = null
    clearMenuFrame()
    anchorPlaced = "-1"
    anchorPlacements = 0
    reportsWanted = false
  }

  companion object {
    /**
     * How many ContextMenu popups this process has composed right now - Menu's and
     * Picker's rule, a counter of its own: a mount dropped mid-menu cannot report its own
     * leak, so the next mount reads it.
     */
    val liveMenus = AtomicInteger(0)
  }
}

/**
 * The menu's composition: a zero-size anchor at the press point and Material 3's
 * `DropdownMenu` on it, with Menu's rows. Laid out at 0 x 0 by [ContextMenuView].
 */
internal class ContextMenuHost(
  context: Context,
  activity: Activity?,
  model: ContextMenuModel,
) : NitroComposeHost<ContextMenuModel>(context, activity, model) {
  /** Never centred: the host is 0 x 0, and the anchor's offset is from its origin. */
  override val centersContent: Boolean
    get() = false

  fun choose(id: String) {
    model.applyPick(id)
  }

  @Composable
  override fun Component(model: ContextMenuModel) {
    // The anchor is a point. Its offset is read in the placement lambda only, so a new
    // press point costs a placement and no recomposition.
    Box(
      Modifier.offset { IntOffset(model.pressX, model.pressY) }.size(0.dp).onGloballyPositioned {
        // A test witness: nothing reads it until a harness asks for a report.
        if (model.reportsWanted) {
          val at = it.positionInWindow()
          model.noteAnchor(at.x.roundToInt(), at.y.roundToInt())
        }
      },
    ) {
      DropdownMenu(
        expanded = model.expanded,
        // Outside tap and the back gesture.
        onDismissRequest = { model.setOpen(false) },
      ) {
        // First: it reads `LocalView`, which here is the popup's view.
        MenuWitness(model)
        val title = model.title
        if (title != null) {
          MenuHeader(title)
        }
        MenuEntries(
          entries = model.entries,
          enabled = model.enabled,
          onPick = { id -> choose(id) },
          onRowsComposed = model::noteMenuRows,
        )
      }
    }
  }
}

/** The wrapper: a `ReactViewGroup` whose last child is the menu's compose host. */
internal class ContextMenuView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiContextMenu,
) : ReactViewGroup(context) {
  private var composeHost: ContextMenuHost? = null
  private val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var pending = false
  private var tookOver = false
  private var downX = 0f
  private var downY = 0f
  private var downTime = -1L
  private var lastEvent: MotionEvent? = null
  private var hostLayoutPosted = false
  private val fire = Runnable { onLongPressTimeout() }

  /** Long presses armed since the mount, and gestures handed to native, for the report. */
  var arms = 0
    private set
  var cancels = 0
    private set

  /** `MotionEvent` copies made since the mount: only while a press is pending. */
  var eventCopies = 0
    private set

  /** Whether a long press is pending right now. */
  val armed: Boolean
    get() = pending

  // The wrapper's place on screen when the menu opened, for the layout-move rule.
  private val openedAt = IntArray(2)
  private val nowAt = IntArray(2)

  /**
   * The observer [layoutWatch] was added to, or `null` when it is on none.
   *
   * The observer, not a flag (`NitroComposeHost`'s `PreDrawWatch` rule): a view that is no
   * longer attached answers `viewTreeObserver` with a *fresh* floating observer, so a
   * removal through it after a detach removes nothing and leaves the listener on the
   * window's observer - which then holds this view for the life of the window, and runs
   * the listener every frame.
   */
  private var watchedObserver: ViewTreeObserver? = null
  private var moveClosePosted = false

  /**
   * A pre-draw check, not a layout listener: Fabric moves a view by calling its `layout`
   * directly, outside any traversal, so a global-layout listener never hears it (measured:
   * the harness's layout-move case stayed open with one). Every move has to be drawn,
   * though, and this runs before each frame of the window - only while the menu is open.
   */
  private val layoutWatch =
    ViewTreeObserver.OnPreDrawListener {
      if (!hybrid.isMenuOpen() || !isAttachedToWindow) {
        // A registration that outlived its menu or its window: the leak witness. Every
        // close and every detach removes the listener, so this never runs.
        strayWatchFires.incrementAndGet()
        return@OnPreDrawListener true
      }
      getLocationOnScreen(nowAt)
      if ((nowAt[0] != openedAt[0] || nowAt[1] != openedAt[1]) && !moveClosePosted) {
        // The popup follows its anchor, so it would now point somewhere the finger
        // never was (S3 measured 73 dp off): down it goes. Nothing scrolls under an open
        // menu - the gesture is the wrapper's - so a move here is a layout's. Posted once.
        moveClosePosted = true
        post {
          moveClosePosted = false
          hybrid.closeForLayoutMove()
        }
      }
      true
    }

  /** Children React Native knows about: everything but the compose host. */
  val reactChildCount: Int
    get() = childCount - (if (composeHost?.parent === this) 1 else 0)

  fun installHost(host: ContextMenuHost) {
    composeHost = host
    // The rows are in the popup's own window; the host adds no node of its own.
    host.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    reinstallHost()
    setOnLongClickListener {
      // Reached only through accessibility (`ACTION_LONG_CLICK`): the touch path never
      // runs `View`'s own long-press check, because `ReactViewGroup.onTouchEvent` does
      // not call `super`. So there is no double open.
      if (!hybrid.canOpen()) return@setOnLongClickListener false
      hybrid.openAt(width / 2, height / 2)
      true
    }
  }

  /**
   * Put the host back as the last child. `ReactViewGroup.recycleView` removes every child
   * on the way into the recycle pool, the host included.
   */
  fun reinstallHost() {
    val host = composeHost ?: return
    if (host.parent === this) return
    (host.parent as? android.view.ViewGroup)?.removeView(host)
    addView(host)
    layoutHost()
  }

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    if (!isFocusable) {
      // Not `accessible` (D36 item 1): the node is a plain `View`'s. The view stays
      // long-clickable for the action below, but a node that says so is an actionable
      // TalkBack stop, which would swallow a ContextMenu's Text children into one stop
      // that is not the element the app asked for.
      info.isLongClickable = false
      info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_LONG_CLICK)
      return
    }
    if (hybrid.canOpen()) {
      info.addAction(
        AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, "Show menu"),
      )
    }
  }

  /**
   * The label of the long-click action this node offers now, for the report: `none` when
   * it offers none, `-` when it offers one without a label (the `View` default a
   * long-clickable view gets, which TalkBack announces as nothing in particular).
   */
  fun a11yActionLabel(): String {
    val info = createAccessibilityNodeInfo()
    val action = info.actionList.firstOrNull { it.id == AccessibilityNodeInfo.ACTION_LONG_CLICK }
    @Suppress("DEPRECATION")
    info.recycle()
    return when {
      action == null -> "none"
      action.label.isNullOrEmpty() -> "-"
      else -> action.label.toString()
    }
  }

  fun addReactChild(
    child: View,
    index: Int,
  ) {
    addView(child, index.coerceIn(0, reactChildCount))
  }

  fun reactChildAt(index: Int): View? = if (index in 0 until reactChildCount) getChildAt(index) else null

  fun removeReactChildAt(index: Int) {
    if (index in 0 until reactChildCount) removeViewAt(index)
  }

  fun removeReactChild(child: View) {
    if (child !== composeHost) removeView(child)
  }

  // MARK: the host's layout - Fabric never measures it, so the wrapper does

  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    super.onLayout(changed, left, top, right, bottom)
    layoutHost()
  }

  override fun requestLayout() {
    super.requestLayout()
    // `ReactViewGroup.requestLayout` is a no-op: a request from the compose host would die
    // here, so the wrapper lays the host out itself on the next turn. Guarded, so a burst
    // of requests posts once.
    if (composeHost != null && !hostLayoutPosted) {
      hostLayoutPosted = true
      post {
        hostLayoutPosted = false
        layoutHost()
      }
    }
  }

  /**
   * Measure and lay the 0 x 0 compose host out, so Compose places the anchor.
   *
   * A request that is pending anywhere in the host's subtree forces the whole subtree
   * through a real measure first. Without it a request can stick: `View.layout` clears a
   * child's `FORCE_LAYOUT` even when its parent's measure never reached it, so the
   * `AndroidComposeView` underneath can be left "layout requested" for good, and Compose's
   * `scheduleMeasureAndLayout` returns early on exactly that - every later change goes
   * unheard, and a 0 x 0 view never draws, so the `dispatchDraw` pass that would rescue a
   * sized one never comes (measured: the anchor was never placed, and the popup stayed
   * unpositioned at `0,142`).
   */
  fun layoutHost() {
    val host = composeHost ?: return
    if (host.parent !== this) return
    if (subtreeRequestsLayout(host)) forceSubtreeLayout(host)
    val zero = MeasureSpec.makeMeasureSpec(0, MeasureSpec.EXACTLY)
    host.measure(zero, zero)
    host.layout(0, 0, 0, 0)
  }

  private fun subtreeRequestsLayout(view: View): Boolean {
    if (view.isLayoutRequested) return true
    if (view !is ViewGroup) return false
    for (index in 0 until view.childCount) {
      if (subtreeRequestsLayout(view.getChildAt(index))) return true
    }
    return false
  }

  private fun forceSubtreeLayout(view: View) {
    view.forceLayout()
    if (view !is ViewGroup) return
    for (index in 0 until view.childCount) {
      forceSubtreeLayout(view.getChildAt(index))
    }
  }

  // MARK: the layout-move rule

  fun watchLayout() {
    getLocationOnScreen(openedAt)
    if (watchedObserver == null) {
      val observer = viewTreeObserver
      observer.addOnPreDrawListener(layoutWatch)
      watchedObserver = observer
    }
  }

  /** Called from the model's close funnel, `onDetachedFromWindow`, recycle and drop. */
  fun unwatchLayout() {
    val observer = watchedObserver ?: return
    watchedObserver = null
    moveClosePosted = false
    // A floating observer that the attach merged into the window's is dead, and its
    // listeners went with the merge: then the window's - the view's own, if attached.
    val target =
      when {
        observer.isAlive -> observer
        isAttachedToWindow -> viewTreeObserver
        else -> return
      }
    target.removeOnPreDrawListener(layoutWatch)
  }

  override fun onDetachedFromWindow() {
    // Fabric detaches a view before `onDropView`, and `viewTreeObserver` is still the
    // window's only until this returns.
    unwatchLayout()
    super.onDetachedFromWindow()
  }

  // MARK: arbitration

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        tookOver = false
        if (hybrid.canOpen()) {
          pending = true
          arms += 1
          downX = ev.x
          downY = ev.y
          downTime = ev.downTime
          ContextMenuGestureSlot.claim(ev.downTime, this)
          removeCallbacks(fire)
          postDelayed(fire, longPressTimeout)
        }
      }
      MotionEvent.ACTION_MOVE ->
        if (pending && hypot(ev.x - downX, ev.y - downY) > touchSlop) drop()
      MotionEvent.ACTION_POINTER_DOWN -> drop()
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> drop()
    }
    if (pending) {
      // The event a take-over hands to `notifyNativeGestureStarted`: copied only while a
      // press is pending, so a view that cannot open costs no copy per event.
      lastEvent?.recycle()
      lastEvent = MotionEvent.obtain(ev)
      eventCopies += 1
    }
    val handled = super.dispatchTouchEvent(ev)
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      if (!handled) {
        // Not the touch target (`pointerEvents="none"`, or `"box-none"` with nothing
        // under the finger): this view never hears the UP or the CANCEL, so the timer
        // would open a menu for a tap and cancel the touch of whatever did take it.
        drop()
      } else if (pending) {
        // A descendant ContextMenu that let go above gives the slot back.
        ContextMenuGestureSlot.claimIfFree(ev.downTime, this)
      }
    }
    if (tookOver &&
      (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL)
    ) {
      // The JS dispatcher drops the rest of a gesture native took until this, or the next
      // DOWN (`JSTouchDispatcher`).
      NativeGestureUtil.notifyNativeGestureEnded(this, ev)
      tookOver = false
    }
    return handled
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    // After the take-over, native children get one `ACTION_CANCEL` and nothing more.
    if (tookOver) return true
    return super.onInterceptTouchEvent(event)
  }

  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    // A child taking the gesture (a `ScrollView` inside starting to drag) is not a long
    // press on this view.
    if (disallowIntercept && pending) drop()
    super.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  /** Forget a pending press, and its copy of the event. */
  fun drop() {
    if (!pending) return
    pending = false
    removeCallbacks(fire)
    ContextMenuGestureSlot.release(this)
    lastEvent?.recycle()
    lastEvent = null
  }

  private fun onLongPressTimeout() {
    if (!pending) return
    pending = false
    if (!ContextMenuGestureSlot.owns(downTime, this) || !hybrid.canOpen()) {
      return
    }
    // 1. JS gets one CANCEL, so the `Pressable` gets `onPressOut` and nothing else.
    lastEvent?.let {
      NativeGestureUtil.notifyNativeGestureStarted(this, it)
      cancels += 1
    }
    // 2. Ancestor scrolls, pagers and stacks stand down for the rest of the gesture.
    parent?.requestDisallowInterceptTouchEvent(true)
    // 3. The rest of the gesture is this view's (`onInterceptTouchEvent`).
    tookOver = true
    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    hybrid.openAt(downX.roundToInt(), downY.roundToInt())
  }

  /** Drop and recycle: no pending press, no gesture, no copy of an event. */
  fun resetGesture() {
    drop()
    if (tookOver) {
      lastEvent?.let { NativeGestureUtil.notifyNativeGestureEnded(this, it) }
    }
    tookOver = false
    lastEvent?.recycle()
    lastEvent = null
    unwatchLayout()
  }

  /** Recycle: a fresh mount counts its own presses. */
  fun resetCounters() {
    arms = 0
    cancels = 0
    eventCopies = 0
  }

  companion object {
    /**
     * Pre-draw runs of a layout watch whose menu was closed or whose view had left its
     * window, process-wide: a leaked registration, which a mount that leaked cannot report
     * itself, so the next one reads it.
     */
    val strayWatchFires = AtomicInteger(0)
  }
}

/** The Hybrid View React renders as `NitroUiContextMenu`. */
class HybridNitroUiContextMenu(
  reactContext: ThemedReactContext,
) : HybridNitroUiContextMenuSpec(), RecyclableView {
  private val model = ContextMenuModel()
  internal val wrapper = ContextMenuView(reactContext, this)
  private val host = ContextMenuHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = wrapper

  private var rawRadius: Double? = null
  private val pressScreen = intArrayOf(-1, -1)

  @Volatile private var report = "pending"

  /** Reports this object has built: none until a harness asks ([ContextMenuModel.reportsWanted]). */
  private var reportSeq = 0

  init {
    wrapper.installHost(host)
    // Every close, whichever path it took, goes through `setOpen(false)`.
    model.afterClose = {
      wrapper.unwatchLayout()
      publish()
    }
  }

  internal fun canOpen(): Boolean = model.canOpen

  internal fun isMenuOpen(): Boolean = model.expanded

  // MARK: - Props
  // Setters store and mark dirty; `afterUpdate` applies the rules that read two of them.

  override var rows: Array<NitroUiMenuRow>
    get() = model.rawRows
    set(next) {
      // Content, not identity (Menu's third guard): an equal menu costs nothing.
      if (next.contentEquals(model.rawRows)) {
        return
      }
      model.rawRows = next
      model.entries = parseMenuRows(next)
      host.markDirty()
    }

  override var title: Variant_NullType_String
    get() = model.title?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val text = next.asSecondOrNull()
      if (text == model.title) {
        return
      }
      model.title = text
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      if (!next == model.enabled) {
        return
      }
      model.enabled = !next
      host.markDirty()
    }

  /** Stored, never drawn: an Android menu is a popup, with no lifted preview to round. */
  override var previewCornerRadius: Variant_NullType_Double
    get() = rawRadius?.let { Variant_NullType_Double.Second(it) } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      rawRadius = next.asSecondOrNull()
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

  // MARK: - Lifecycle

  override fun afterUpdate() {
    if (!model.canOpen) {
      // A control that answers nothing owns no live menu and arms no press (D29); the
      // close is reported through the model's funnel.
      wrapper.drop()
      closeMenu()
    }
    wrapper.isLongClickable = model.canOpen
    host.commit()
    publish()
  }

  override fun prepareForRecycle() {
    wrapper.resetGesture()
    wrapper.resetCounters()
    rawRadius = null
    pressScreen[0] = -1
    pressScreen[1] = -1
    // Resets the model - `expanded` first, `reportsWanted` too - and the host's flags.
    host.prepareForRecycle()
    reportSeq = 0
    report = "pending"
  }

  override fun onDropView() {
    wrapper.resetGesture()
    // The close is reported while the app's handler is still connected, so open state an
    // app tracks from `onOpen`/`onClose` never outlives the view; disposing the composition
    // below takes the window down, and the witness's close then finds nothing open.
    closeMenu()
    model.onSelect = null
    model.onOpen = null
    model.onClose = null
    host.drop()
  }

  // MARK: - Open and close

  internal fun openAt(
    x: Int,
    y: Int,
  ) {
    if (model.expanded || !model.canOpen) return
    wrapper.getLocationOnScreen(pressScreen)
    pressScreen[0] += x
    pressScreen[1] += y
    model.openAt(x, y)
    host.applyModelWrites()
    wrapper.layoutHost()
    wrapper.watchLayout()
    publish()
  }

  internal fun closeForLayoutMove() {
    closeMenu()
  }

  private fun closeMenu() {
    wrapper.unwatchLayout()
    if (!model.expanded) return
    model.setOpen(false)
    host.applyModelWrites()
    publish()
  }

  // MARK: - Methods

  /** What a row press calls (`MenuEntries`' `onPick`), and nothing more. */
  override fun nuiTestSelectRow(id: String) {
    if (Looper.myLooper() == Looper.getMainLooper()) host.choose(id) else wrapper.post { host.choose(id) }
  }

  /** A no-op: Android has no second renderer to ask (see the spec); `drawn` stays `-1`. */
  override fun nuiTestMenuProbe() = Unit

  override fun nuiTestContextMenuReport(): String {
    // From the first read on, every state change keeps the report fresh; until then
    // nothing builds it. This read returns the last one built.
    model.reportsWanted = true
    wrapper.post { publish() }
    return report
  }

  override fun nuiTestA11yLongClick() {
    wrapper.post {
      wrapper.performAccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, null)
      publish()
    }
  }

  /** Snapshot the state for [nuiTestContextMenuReport]. UI thread, and only once asked. */
  private fun publish() {
    if (!model.reportsWanted) return
    reportSeq += 1
    val density = wrapper.resources.displayMetrics.density

    fun dp(px: Int): String = "%.1f".format(px / density)
    val kids = StringBuilder()
    for (index in 0 until wrapper.reactChildCount) {
      val child = wrapper.getChildAt(index)
      if (kids.isNotEmpty()) kids.append('|')
      val id = child.getTag(com.facebook.react.R.id.react_test_id) as? String ?: "-"
      kids.append("$id@${dp(child.left)},${dp(child.top)},${dp(child.width)},${dp(child.height)}")
    }
    val press = if (pressScreen[0] < 0) "-1" else "${pressScreen[0]},${pressScreen[1]}"
    report =
      "open=${if (model.expanded) 1 else 0};opens=${model.opens};closes=${model.closes};" +
      "selects=${model.selects};configs=-1;cancels=${wrapper.cancels};rows=${model.reportedRows};" +
      "drawn=-1;title=${model.title ?: "-"};box=${dp(wrapper.width)}x${dp(wrapper.height)};" +
      "contentIndex=${wrapper.indexOfChild(host)}/${wrapper.childCount};interaction=-1;" +
      "ax=${if (wrapper.isFocusable) 1 else 0};a11yAction=${wrapper.a11yActionLabel()};" +
      "radius=-1;press=$press;menu=${model.menuFrame};anchor=${model.anchorPlaced};live=${ContextMenuModel.liveMenus.get()};" +
      "arms=${wrapper.arms};armed=${if (wrapper.armed) 1 else 0};copies=${wrapper.eventCopies};" +
      "watchStray=${ContextMenuView.strayWatchFires.get()};seq=$reportSeq;kids=$kids"
  }
}
