package com.margelo.nitro.nitroui

import android.os.Looper
import android.os.Handler
import android.app.Activity
import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import com.margelo.nitro.R.id.associated_hybrid_view_tag
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView
import com.margelo.nitro.nitroui.views.HybridNitroUiFormSectionStateUpdater
import kotlin.math.roundToInt

/**
 * The `Section` of the S6 spike on Android: React Native rows kept in place, with **one**
 * Compose layer behind them drawing Material 3 Expressive's segmented-list shapes (Q10
 * Appendix C1).
 *
 * The rows stay where Yoga put them, as a ContextMenu's do (D37), so `measure()`, the
 * keyboard, `ScrollView` recycling and every nitro-ui control's own mount path stay React
 * Native's. What Compose adds is what Android has no other source for:
 * `ListItemDefaults.segmentedShapes(index, count)` for the corner treatment,
 * `segmentedColors()` for the container, `SegmentedGap` for the space between shapes, and M3
 * Expressive's own press feedback - a *shape morph* plus a ripple (in material3
 * 1.5.0-beta02 a pressed segmented item resolves `shapes.pressedShape` and the ripple, and
 * its container colour changes only with enabled/selected).
 *
 * **One composition for the whole section, not one per row.** Appendix C1 drew a
 * `SegmentedListItem` container behind each row, and each of those is a Compose runtime - the
 * cost `docs/components/host.md` measures at 2.75x mount UI CPU and 1.39x memory per control
 * against a shared composition, paid here for one `Box` and one shape. So this layer draws
 * every row's shape from the rows' own rects, read from the row views after each layout. It
 * is the spike's main API argument to G-Form, and the report carries the number.
 *
 * The header and footer are Compose text in the same layer, at the section's top and bottom.
 * The space they take is measured *in Compose* and reported through `onMetrics`, so Yoga
 * reserves exactly what the text needed at the current font scale - a Dynamic Type change
 * re-reports it.
 */
internal class HybridNitroUiFormSection(
  private val reactContext: ThemedReactContext,
) : HybridNitroUiFormSectionSpec(), RecyclableView {
  override val view: NitroUiFormSectionView by lazy { NitroUiFormSectionView(reactContext, this) }

  private var rawTitle: String? = null
  private var rawFooter: String? = null
  private var perfInstanceId = NitroUiPerf.NO_INSTANCE
  private var reported: FormMetrics? = null

  override var title: Variant_NullType_String
    get() = rawTitle?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      rawTitle = next.asSecondOrNull()
    }

  override var footer: Variant_NullType_String
    get() = rawFooter?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      rawFooter = next.asSecondOrNull()
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

  override var onMetrics: ((headerHeight: Double, footerHeight: Double, inset: Double, gap: Double) -> Unit)? = null

  override fun afterUpdate() {
    view.refreshChrome()
  }

  override fun prepareForRecycle() {
    rawTitle = null
    rawFooter = null
    reported = null
    view.prepareSection()
  }

  override fun onDropView() {
    onMetrics = null
    view.dropSection()
  }

  /** What the layer measured, in px; reported in dp once per change. */
  fun reportMetrics(
    headerPx: Float,
    footerPx: Float,
    insetPx: Float,
    gapPx: Float,
  ) {
    val callback = onMetrics ?: return
    val density = view.resources.displayMetrics.density
    val next =
      FormMetrics(
        header = headerPx / density,
        footer = footerPx / density,
        inset = insetPx / density,
        gap = gapPx / density,
      )
    if (reported == next) return
    reported = next
    callback(next.header.toDouble(), next.footer.toDouble(), next.inset.toDouble(), next.gap.toDouble())
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

  override fun nuiTestSectionReport(): String {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      report = buildSectionReport()
    } else {
      reportHandler.post { report = buildSectionReport() }
    }
    return report
  }

  /** Read on the UI thread only. */
  private fun buildSectionReport(): String {
    val density = view.resources.displayMetrics.density
    val rows = view.rowViews
    val rects =
      view.model.rects.joinToString(",") {
        String.format("%.0f-%.0f", it.top / density, it.height / density)
      }
    return listOf(
      "rows=${rows.size}",
      "index=${view.sectionIndex()}",
      "title=${rawTitle ?: "-"}",
      "footer=${rawFooter ?: "-"}",
      "gap=${String.format("%.1f", view.model.gapPx / density)}",
      "shapes=${view.model.rects.size}",
      "pressed=${if (view.model.pressedIndex >= 0) 1 else 0}",
      "header=${String.format("%.1f", view.model.headerPx / density)}",
      "rects=${rects.ifEmpty { "-" }}",
    ).joinToString(";")
  }
}

/** The four numbers a section reports to React Native, in dp. */
internal data class FormMetrics(val header: Float, val footer: Float, val inset: Float, val gap: Float)

/** The state of one section's shape layer. */
internal class FormSectionModel : NitroUiModel() {
  /** One entry per row, in React's order, in the section's px. */
  var rects by mutableStateOf<List<FormRowRect>>(emptyList())
  var headerText by mutableStateOf<String?>(null)
  var footerText by mutableStateOf<String?>(null)

  /** The row the finger is on, by index; -1 for none. */
  var pressedIndex by mutableStateOf(-1)

  /** `ListItemDefaults.SegmentedGap`, in px, once the layer has read it. */
  var gapPx = 0f

  /** What the header and footer text took, in px, as Compose measured them. */
  var headerPx = 0f
  var footerPx = 0f

  /** Leaves those numbers for JavaScript. Set by the Hybrid View, which owns the Fabric node. */
  var onMetrics: ((headerPx: Float, footerPx: Float, insetPx: Float, gapPx: Float) -> Unit)? = null

  override fun reset() {
    rects = emptyList()
    headerText = null
    footerText = null
    pressedIndex = -1
  }
}

/** One row's box in the section's px, plus what its shape and accessory need. */
internal data class FormRowRect(
  val left: Float,
  val top: Float,
  val right: Float,
  val height: Float,
  val selected: Boolean,
  /** `NitroUiFormRowView.ACCESSORY_*` - mirrors `NitroUiFormAccessory`. */
  val accessory: Int,
)

/**
 * The section's `ReactViewGroup`: React Native's children in place, one Compose host behind
 * them, and the row rects that layer draws.
 *
 * The host is a child of this view but hidden from Fabric's indices, exactly as
 * [ContextMenuView] keeps its menu host out - an insert at `n` lands among the rows and an
 * unmount never takes the host.
 */
internal class NitroUiFormSectionView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiFormSection,
) : ReactViewGroup(context) {
  val model = FormSectionModel()
  private var composeHost: FormSectionHost? = null
  private var hostLayoutPosted = false

  init {
    val host = FormSectionHost(context, context.currentActivity, model)
    // The shapes and text are decoration over React Native's own content: the layer adds no
    // accessibility node, and the rows keep theirs.
    host.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    composeHost = host
    model.onMetrics = { header, footer, inset, gap -> hybrid.reportMetrics(header, footer, inset, gap) }
    addView(host)
  }

  val rowViews: List<NitroUiFormRowView>
    get() = (0 until childCount).mapNotNull { getChildAt(it) as? NitroUiFormRowView }

  /** This section's position among the Form's sections, for the report. */
  fun sectionIndex(): Int {
    val parentView = parent as? ViewGroup ?: return -1
    var index = 0
    for (child in 0 until parentView.childCount) {
      val sibling = parentView.getChildAt(child)
      if (sibling === this) return index
      if (sibling is NitroUiFormSectionView) index++
    }
    return -1
  }

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

  /**
   * Measure and lay the Compose host over this whole box, then hand it the rows' boxes.
   *
   * The measure-then-layout order and the force-layout guard are [ContextMenuView]'s, for the
   * same reason: `ReactViewGroup.requestLayout` is a no-op, so a request from the host has to
   * be answered here or the composition stops being laid out.
   */
  private fun layoutHost() {
    val host = composeHost ?: return
    if (host.parent !== this) return
    if (width > 0 && height > 0) {
      val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
      val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
      host.measure(widthSpec, heightSpec)
      host.layout(0, 0, width, height)
    }
    publishRects()
  }

  /**
   * Give the layer the rows' boxes. Called from `onLayout`, which is where Fabric's writes to a
   * row's frame have just happened - so a shape and its content cannot disagree.
   */
  fun publishRects() {
    val gap = model.gapPx
    model.rects =
      rowViews.map { row ->
        FormRowRect(
          left = row.left.toFloat(),
          top = row.top + gap / 2f,
          right = row.right.toFloat(),
          height = (row.height - gap).coerceAtLeast(0f),
          selected = row.rowSelected,
          accessory = row.rowAccessory,
        )
      }
  }

  fun refreshChrome() {
    model.headerText = hybrid.title.asSecondOrNull()
    model.footerText = hybrid.footer.asSecondOrNull()
    composeHost?.perfInstanceId = hybrid.nuiPerfId.asSecondOrNull()?.toInt() ?: NitroUiPerf.NO_INSTANCE
    publishRects()
  }

  fun prepareSection() {
    model.reset()
  }

  fun dropSection() {
    composeHost?.let { removeView(it) }
    composeHost = null
  }

  /** The finger is on this row, or is no longer. */
  fun setPressed(
    row: NitroUiFormRowView,
    pressed: Boolean,
  ) {
    model.pressedIndex = if (pressed) rowViews.indexOf(row) else -1
  }

  /** A row's press feedback is drawn here, so the row needs somewhere to put its interaction. */
  fun interactionSourceFor(row: NitroUiFormRowView): MutableInteractionSource? =
    composeHost?.interactionSourceFor(rowViews.indexOf(row))

  override fun requestLayout() {
    super.requestLayout()
    if (composeHost != null && !hostLayoutPosted) {
      hostLayoutPosted = true
      post {
        hostLayoutPosted = false
        layoutHost()
      }
    }
  }

  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int,
  ) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w > 0 && h > 0) post { layoutHost() }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (width > 0 && height > 0) post { layoutHost() }
  }

  // MARK: Fabric's children, minus the Compose host

  val reactChildCount: Int
    get() = childCount - (if (composeHost?.parent === this) 1 else 0)

  fun reactChildAt(index: Int): View? {
    var seen = 0
    for (child in 0 until childCount) {
      val candidate = getChildAt(child)
      if (candidate === composeHost) continue
      if (seen == index) return candidate
      seen++
    }
    return null
  }

  /** Insert at Fabric's index, with the host kept last. */
  fun addReactChild(
    child: View,
    index: Int,
  ) {
    val host = composeHost
    if (host == null || host.parent !== this) {
      addView(child, index.coerceAtMost(childCount))
      return
    }
    var target = index
    for (existing in 0 until childCount) {
      if (getChildAt(existing) === host && existing <= target) target++
    }
    addView(child, target.coerceAtMost(childCount))
  }

  fun removeReactChild(child: View) {
    if (child === composeHost) return
    removeView(child)
  }

  fun removeReactChildAt(index: Int) {
    reactChildAt(index)?.let { removeReactChild(it) }
  }

  fun removeAllReactChildren() {
    while (reactChildCount > 0) removeReactChildAt(0)
  }
}

/** The section's Compose layer: shapes, press feedback, accessories, header and footer. */
internal class FormSectionHost(
  context: Context,
  activity: Activity?,
  model: FormSectionModel,
) : NitroComposeHost<FormSectionModel>(context, activity, model) {
  /** The layer fills the section; nothing is centred in it. */
  override val centersContent: Boolean
    get() = false

  private val sources = mutableMapOf<Int, MutableInteractionSource>()

  fun interactionSourceFor(index: Int): MutableInteractionSource =
    sources.getOrPut(index) { MutableInteractionSource() }

  @Composable
  override fun Component(model: FormSectionModel) {
    FormSegmentedLayer(model, sources)
  }
}

/**
 * The drawing. Shapes and colours come from material3's own segmented factories; the row boxes
 * come from the row views; the text is measured here and reported from here.
 */
@Composable
internal fun FormSegmentedLayer(
  model: FormSectionModel,
  sources: MutableMap<Int, MutableInteractionSource>,
) {
  val density = LocalDensity.current
  val gap = ListItemDefaults.SegmentedGap
  val inset = FormListMetrics.ContainerInset
  val colors = ListItemDefaults.segmentedColors()
  val count = model.rects.size
  val pressed = model.pressedIndex
  // `segmentedShapes` and `ripple` are @Composable, so the shapes resolve here and the two
  // canvases below only draw what this list already resolved.
  val shapes = model.rects.indices.map { ListItemDefaults.segmentedShapes(it, count) }

  Box(Modifier.fillMaxSize()) {
    // 1. The row containers. Drawn rather than composed: a row's shape is
    //    `segmentedShapes(index, count)`, resolved for its pressed/selected state the way
    //    material3's own `InteractiveListItem` resolves it.
    Canvas(Modifier.fillMaxSize()) {
      if (model.gapPx != gap.toPx()) model.gapPx = gap.toPx()
      model.rects.forEachIndexed { index, rect ->
        drawRowContainer(rect, resolvedShape(shapes[index], rect.selected, index == pressed), colors)
      }
    }
    // 2. The press indication. material3's clickable `SegmentedListItem` draws
    //    `ripple(focusRingShape = shape)`, and the finger is on a React Native view, so the
    //    row feeds the interaction into a source it holds here.
    model.rects.forEachIndexed { index, rect ->
      val source = sources.getOrPut(index) { MutableInteractionSource() }
      Box(
        Modifier
          .align(Alignment.TopStart)
          .offset { IntOffset(rect.left.roundToInt(), rect.top.roundToInt()) }
          .withPixelSize(rect.right - rect.left, rect.height)
          .indication(
            source,
            ripple(focusRingShape = resolvedShape(shapes[index], rect.selected, index == pressed)),
          ),
      )
    }
    // 3. The accessories: `UICellAccessory`'s Android twin, in the same layer, so a row
    //    holding a Switch keeps its own layout untouched.
    Canvas(Modifier.fillMaxSize()) {
      model.rects.forEachIndexed { _, rect ->
        if (rect.accessory != NitroUiFormRowView.ACCESSORY_NONE) {
          drawRowAccessory(rect, colors.contentColor(enabled = true, selected = rect.selected, dragged = false))
        }
      }
    }
    // 4. The header and footer, measured here so their space can be reserved by Yoga.
    model.headerText?.takeIf { it.isNotEmpty() }?.let { text ->
      Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier =
          Modifier
            .align(Alignment.TopStart)
            .padding(start = inset, end = inset, top = FormListMetrics.HeaderTopPadding)
            .onSizeChanged { model.headerPx = it.height.toFloat() },
      )
    }
    model.footerText?.takeIf { it.isNotEmpty() }?.let { text ->
      Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
        modifier =
          Modifier
            .align(Alignment.BottomStart)
            .padding(start = inset, end = inset, bottom = FormListMetrics.FooterBottomPadding)
            .onSizeChanged { model.footerPx = it.height.toFloat() },
      )
    }
  }

  // What the text took, out to React Native, once per change.
  val gapPx = with(density) { gap.toPx() }
  val insetPx = with(density) { inset.toPx() }
  LaunchedEffect(model.headerPx, model.footerPx, gapPx, insetPx) {
    model.onMetrics?.invoke(model.headerPx, model.footerPx, insetPx, gapPx)
  }
}

/** Give a layer the px size of one row, without a Dp round trip. */
private fun Modifier.withPixelSize(
  widthPx: Float,
  heightPx: Float,
): Modifier =
  this.then(
    layout { measurable, constraints ->
      val width = widthPx.roundToInt().coerceAtMost(constraints.maxWidth)
      val height = heightPx.roundToInt().coerceAtMost(constraints.maxHeight)
      val placeable = measurable.measure(Constraints.fixed(width, height))
      layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
    },
  )

/** The shape material3's `InteractiveListItem` would resolve for this row's state. */
private fun resolvedShape(
  shapes: androidx.compose.material3.ListItemShapes,
  selected: Boolean,
  pressed: Boolean,
): androidx.compose.ui.graphics.Shape =
  when {
    pressed -> shapes.pressedShape
    selected -> shapes.selectedShape
    else -> shapes.shape
  }

/** Draw one row's container the way material3 draws a segmented item's. */
private fun DrawScope.drawRowContainer(
  rect: FormRowRect,
  shape: androidx.compose.ui.graphics.Shape,
  colors: androidx.compose.material3.ListItemColors,
) {
  val box = Rect(rect.left, rect.top, rect.right, rect.top + rect.height)
  drawOutline(
    outline = shape.createOutline(Size(box.width, box.height), layoutDirection, this),
    color = colors.containerColor(enabled = true, selected = rect.selected, dragged = false),
    alpha = 1f,
  )
}

/** The trailing accessory, in the row's trailing padding: a chevron or a check. */
private fun DrawScope.drawRowAccessory(
  rect: FormRowRect,
  color: Color,
) {
  val trailing = rect.right - FormListMetrics.TrailingPadding
  val centreY = rect.top + rect.height / 2f
  val stroke = Stroke(width = 1.6f * density, cap = StrokeCap.Round)
  if (rect.accessory == NitroUiFormRowView.ACCESSORY_DISCLOSURE) {
    val size = 7f * density
    drawPath(
      Path().apply {
        moveTo(trailing - size, centreY - size)
        lineTo(trailing, centreY)
        lineTo(trailing - size, centreY + size)
      },
      color,
      style = stroke,
    )
  } else {
    val size = 9f * density
    drawPath(
      Path().apply {
        moveTo(trailing - size, centreY)
        lineTo(trailing - size * 0.45f, centreY + size * 0.55f)
        lineTo(trailing, centreY - size * 0.65f)
      },
      color,
      style = stroke,
    )
  }
}

/**
 * The numbers a segmented list needs that material3 1.5.0-beta02 has no token for: a row's
 * inset from the section's edge and the text paddings. Named once, here, instead of appearing
 * as literals in three places.
 */
internal object FormListMetrics {
  /** A row's inset from the section's edge. */
  val ContainerInset = 12.dp

  /** Above a section header's text. */
  val HeaderTopPadding = 16.dp

  /** Below a section footer's text. */
  val FooterBottomPadding = 12.dp

  /** Inside a row's trailing edge, where an accessory sits (px). */
  const val TrailingPadding = 16f
}

/**
 * The Fabric manager of `NitroUiFormSection`: hand-written for the same reason as the Form's,
 * and with the same host-hiding rule as [NitroUiContextMenuViewManager] - the Compose layer is
 * not a Fabric child, so it stays out of [getChildCount], [getChildAt] and the removals.
 */
internal class NitroUiFormSectionViewManager : ReactViewManager() {
  private class Holder(
    val hybridView: HybridNitroUiFormSection,
    var lastState: StateWrapper? = null,
  )

  init {
    super.setupViewRecycling()
  }

  override fun getName(): String = "NitroUiFormSection"

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val hybridView = HybridNitroUiFormSection(context)
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
    HybridNitroUiFormSectionStateUpdater.updateViewProps(holder.hybridView, stateWrapper, holder.lastState)
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

  override fun addView(
    parent: ReactViewGroup,
    child: View,
    index: Int,
  ) {
    (parent as NitroUiFormSectionView).addReactChild(child, index)
  }

  override fun getChildCount(parent: ReactViewGroup): Int =
    (parent as NitroUiFormSectionView).reactChildCount

  override fun getChildAt(
    parent: ReactViewGroup,
    index: Int,
  ): View? = (parent as NitroUiFormSectionView).reactChildAt(index)

  override fun removeViewAt(
    parent: ReactViewGroup,
    index: Int,
  ) {
    (parent as NitroUiFormSectionView).removeReactChildAt(index)
  }

  override fun removeView(
    parent: ReactViewGroup,
    view: View,
  ) {
    (parent as NitroUiFormSectionView).removeReactChild(view)
  }

  override fun removeAllViews(parent: ReactViewGroup) {
    (parent as NitroUiFormSectionView).removeAllReactChildren()
  }

  private fun holder(view: View): Holder? = view.getTag(associated_hybrid_view_tag) as? Holder
}
