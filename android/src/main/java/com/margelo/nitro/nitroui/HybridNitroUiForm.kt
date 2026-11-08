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
 * - the keyboard is React Native's problem too, and it solves neither half of it. A focused
 *   field asks its scroller through `requestChildRectangleOnScreen`, which `ReactScrollView`
 *   asks of its *direct* children only, so a Form's rows never reach it: [NitroUiFormView] and
 *   the section's view forward the request with the rectangle moved into their own space. And
 *   the scroller that is asked keeps its viewport where it was — `adjustResize` resizes
 *   nothing under API 35's edge-to-edge, measured on the lease's API 35 AVD — so scrolling a
 *   row "into the viewport" scrolls it to the bottom edge of the screen, *behind* the
 *   keyboard. The two halves that make a field actually visible are both the Form's:
 *   [onImeInset] reserves the keyboard's height at the end of the scroll content so the last
 *   row can be scrolled clear of it at all, and [NitroUiFormView.revealFocusedRow] moves it
 *   into what is left above the keyboard.
 */
internal class HybridNitroUiForm(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormSpec(), RecyclableView {
  override val view: NitroUiFormView by lazy { NitroUiFormView(reactContext, this) }

  private var avoidsKeyboard = true

  /** Whether the box may move a focused row for the keyboard — the `keyboardAvoidance` prop. */
  internal val avoidsKeyboardForIme: Boolean
    get() = avoidsKeyboard
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
      noteImeInsetPx(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
      ViewCompat.onApplyWindowInsets(v, insets)
    }
    ViewCompat.requestApplyInsets(this)
  }

  /** Drop the listener, so a recycled view cannot report into a dead Hybrid. */
  fun tagImeListenerToNothing() {
    ViewCompat.setOnApplyWindowInsetsListener(this, null)
    removeCallbacks(revealFocusedRow)
    imeInsetPx = 0
    pendingImeReveal = false
  }

  // MARK: The keyboard (D45 item 1)

  /** The `ime` inset the window has not consumed by resizing, in px. 0 with no keyboard up. */
  private var imeInsetPx = 0

  /** Whether the focused row still has to be moved clear of the keyboard. */
  private var pendingImeReveal = false

  /** Attempts spent on the current keyboard. See [IME_REVEAL_ATTEMPTS]. */
  private var revealAttempts = 0

  /**
   * The Form's own answer to the keyboard, in px of [imeInsetPx].
   *
   * Two numbers come from one inset, and they go to different places: the height goes back to
   * React through [HybridNitroUiForm.noteImeInsetPx], which reserves it at the end of the
   * scroll content, and the same height is what this view measures "clear of the keyboard"
   * against. Reserving without revealing leaves the field at the bottom edge of the screen,
   * behind the keyboard, which is exactly the shape S6b measured red and this branch shipped
   * red through two rounds: the row moved `ime=` from 0 to 336.48 dp and never moved itself.
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
   * Move the focused row into the part of the scroll view above the keyboard.
   *
   * `deficit` is the whole claim: how far the focused view's bottom edge hangs below the
   * bottom of the visible band. Zero or less means the field is already clear and nothing is
   * scrolled — a Form that yanked the page every time a field was tapped would fail the
   * same person who just scrolled somewhere else to read while typing.
   *
   * One attempt is rarely enough, because the reservation is a React round trip: the inset
   * arrives here first, and until the content has grown by it the scroller cannot move the
   * row as far as it has to. So an attempt that ended at the end of the content leaves the
   * claim pending and asks again, a bounded number of times, and a form whose row is clear
   * stops asking on the first try.
   *
   * The scroll is `scrollBy` on React Native's own `ScrollView`, so the offset the shadow
   * tree reports and every `onScroll` event go through the path React Native already owns.
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

  /**
   * A field focused while the keyboard is already up wants the same treatment.
   *
   * `requestChildFocus` is the hook `ViewGroup` actually offers for this: a Form's rows are
   * several levels below it, so the framework reports the focus here rather than to the row
   * that took it. `ViewGroup` has no `onChildFocus` to override — it asks for the `child`
   * whose branch the focus is in, which is why the signature reads like this.
   */
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

  /**
   * How many times one keyboard is answered for, and how far apart the attempts are.
   *
   * Bounded because the alternative is a `Runnable` that outlives the question: the React
   * round trip the reservation needs is a couple of frames on an idle device, and 12 attempts
   * at 50 ms is half a second, which is longer than the reservation and shorter than anything
   * a person would notice as the page moving under their finger.
   */
  private companion object {
    const val IME_REVEAL_ATTEMPTS = 12
    const val IME_REVEAL_INTERVAL_MS = 50L

    /** The gap left between the focused view and the top of the keyboard, in dp. */
    const val IME_REVEAL_MARGIN_DP = 8f
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
