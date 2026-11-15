package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.toRgbHex
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.absoluteValue
import kotlin.math.roundToInt
import kotlin.math.sqrt

// AlertDialog and ConfirmationDialog: one native view behind both. `alert` composes
// Material 3's `AlertDialog`; `confirmation` a `ModalBottomSheet` with one row per action.

internal class DialogModel : NitroUiModel() {
  var presented by mutableStateOf(false)
    private set

  /** Whether a closed sheet is still animating out; it stays composed until then. */
  var closing by mutableStateOf(false)

  /** Bumped per presentation, so presenting again makes a new window that animates in. */
  var generation by mutableIntStateOf(0)
    private set

  var variant by mutableStateOf("alert")
  var title by mutableStateOf("")
  var message by mutableStateOf<String?>(null)
  var titleVisibility by mutableStateOf("automatic")
  var actions by mutableStateOf<List<NitroUiDialogAction>>(emptyList())
  var dismissible by mutableStateOf(true)
  var tintColor by mutableStateOf<Int?>(null)
  var testID by mutableStateOf<String?>(null)

  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onAction: ((String) -> Unit)? = null

  /** Whether the anchor is inside a `<Host>`, for the report. */
  @Volatile var hosted = false

  /** Windows this mount has composed, counted where the window enters the composition. */
  private val composedPresentations = AtomicInteger(0)

  /** Bumped to arm one row probe. Snapshot state, so arming reaches the composition. */
  var probeToken by mutableIntStateOf(0)
    private set

  @Volatile var probePending = false
    private set

  private val probeCount = AtomicInteger(0)

  @Volatile private var probeLine = ""

  // Test read-outs. Written on the UI thread, read from the JS thread.
  @Volatile private var composedFacts = "kind=none"

  @Volatile private var composedIds: List<String> = emptyList()

  // Whether each action's label is drawn enabled, read from the colour it actually received.
  private val drawnEnabled = ConcurrentHashMap<String, Boolean>()

  fun applyDisplayed(): Boolean {
    val next = state.displayed
    if (next == presented) {
      return false
    }
    if (next) {
      closing = false
      generation += 1
    } else if (variant == "confirmation") {
      // Keep the sheet composed while it animates out; the sheet clears this when its
      // `hide()` returns.
      closing = true
    }
    presented = next
    return true
  }

  /** Reports the action first, then the close. */
  fun performAction(id: String) {
    if (!presented) {
      return
    }
    val action = actions.firstOrNull { it.id == id } ?: return
    if (action.disabled) {
      return
    }
    onAction?.invoke(id)
    userClosed()
  }

  /** A close with no action: back, an outside tap, a swipe, or `nuiTestDismiss`. */
  fun userDismissed() {
    if (!presented || !dismissible) {
      return
    }
    userClosed()
  }

  /** The window went away under the dialog (its anchor left the window). */
  fun closedByWindowLoss() {
    if (!presented) {
      return
    }
    userClosed(animate = false)
  }

  private fun userClosed(animate: Boolean = true) {
    val count = state.user(false)
    applyDisplayed()
    if (!animate) {
      closing = false
    }
    onPresentedChange?.invoke(false, count.toDouble())
  }

  fun noteComposed(
    facts: String,
    ids: List<String>,
  ) {
    composedFacts = facts
    composedIds = ids
  }

  fun noteDrawn(
    id: String,
    enabled: Boolean,
  ) {
    drawnEnabled[id] = enabled
  }

  /**
   * Arms one read of the sheet's rows. One at a time, and only on request: the answer
   * costs a window-sized bitmap draw.
   */
  fun armRowProbe() {
    if (probePending || !presented || variant != "confirmation") {
      return
    }
    probePending = true
    probeToken += 1
  }

  fun publishRowProbe(line: String) {
    probePending = false
    probeLine = "n=${probeCount.incrementAndGet()} $line"
  }

  /** The sheet left composition with a probe armed; clear it so a later one can be armed. */
  fun abandonRowProbe() {
    probePending = false
  }

  fun noteWindowEntered() {
    composedPresentations.incrementAndGet()
  }

  fun noteWindowLeft() {
    composedFacts = "kind=none"
    composedIds = emptyList()
    drawnEnabled.clear()
  }

  // Every field is volatile or atomic, so this is safe to call from the JS thread.
  fun readReport(lifetime: String): String =
    "presented=${if (state.displayed) 1 else 0};js=${if (state.js == true) 1 else 0}" +
      ";live=${livePresentations.get()};presentCount=${composedPresentations.get()}" +
      ";$composedFacts;drawn=${drawnReport()}" +
      (if (probeLine.isEmpty()) "" else ";probe=$probeLine") +
      ";hosted=${if (hosted) 1 else 0};$lifetime"

  private fun drawnReport(): String =
    composedIds.joinToString(",") { id ->
      when (drawnEnabled[id]) {
        true -> "1"
        false -> "0"
        null -> "?"
      }
    }

  override fun reset() {
    presented = false
    closing = false
    variant = "alert"
    title = ""
    message = null
    titleVisibility = "automatic"
    actions = emptyList()
    dismissible = true
    tintColor = null
    testID = null
    state.displayed = false
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    onPresentedChange = null
    onAction = null
    composedPresentations.set(0)
    composedFacts = "kind=none"
    composedIds = emptyList()
    drawnEnabled.clear()
    probePending = false
    probeToken = 0
    probeCount.set(0)
    probeLine = ""
  }

  companion object {
    // Dialog windows composed right now, process-wide, so a test can read it through a
    // fresh mount after the one that presented is gone.
    val livePresentations = AtomicInteger(0)
  }
}

/**
 * The alpha under which a label counts as drawn disabled in the report: Material paints
 * a disabled label at 0.38 and an enabled one opaque.
 */
private const val DISABLED_ALPHA_CEILING = 0.5f

/** A confirmation sheet opens fully or not at all: it has no half-height rest. */
@OptIn(ExperimentalMaterial3Api::class)
private val CONFIRMATION_SHEET_VALUES = setOf(SheetValue.Hidden, SheetValue.Expanded)

/**
 * Text-button colours per (scheme, colour), shared across instances:
 * `ButtonDefaults.textButtonColors(contentColor = ...)` builds a new object per call.
 */
private object DialogButtonColorsCache {
  private const val MAX_ENTRIES = 8
  private var scheme: ColorScheme? = null
  private val entries = HashMap<Long, ButtonColors>()

  @Synchronized
  fun get(
    scheme: ColorScheme,
    color: Long,
  ): ButtonColors? {
    adopt(scheme)
    return entries[color]
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    color: Long,
    colors: ButtonColors,
  ) {
    adopt(scheme)
    if (entries.size >= MAX_ENTRIES) {
      entries.clear()
    }
    entries[color] = colors
  }

  private fun adopt(next: ColorScheme) {
    if (scheme !== next) {
      scheme = next
      entries.clear()
    }
  }
}

@Composable
private fun dialogButtonColors(
  role: String,
  tint: Int?,
): ButtonColors {
  val scheme = MaterialTheme.colorScheme
  val content =
    when {
      role == "destructive" -> scheme.error
      tint != null -> ComposeColor(tint)
      else -> scheme.primary
    }
  val key = content.value.toLong()
  DialogButtonColorsCache.get(scheme, key)?.let { return it }
  val built = ButtonDefaults.textButtonColors(contentColor = content)
  DialogButtonColorsCache.put(scheme, key, built)
  return built
}

private class DialogHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: DialogModel,
) : NitroComposeHost<DialogModel>(context, activity, model) {
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  init {
    // The anchor is not an accessibility element: the window is.
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: DialogModel) {
    model.hosted = isHostedByParent
    if (model.presented || model.closing) {
      DialogWitness(model)
      key(model.generation) {
        if (model.variant == "confirmation") {
          ConfirmationSheet(model)
        } else {
          Alert(model)
        }
      }
    }
  }

  // Counts this presentation for as long as the composition that opened it lives.
  @Composable
  private fun DialogWitness(model: DialogModel) {
    DisposableEffect(Unit) {
      DialogModel.livePresentations.incrementAndGet()
      onDispose {
        DialogModel.livePresentations.decrementAndGet()
        model.noteWindowLeft()
      }
    }
  }

  @OptIn(ExperimentalComposeUiApi::class)
  @Composable
  private fun Alert(model: DialogModel) {
    val actions = model.actions
    val cancel = actions.firstOrNull { it.role == "cancel" }
    val confirming = actions.filter { it !== cancel }
    val tint = model.tintColor
    val dismissible = model.dismissible
    WindowFacts(model, kind = "alert", rows = actions.size)
    AlertDialog(
      onDismissRequest = { model.userDismissed() },
      confirmButton = {
        // Material's `AlertDialogFlowRow` lays the non-cancel actions out in order and
        // wraps them when they do not fit.
        for (action in confirming) {
          DialogButton(model, action, tint)
        }
      },
      dismissButton =
        cancel?.let { action ->
          { DialogButton(model, action, tint) }
        },
      title = { Text(model.title) },
      text = model.message?.let { message -> { Text(message) } },
      modifier = Modifier.dialogTestTag(model.testID),
      properties =
        DialogProperties(
          dismissOnBackPress = dismissible,
          dismissOnClickOutside = dismissible,
        ),
    )
  }

  @Composable
  private fun DialogButton(
    model: DialogModel,
    action: NitroUiDialogAction,
    tint: Int?,
  ) {
    TextButton(
      onClick = { model.performAction(action.id) },
      enabled = !action.disabled,
      colors = dialogButtonColors(action.role, tint),
    ) {
      ActionLabel(model, action)
    }
  }

  // Records the colour the label received: Material draws a disabled label at 38% alpha.
  @Composable
  private fun ActionLabel(
    model: DialogModel,
    action: NitroUiDialogAction,
  ) {
    val drawn = LocalContentColor.current
    SideEffect {
      model.noteDrawn(action.id, drawn.alpha > DISABLED_ALPHA_CEILING)
    }
    Text(action.title)
  }

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  private fun ConfirmationSheet(model: DialogModel) {
    val sheetState =
      rememberBottomSheetState(
        initialValue = SheetValue.Hidden,
        enabledValues = CONFIRMATION_SHEET_VALUES,
      )
    val dismissible = model.dismissible
    val presented = model.presented
    // A programmatic close (an action, a JS `false`) animates the sheet out before the
    // subtree stops composing; a gesture close has already hidden it, so `hide()`
    // returns at once there.
    LaunchedEffect(presented) {
      if (!presented) {
        try {
          sheetState.hide()
        } finally {
          model.closing = false
        }
      }
    }
    // The cancel action last, as Material's sheets and iOS's action sheet both put it.
    val ordered = model.actions.sortedBy { if (it.role == "cancel") 1 else 0 }
    WindowFacts(model, kind = "sheet", rows = ordered.size)
    ModalBottomSheet(
      onDismissRequest = { model.userDismissed() },
      modifier = Modifier.dialogTestTag(model.testID).semantics { paneTitle = model.title },
      sheetState = sheetState,
      sheetGesturesEnabled = dismissible,
      properties =
        ModalBottomSheetProperties(
          shouldDismissOnBackPress = dismissible,
          shouldDismissOnClickOutside = dismissible,
        ),
    ) {
      Column(modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
        val showsTitle = model.titleVisibility != "hidden"
        if (showsTitle) {
          Text(
            text = model.title,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
          )
        }
        model.message?.let { message ->
          Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 8.dp),
          )
        }
        // 16 dp inset, the radius of the group's outer corners: flush to the sheet they would
        // cut wedges against its edge.
        Column(
          modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
          verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap),
        ) {
          val tint = model.tintColor
          val rowColors = ListItemDefaults.segmentedColors()
          ordered.forEachIndexed { index, action ->
            // `tintColor` and the destructive role replace only the enabled content colour, so
            // a disabled row is still drawn disabled. Remembered: a props update must not
            // allocate a `ListItemColors` per row.
            val content =
              when {
                action.role == "destructive" -> MaterialTheme.colorScheme.error
                tint != null -> ComposeColor(tint)
                else -> null
              }
            val colors =
              remember(rowColors, content) {
                content?.let { rowColors.copy(contentColor = it) } ?: rowColors
              }
            SegmentedListItem(
              onClick = { model.performAction(action.id) },
              shapes = ListItemDefaults.segmentedShapes(index, ordered.size),
              modifier =
                Modifier
                  .fillMaxWidth()
                  .semantics { this[ROW_MARK] = Unit },
              enabled = !action.disabled,
              colors = colors,
            ) {
              ActionLabel(model, action)
            }
          }
        }
        RowProbeWitness(model)
      }
    }
  }

  // Test-only. Composed inside the sheet because that is where `LocalView` is the
  // sheet's own window. The answer needs a bitmap draw of that window.
  @Composable
  private fun RowProbeWitness(model: DialogModel) {
    val view = LocalView.current
    val density = LocalDensity.current.density
    val token = model.probeToken
    DisposableEffect(Unit) {
      onDispose { model.abandonRowProbe() }
    }
    LaunchedEffect(token) {
      if (token > 0) {
        model.publishRowProbe(describeConfirmationRows(view, density))
      }
    }
  }

  @Composable
  private fun WindowFacts(
    model: DialogModel,
    kind: String,
    rows: Int,
  ) {
    DisposableEffect(Unit) {
      model.noteWindowEntered()
      onDispose { }
    }
    val title = model.title
    val message = model.message
    val actions = model.actions
    SideEffect {
      model.noteComposed(
        "kind=$kind;title=$title;message=${message ?: "-"};actions=$rows" +
          ";ids=${actions.joinToString(",") { it.id }}" +
          ";enabled=${actions.joinToString(",") { if (it.disabled) "0" else "1" }}",
        actions.map { it.id },
      )
    }
  }

  // A Compose dialog window survives its host's detach (a screen push), so close it. One
  // turn later, so an unmount's `onDropView` or an immediate re-attach gets there first.
  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    if (!model.presented) {
      return
    }
    val generation = mountGeneration
    mainHandler.post {
      if (generation != mountGeneration || isAttachedToWindow) {
        return@post
      }
      model.closedByWindowLoss()
      markDirty()
      commit()
    }
  }
}

/** Tags the window `<testID>-dialog`, as a resource id that uiautomator can find. */
@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.dialogTestTag(testID: String?): Modifier =
  if (testID == null) {
    this
  } else {
    this.semantics { testTagsAsResourceId = true }.testTag("$testID-dialog")
  }

class HybridNitroUiDialog(
  reactContext: ThemedReactContext,
) : HybridNitroUiDialogSpec(), RecyclableView {
  private val model = DialogModel()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = DialogHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var variant: String
    get() = model.variant
    set(next) {
      if (next != model.variant) {
        model.variant = next
        host.markDirty()
      }
    }

  override var presented: Boolean
    get() = model.state.js ?: false
    set(next) {
      model.state.js = next
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var title: String
    get() = model.title
    set(next) {
      if (next != model.title) {
        model.title = next
        host.markDirty()
      }
    }

  override var message: Variant_NullType_String
    get() = model.message?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      if (value != model.message) {
        model.message = value
        host.markDirty()
      }
    }

  override var titleVisibility: String
    get() = model.titleVisibility
    set(next) {
      if (next != model.titleVisibility) {
        model.titleVisibility = next
        host.markDirty()
      }
    }

  override var actions: Array<NitroUiDialogAction>
    get() = model.actions.toTypedArray()
    set(next) {
      val list = next.toList()
      if (list != model.actions) {
        model.actions = list
        host.markDirty()
      }
    }

  override var dismissible: Boolean
    get() = model.dismissible
    set(next) {
      if (next != model.dismissible) {
        model.dismissible = next
        host.markDirty()
      }
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // `processColor` passes the ARGB int as a double; `toLong()` keeps the bit pattern.
      val value = next.asSecondOrNull()?.toLong()?.toInt()
      if (value != model.tintColor) {
        model.tintColor = value
        host.markDirty()
      }
    }

  override var testID: Variant_NullType_String
    get() = model.testID?.let { Variant_NullType_String.Second(it) } ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val value = next.asSecondOrNull()
      host.tag = value
      if (value != model.testID) {
        model.testID = value
        host.markDirty()
      }
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
      }
    set(next) {
      host.perfInstanceId = next.asSecondOrNull()?.toInt() ?: NitroUiPerf.NO_INSTANCE
    }

  override var onPresentedChange: ((presented: Boolean, eventCount: Double) -> Unit)?
    get() = model.onPresentedChange
    set(next) {
      model.onPresentedChange = next
    }

  override var onAction: ((id: String) -> Unit)?
    get() = model.onAction
    set(next) {
      model.onAction = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // A dismissal that JS refused presents the dialog again.
    model.state.reconcile()
    if (model.applyDisplayed()) {
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.mountGeneration += 1
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onAction = null
    // Disposing the composition takes the window down; make the state agree.
    model.state.displayed = false
    model.applyDisplayed()
    model.closing = false
    host.drop()
  }

  // MARK: - Methods

  // A lock-free read of volatiles: never waits for the UI thread.
  override fun nuiTestStateReport(): String = model.readReport(host.lifetimeReport().replace(' ', ';'))

  // [PROBE_ROWS_ID] is not an action: it asks for one read of the confirmation sheet's rows.
  override fun nuiTestPerformAction(id: String) {
    if (id == PROBE_ROWS_ID) {
      runOnUi {
        model.armRowProbe()
        host.applyModelWrites()
      }
      return
    }
    runOnUi {
      model.performAction(id)
      host.applyModelWrites()
    }
  }

  override fun nuiTestDismiss() {
    runOnUi {
      model.userDismissed()
      host.applyModelWrites()
    }
  }

  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }
}

/** A reserved id that asks for a row probe. The underscores keep it clear of app ids. */
private const val PROBE_ROWS_ID = "__nui_probe_rows"

/**
 * Marks each confirmation row in the semantics tree. Not a `testTag`: with
 * `testTagsAsResourceId` on the window, a tag would become a resource id in every app.
 */
internal val ROW_MARK = SemanticsPropertyKey<Unit>("NitroUiDialogRow")

/**
 * Per-pixel tolerance for a row's container colour. Tight, because the row's `surface`
 * and the sheet's container colour are only about 20 apart.
 */
private const val ROW_PIXEL_TOLERANCE = 6

/** How far inside a row's edge the corner is read: clear of the corner's anti-aliasing. */
private const val CORNER_PROBE_DEPTH_PX = 3

private class SheetRow(
  val title: String,
  val enabled: Boolean,
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
)

/**
 * Describes the open sheet's rows on one line: `rows=` from each row's merged semantics
 * node (`~` marks a disabled one) and `radii=` from its pixels, in dp, as `top/bottom`.
 */
private fun describeConfirmationRows(
  view: View,
  density: Float,
): String {
  val owner = (view as? RootForTest)?.semanticsOwner ?: return "no semantics"
  val rows = ArrayList<SheetRow>()
  collectSheetRows(owner.rootSemanticsNode, rows)
  if (rows.isEmpty()) {
    return "no rows"
  }
  if (view.width < 8 || view.height < 8) {
    return "no pixels"
  }
  val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
  try {
    view.draw(Canvas(bitmap))
    val measured = rows.map { it.drawnCorners(bitmap, density) }
    val container = measured.map { it.second }.firstOrNull { it != "-" } ?: "-"
    val state = rows.joinToString(",") { if (it.enabled) it.title else "${it.title}~" }
    return (
      "rows=$state radii=${measured.joinToString(",") { it.first }}" +
        " container=$container window=${view.width}x${view.height}"
      )
  } finally {
    bitmap.recycle()
  }
}

private fun collectSheetRows(node: SemanticsNode, into: MutableList<SheetRow>) {
  val bounds = if (node.config.contains(ROW_MARK)) node.boundsInRoot else null
  if (bounds != null) {
    val text = node.config.getOrNull(SemanticsProperties.Text)
      ?.joinToString("") { it.text }
      ?: "?"
    into.add(
      SheetRow(
        title = text,
        enabled = !node.config.contains(SemanticsProperties.Disabled),
        left = bounds.left.roundToInt(),
        top = bounds.top.roundToInt(),
        right = bounds.right.roundToInt() - 1,
        bottom = bounds.bottom.roundToInt() - 1,
      )
    )
    return
  }
  for (child in node.children) {
    collectSheetRows(child, into)
  }
}

/**
 * The corner radius a row's container is drawn with, in dp, as `"<top>/<bottom>"`. A
 * rounded corner meets the line `d` px inside the edge at `dx = r - sqrt(2rd - d^2)`,
 * so `r = dx + d + sqrt(2 dx d)`. `?` when the row cannot be read.
 */
private fun SheetRow.drawnCorners(bitmap: Bitmap, density: Float): Pair<String, String> {
  if (right - left < 8 || bottom - top < 8) {
    return "?-small" to "-"
  }
  // A sheet still animating up measures below the window; report that as unreachable.
  if (top + CORNER_PROBE_DEPTH_PX >= bottom || bottom - CORNER_PROBE_DEPTH_PX <= top) {
    return "?-small" to "-"
  }
  if (top < 0 || bottom >= bitmap.height || right >= bitmap.width) {
    return "?-outside" to "-"
  }
  // Flat, untexted space of the row's own container, well inside every corner.
  val container = bitmap.getPixel(right - 5, (top + bottom) / 2)
  val topRadius = leadingRadius(bitmap, left, top + CORNER_PROBE_DEPTH_PX, container)
  val bottomRadius = leadingRadius(bitmap, left, bottom - CORNER_PROBE_DEPTH_PX, container)
  if (topRadius < 0 || bottomRadius < 0) {
    return "?-blind" to ComposeColor(container).toRgbHex()
  }
  val toDp = { px: Double -> (px / density).roundToInt().toString() }
  return "${toDp(cornerRadiusPx(topRadius))}/${toDp(cornerRadiusPx(bottomRadius))}" to
    ComposeColor(container).toRgbHex()
}

/** How far from the leading edge the container colour begins on line [y], in px, or -1. */
private fun leadingRadius(bitmap: Bitmap, left: Int, y: Int, container: Int): Int {
  for (x in left until bitmap.width) {
    if (isSameColour(bitmap.getPixel(x, y), container)) {
      return x - left
    }
  }
  return -1
}

private fun cornerRadiusPx(dx: Int): Double {
  val d = CORNER_PROBE_DEPTH_PX.toDouble()
  val gap = dx.toDouble()
  return gap + d + sqrt(2.0 * gap * d)
}

private fun isSameColour(pixel: Int, colour: Int): Boolean {
  val distance =
    ((pixel shr 16 and 0xff) - (colour shr 16 and 0xff)).absoluteValue +
      ((pixel shr 8 and 0xff) - (colour shr 8 and 0xff)).absoluteValue +
      ((pixel and 0xff) - (colour and 0xff)).absoluteValue
  return distance <= ROW_PIXEL_TOLERANCE
}
