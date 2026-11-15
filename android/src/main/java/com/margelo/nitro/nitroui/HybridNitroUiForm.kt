package com.margelo.nitro.nitroui

import android.graphics.Rect
import android.os.Looper
import android.os.Handler
import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroUiColorSchemes
import com.margelo.nitro.nitroui.core.NitroUiPerf
import androidx.compose.ui.graphics.toArgb
import com.margelo.nitro.views.RecyclableView
import com.margelo.nitro.nitroui.views.HybridNitroUiFormStateUpdater

/**
 * The `Form` on Android: a `ReactViewGroup` painted with Material 3's grouped page colour.
 * The rows stay where Yoga put them, inside React Native's own `ScrollView`, so the scroll
 * offset is that scroll view's business and only keyboard avoidance is handled here.
 */
internal class HybridNitroUiForm(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormSpec(), RecyclableView {
  override val view: NitroUiFormView by lazy { NitroUiFormView(reactContext, this) }

  private var avoidsKeyboard = true

  internal val avoidsKeyboardForIme: Boolean
    get() = avoidsKeyboard
  private var perfInstanceId = NitroUiPerf.NO_INSTANCE
  private var reportedWidthDp = -1f
  private var imeInsetCallback: ((inset: Double) -> Unit)? = null
  private var reportedImeInsetDp = -1f

  /**
   * Ignored: React Native's `ScrollView` shadow node already applies the scroll offset, and
   * applying it here as well would subtract it twice.
   */
  override var nuiContentOffsetY: Variant_NullType_Double
    get() = Variant_NullType_Double.First(NullType.NULL)
    set(@Suppress("UNUSED_PARAMETER") value) {
      // Deliberately dropped.
    }

  /** Never called on Android: the scroll view above already reports its own offset. */
  override var onContentOffset: ((y: Double) -> Unit)? = null

  /**
   * The `ime` inset the window did not consume by resizing, in dp, reported on change. The
   * scroll view is React Native's, so JavaScript grows the scroll content by this amount.
   */
  override var onImeInset: ((inset: Double) -> Unit)?
    get() = imeInsetCallback
    set(value) {
      imeInsetCallback = value
      if (value != null) view.watchImeInset()
    }


  override var keyboardAvoidance: Boolean
    get() = avoidsKeyboard
    set(value) {
      avoidsKeyboard = value
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(perfInstanceId.toDouble())
      }
    set(next) {
      val raw = next.asSecondOrNull()
      perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var onContentBox: ((width: Double) -> Unit)? = null

  override fun afterUpdate() {
    view.paint()
  }

  override fun prepareForRecycle() {
    reportedWidthDp = -1f
    reportedImeInsetDp = -1f
    // The report is a cache; without this a recycled Form's first read would describe its
    // previous owner.
    report = "pending"
    view.resetAccessibility()
  }

  override fun onDropView() {
    onContentBox = null
    onContentOffset = null
    onImeInset = null
    view.resetAccessibility()
    view.tagImeListenerToNothing()
  }

  /** Called by the box when the `ime` inset moved. dp, and once per change. */
  fun noteImeInsetPx(px: Float) {
    val callback = imeInsetCallback ?: return
    val dp = (px / view.resources.displayMetrics.density).coerceAtLeast(0f)
    if (reportedImeInsetDp >= 0f && Math.abs(dp - reportedImeInsetDp) < 0.5f) return
    reportedImeInsetDp = dp
    callback(dp.toDouble())
  }

  /** The Form's content width, in px, reported in dp once per change. */
  fun noteContentWidth(widthPx: Float) {
    if (widthPx <= 0f) return
    val dp = widthPx / view.resources.displayMetrics.density
    if (reportedWidthDp >= 0f && Math.abs(dp - reportedWidthDp) < 0.25f) return
    reportedWidthDp = dp
    onContentBox?.invoke(dp.toDouble())
  }

  /** The rows under this Form, read by walking the view tree. */
  private val rows: List<NitroUiFormRowView>
    get() = view.rowViews()

  /** Direct children that are sections, for the report. */
  private fun sectionsInView(): Int {
    var count = 0
    for (index in 0 until view.childCount) {
      if (view.getChildAt(index) is NitroUiFormSectionView) count++
    }
    return count
  }

  /**
   * The cached test report. A Nitro method runs on the JS thread and the state is the UI
   * thread's, so a read returns the last build and posts a rebuild for the next one.
   */
  @Volatile private var report = "pending"
  private val reportHandler = Handler(Looper.getMainLooper())

  override fun nuiTestFormReport(): String {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      report = buildFormReport()
    } else {
      reportHandler.post { report = buildFormReport() }
    }
    return report
  }

  /** Read on the UI thread only. */
  private fun buildFormReport(): String {
    val density = view.resources.displayMetrics.density
    val sections = sectionsInView()
    val rows = rows
    val heights = rows.take(6).joinToString(",") { String.format("%.1f", it.height / density) }
    return listOf(
      "sections=$sections",
      "rows=${rows.size}",
      "inCells=${rows.count { it.isLocallyVisible() }}",
      "orphans=${rows.count { it.parent == null }}",
      "alive=${rows.size}",
      "width=${String.format("%.2f", reportedWidthDp)}",
      "heights=$heights",
      "taps=${rows.sumOf { it.taps }}",
      "pressed=${rows.count { it.pressed }}",
      "scroll=${String.format("%.1f", scrollOffsetDp())}",
      "keyboard=${if (avoidsKeyboard) "rn" else "off"}",
      "ime=${String.format("%.2f", if (reportedImeInsetDp < 0f) 0f else reportedImeInsetDp)}",
      "offset=0.00",
      "origin=0.00",
      "placed=${if (view.isAttachedToWindow) sectionsInView() else 0}",
    ).joinToString(";")
  }

  /** How far the `ScrollView` above the Form has scrolled, in dp. */
  private fun scrollOffsetDp(): Double {
    val density = view.resources.displayMetrics.density
    var parent: Any? = view.parent
    while (parent is View) {
      if (parent is ScrollView) return (parent.scrollY / density).toDouble()
      parent = parent.parent
    }
    return 0.0
  }

  override fun nuiTestScrollTo(y: Double) {
    reportHandler.post { scrollToDp(y) }
  }

  /** The test commands act on the iOS list; there is nothing for them to do on Android. */
  override fun nuiTestCommand(command: String) = Unit

  private fun scrollToDp(y: Double) {
    val density = view.resources.displayMetrics.density
    var parent: Any? = view.parent
    while (parent is View) {
      if (parent is ScrollView) {
        parent.scrollTo(0, (y * density).toInt())
        return
      }
      parent = parent.parent
    }
  }
}

/** The Form's box: React Native's `View`, plus the Material 3 grouped page colour. */
internal class NitroUiFormView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiForm,
) : ReactViewGroup(context) {
  init {
    paint()
  }

  /** `surfaceContainerLow`: one tonal step below a row's `surface`. */
  fun paint() {
    val dark =
      resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
      Configuration.UI_MODE_NIGHT_YES
    setBackgroundColor(NitroUiColorSchemes.forContext(context, dark).surfaceContainerLow.toArgb())
  }

  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    hybrid.noteContentWidth(w.toFloat())
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    paint()
    hybrid.noteContentWidth(width.toFloat())
    watchImeInset()
  }

  /**
   * Listen for the window's `ime` inset. The listener returns the insets unchanged, so it
   * consumes nothing another view needs.
   */
  fun watchImeInset() {
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
      noteImeInsetPx(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
      ViewCompat.onApplyWindowInsets(v, insets)
    }
    ViewCompat.requestApplyInsets(this)
  }

  /**
   * React Native's `prepareToRecycleView` leaves `contentDescription` and
   * `importantForAccessibility` alone, so a pooled view would keep its previous identity.
   */
  fun resetAccessibility() {
    contentDescription = null
    isClickable = false
    isLongClickable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
  }

  /** Drop the listener, so a recycled view cannot report into a dead Hybrid. */
  fun tagImeListenerToNothing() {
    ViewCompat.setOnApplyWindowInsetsListener(this, null)
    removeCallbacks(revealFocusedRow)
    imeInsetPx = 0
    pendingImeReveal = false
  }

  // MARK: The keyboard

  /** The `ime` inset the window has not consumed by resizing, in px. 0 with no keyboard up. */
  private var imeInsetPx = 0

  /** Whether the focused row still has to be moved clear of the keyboard. */
  private var pendingImeReveal = false

  private var revealAttempts = 0

  /**
   * The `ime` inset changed. Its height is reported to JavaScript, which reserves it at the
   * end of the scroll content, and the focused row is then scrolled clear of the keyboard.
   */
  fun noteImeInsetPx(px: Int) {
    val inset = px.coerceAtLeast(0)
    if (inset == imeInsetPx) return
    imeInsetPx = inset
    hybrid.noteImeInsetPx(inset.toFloat())
    pendingImeReveal = inset > 0
    revealAttempts = 0
    if (pendingImeReveal) post(revealFocusedRow)
  }

  /**
   * Scroll the focused view into the part of the scroll view above the keyboard. Retried a
   * bounded number of times: the scroll content only grows by the reserved inset after a
   * React round trip, and until then the scroll view cannot move the row far enough.
   */
  private val revealFocusedRow =
    object : Runnable {
      override fun run() {
        if (!isShown || !isAttachedToWindow) return
        if (!pendingImeReveal || !hybrid.avoidsKeyboardForIme || imeInsetPx == 0) {
          pendingImeReveal = false
          return
        }
        val scroller = scrollableView()
        if (scroller == null) {
          pendingImeReveal = false
          return
        }
        val focused = findFocus()
        if (focused == null || focused === this@NitroUiFormView) {
          pendingImeReveal = false
          return
        }
        val density = resources.displayMetrics.density
        val here = IntArray(2)
        focused.getLocationInWindow(here)
        val there = IntArray(2)
        scroller.getLocationInWindow(there)
        val visibleBottom = there[1] + scroller.height - imeInsetPx
        val margin = (IME_REVEAL_MARGIN_DP * density).toInt()
        val deficit = here[1] + focused.height + margin - visibleBottom
        if (deficit <= 0) {
          pendingImeReveal = false
          return
        }
        scroller.scrollBy(0, deficit)
        revealAttempts += 1
        if (revealAttempts < IME_REVEAL_ATTEMPTS) {
          postDelayed(this, IME_REVEAL_INTERVAL_MS)
        } else {
          pendingImeReveal = false
        }
      }
    }

  /** React Native's `ScrollView` above this view, or null when the Form is not scrolling. */
  private fun scrollableView(): ScrollView? {
    var parent: Any? = this.parent
    while (parent is View) {
      if (parent is ScrollView) return parent
      parent = parent.parent
    }
    return null
  }

  /** A field focused while the keyboard is already up is revealed the same way. */
  override fun requestChildFocus(
    child: View,
    focused: View,
  ) {
    super.requestChildFocus(child, focused)
    if (imeInsetPx <= 0 || !hybrid.avoidsKeyboardForIme) return
    pendingImeReveal = true
    revealAttempts = 0
    post(revealFocusedRow)
  }

  /** The content grew — possibly by the reservation itself. Re-check a pending reveal. */
  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    super.onLayout(changed, left, top, right, bottom)
    if (pendingImeReveal) post(revealFocusedRow)
  }

  private companion object {
    const val IME_REVEAL_ATTEMPTS = 12
    const val IME_REVEAL_INTERVAL_MS = 50L

    /** The gap left between the focused view and the top of the keyboard, in dp. */
    const val IME_REVEAL_MARGIN_DP = 8f
  }

  /**
   * `ReactScrollView` only scrolls to a rectangle its direct child asks for, so a request
   * from a descendant is passed up with the rectangle moved into this view's coordinates.
   */
  override fun requestChildRectangleOnScreen(
    child: View,
    rectangle: Rect,
    immediate: Boolean,
  ): Boolean {
    val scrolled = super.requestChildRectangleOnScreen(child, rectangle, immediate)
    val parent = parent?.requestChildRectangleOnScreen(this, translateIntoSelf(child, rectangle), immediate)
    return scrolled || (parent == true)
  }

  override fun requestChildRectangleOnScreen(
    child: View,
    rectangle: Rect,
    immediate: Boolean,
    direction: Int,
  ): Boolean {
    val scrolled =
      super.requestChildRectangleOnScreen(child, rectangle, immediate, direction)
    val parent =
      parent?.requestChildRectangleOnScreen(
        this,
        translateIntoSelf(child, rectangle),
        immediate,
        direction,
      )
    return scrolled || (parent == true)
  }

  /** A rectangle given in [child]'s coordinates, moved into this view's. */
  private fun translateIntoSelf(
    child: View,
    rectangle: Rect,
  ): Rect {
    val out = Rect(rectangle)
    out.offset(child.left - scrollX, child.top - scrollY)
    return out
  }

  /** Every [NitroUiFormRowView] below here, in layout order, sections included. */
  fun rowViews(): List<NitroUiFormRowView> {
    val out = ArrayList<NitroUiFormRowView>()
    collect(this, out)
    return out
  }

  private fun collect(
    parent: ViewGroup,
    into: MutableList<NitroUiFormRowView>,
  ) {
    for (index in 0 until parent.childCount) {
      when (val child = parent.getChildAt(index)) {
        is NitroUiFormRowView -> into.add(child)
        is ViewGroup -> collect(child, into)
        else -> {}
      }
    }
  }
}

/**
 * The Fabric manager of `NitroUiForm`, used instead of nitrogen's generated one: a generated
 * manager is a `SimpleViewManager`, which cannot take React Native children.
 */
internal class NitroUiFormViewManager : ReactViewManager() {
  private class Holder(
    val hybridView: HybridNitroUiForm,
    var lastState: StateWrapper? = null,
  )

  init {
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiForm"

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val hybridView = HybridNitroUiForm(context)
    val view = hybridView.view
    view.setTag(associated_hybrid_view_tag, Holder(hybridView))
    return view
  }

  override fun updateState(
    view: ReactViewGroup,
    props: ReactStylesDiffMap,
    stateWrapper: StateWrapper,
  ): Any? {
    val holder = holder(view) ?: throw Error("Couldn't find view $view in local views table!")
    holder.hybridView.beforeUpdate()
    HybridNitroUiFormStateUpdater.updateViewProps(holder.hybridView, stateWrapper, holder.lastState)
    holder.hybridView.afterUpdate()
    holder.lastState = stateWrapper
    return super.updateState(view, props, stateWrapper)
  }

  override fun onDropViewInstance(view: ReactViewGroup) {
    val holder = holder(view)
    holder?.lastState = null
    holder?.hybridView?.onDropView()
    super.onDropViewInstance(view)
  }

  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: ReactViewGroup,
  ): ReactViewGroup? {
    val prepared = super.prepareToRecycleView(reactContext, view) ?: return null
    val holder = holder(prepared) ?: return null
    holder.lastState = null
    holder.hybridView.prepareForRecycle()
    return prepared
  }

  private fun holder(view: View): Holder? = view.getTag(associated_hybrid_view_tag) as? Holder
}
