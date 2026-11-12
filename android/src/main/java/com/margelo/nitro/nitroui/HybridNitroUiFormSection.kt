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
 * cost `docs/components/host.md` measures per control against a shared composition (2.75x the
 * mount memory, 1.39x the mount UI-thread CPU per op). One such runtime is paid here for
 * one `Box` and one shape, and the layer draws every row's shape from the rows' own rects,
 * read from the row views after each layout. It is the spike's main API argument to G-Form,
 * and the report carries the number.
 *
 * The header and footer are Compose text in the same layer, at the section's top and bottom.
 * The space they take is measured *in Compose* and reported through `onMetrics`, so Yoga
 * reserves exactly what they need at the current font scale - a Dynamic Type change
 * re-reports it. "Exactly" includes each band's own padding: S6 reserved only the glyph
 * box, so the 16 dp the header is pushed down by left its lower half under the first row
 * (visible in S6's `form-android.png`). The owner's answer was "give the header its own
 * Compose layer sized to the header band"; S6b sized the band instead and left the text
 * where it is, because a second composition per section is the exact cost this file exists
 * to avoid - 2.75x the mount memory and 1.39x the mount UI-thread CPU per op against a
 * shared composition, `docs/components/host.md` - and rows only painted over the header
 * because the reservation was short, not because of the layer's place in the z-order. The
 * report carries the screenshot that shows it, and the deviation is a question, not a given.
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

  /**
   * Always `0`, once — and that is the whole story on Android.
   *
   * iOS has to say where the list put a section, because its rows are drawn by cells that move
   * without React Native knowing. Here the section is a `ReactViewGroup` and its rows are its
   * children at the frames Yoga gave them, so the section is at `0` of its own box and every
   * row's Yoga origin already matches where it is drawn. `Form.tsx` still positions the section
   * absolutely from whatever it is told, so `0` is not a placeholder — it is the answer.
   */
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
      // `*Band` is what the layer draws into and what Yoga is asked to reserve; `*Text` is
      // the glyphs inside it. The difference is the band's own padding, and the S6b case for
      // question 2's Android half is exactly that difference - so both are reported, under
      // names that say which is which. `footer=` above is the footer's *text*, which is why
      // no height here is called plain `footer`.
      "headerBand=${String.format("%.1f", view.model.headerPx / density)}",
      "footerBand=${String.format("%.1f", view.model.footerPx / density)}",
      "headerText=${String.format("%.1f", view.model.headerTextPx / density)}",
      "footerText=${String.format("%.1f", view.model.footerTextPx / density)}",
      // The section's own height, and the height the layer that draws its chrome was last
      // measured at. Equal is the whole point: the layer is placed by Compose, and Compose
      // places inside the box it was measured under.
      "boxH=${String.format("%.1f", view.height / density)}",
      "layerH=${String.format("%.1f", view.model.layerPx / density)}",
      "rects=${rects.ifEmpty { "-" }}",
      // The same boxes with all four numbers, in the encoding the row's own `frame` and the
      // drawn accessory use. `rects` above carries only `top-height`, because it was written
      // for one question — how many shapes, and how far down the section they go. It cannot
      // show a container that publishes a correct `top` and a width of nothing: the picture
      // of a section whose first row has no card at all is exactly that, and every number
      // this report used to carry was right about it.
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
      // Where the layer last *placed* an accessory, which comes out of the layout pass rather
      // than out of the numbers that were asked for: `rects`/`shapes` say what the layer was
      // given, this says where it ended up on screen. Same encoding as the row's own `frame`, so
      // a test can put the two side by side.
      "drawnAccessory=${accessoryFrame.ifEmpty { "-" }}",
      // Where the layer that draws all of this *is*, in the section's px. Everything above is
      // measured inside that view: `drawnCards` is a placement within the layer, `layerH` is the
      // size Compose gave its root — so neither of them can see a layer that is the section's
      // size and shape but is not sitting on the section. It is a child of a `ReactViewGroup`
      // without being one of Fabric's children, so whose frame it ends up under is a real
      // question, and it is the one question that has an answer only from out here.
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
      // The same four numbers per row, out of the layout pass rather than out of [rects]:
      // `cardBoxes` is what the layer was given, this is where that box landed. A section whose
      // rows are drawn outside their own containers has one of these two wrong, and only this
      // one can say which (`FormFidelity`'s card case, X24 round 3).
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
  /**
   * The layer's horizontal inset, in px, as the composition last read it.
   *
   * It lives on the model so a band can publish all four numbers from inside its own
   * `onSizeChanged`. `headerPx`, `footerPx` and `gapPx` are plain vars, so the layer's
   * `LaunchedEffect` re-runs only when something *else* recomposes the layer — which races the
   * layout pass that measured the band. Measured red: a section whose heading was measured
   * after its last recomposition went on telling Yoga it had no header, and its rows drew
   * under the heading (`FormFidelity`'s band check, fix round 1).
   */
  var insetPx = 0f
  /**
   * The section's own box, in px, as the layout pass last saw it.
   *
   * The layer has to be told this rather than inherit it: `NitroUiMeasuredRoot` measures a
   * host's content with `maxHeight = Infinity`, which is right for a control whose size is its
   * content's and wrong for a decoration that fills its box - `fillMaxSize` there answers "as
   * tall as my content", and this layer's content is one row's press box. Measured: the layer
   * came out 54.1 dp tall in a section 296.4 dp tall, so the footer, bottom-aligned in it, drew
   * over the header, and the row shapes and accessories clipped to it never drew.
   */
  var boxW by mutableStateOf(0f)
  /** As [boxW], vertically. The section report calls this `layerH` from the other side. */
  var boxH by mutableStateOf(0f)

  /** What the header and footer text took, in px, as Compose measured them. */
  var headerPx = 0f
  /**
   * The header glyphs alone, without the band’s padding — reported beside `headerPx` so a
   * test can tell “the band is roomy” from “the band includes its padding”, which are the
   * same number only once the padding is inside it. That is exactly the S6 bug.
   */
  var headerTextPx = 0f
  /** As [headerTextPx], for the footer. */
  var footerTextPx = 0f
  var footerPx = 0f
  /**
   * Where an accessory was last *placed*, in the section's px.
   *
   * Placed, not asked for: an accessory's position is a section-relative offset plus the Box's
   * alignment, and that sum is what a person sees.
   */
  var drawnAccessory: FormRowRect? = null

  /**
   * Where the layer last *placed* each row's container, by row index, in the section's px.
   *
   * The other half of the same distinction as [drawnAccessory], and the half `form-android.png`
   * was missing: [rects] is what the layer was *handed*, and a container can be handed the right
   * box and land in another one — the box travels through an offset lambda, a Box alignment and
   * a layer that has to have been told the section's size before any of it means what it says.
   * Only the layout pass knows where the drawing ended up, so this is written from `onPlaced`,
   * next to the accessory's own report, and read by the section report beside it.
   */
  val drawnCards = HashMap<Int, FormRowRect>()

  /**
   * Where the layer's own root box was placed inside the host's Compose view, in px.
   *
   * [drawnCards] is a placement inside this box and [hostBox] is where the box's view sits, so
   * the gap between the two — the placement the host's root gave its content — is the last place
   * a section's cards can be going astray without any number saying so.
   */
  var drawnLayer: FormRowRect? = null

  /**
   * How tall the drawing layer was when Compose last measured it, in px.
   *
   * Reported beside the section's own height because everything in the layer is placed inside
   * *this* box, not the View's: a footer aligned to its bottom and a row's container offset
   * against its top both say where the layer thinks the section is. The two disagree exactly
   * when the layer was never told the section's size, which is the one way this file's pixel
   * layout can be wrong while every View frame in `dumpsys` is right.
   */
  var layerPx = 0f

  /** Leaves those numbers for JavaScript. Set by the Hybrid View, which owns the Fabric node. */
  var onMetrics: ((headerPx: Float, footerPx: Float, insetPx: Float, gapPx: Float) -> Unit)? = null

  /**
   * Send the four numbers JavaScript reserves space for, as the layer currently measured them.
   *
   * One funnel for both callers: the layer's own `LaunchedEffect`, and `refreshChrome` when a
   * band has just lost the text that used to measure it and no recomposition is coming.
   */
  fun publishMetrics(insetPx: Float = this.insetPx) {
    onMetrics?.invoke(headerPx, footerPx, insetPx, gapPx)
  }

  override fun reset() {
    rects = emptyList()
    headerText = null
    headerTextPx = 0f
    footerTextPx = 0f
    // The *bands*, too. They are what JavaScript reserves space for, and a recycled section
    // that keeps the previous mount's band measures its first row under a header that no
    // longer exists (fix round 1). `headerTextPx`/`footerTextPx` were already cleared here and
    // the bands were not, which is the difference between a report that looks reset and a
    // section that is.
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
  /**
   * The layer, for the one thing only its owner's owner can say about it: where it sits.
   *
   * [composeHost] stays private — everything the layer is *told* goes through this class. Its
   * frame is read by the section report, which is asked from the Hybrid View, and that report is
   * the only place a layer sitting on the wrong part of its section can be seen at all.
   */
  val layer: View?
    get() = composeHost
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

  /**
   * Forward a focused row's request to be seen, with the rectangle moved into this view's space.
   *
   * The Form's box forwards it on to React Native's `ScrollView`, which is the only view here
   * that can scroll — but `ViewGroup` asks a request's parent's *direct* child, so without this
   * hop a field two levels below the scroll view is never heard from (D45 item 1, and the real
   * input case S6b measured red). This view does not scroll, so `scrollX`/`scrollY` are the
   * framework's own correction and normally 0.
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
   *
   * The measure-then-layout order is [ContextMenuView]'s, for the reason it gives:
   * `ReactViewGroup.requestLayout` is a no-op, so a request from the host has to be answered
   * here or the composition stops being laid out. The size itself goes in as state, because a
   * host's content is measured with an unbounded height - see [FormSectionModel.boxH].
   */
  private fun layoutHost() {
    val host = composeHost ?: return
    if (host.parent !== this) return
    if (width > 0 && height > 0) {
      // The box the layer has to draw in, as the layer's own state. It cannot ask for this
      // through its constraints: `NitroUiMeasuredRoot` measures a host's content with an
      // unbounded height - on purpose, for the controls whose size is their content's - so
      // `fillMaxSize` here answers "as tall as my content", which for this layer is one row.
      model.boxW = width.toFloat()
      model.boxH = height.toFloat()
      val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
      val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
      host.measure(widthSpec, heightSpec)
      host.layout(0, 0, width, height)
      // ... and ask for the draw a real parent gives for free. A measure driven from here is
      // not followed by one of its own, so whatever the layout pass just changed would wait for
      // something else to invalidate the host. Nothing in `FormFidelity` can see a frame that
      // never came - it reads numbers, not pixels - so this line is a guarantee rather than a
      // fix with a test behind it: it is here because a hand-driven measure should not depend on
      // someone else redrawing, and the `Sections` screenshot is the only thing that would notice
      // if it were wrong.
      host.invalidate()
    }
    publishRects()
  }

  /**
   * Give the layer the rows' boxes. Called from the `onLayout` of the section and of every row,
   * which is where Fabric's writes to a row's frame have just happened - so a shape and its
   * content cannot disagree.
   *
   * It also has to pay for the frame that shows the change. The layer reads
   * [FormSectionModel.rects] where it places its children, so a row that moved reaches the
   * screen only through a fresh measure of the host, and the way Compose would ask for one -
   * `requestLayout` - dies at `ReactViewGroup` like every other request in this subtree. The
   * section's own layout pass usually follows a row's anyway, which is why no test catches this
   * drive being missing; it is here so a move does not depend on whose pass happens to be next.
   *
   * So: write only when the boxes actually moved, and drive [layoutHost] once when they do.
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
    // A row that is gone takes its placement report with it: `drawnCards` is keyed by index, and
    // an entry for a row that no longer exists would be read as a container drawn for it.
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
    // A band whose text has just gone has no `Text` left to measure: the two `onSizeChanged`
    // modifiers that normally report a band run on the view that draws it, and that view is
    // gone. Without this the old height goes to Yoga forever and the section reserves a header
    // over nothing (fix round 1).
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
    // And publish it now, from here. The layer's own `LaunchedEffect` is what normally sends
    // these four numbers, and a band that shrank to nothing may never recompose to say so —
    // `HybridNitroUiFormSection.reportMetrics` compares against what it last sent, so a repeat
    // of a number that did not move costs a comparison.
    model.publishMetrics(FormListMetrics.ContainerInset.value * resources.displayMetrics.density)
  }

  /**
   * Re-arm the layer for the mount that follows this one.
   *
   * `host.prepareForRecycle()` is ContextMenu's pattern, and it is the whole reset: the model
   * with it, and the host's own "this mount has rendered nothing yet" flags. The composition
   * was disposed by [dropSection], which `onDropViewInstance` calls first, and the host
   * composes again from its `onAttachedToWindow` for whoever pulls this view out of the pool.
   *
   * Putting the host back is not part of that pattern, and this view needs it. React Native's
   * `ViewManager.onDropViewInstance` calls `prepareToRecycleView` before pushing the view onto
   * the pool, `ReactViewManager.prepareToRecycleView` calls `ReactViewGroup.recycleView`, and
   * `recycleView` runs `removeAllViews()` (RN 0.88: `ViewManager.java:269`,
   * `ReactViewManager.kt:75`, `ReactViewGroup.kt:195`). The Compose layer is a child of this
   * view like any other, so it goes to the pool detached — and `layoutHost` declines a host
   * whose parent is not this view, so every section handed out after an unmounted one measured
   * its layer at 0 x 0, drew no shapes, no header band and no pressed state, and reported a box
   * with no layer inside it (`Form.harness`'s recycled case, fix round 1).
   */
  fun prepareSection() {
    val host = composeHost
    if (host == null) {
      model.reset()
      return
    }
    if (host.parent !== this) {
      // Index 0, because the host-hiding rule in [addReactChild] wants the layer first, and
      // RN has just emptied the view anyway. Re-attaching here is safe: the section is in the
      // pool, so the host is attached with it and not before, and `NitroUiLifetimeGate` keeps
      // a host that is not attached from composing.
      addView(host, 0)
    }
    host.prepareForRecycle()
  }

  /**
   * Release the composition, and keep the view.
   *
   * React Native calls `onDropViewInstance` as the front door of *recycling* as well as of a
   * real unmount, and this view outlives the mount: it goes back to the pool and the next
   * `Form.Section` is handed the same object. Removing the host from it — which is what this
   * did
   * — left a pooled section with no layer at all: the shapes, the header band and the pressed
   * state were gone for good, and every section mounted after an unmounted one drew its rows
   * over the page background, blank (fix round 1).
   *
   * Disposing the composition is still right, and it is what `NitroComposeHost.drop` does
   * properly: composition, strategy, pre-draw watches. The view stays where it is, ready for
   * [prepareSection] to re-arm it.
   */
  fun dropSection() {
    composeHost?.drop()
  }

  /**
   * Take the previous mount's accessibility identity off before this view goes to the pool.
   *
   * Same rule as the Row's: React Native's `prepareToRecycleView` clears its own
   * `accessibility_label` tag and leaves `contentDescription` and `importantForAccessibility`
   * set, so a pooled section comes back still named for a mount that ended (fix round 1).
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
   * Insert at Fabric's index, with the host kept *first*.
   *
   * Last is where a child that must not disturb Fabric's indices usually goes, and it is
   * where a ContextMenu's host belongs - but this host is a full-size Compose layer that
   * drives a ripple, and last in a `ViewGroup` means top of the z-order: it stood between a
   * finger and every row, so a `Pressable` in a row got nothing and a row's own press never
   * began (S6 question 7: 0 of 10 taps on the row and on its content, 43 of 10 on the same
   * `Pressable` placed outside the Form). At index 0 it draws the shapes and the ripple
   * under React Native's content, which is what the file header always said it did.
   *
   * Fabric's index `n` is therefore this view's index `n + 1`. [reactChildAt] and
   * [reactChildCount] skip the host wherever it sits, so they need no counterpart.
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
  // Read the model once, here. React Native writes `rects` from the UI thread between a
  // composition and the draw that follows it, so a draw lambda that read `model.rects` again
  // would index this composition's `shapes` with a newer list - an `IndexOutOfBounds` in
  // `DrawBackgroundModifier.draw` on the first mount of a section, which is what it did.
  val rows = model.rects
  val count = rows.size
  val pressed = model.pressedIndex
  // Record the list this composition read, before anything can read it back: it is what the
  // canvases below will draw, whatever `model.rects` has become by the time they do.
  // `segmentedShapes` and `ripple` are @Composable, so the shapes resolve here and the two
  // canvases below only draw what this list already resolved.
  val shapes = rows.indices.map { ListItemDefaults.segmentedShapes(it, count) }

  Box(
    Modifier
      // Not `fillMaxSize`: a host's content is measured with an unbounded height, so filling
      // the height here means filling one row. The box arrives as state, from the layout pass.
      //
      // And where that box ended up is reported, not assumed: the layer draws every card at a
      // number relative to this box, so a box the host's root placed anywhere but at the top of
      // its view moves the whole picture — rows, accessories and all — with every number in the
      // section report still reading correct.
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
      .withPixelSize(model.boxW, model.boxH)
      // The layer's own answer for the box it draws in, so a layer that is not the section's
      // size stops being invisible here: `layerH` in the section report is this number.
      .onSizeChanged { model.layerPx = it.height.toFloat() }
  ) {
    // 1. The row containers. Drawn rather than composed: a row's shape is
    //    `segmentedShapes(index, count)`, resolved for its pressed/selected state the way
    //    material3's own `InteractiveListItem` resolves it.
    //
    //
    // One canvas per row, sized and placed by the same layout pass - [placedPixelBox]. The
    // accessory under it still travels on `align`/`offset`, which is right for a child Compose
    // sizes itself (`Modifier.size`). It was not right for a child this file sizes, and this
    // canvas was one for a long time: `offset` and [withPixelSize] each placed the box once, so
    // every card landed at twice the row's offset from the layer's corner - one row-inset right
    // and one header-band below the row whose shape it draws. That is the offset
    // `form-android.png` shows and the one `FormFidelity`'s card case failed on
    // (`drawnCards=0:24.4,77.0` beside a row at `12.2,37.3`). `createOutline` builds an outline
    // at the origin of the scope that asks for it, so a single canvas over the whole layer has
    // to move every shape into place by hand, and a shape that forgot where it came from shows
    // up in no number a test can read - only in the pixels. The `Sections` story shipped exactly
    // that, each section's rows drawn over its own header. Placed by the layout pass, a row's
    // container can only sit where the row sits.
    rows.forEachIndexed { index, rect ->
      Canvas(
        Modifier
          .align(Alignment.TopStart)
          // Sized and placed in the one pass, and reported from inside it: what a test can
          // compare with the row's own frame is the placement the layout produced, not the
          // numbers the placement was asked for. See [placedPixelBox].
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
    // 2. The press indication. material3's clickable `SegmentedListItem` draws
    //    `ripple(focusRingShape = shape)`, and the finger is on a React Native view, so the
    //    row feeds the interaction into a source it holds here.
    //
    //    One ripple, made here and shared by every row, and deliberately resolved without
    //    looking at the pressed state. `Modifier.indication` keeps the indication it was handed
    //    and, when the next one is not the same, throws that node away and builds a new one
    //    (`IndicationModifierElement.update` undelegates the old). A press writes
    //    `pressedIndex` on the way down and so recomposes this layer, which means an indication
    //    that read `pressed` was destroyed by the very press meant to show it - after the
    //    finger's `Press` had already been collected by the node being discarded. What the
    //    device showed was the shape morph with no ink: a held finger on a row in a section
    //    moved 819 px of a 931x183 box, the corners of the new shape, and left the row's mean
    //    luma unchanged to four decimals. `ripple()` with no arguments is the indication the
    //    theme gives everything else through `LocalIndication`, is remembered on its defaults
    //    and so survives a recomposition, and is the same one [HybridNitroUiListItem] installs
    //    for a standalone row.
    val pressRipple = ripple()
    rows.forEachIndexed { index, rect ->
      val source = sources.getOrPut(index) { MutableInteractionSource() }
      Box(
        Modifier
          .align(Alignment.TopStart)
          // The same single placement as the card above: a ripple sized here but placed by a
          // second modifier would light up somewhere else in the section than the row pressed.
          .placedPixelBox(rect.left, rect.top, rect.right - rect.left, rect.height)
          .indication(source, pressRipple),
      )
    }
    // 3. The accessories. iOS gets these from `UICellAccessory`; the Android twin is one of
    // Google's own Material Symbols drawables, because the spike's version was a caret typed
    // out as `Path` line commands and D43's guard exists for exactly that (it is how
    // SearchField 0.7.0 shipped a search icon that drew a key). `nitroUiIcon` parses the
    // shipped XML once per process; `Icon` tints it, which the parsed vector's own intrinsic
    // colour must not be trusted to get right across light and dark.
    //
    // Drawn into the same layer, so an accessory costs a node and not a composition. The room
    // is `FormListMetrics.TrailingPadding`, and `Form.tsx` reserves it on the row, because a
    // row's content is React Native's and only the row knows it has an accessory.
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
            // TopStart, like the press box above: the offset below is measured from the
            // section's edge, and an end-aligned child has it added to the far edge instead -
            // which is how a disclosure landed a section-width outside the layer and no
            // `Form.Row` showed a chevron on Android.
            .align(Alignment.TopStart)
            .offset {
              IntOffset(
                (rect.right - size.toPx() - FormListMetrics.TrailingPadding.toPx()).roundToInt(),
                (rect.top + (rect.height - size.toPx()) / 2f).roundToInt(),
              )
            }
            // Where it actually ended up, in the section's px, for the report. Placement is the
            // sum of the alignment above and the offset, and the two can add up to somewhere
            // outside the layer while every number that went into them is right.
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
        // A heading, in the one sense TalkBack has for it. The layer as a whole is
        // `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS` because it is decoration — but a
        // header is not decoration, it is the thing that tells a person which group of rows
        // they are in, and React Native never sees it to set the role itself.
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier =
          Modifier
            .align(Alignment.TopStart)
            // Not a `Text` argument: a heading is a modifier, and it is the one thing here a
            // screen reader can act on. The layer as a whole hides its descendants, so without
            // this a section header is announced as plain text in an unlabelled group.
            .semantics { heading() }
            // `onSizeChanged` sits *outside* the padding on purpose, so what goes to Yoga
            // is the whole band the header draws into - padding and text. With it inside,
            // `headerPx` was the glyphs alone, Yoga reserved only that, and the 16 dp the
            // text is pushed down by drew the lower half of every header under the first
            // row of its own section (S6's form-android.png, and the reason this line reads
            // the band and not the text).
            .onSizeChanged {
              model.headerPx = it.height.toFloat()
              // From the measurement itself, not from the next recomposition: this is the
              // moment Yoga can still act on the number.
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
            // The footer band, same as the header's: measured with its padding, or the
            // last row paints up over the footer text.
            .onSizeChanged {
              model.footerPx = it.height.toFloat()
              model.publishMetrics()
            }
            .padding(start = inset, end = inset, bottom = FormListMetrics.FooterBottomPadding)
            .onSizeChanged { model.footerTextPx = it.height.toFloat() }
      )
    }
  }

  // What the text took, out to React Native, once per change.
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
 * Give a layer the px size of one row, without a Dp round trip.
 *
 * Only for a child that lives at the origin of its box - the section's own layer, which fills
 * it. A child that has to be *moved* inside that box wants [placedPixelBox]: `Modifier.offset`
 * and this modifier each place the child once, and the two add up to a box at twice the
 * distance from the corner.
 */
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

/**
 * Size a child of the section's layer *and* put it where its row is, in the layer's own px,
 * from one layout pass.
 *
 * A row's box arrives from the row views as px numbers, so its size and its position both have
 * to be applied without a Dp round trip - and applied once. The card canvas used to travel on
 * `Modifier.offset { }` with [withPixelSize] below it, and the placement came out twice: the
 * box landed at (`2 * rect.left`, `2 * rect.top`), one row-inset and one header-band away from
 * the row whose shape it draws - in the pixels as much as in the report. Here the modifier that
 * measures the child is the one that places it, so exactly one place applies a position.
 *
 * [onPlaced] is handed the box this pass applied - the width and height the child came back
 * with, at the position that was placed - so `FormFidelity` can put a drawn container beside
 * the row's own frame, which is Fabric's reading of the same row and does not come from here.
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
        // Absolute, not `placeRelative`: these coordinates come from the row views' own px
        // positions inside this layer, which the platform has already mirrored for a RTL
        // layout. Mirroring them a second time would move the card to the far side.
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
 * Draw one row's container the way material3 draws a segmented item's, into the canvas the
 * caller placed over that row.
 *
 * The canvas *is* the row's box, and the outline is built at the origin of the scope that asks
 * for it, so this has nowhere to get the row's position wrong: the row's offset belongs to the
 * layout pass ([FormSegmentedLayer]'s `offset`), not to a number copied into a draw call. The
 * box is the row's own, not the row's minus `SegmentedGap` - the gap is cut out of the
 * segmented shape itself, which is what makes two rows in a column read as one card.
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

  /** Inside a row's trailing edge, where an accessory sits. */
  val TrailingPadding = 16.dp

  /** The side of an accessory's glyph — Material's own 24 dp canvas. */
  val AccessorySize = 24.dp
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
