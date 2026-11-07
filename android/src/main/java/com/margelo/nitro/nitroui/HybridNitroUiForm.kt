package com.margelo.nitro.nitroui

import android.os.Looper
import android.os.Handler
import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
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
 * **The scroller is React Native's.** iOS's `Form` *is* a `UICollectionView` and scrolls
 * itself, so the spike's `Form.tsx` wraps this box in a `ScrollView` on Android only. That
 * asymmetry is a finding, not a detail: the report leads with it.
 */
internal class HybridNitroUiForm(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormSpec(), RecyclableView {
  override val view: NitroUiFormView by lazy { NitroUiFormView(reactContext, this) }

  private var avoidsKeyboard = true
  private var perfInstanceId = NitroUiPerf.NO_INSTANCE
  private var reportedWidthDp = -1f


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
  }

  override fun onDropView() {
    onContentBox = null
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
    var sections = 0
    for (index in 0 until view.childCount) {
      if (view.getChildAt(index) is NitroUiFormSectionView) sections++
    }
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
      "keyboard=${if (avoidsKeyboard) "rn" else "off"}",
    ).joinToString(";")
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
