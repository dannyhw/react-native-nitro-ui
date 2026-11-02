package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.testTag
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
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicInteger

/*
 * AlertDialog and ConfirmationDialog (G11, DECISIONS D33): one native view behind both
 * exports. The `alert` variant composes Material 3's `AlertDialog`; the `confirmation`
 * variant composes a Material 3 `ModalBottomSheet` with one row per action - Material's
 * action-sheet idiom, and the library's first `ModalBottomSheet` (Q5 B3).
 *
 * Both are windows composed by the host's own composition, which is the machinery
 * DatePicker's dialog proved (H2b): the composition that composes the window is the one
 * that closes it, so `NitroComposeHost.drop()` disposing the composition takes the window
 * down with the mount, and a `<Host>` that composes the dialog takes it down with the
 * Host. The view React Native lays out is a `0 x 0` anchor with nothing of its own to
 * draw (`sizing: null`).
 */

/** State of one dialog. See [NitroUiModel] for the shape this has to have. */
internal class DialogModel : NitroUiModel() {
  /**
   * Whether the dialog is presented: the handshake's `displayed`, mirrored into
   * snapshot state because composing the window is what presenting it *is* here.
   */
  var presented by mutableStateOf(false)
    private set

  /**
   * Whether a closed sheet is still animating out. A programmatic close runs
   * `sheetState.hide()` before the subtree stops composing (Q5 B3), so the window
   * leaves with its animation instead of vanishing; the witness counts until then.
   */
  var closing by mutableStateOf(false)

  /**
   * Bumped on every presentation, so a dialog presented again (a refused dismissal)
   * is a fresh window - a fresh `AlertDialog`, a sheet that animates in again -
   * rather than the one still on its way out.
   */
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

  /** `presented` behind the event-count handshake (`core.md` section 4). */
  val state = NitroUiControlledValue(false)

  var onPresentedChange: ((Boolean, Double) -> Unit)? = null
  var onAction: ((String) -> Unit)? = null

  /** Whether the anchor is inside a `<Host>`, for the report. */
  @Volatile var hosted = false

  /**
   * How many windows this mount has composed - counted where the window enters the
   * composition, so a presentation that never got a window (no attach yet) is not one.
   */
  private val composedPresentations = AtomicInteger(0)

  /** What the composition last composed, for [readReport]. Written on the UI thread. */
  @Volatile private var composedFacts = "kind=none"

  /** Make the composition match [state]'s `displayed`. Returns whether it moved. */
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

  /** An action was tapped: report it, then the close (D32's order), then close. */
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

  /** Recorded by the composed window. */
  fun noteComposed(facts: String) {
    composedFacts = facts
  }

  fun noteWindowEntered() {
    composedPresentations.incrementAndGet()
  }

  fun noteWindowLeft() {
    composedFacts = "kind=none"
  }

  /**
   * What this dialog shows, as `key=value` pairs. Every field is either a volatile
   * written on the UI thread or an atomic, so this is safe from the JS thread without
   * waiting for the UI thread (`core.md` section 5).
   */
  fun readReport(lifetime: String): String =
    "presented=${if (state.displayed) 1 else 0};js=${if (state.js == true) 1 else 0}" +
      ";live=${livePresentations.get()};presentCount=${composedPresentations.get()}" +
      ";$composedFacts;hosted=${if (hosted) 1 else 0};$lifetime"

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
  }

  companion object {
    /**
     * How many dialog windows this process has composed right now: one per window,
     * counted by a `DisposableEffect` in the subtree that composes it, so it returns to
     * zero exactly when nothing of a presentation is left - closed, dropped, recycled or
     * taken down with its Host. Process-wide, because a dropped mount has nothing left
     * to report; a harness reads it through a fresh mount.
     */
    val livePresentations = AtomicInteger(0)
  }
}

/**
 * The button colours a dialog needs, shared across instances (`core.md` section 3,
 * "Shared objects"): `ButtonDefaults.textButtonColors(contentColor = ...)` builds a
 * fresh object per call, so it is built once per (scheme, colour) for the process.
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

/** The text-button colours for one action, from [DialogButtonColorsCache]. */
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
  /** Where a detach's deferred check runs. */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped per mount, so a deferred check from a dropped mount stands down. */
  var mountGeneration = 0

  init {
    // The anchor is not an accessibility element: the window is (Q5 B5).
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  /**
   * A `<Host>` composes this dialog, window and all: a Compose dialog opened from the
   * Host's composition is proven for DatePicker (H2b), and a window with no anchor does
   * not follow a layout move the way an anchored popup must.
   */
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

  /**
   * Count this presentation for as long as the composition that opened it lives - the
   * DatePicker witness (`HybridNitroUiDatePicker.kt`, `Presentation`), for the same
   * reasons: closing, dropping the view and disposing the composition each take their
   * own path, and a leak on any of them leaves the count above zero.
   */
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
      Text(action.title)
    }
  }

  @OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
  @Composable
  private fun ConfirmationSheet(model: DialogModel) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
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
        val tint = model.tintColor
        for (action in ordered) {
          val content =
            when {
              action.role == "destructive" -> MaterialTheme.colorScheme.error
              tint != null -> ComposeColor(tint)
              else -> MaterialTheme.colorScheme.onSurface
            }
          ListItem(
            headlineContent = { Text(action.title) },
            colors =
              ListItemDefaults.colors(
                headlineColor = content,
                disabledHeadlineColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
              ),
            modifier =
              Modifier
                .fillMaxWidth()
                .clickable(enabled = !action.disabled) { model.performAction(action.id) },
          )
        }
      }
    }
  }

  /**
   * Record what this window composed, for the report, and count the window when it
   * enters the composition.
   */
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
      )
    }
  }

  /**
   * Losing the window while presented closes the dialog and reports it, as iOS does
   * (Q5 B3: a Compose dialog window survives its host's detach - a screen push, say -
   * and would otherwise stay up over a screen it does not belong to). One turn later,
   * so an unmount's `onDropView`, which runs in the same mount batch, and a reparent
   * that puts the view straight back both get there first.
   */
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

/**
 * `<testID>-dialog` on the presented window, as a resource id uiautomator can find
 * (Q5 B5). Nothing is tagged when the app gave no `testID`.
 */
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

  /** Where [runOnUi] sends work that is not already on the UI thread. */
  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = DialogHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
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
      // `processColor` is signed on Android (D10): keep the bit pattern.
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
    // The handshake decides whether React's `presented` wins - including a dismissal JS
    // refused, which presents the dialog again (D33).
    model.state.reconcile()
    if (model.applyDisplayed()) {
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.mountGeneration += 1
    // `host.prepareForRecycle()` resets the model, which stops composing the window -
    // and `onDropView` already disposed the composition that held it.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.mountGeneration += 1
    model.onPresentedChange = null
    model.onAction = null
    // The composition disposal in `drop()` takes the window down with the mount; the
    // flags follow so the state is honest as well as the screen.
    model.state.displayed = false
    model.applyDisplayed()
    model.closing = false
    host.drop()
  }

  // MARK: - Methods

  override fun nuiTestStateReport(): String = model.readReport(host.lifetimeReport().replace(' ', ';'))

  override fun nuiTestPerformAction(id: String) {
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

  /** Run [action] on the UI thread, now if already there, queued otherwise. */
  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }
}
