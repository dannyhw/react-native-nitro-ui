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
 * The `Form` of the S6 spike on Android: React Native's own scrollable column of sections,
 * painted with Material 3's grouped page colour (Q10 Appendix C1).
 *
 * **Android has no platform Form**, so there is nothing to host and no composition to
 * carry: the box is a `ReactViewGroup` and the rows stay where Yoga put them - which is also
 * what gives Android `measure()`, `ScrollView` recycling and keyboard scrolling for free from
 * React Native. The one thing the Hybrid View adds over a `View` is the colour: it comes
 * from the same Material 3 scheme every other control draws with ([NitroUiColorSchemes])
 * rather than from a hex literal in a JS file, which is the difference between using M3 and
 * imitating it (D38.1). Everything per row is drawn by the section's single Compose layer
 * (`HybridNitroUiFormSection.kt`).
 *
 * **The scroller is React Native's**, and that single fact decides three things here:
 *
 * - `onContentOffset` is never called, and `nuiContentOffsetY` is never read. React Native's
 *   own `ScrollView` shadow node already answers `getContentOriginOffset` for everything
 *   inside it, which is the very hook a Form's shadow node exists to override on iOS. Reporting
 *   an offset here would subtract the scroll twice (D45 item 3);
 * - a section reports `onPlacement(0)` and flows in place, so a row's Yoga origin is already
 *   where it is drawn;
 * - the keyboard is React Native's problem too, and it half-solves it: `ReactScrollView`
 *   scrolls to whatever `requestChildRectangleOnScreen` reaches it with, and a Form's rows are
 *   not its direct children. [NitroUiFormView] and the section's view close that gap by
 *   forwarding the request with the rectangle moved into their own space (D45 item 1), and
 *   [onImeInset] reserves the keyboard's height at the end of the scroll content so the last
 *   row can be scrolled clear of it at all.
 */
internal class HybridNitroUiForm(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormSpec(), RecyclableView {
  override val view: NitroUiFormView by lazy { NitroUiFormView(reactContext, this) }

  private var avoidsKeyboard = true
  private var perfInstanceId = NitroUiPerf.NO_INSTANCE
  private var reportedWidthDp = -1f
  private var imeInsetCallback: ((inset: Double) -> Unit)? = null
  private var reportedImeInsetDp = -1f

  /**
   * Received and never read. The scroll correction inside a React Native `ScrollView` is that
   * scroll view's own shadow node's job, and doing it here as well would subtract the offset
   * twice — which is why `Form.tsx` sends the number on both platforms and only iOS acts on it.
   */
  override var nuiContentOffsetY: Variant_NullType_Double
    get() = Variant_NullType_Double.First(NullType.NULL)
    set(@Suppress("UNUSED_PARAMETER") value) {
      // Deliberately dropped; see the class header.
    }

  /**
   * Never called on Android, for the same reason in the other direction: the scroller above
   * this view already tells the shadow tree how far it has scrolled. Declared because the spec
   * declares it, and because `Form.tsx` sends every prop on both platforms.
   */
  override var onContentOffset: ((y: Double) -> Unit)? = null

  /**
   * The `ime` inset this window did not consume by resizing, in dp, whenever it changes.
   *
   * The Form cannot add it to the viewport — that view is React Native's `ScrollView`, above
   * the Form — so the number goes back to `Form.tsx`, which grows the scroll content by it.
   * Under the example app's `adjustResize` the window *does* resize and this is 0, which is the
   * correct answer and not a missing one: there is nothing left to reserve.
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
  }

  override fun onDropView() {
    onContentBox = null
    onContentOffset = null
    onImeInset = null
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

  /**
   * The rows under this Form, read by walking the box rather than from a table the rows
   * register themselves in. Android keeps rows in place, so the tree *is* the answer, and a
   * walker cannot go stale when a mount or an unmount races a report — the failure iOS's
   * reparenting had to design around, which Android does not have.
   */
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
   * The report as JavaScript sees it.
   *
   * A Nitro method runs on the JS thread and every number here is the UI thread's, so
   * the read is eventually consistent - built on the UI thread and returned as it last
   * stood, the rule `HybridNitroUiBottomSheet.nuiTestStateReport` sets. The harness
   * polls a report until it says what the test is waiting for.
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
      // The Form's own answer to "did anything reach React about the keyboard": the inset JS
      // was told to reserve, and whether the scroller is even allowed to try.
      "keyboard=${if (avoidsKeyboard) "rn" else "off"}",
      "ime=${String.format("%.2f", if (reportedImeInsetDp < 0f) 0f else reportedImeInsetDp)}",
      "offset=0.00",
      "origin=0.00",
      "placed=${if (view.isAttachedToWindow) sectionsInView() else 0}",
    ).joinToString(";")
  }

  /**
   * How far the Form's own `ScrollView` has scrolled, in dp.
   *
   * S6b question 4 needs this number to be read rather than assumed: React Native's
   * `measure` walks the shadow tree and subtracts no scroll offset (0.88's
   * `UIManagerBinding.cpp` calls the shared `dom::measureInWindow`, which sums Yoga
   * origins and never looks at a view), so a row in this `ScrollView` measures where it
   * was laid out, not where it is drawn. The `E7` case adds this back on Android and
   * asserts it is the whole difference.
   */
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

  /**
   * There is no platform `Form` on Android to compare with, so question 2's reference is an
   * iOS-only seam and every command here does nothing. The report keeps `kind=prototype`.
   */
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

  /**
   * `surfaceContainerLow`: one tonal step below a row's `surface`
   * (`ListTokens.ItemSegmentedContainerColor`), the way iOS's grouped colours sit.
   */
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
   * Ask the window for its `ime` inset, and keep asking.
   *
   * `setOnApplyWindowInsetsListener` on a view React Native owns is safe in the one way that
   * matters here: the return value is this view's *own* consumed insets, and returning
   * [ViewCompat.onApplyWindowInsets] unchanged leaves the dispatch to the app exactly as it
   * found it. Nothing here eats an inset another view needed.
   */
  fun watchImeInset() {
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      hybrid.noteImeInsetPx(ime.toFloat())
      ViewCompat.onApplyWindowInsets(v, insets)
    }
    ViewCompat.requestApplyInsets(this)
  }

  /** Drop the listener, so a recycled view cannot report into a dead Hybrid. */
  fun tagImeListenerToNothing() {
    ViewCompat.setOnApplyWindowInsetsListener(this, null)
  }

  /**
   * A descendant — a focused field, three views down — wants to be seen.
   *
   * `ReactScrollView.onRequestChildFocus` asks its *direct* children this, so a Form nested
   * inside a scroll view is never asked at all, and the row under the keyboard stays under it
   * (S6b measured this as the red real-input case). Answering is a translation, not a scroll:
   * move the rectangle into this view's space and pass the request up with `this` as the child,
   * which is the contract `ReactScrollView` expects from a child it has been given.
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

  /**
   * A rectangle given in [child]'s coordinates, in ours — which is what `requestChildRectangleOnScreen`
   * means when the child it is handed is `this`.
   *
   * The offset is the child's position, not a guess at it, because the framework's own
   * implementation does the same addition (`ViewGroup.requestChildRectangleOnScreen` →
   * `offsetDescendantRectToMyCoords`). A Form's box does not scroll, so there is no scroll
   * correction to fold in; the scroll lives in the `ScrollView` above, which is exactly the
   * view being asked to do something about it.
   */
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
 * The Fabric manager of `NitroUiForm` - hand-written and registered instead of nitrogen's
 * generated `HybridNitroUiFormManager`, for the `<Host>`/BottomSheet/ContextMenu reason: a
 * generated manager is a `SimpleViewManager` with no `IViewGroupManager` half, and a Form's
 * whole content is React Native children.
 *
 * Unlike a ContextMenu's, this view has no extra child to keep out of Fabric's indices, so
 * the group methods are `ReactViewManager`'s own and only the props batch is redirected.
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
