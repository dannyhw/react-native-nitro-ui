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
import com.margelo.nitro.nitroui.core.NitroUiPixelProbes
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.hypot
import kotlin.math.roundToInt

// A `ReactViewGroup` that keeps its React Native children in place and opens a Material 3
// menu at the finger on a long press. Must stay in this package (the generated spec's).

/**
 * Process-wide, keyed by the gesture's `downTime`. A parent's `dispatchTouchEvent` runs
 * before its child's, so every ContextMenu on the path claims the same DOWN and the last
 * writer, the deepest, is the one whose timer may open. UI thread only.
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
   * Takes the slot back for an ancestor when the descendant that claimed it on this DOWN let
   * go because it was not a touch target. A slot another view still holds stays its.
   */
  fun claimIfFree(
    downTime: Long,
    view: View,
  ) {
    if (this.downTime != downTime || owner?.get() == null) claim(downTime, view)
  }
}

internal class ContextMenuModel : NitroUiModel(), MenuWitnessSink {
  var entries by mutableStateOf<List<MenuEntry>>(emptyList())

  /** The array the `rows` setter was last handed, for its equality guard. Not observed. */
  var rawRows: Array<NitroUiMenuRow> = emptyArray()

  val rowIcons = MenuRowIcons()

  /** Called from `afterUpdate()`, once per change. */
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

  /** Pixel-probe results for the open popup's window. */
  val menuProbes = NitroUiPixelProbes()

  /** The open menu's own view, or `null`: the rows live in that window, not this one. */
  val openMenuView: View?
    get() = menuView?.takeIf { expanded }

  var title by mutableStateOf<String?>(null)

  var enabled by mutableStateOf(true)

  var expanded by mutableStateOf(false)

  /** The press point inside the wrapper, px. Read only in the anchor's `offset {}`. */
  var pressX by mutableIntStateOf(0)
  var pressY by mutableIntStateOf(0)

  var onSelect: ((String) -> Unit)? = null
  var onOpen: (() -> Unit)? = null
  var onClose: (() -> Unit)? = null

  /**
   * Runs on every close, before the app's `onClose`, so no close path can leave the
   * wrapper's pre-draw listener on the window. Installed once and never reset.
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

  /** The popup's semantics tree as last read, `drawn` notation, or `null` unread. */
  @Volatile var drawn: String? = null
    private set

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
   * Reports each transition once: every `onOpen` is followed by exactly one `onClose`,
   * however many paths ask for the same close.
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

  /** Reports the pick when the control and the row are enabled, then closes either way. */
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

  override fun noteMenuDrawn(tree: String) {
    drawn = tree
  }

  /** Re-read the open popup's semantics now (`nuiTestMenuProbe`). UI thread. */
  fun refreshDrawn() {
    refreshMenuDrawn(menuView, this)
  }

  fun noteMenuRows(rows: Int) {
    menuRowCount = rows
  }

  /** Set by the first test report read. Until then no report or anchor witness is built. */
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
    // First: a recycled view must never come back open.
    expanded = false
    entries = emptyList()
    rawRows = emptyArray()
    // A recycled wrapper must not draw its previous owner's icons.
    rowIcons.reset()
    menuProbes.clear()
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
    drawn = null
    clearMenuFrame()
    anchorPlaced = "-1"
    anchorPlacements = 0
    reportsWanted = false
  }

  companion object {
    /** Popups composed in this process right now. Process-wide, so a later mount can see a leak. */
    val liveMenus = AtomicInteger(0)
  }
}

/** A zero-size anchor at the press point with the shared menu popup on it. Laid out at 0 x 0. */
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
      NitroUiMenuPopup(
        expanded = model.expanded,
        // Outside tap and the back gesture.
        onDismissRequest = { model.setOpen(false) },
        witness = model,
      ) {
        MenuGroups(
          entries = model.entries,
          menuTitle = model.title,
          enabled = model.enabled,
          icons = model.rowIcons,
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

  val armed: Boolean
    get() = pending

  // The wrapper's place on screen when the menu opened, for the layout-move rule.
  private val openedAt = IntArray(2)
  private val nowAt = IntArray(2)

  /**
   * The observer [layoutWatch] was added to, or `null`. The observer rather than a flag: a
   * detached view answers `viewTreeObserver` with a new floating observer, so removing
   * through that would leave the listener on the window's.
   */
  private var watchedObserver: ViewTreeObserver? = null
  private var moveClosePosted = false

  /**
   * Pre-draw rather than a layout listener: Fabric moves a view by calling `layout` directly,
   * outside any traversal, so a global-layout listener never hears it. Added only while the
   * menu is open.
   */
  private val layoutWatch =
    ViewTreeObserver.OnPreDrawListener {
      if (!hybrid.isMenuOpen() || !isAttachedToWindow) {
        // A listener that outlived its menu or window: counted as a leak.
        strayWatchFires.incrementAndGet()
        return@OnPreDrawListener true
      }
      getLocationOnScreen(nowAt)
      if ((nowAt[0] != openedAt[0] || nowAt[1] != openedAt[1]) && !moveClosePosted) {
        // The popup follows its anchor, so a layout that moves the wrapper closes the menu.
        // Posted once.
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
      // Reached only through accessibility: `ReactViewGroup.onTouchEvent` does not call
      // `super`, so the touch path never runs `View`'s own long-press check.
      if (!hybrid.canOpen()) return@setOnLongClickListener false
      hybrid.openAt(width / 2, height / 2)
      true
    }
  }

  /** `ReactViewGroup.recycleView` removes every child, the host included; this puts it back last. */
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
      // Not `accessible`: a node that says it is long-clickable becomes a TalkBack stop
      // that swallows the children's text.
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

  /** For tests: `none` when the node offers no long-click action, `-` when it has no label. */
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
    // `ReactViewGroup.requestLayout` is a no-op, so the wrapper lays the compose host out
    // itself on the next turn.
    if (composeHost != null && !hostLayoutPosted) {
      hostLayoutPosted = true
      post {
        hostLayoutPosted = false
        layoutHost()
      }
    }
  }

  /**
   * Measures and lays out the 0 x 0 compose host so Compose places the anchor. A request
   * pending in the subtree is forced through a real measure first: otherwise `View.layout`
   * clears it unmeasured and Compose ignores every later request.
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
    // A floating observer merged into the window's at attach is dead: use the window's.
    val target =
      when {
        observer.isAlive -> observer
        isAttachedToWindow -> viewTreeObserver
        else -> return
      }
    target.removeOnPreDrawListener(layoutWatch)
  }

  override fun onDetachedFromWindow() {
    // `viewTreeObserver` is the window's only until this returns.
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
      // Copied only while a press is pending; a take-over hands it to JS as the cancel.
      lastEvent?.recycle()
      lastEvent = MotionEvent.obtain(ev)
      eventCopies += 1
    }
    val handled = super.dispatchTouchEvent(ev)
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      if (!handled) {
        // Not the touch target, so this view never hears the UP or CANCEL and the timer
        // would open a menu for a tap.
        drop()
      } else if (pending) {
        // A descendant ContextMenu that let go above gives the slot back.
        ContextMenuGestureSlot.claimIfFree(ev.downTime, this)
      }
    }
    if (tookOver &&
      (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL)
    ) {
      // The JS dispatcher drops the rest of a gesture native took until this or the next DOWN.
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

  fun resetCounters() {
    arms = 0
    cancels = 0
    eventCopies = 0
  }

  companion object {
    /** Pre-draw runs of a layout watch that outlived its menu or window: a leak counter. */
    val strayWatchFires = AtomicInteger(0)
  }
}

class HybridNitroUiContextMenu(
  reactContext: ThemedReactContext,
) : HybridNitroUiContextMenuSpec(), RecyclableView {
  private val model = ContextMenuModel()
  internal val wrapper = ContextMenuView(reactContext, this)
  private val host = ContextMenuHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = wrapper

  private var rawRadius: Double? = null
  private val pressScreen = intArrayOf(-1, -1)

  @Volatile private var report = "pending"

  /** Reports built so far: none until a test asks. */
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
      // Compared by content: an equal menu costs nothing.
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

  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  override fun afterUpdate() {
    // Once per batch, not in the `rows` setter: a lookup can take a lock or open a socket.
    model.resolveRowIcons(iconArtwork)
    if (!model.canOpen) {
      // A control with nothing to pick keeps no menu open and arms no press.
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
    // Resets the model (`expanded` first) and the host's flags.
    host.prepareForRecycle()
    reportSeq = 0
    report = "pending"
  }

  override fun onDropView() {
    wrapper.resetGesture()
    // Report the close while the app's handlers are still connected; disposing the
    // composition below takes the window down.
    closeMenu()
    model.onSelect = null
    model.onOpen = null
    model.onClose = null
    host.drop()
  }

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
      wrapper.post { run() }
    }
  }

  override fun nuiTestMenuPixelReport(): String = model.menuProbes.read()

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

  override fun nuiTestSelectRow(id: String) {
    if (Looper.myLooper() == Looper.getMainLooper()) host.choose(id) else wrapper.post { host.choose(id) }
  }

  /** Re-reads the open popup's semantics tree on the UI thread. */
  override fun nuiTestMenuProbe() {
    MenuDrawnWitness.wanted = true
    wrapper.post {
      model.refreshDrawn()
      publish()
    }
  }

  override fun nuiTestContextMenuReport(): String {
    // Reports are built only after the first read; this returns the last one built.
    model.reportsWanted = true
    MenuDrawnWitness.wanted = true
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
      "drawn=${model.drawn ?: "-1"};title=${model.title ?: "-"};box=${dp(wrapper.width)}x${dp(wrapper.height)};" +
      "contentIndex=${wrapper.indexOfChild(host)}/${wrapper.childCount};interaction=-1;" +
      "ax=${if (wrapper.isFocusable) 1 else 0};a11yAction=${wrapper.a11yActionLabel()};" +
      "radius=-1;press=$press;menu=${model.menuFrame};anchor=${model.anchorPlaced};live=${ContextMenuModel.liveMenus.get()};" +
      "arms=${wrapper.arms};armed=${if (wrapper.armed) 1 else 0};copies=${wrapper.eventCopies};" +
      "watchStray=${ContextMenuView.strayWatchFires.get()};seq=$reportSeq;" +
      // The colour each row tinted its glyph with, or `-`.
      "iconTints=${model.rowIcons.tintsReport()};kids=$kids"
  }
}
