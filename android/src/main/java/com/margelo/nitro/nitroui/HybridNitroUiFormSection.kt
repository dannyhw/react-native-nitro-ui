package com.margelo.nitro.nitroui

import android.graphics.Rect
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.views.RecyclableView
import com.margelo.nitro.nitroui.views.HybridNitroUiFormSectionStateUpdater
import kotlin.math.roundToInt

/**
 * A `Form.Section` on Android: React Native rows kept where Yoga put them, with one Compose
 * layer behind them drawing Material 3's segmented-list shapes, press feedback, accessories,
 * and the header and footer text. One composition serves the whole section, not one per row.
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

  /** Always called with `0`: on Android a section's rows are drawn where Yoga laid them out. */
  override var onPlacement: ((top: Double) -> Unit)? = null

  override fun afterUpdate() {
    view.refreshChrome()
    onPlacement?.invoke(0.0)
  }

  override fun prepareForRecycle() {
    rawTitle = null
    rawFooter = null
    reported = null
    view.prepareSection()
    view.resetAccessibility()
  }

  override fun onDropView() {
    onMetrics = null
    onPlacement = null
    view.resetAccessibility()
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
   * The cached test report. A Nitro method runs on the JS thread and the state is the UI
   * thread's, so a read returns the last build and posts a rebuild for the next one.
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
    val accessory = view.model.drawnAccessory
    val accessoryFrame =
      if (accessory == null) {
        ""
      } else {
        String.format(
          "%.1f,%.1f,%.1f,%.1f",
          accessory.left / density,
          accessory.top / density,
          (accessory.right - accessory.left) / density,
          accessory.height / density,
        )
      }
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
      // `*Band` is the space Yoga is asked to reserve, padding included; `*Text` is the text
      // alone.
      "headerBand=${String.format("%.1f", view.model.headerPx / density)}",
      "footerBand=${String.format("%.1f", view.model.footerPx / density)}",
      "headerText=${String.format("%.1f", view.model.headerTextPx / density)}",
      "footerText=${String.format("%.1f", view.model.footerTextPx / density)}",
      // The section's height and the height Compose measured the layer at; they should match.
      "boxH=${String.format("%.1f", view.height / density)}",
      "layerH=${String.format("%.1f", view.model.layerPx / density)}",
      "rects=${rects.ifEmpty { "-" }}",
      // The boxes the layer was given, as `left,top,width,height`.
      "cardBoxes=" +
        view
          .model
          .rects
          .joinToString("|") {
            String.format(
              "%.1f,%.1f,%.1f,%.1f",
              it.left / density,
              it.top / density,
              (it.right - it.left) / density,
              it.height / density,
            )
          }
          .ifEmpty { "-" },
      // Where the layout pass placed an accessory.
      "drawnAccessory=${accessoryFrame.ifEmpty { "-" }}",
      // Where the layer's root box was placed in its host (`layerBox`), and where the host
      // view sits in the section (`hostBox`).
      "layerBox=" +
        view
          .model
          .drawnLayer
          ?.let {
            String.format(
              "%.1f,%.1f,%.1f,%.1f",
              it.left / density,
              it.top / density,
              (it.right - it.left) / density,
              it.height / density,
            )
          }
          ?: "-",
      "hostBox=" +
        view
          .layer
          ?.let {
            String.format(
              "%.1f,%.1f,%.1f,%.1f",
              it.left / density,
              it.top / density,
              it.width / density,
              it.height / density,
            )
          }
          ?: "-",
      // Where the layout pass placed each row's container, by row index.
      "drawnCards=" +
        view
          .model
          .drawnCards
          .entries
          .sortedBy { it.key }
          .joinToString("|") { (index, rect) ->
            String.format(
              "%d:%.1f,%.1f,%.1f,%.1f",
              index,
              rect.left / density,
              rect.top / density,
              (rect.right - rect.left) / density,
              rect.height / density,
            )
          }
          .ifEmpty { "-" },
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
  /** The layer's horizontal inset, in px, as the composition last read it. */
  var insetPx = 0f
  /**
   * The section's own box, in px. The layer is told its size as state because a host's content
   * is measured with an unbounded height, so `fillMaxSize` would make it only as tall as its
   * content, and the constraints it is measured with cannot say how tall the section is. The
   * layer reads it while it is measured, so a section that grows is drawn into at its new height
   * as soon as the layer is next measured, and not only once a composition has caught up.
   */
  var boxW by mutableStateOf(0f)
  var boxH by mutableStateOf(0f)

  /** The header band Yoga reserves, in px: the text plus its padding. */
  var headerPx = 0f
  /** The header text alone, without the band's padding, in px. */
  var headerTextPx = 0f
  var footerTextPx = 0f
  var footerPx = 0f
  /** Where the layout pass last placed an accessory, in the section's px. */
  var drawnAccessory: FormRowRect? = null

  /** Where the layout pass last placed each row's container, by row index. */
  val drawnCards = HashMap<Int, FormRowRect>()

  /** Where the layer's root box was placed inside the host's Compose view, in px. */
  var drawnLayer: FormRowRect? = null

  /** How tall the layer was when Compose last measured it, in px. */
  var layerPx = 0f

  var onMetrics: ((headerPx: Float, footerPx: Float, insetPx: Float, gapPx: Float) -> Unit)? = null

  /** Send the four numbers JavaScript reserves space for, as the layer last measured them. */
  fun publishMetrics(insetPx: Float = this.insetPx) {
    onMetrics?.invoke(headerPx, footerPx, insetPx, gapPx)
  }

  override fun reset() {
    rects = emptyList()
    headerText = null
    headerTextPx = 0f
    footerTextPx = 0f
    headerPx = 0f
    footerPx = 0f
    gapPx = 0f
    footerText = null
    pressedIndex = -1
    boxW = 0f
    boxH = 0f
    drawnAccessory = null
    drawnCards.clear()
    drawnLayer = null
    layerPx = 0f
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
 * The section's `ReactViewGroup`: React Native's children in place, with one Compose host
 * behind them. The host is a child of this view but hidden from Fabric's child indices.
 */
internal class NitroUiFormSectionView(
  context: ThemedReactContext,
  private val hybrid: HybridNitroUiFormSection,
) : ReactViewGroup(context) {
  val model = FormSectionModel()
  private var composeHost: FormSectionHost? = null
  /** The Compose layer's view, exposed so the test report can read its frame. */
  val layer: View?
    get() = composeHost
  private var hostLayoutPosted = false

  init {
    val host = FormSectionHost(context, context.currentActivity, model)
    // The layer is decoration: it adds no accessibility node, and the rows keep theirs.
    host.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    composeHost = host
    model.onMetrics = { header, footer, inset, gap -> hybrid.reportMetrics(header, footer, inset, gap) }
    addView(host)
  }

  val rowViews: List<NitroUiFormRowView>
    get() = (0 until childCount).mapNotNull { getChildAt(it) as? NitroUiFormRowView }

  /**
   * `ReactScrollView` only scrolls to a rectangle its direct child asks for, so a focused
   * row's request is passed up with the rectangle moved into this view's coordinates.
   */
  override fun requestChildRectangleOnScreen(
    child: View,
    rectangle: Rect,
    immediate: Boolean,
  ): Boolean {
    val scrolled = super.requestChildRectangleOnScreen(child, rectangle, immediate)
    val up = parent?.requestChildRectangleOnScreen(this, movedIntoSelf(child, rectangle), immediate)
    return scrolled || up == true
  }

  override fun requestChildRectangleOnScreen(
    child: View,
    rectangle: Rect,
    immediate: Boolean,
    direction: Int,
  ): Boolean {
    val scrolled =
      super.requestChildRectangleOnScreen(child, rectangle, immediate, direction)
    val up =
      parent?.requestChildRectangleOnScreen(
        this,
        movedIntoSelf(child, rectangle),
        immediate,
        direction,
      )
    return scrolled || up == true
  }

  private fun movedIntoSelf(
    child: View,
    rectangle: Rect,
  ): Rect {
    val out = Rect(rectangle)
    out.offset(child.left - scrollX, child.top - scrollY)
    return out
  }

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
   * `ReactViewGroup.requestLayout` is a no-op, so the host's layout requests have to be
   * answered from here.
   */
  private fun layoutHost() {
    val host = composeHost ?: return
    if (host.parent !== this) return
    if (width > 0 && height > 0) {
      model.boxW = width.toFloat()
      model.boxH = height.toFloat()
      val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
      val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
      host.measure(widthSpec, heightSpec)
      host.layout(0, 0, width, height)
      // A measure driven by hand is not followed by a draw of its own.
      host.invalidate()
    }
    publishRects()
  }

  /**
   * Give the layer the rows' boxes. Called from the `onLayout` of the section and of every
   * row, right after Fabric wrote the row frames. When a box moved, the host is laid out again
   * once, because its own `requestLayout` goes nowhere under a `ReactViewGroup`.
   */
  fun publishRects() {
    val gap = model.gapPx
    val next =
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
    if (next == model.rects) return
    model.rects = next
    model.drawnCards.keys.retainAll(next.indices.toSet())
    if (composeHost != null && !hostLayoutPosted) {
      hostLayoutPosted = true
      post {
        hostLayoutPosted = false
        layoutHost()
      }
    }
  }

  fun refreshChrome() {
    val header = hybrid.title.asSecondOrNull()
    val footer = hybrid.footer.asSecondOrNull()
    model.headerText = header
    model.footerText = footer
    // Text that was removed has no `Text` left to report a size of zero, so clear it here.
    if (header.isNullOrEmpty()) {
      model.headerPx = 0f
      model.headerTextPx = 0f
    }
    if (footer.isNullOrEmpty()) {
      model.footerPx = 0f
      model.footerTextPx = 0f
    }
    composeHost?.perfInstanceId = hybrid.nuiPerfId.asSecondOrNull()?.toInt() ?: NitroUiPerf.NO_INSTANCE
    publishRects()
    // Removed text may never recompose the layer, so the metrics are published from here too.
    model.publishMetrics(FormListMetrics.ContainerInset.value * resources.displayMetrics.density)
  }

  /**
   * Reset the layer for the next mount. React Native's `recycleView` runs `removeAllViews()`,
   * which detaches the Compose host as well, so it is put back here.
   */
  fun prepareSection() {
    val host = composeHost
    if (host == null) {
      model.reset()
      return
    }
    if (host.parent !== this) {
      // Index 0: the host has to stay first, under the rows (see [addReactChild]).
      addView(host, 0)
    }
    host.prepareForRecycle()
  }

  /**
   * Dispose the composition and keep the host view: `onDropViewInstance` also runs when a
   * view is recycled, and the next `Form.Section` is handed this same view.
   */
  fun dropSection() {
    composeHost?.drop()
  }

  /**
   * React Native's `prepareToRecycleView` leaves `contentDescription` and
   * `importantForAccessibility` alone, so a pooled view would keep its previous identity.
   */
  fun resetAccessibility() {
    contentDescription = null
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
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

  /**
   * Insert at Fabric's index, with the host kept first: last would put the full-size Compose
   * layer on top of the z-order, between a finger and every row. Fabric's index `n` is
   * therefore this view's index `n + 1`.
   */
  fun addReactChild(
    child: View,
    index: Int,
  ) {
    val host = composeHost
    if (host == null || host.parent !== this) {
      addView(child, index.coerceAtMost(childCount))
      return
    }
    if (indexOfChild(host) != 0) {
      removeViewAt(indexOfChild(host))
      addView(host, 0)
    }
    addView(child, (index + 1).coerceAtMost(childCount))
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
  // Read the model once, here. React Native writes `rects` between a composition and the draw
  // that follows it, so a draw lambda that read `model.rects` again could index this
  // composition's `shapes` with a newer, longer list.
  val rows = model.rects
  val count = rows.size
  val pressed = model.pressedIndex
  val shapes = rows.indices.map { ListItemDefaults.segmentedShapes(it, count) }

  Box(
    Modifier
      .onPlaced { placed ->
        val at = placed.positionInParent()
        model.drawnLayer =
          FormRowRect(
            left = at.x,
            top = at.y,
            right = at.x + placed.size.width.toFloat(),
            height = placed.size.height.toFloat(),
            selected = false,
            accessory = NitroUiFormRowView.ACCESSORY_NONE,
          )
      }
      // Not `fillMaxSize`: a host's content is measured with an unbounded height.
      .intoSectionBox(model)
      .onSizeChanged { model.layerPx = it.height.toFloat() }
  ) {
    // 1. The row containers: one canvas per row, sized and placed in one layout pass, each
    //    drawing `segmentedShapes(index, count)` resolved for its pressed/selected state.
    rows.forEachIndexed { index, rect ->
      Canvas(
        Modifier
          .align(Alignment.TopStart)
          .placedPixelBox(rect.left, rect.top, rect.right - rect.left, rect.height) { at ->
            model.drawnCards[index] =
              FormRowRect(
                left = at.left,
                top = at.top,
                right = at.right,
                height = at.height,
                selected = rect.selected,
                accessory = rect.accessory,
              )
          },
      ) {
        if (model.gapPx != gap.toPx()) model.gapPx = gap.toPx()
        drawRowContainer(
          resolvedShape(shapes[index], rect.selected, index == pressed),
          colors,
          rect.selected,
        )
      }
    }
    // 2. The press indication. The finger is on a React Native view, so the row feeds the
    //    interaction into a source held here. The ripple must not depend on the pressed
    //    state: `Modifier.indication` rebuilds its node when handed a different indication,
    //    and a press recomposes this layer, which would discard the ripple as it starts.
    val pressRipple = ripple()
    rows.forEachIndexed { index, rect ->
      val source = sources.getOrPut(index) { MutableInteractionSource() }
      Box(
        Modifier
          .align(Alignment.TopStart)
          .placedPixelBox(rect.left, rect.top, rect.right - rect.left, rect.height)
          .indication(source, pressRipple),
      )
    }
    // 3. The accessories: Material Symbols drawables, tinted by `Icon`. JavaScript reserves
    //    their room on the row.
    rows.forEachIndexed { index, rect ->
      val icon = accessoryIcon(rect.accessory)
      if (icon == null) return@forEachIndexed
      val size = FormListMetrics.AccessorySize
      Icon(
        imageVector = icon,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
          Modifier
            // TopStart: the offset below is measured from the section's start edge.
            .align(Alignment.TopStart)
            .offset {
              IntOffset(
                (rect.right - size.toPx() - FormListMetrics.TrailingPadding.toPx()).roundToInt(),
                (rect.top + (rect.height - size.toPx()) / 2f).roundToInt(),
              )
            }
            .onPlaced { placed ->
              val at = placed.positionInParent()
              model.drawnAccessory =
                FormRowRect(
                  left = at.x,
                  top = at.y,
                  right = at.x + placed.size.width.toFloat(),
                  height = placed.size.height.toFloat(),
                  selected = false,
                  accessory = rect.accessory,
                )
            }
            .size(size),
      )
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
            .semantics { heading() }
            // Outside the padding, so Yoga reserves the whole band: padding and text.
            .onSizeChanged {
              model.headerPx = it.height.toFloat()
              // Published from the measurement itself; a recomposition may never follow.
              model.publishMetrics()
            }
            .padding(start = inset, end = inset, top = FormListMetrics.HeaderTopPadding)
            .onSizeChanged { model.headerTextPx = it.height.toFloat() }
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
            .onSizeChanged {
              model.footerPx = it.height.toFloat()
              model.publishMetrics()
            }
            .padding(start = inset, end = inset, bottom = FormListMetrics.FooterBottomPadding)
            .onSizeChanged { model.footerTextPx = it.height.toFloat() }
      )
    }
  }

  val gapPx = with(density) { gap.toPx() }
  val insetPx = with(density) { inset.toPx() }
  model.insetPx = insetPx
  LaunchedEffect(model.headerPx, model.footerPx, gapPx, insetPx) {
    model.publishMetrics(insetPx)
  }
}

/** The glyph a row's accessory asks for, or null for none. */
@Composable
private fun accessoryIcon(accessory: Int): ImageVector? =
  when (accessory) {
    NitroUiFormRowView.ACCESSORY_DISCLOSURE -> nitroUiIcon(R.drawable.nitroui_chevron_right)
    NitroUiFormRowView.ACCESSORY_CHECKMARK -> nitroUiIcon(R.drawable.nitroui_check)
    else -> null
  }

/**
 * Size the section's layer to the section's own box, at the origin of its host.
 *
 * The box cannot come from [constraints]: the shared host measures its content with an unbounded
 * height, which is why the section hands it over at all. Read it here rather than pass it in:
 * passed in, the value is the one this composition was built with, and the section measures the
 * host in the same pass that writes a new box, so a section that has just grown keeps drawing
 * into its old height until a composition catches up. A layer one pass behind also draws its row
 * shapes at the rows' old places, so a stale height is never the only symptom.
 */
private fun Modifier.intoSectionBox(model: FormSectionModel): Modifier =
  this.then(
    layout { measurable, constraints ->
      val width = model.boxW.roundToInt().coerceAtLeast(0).coerceAtMost(constraints.maxWidth)
      val height = model.boxH.roundToInt().coerceAtLeast(0)
      val placeable = measurable.measure(Constraints.fixed(width, height))
      layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
    },
  )

/**
 * Size a child of the section's layer and put it where its row is, in px, in one layout pass.
 * [onPlaced] is handed the box this pass applied.
 */
private fun Modifier.placedPixelBox(
  leftPx: Float,
  topPx: Float,
  widthPx: Float,
  heightPx: Float,
  onPlaced: ((FormRowRect) -> Unit)? = null,
): Modifier =
  this.then(
    layout { measurable, constraints ->
      val width = widthPx.roundToInt().coerceAtMost(constraints.maxWidth)
      val height = heightPx.roundToInt().coerceAtMost(constraints.maxHeight)
      val placeable = measurable.measure(Constraints.fixed(width, height))
      layout(placeable.width, placeable.height) {
        val left = leftPx.roundToInt()
        val top = topPx.roundToInt()
        // Absolute, not `placeRelative`: the row views' positions are already mirrored for
        // a right-to-left layout.
        placeable.place(left, top)
        onPlaced?.invoke(
          FormRowRect(
            left = left.toFloat(),
            top = top.toFloat(),
            right = (left + placeable.width).toFloat(),
            height = placeable.height.toFloat(),
            selected = false,
            accessory = NitroUiFormRowView.ACCESSORY_NONE,
          ),
        )
      }
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

/**
 * Draw one row's container the way material3 draws a segmented item's, filling the canvas
 * the caller placed over that row.
 */
private fun DrawScope.drawRowContainer(
  shape: androidx.compose.ui.graphics.Shape,
  colors: androidx.compose.material3.ListItemColors,
  selected: Boolean,
) {
  drawOutline(
    outline = shape.createOutline(size, layoutDirection, this),
    color = colors.containerColor(enabled = true, selected = selected, dragged = false),
    alpha = 1f,
  )
}

/** The numbers a segmented list needs that material3 has no token for. */
internal object FormListMetrics {
  /** A row's inset from the section's edge. */
  val ContainerInset = 12.dp

  /** Above a section header's text. */
  val HeaderTopPadding = 16.dp

  /** Below a section footer's text. */
  val FooterBottomPadding = 12.dp

  /** Inside a row's trailing edge, where an accessory sits. */
  val TrailingPadding = 16.dp

  /** The side of an accessory's glyph — Material's own 24 dp canvas. */
  val AccessorySize = 24.dp
}

/**
 * The Fabric manager of `NitroUiFormSection`. The Compose layer is not a Fabric child, so it
 * stays out of [getChildCount], [getChildAt] and the removals.
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
