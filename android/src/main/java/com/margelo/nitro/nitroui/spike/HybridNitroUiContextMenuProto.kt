package com.margelo.nitro.nitroui

// S3 spike only (DECISIONS D36, Q6 Appendices C and D): never merged.
//
// A `ReactViewGroup` (children in place, styled like a `View`) with one more child kept
// last and hidden from Fabric: a 0 x 0 `NitroComposeHost` composing a Material 3
// `DropdownMenu` anchored to a zero-size box at the press point. The wrapper watches
// `dispatchTouchEvent`; at the long-press timeout it hands the gesture to native
// (`NativeGestureUtil.notifyNativeGestureStarted` -> JS gets one CANCEL), stops its
// ancestors from intercepting, and intercepts the rest of the gesture itself.

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.facebook.react.views.view.ReactViewGroup
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import java.lang.ref.WeakReference
import kotlin.math.hypot
import kotlin.math.roundToInt

/** Process-wide: the deepest ContextMenu on a gesture's path is the one that may open. */
internal object S3GestureSlot {
  private var downTime = -1L
  private var owner: WeakReference<View>? = null

  fun claim(downTime: Long, view: View) {
    this.downTime = downTime
    owner = WeakReference(view)
  }

  fun owns(downTime: Long, view: View): Boolean = this.downTime == downTime && owner?.get() === view
}

internal class S3ContextMenuModel : NitroUiModel() {
  var entries by mutableStateOf<List<MenuEntry>>(emptyList())
  var title by mutableStateOf<String?>(null)
  var expanded by mutableStateOf(false)
  var pressX by mutableIntStateOf(0)
  var pressY by mutableIntStateOf(0)
  var onPick: ((String) -> Unit)? = null
  var onDismiss: (() -> Unit)? = null
  var onMenuFrame: ((Int, Int, Int, Int) -> Unit)? = null
  var onMenuGone: (() -> Unit)? = null

  override fun reset() {
    entries = emptyList()
    title = null
    expanded = false
    pressX = 0
    pressY = 0
  }
}

internal class S3ContextMenuHost(
  context: Context,
  activity: Activity?,
  model: S3ContextMenuModel,
) : NitroComposeHost<S3ContextMenuModel>(context, activity, model) {
  override val centersContent: Boolean
    get() = false

  @Composable
  override fun Component(model: S3ContextMenuModel) {
    Box(Modifier.offset { IntOffset(model.pressX, model.pressY) }.size(0.dp)) {
      DropdownMenu(
        expanded = model.expanded,
        onDismissRequest = { model.onDismiss?.invoke() },
      ) {
        S3Witness(model)
        val title = model.title
        if (title != null) {
          Text(
            text = title,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
          )
        }
        for (entry in model.entries) {
          when (entry) {
            is MenuEntry.Action -> S3Row(entry.item, model)
            is MenuEntry.Submenu -> {
              HorizontalDivider()
              for (item in entry.item.items) S3Row(item, model)
            }
            is MenuEntry.Section -> {
              HorizontalDivider()
              for (item in entry.item.items) S3Row(item, model)
            }
          }
        }
      }
    }
  }

  @Composable
  private fun S3Row(
    item: MenuActionItem,
    model: S3ContextMenuModel,
  ) {
    DropdownMenuItem(
      text = {
        Text(
          text = item.title,
          color =
            if (item.destructive && !item.disabled) MaterialTheme.colorScheme.error else ComposeColor.Unspecified,
        )
      },
      onClick = { model.onPick?.invoke(item.id) },
      enabled = !item.disabled,
    )
  }

  @Composable
  private fun S3Witness(model: S3ContextMenuModel) {
    val menuView = LocalView.current
    DisposableEffect(menuView) {
      val where = IntArray(2)
      val listener =
        View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
          view.getLocationOnScreen(where)
          model.onMenuFrame?.invoke(where[0], where[1], where[0] + view.width, where[1] + view.height)
        }
      menuView.addOnLayoutChangeListener(listener)
      onDispose {
        menuView.removeOnLayoutChangeListener(listener)
        model.onMenuGone?.invoke()
      }
    }
  }
}

/** The wrapper: a `ReactViewGroup` whose last child is the compose host. */
internal class S3ContextMenuView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiContextMenuProto,
) : ReactViewGroup(context) {
  private var composeHost: S3ContextMenuHost? = null
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

  /** Children React Native knows about: everything but the compose host. */
  val reactChildCount: Int
    get() = childCount - (if (composeHost?.parent === this) 1 else 0)

  fun installHost(host: S3ContextMenuHost) {
    composeHost = host
    host.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    addView(host)
    isLongClickable = true
    setOnLongClickListener {
      if (!hybrid.canOpen()) return@setOnLongClickListener false
      hybrid.openAt(width / 2, height / 2, "a11y")
      true
    }
    // Not `ViewCompat.replaceAccessibilityAction`: that installs a delegate of its own,
    // so RN's `ReactAccessibilityDelegate` is never set and the node loses its
    // `testID` (resource-id), role and state - measured, see the report. The label
    // goes on in `onInitializeAccessibilityNodeInfo`, after RN's delegate has run.
  }

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    if (hybrid.canOpen()) {
      info.addAction(
        AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, "Show menu"),
      )
    }
  }

  fun addReactChild(child: View, index: Int) {
    addView(child, index.coerceAtMost(reactChildCount))
  }

  fun removeReactChildAt(index: Int) {
    removeViewAt(index)
  }

  // MARK: the host's layout - Fabric never measures it, so the wrapper does

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    layoutHost()
  }

  override fun requestLayout() {
    super.requestLayout()
    // `ReactViewGroup.requestLayout` is a no-op: a request from the compose host would
    // die here, so the wrapper lays the host out itself on the next turn.
    if (composeHost != null && !hostLayoutPosted) {
      hostLayoutPosted = true
      post {
        hostLayoutPosted = false
        layoutHost()
      }
    }
  }

  fun layoutHost() {
    val host = composeHost ?: return
    if (host.parent !== this) return
    val zero = MeasureSpec.makeMeasureSpec(0, MeasureSpec.EXACTLY)
    host.measure(zero, zero)
    host.layout(0, 0, 0, 0)
  }

  // MARK: arbitration

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    lastEvent?.recycle()
    lastEvent = MotionEvent.obtain(ev)
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        tookOver = false
        if (hybrid.canOpen()) {
          pending = true
          downX = ev.x
          downY = ev.y
          downTime = ev.downTime
          S3GestureSlot.claim(ev.downTime, this)
          removeCallbacks(fire)
          postDelayed(fire, longPressTimeout)
          hybrid.emit("down", "x=${ev.x.roundToInt()} y=${ev.y.roundToInt()} timeout=$longPressTimeout")
        }
      }
      MotionEvent.ACTION_MOVE ->
        if (pending && hypot(ev.x - downX, ev.y - downY) > touchSlop) drop("slop")
      MotionEvent.ACTION_POINTER_DOWN -> drop("pointer")
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        if (pending) drop(if (ev.actionMasked == MotionEvent.ACTION_UP) "up" else "cancel")
      }
    }
    val handled = super.dispatchTouchEvent(ev)
    if (tookOver &&
      (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL)
    ) {
      NativeGestureUtil.notifyNativeGestureEnded(this, ev)
      tookOver = false
      hybrid.emit("gestureEnd", "action=${ev.actionMasked}")
    }
    return handled
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (tookOver) return true
    return super.onInterceptTouchEvent(event)
  }

  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    if (disallowIntercept && pending) drop("child-disallow")
    super.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  fun drop(why: String) {
    if (!pending) return
    pending = false
    removeCallbacks(fire)
    hybrid.emit("drop", "why=$why")
  }

  private fun onLongPressTimeout() {
    if (!pending) return
    pending = false
    if (!S3GestureSlot.owns(downTime, this)) {
      hybrid.emit("fire", "result=not-deepest")
      return
    }
    val event = lastEvent
    if (hybrid.cancelsTouches && event != null) {
      NativeGestureUtil.notifyNativeGestureStarted(this, event)
    }
    parent?.requestDisallowInterceptTouchEvent(true)
    tookOver = true
    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    hybrid.openAt(downX.roundToInt(), downY.roundToInt(), "touch")
  }

  fun cancelPendingForDrop() {
    pending = false
    removeCallbacks(fire)
  }
}

class HybridNitroUiContextMenuProto(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiContextMenuProtoSpec() {
  private val model = S3ContextMenuModel()
  internal val wrapper = S3ContextMenuView(reactContext, this)
  private val host = S3ContextMenuHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = wrapper

  private var rawRows: Array<NitroUiMenuRow> = emptyArray()
  private var rawTitle: String? = null
  private var rawDisabled = false
  private var rawCancel = true
  private var isOpen = false
  private var opens = 0
  private var closes = 0
  private var selects = 0
  private var seq = 0
  private var openedAt = 0L
  private var pressScreen = IntArray(2)
  private var menuFrame = "-"
  private var firstFrameMs = -1L
  private var firstDrawMs = -1L
  private var lastVia = "-"

  @Volatile private var report = "pending"

  init {
    wrapper.installHost(host)
    model.onPick = { id -> pick(id) }
    model.onDismiss = { closeMenu("dismiss") }
    model.onMenuFrame = { l, t, r, b -> menuMoved(l, t, r, b) }
    model.onMenuGone = { menuFrame = "-" }
  }

  internal val cancelsTouches: Boolean
    get() = rawCancel

  internal fun canOpen(): Boolean = !rawDisabled && rawRows.isNotEmpty()

  // MARK: props

  override var rows: Array<NitroUiMenuRow>
    get() = rawRows
    set(value) {
      rawRows = value
    }

  override var title: Variant_NullType_String
    get() = rawTitle?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(value) {
      rawTitle = value.asSecondOrNull()
    }

  override var disabled: Boolean
    get() = rawDisabled
    set(value) {
      rawDisabled = value
    }

  override var cancelTouches: Boolean
    get() = rawCancel
    set(value) {
      rawCancel = value
    }

  override var onSelect: ((id: String) -> Unit)? = null
  override var onOpen: (() -> Unit)? = null
  override var onClose: (() -> Unit)? = null
  override var onTrace: ((line: String) -> Unit)? = null

  override fun afterUpdate() {
    model.entries = parseMenuRows(rawRows)
    model.title = rawTitle
    if (rawDisabled) {
      wrapper.drop("disabled")
      closeMenu("disabled")
    }
    Snapshot.sendApplyNotifications()
    publish()
  }

  override fun onDropView() {
    wrapper.cancelPendingForDrop()
    closeMenu("drop")
    onSelect = null
    onOpen = null
    onClose = null
    onTrace = null
    host.drop()
  }

  // MARK: methods

  override fun nuiTestReport(): String {
    wrapper.post { publish() }
    return report
  }

  override fun nuiTestA11yLongClick() {
    wrapper.post {
      val ok = wrapper.performAccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, null)
      emit("a11yLongClick", "handled=${if (ok) 1 else 0}")
    }
  }

  override fun nuiTestSynthHold(fx: Double, fy: Double, ms: Double) {
    wrapper.post {
      val activity = reactContext.currentActivity ?: return@post
      val root = activity.window.decorView
      val where = IntArray(2)
      wrapper.getLocationOnScreen(where)
      val x = where[0] + wrapper.width * fx.toFloat()
      val y = where[1] + wrapper.height * fy.toFloat()
      val down = SystemClock.uptimeMillis()
      val first = MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, x, y, 0)
      root.dispatchTouchEvent(first)
      first.recycle()
      emit("synth", "at=${x.roundToInt()},${y.roundToInt()} ms=${ms.toLong()}")
      root.postDelayed({
        val now = SystemClock.uptimeMillis()
        val up = MotionEvent.obtain(down, now, MotionEvent.ACTION_UP, x, y, 0)
        root.dispatchTouchEvent(up)
        up.recycle()
      }, ms.toLong())
    }
  }

  // MARK: open / pick / close

  internal fun openAt(x: Int, y: Int, via: String) {
    if (isOpen) return
    isOpen = true
    opens += 1
    lastVia = via
    openedAt = SystemClock.uptimeMillis()
    firstFrameMs = -1L
    firstDrawMs = -1L
    wrapper.getLocationOnScreen(pressScreen)
    pressScreen[0] += x
    pressScreen[1] += y
    model.pressX = x
    model.pressY = y
    model.expanded = true
    Snapshot.sendApplyNotifications()
    wrapper.layoutHost()
    emit("open", "x=$x y=$y screen=${pressScreen[0]},${pressScreen[1]} via=$via")
    onOpen?.invoke()
    publish()
  }

  private fun pick(id: String) {
    selects += 1
    emit("handler", "id=$id")
    onSelect?.invoke(id)
    closeMenu("pick")
  }

  private fun closeMenu(via: String) {
    if (!isOpen) return
    isOpen = false
    closes += 1
    model.expanded = false
    Snapshot.sendApplyNotifications()
    emit("close", "via=$via")
    onClose?.invoke()
    publish()
  }

  private fun menuMoved(l: Int, t: Int, r: Int, b: Int) {
    menuFrame = "$l,$t,$r,$b"
    if (firstFrameMs < 0 && isOpen) {
      firstFrameMs = SystemClock.uptimeMillis() - openedAt
      Choreographer.getInstance().postFrameCallback {
        firstDrawMs = SystemClock.uptimeMillis() - openedAt
        emit("drawn", "openToDrawnMs=$firstDrawMs")
        publish()
      }
    }
    val density = wrapper.resources.displayMetrics.density
    val dx = (l - pressScreen[0]) / density
    val dy = (t - pressScreen[1]) / density
    val dyBottom = (b - pressScreen[1]) / density
    emit(
      "menuFrame",
      "menu=$menuFrame press=${pressScreen[0]},${pressScreen[1]} dxDp=${"%.1f".format(dx)} " +
        "dyTopDp=${"%.1f".format(dy)} dyBottomDp=${"%.1f".format(dyBottom)} openToLayoutMs=$firstFrameMs",
    )
    publish()
  }

  internal fun emit(event: String, detail: String) {
    seq += 1
    val line = "$seq|$event|t=${SystemClock.uptimeMillis()}|$detail"
    android.util.Log.i("S3ContextMenu", "${wrapper.getTag(com.facebook.react.R.id.react_test_id)} $line")
    onTrace?.invoke(line)
  }

  private fun publish() {
    val kids = StringBuilder()
    for (index in 0 until wrapper.reactChildCount) {
      val child = wrapper.getChildAt(index)
      if (kids.isNotEmpty()) kids.append('|')
      val id = child.getTag(com.facebook.react.R.id.react_test_id) as? String ?: "-"
      val density = wrapper.resources.displayMetrics.density
      kids.append(
        "$id@${"%.1f".format(child.left / density)},${"%.1f".format(child.top / density)}," +
          "${"%.1f".format(child.width / density)},${"%.1f".format(child.height / density)}",
      )
    }
    val density = wrapper.resources.displayMetrics.density
    report =
      "box=${"%.1f".format(wrapper.width / density)}x${"%.1f".format(wrapper.height / density)};" +
      "hostIndex=${wrapper.indexOfChild(host)}/${wrapper.childCount};" +
      "open=${if (isOpen) 1 else 0};opens=$opens;closes=$closes;selects=$selects;via=$lastVia;" +
      "press=${pressScreen[0]},${pressScreen[1]};menu=$menuFrame;layoutMs=$firstFrameMs;drawMs=$firstDrawMs;" +
      "longClickable=${if (wrapper.isLongClickable) 1 else 0};kids=$kids"
  }
}
