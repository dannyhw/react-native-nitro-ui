package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Looper
import android.view.View
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonColors
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.ScrollField
import androidx.compose.material3.ScrollFieldColors
import androidx.compose.material3.ScrollFieldDefaults
import androidx.compose.material3.SelectableDropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.ScrollFieldState
import androidx.compose.material3.TextFieldColors
import androidx.compose.material3.rememberScrollFieldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.lerp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.NuiWheelRow
import com.margelo.nitro.nitroui.core.nuiOwnVerticalDrags
import com.margelo.nitro.nitroui.core.nuiReportAtWheelRest
import com.margelo.nitro.nitroui.core.nuiWheelColors
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Material 3's exposed dropdown menu, radio group or wheel, chosen by `variant`. Must stay
// in this package: the generated manager finds the implementation by a wildcard import.

internal class PickerModel : NitroUiModel() {
  /** The choices: what the popup lists and what decides the anchor's width. */
  var options by mutableStateOf(emptyArray<String>())

  /**
   * [state]'s `displayed` as an `Int`. Observed, because the handshake is plain state and only
   * a write to snapshot state reaches Compose; the two are always written together.
   */
  var displayed by mutableStateOf(0)

  /** Whether the popup is open. Only the `menu` variant ever sets it. */
  var expanded by mutableStateOf(false)

  /** `'menu'`, `'wheel'` or `'radio'`. Only `'menu'` is a popup. */
  var variant by mutableStateOf("menu")

  /**
   * A request from the test hook to move the wheel. The pager lives in the composition, so
   * the hook writes a request and the composition turns it into an animated scroll.
   */
  var wheelRequest by mutableStateOf<PickerWheelRequest?>(null)

  /** The picker's label, drawn as the field's floating label. */
  var label by mutableStateOf<String?>(null)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the field's accent, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * What the last pick painted, or `null`. Set by [applyUserSelection] and read once by the
   * next `afterUpdate`, which clears it. Not observed.
   */
  var pickStamp: PickerPickStamp? = null

  var sizingKey = ""

  /**
   * Event-count handshake over the selected index. A `Double` because it stores what React
   * sent raw: an index is only legal once clamped against [options], which may arrive later
   * in the same batch. Not observed.
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in units of [options]. Applied once, in `afterUpdate()`. */
  var defaultSelectedIndex: Double = 0.0

  var didApplyDefault = false

  var onChange: ((Double, Double) -> Unit)? = null

  // MARK: - The popup's own facts
  // Written from layout and formatted only when a test asks. None of it is rendered from.

  /** The anchor's box inside the composition's own view, px; -1 before the first layout. */
  @Volatile private var anchorLeft = -1f
  @Volatile private var anchorTop = -1f
  @Volatile private var anchorRight = -1f
  @Volatile private var anchorBottom = -1f

  /**
   * Where the composition's own view sits on screen, px; -1 unread. Kept apart from the
   * anchor's box: when a `<Host>` moves, the Compose view keeps its frame inside its parent
   * and no layout callback fires.
   */
  @Volatile private var compositionLeft = -1
  @Volatile private var compositionTop = -1

  /** Screen rect of the open menu's content view, px; -1 while no menu is composed. */
  @Volatile private var menuLeft = -1
  @Volatile private var menuTop = -1
  @Volatile private var menuRight = -1
  @Volatile private var menuBottom = -1

  /** Rows the composed menu listed at its last recomposition. */
  @Volatile private var menuRowCount = 0

  /** The open menu's view. UI thread only; the report reads the published numbers instead. */
  private var menuView: View? = null

  /** The popup's semantics tree as last read, or `null` unread. */
  @Volatile private var drawn: String? = null

  fun noteMenuDrawn(tree: String) {
    drawn = tree
  }

  /** Guards the read that formats [readMenuReport] from the JS thread. */
  private val reportLock = Any()

  /** UI thread only: a layout callback. */
  fun noteAnchorBox(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    val moved = anchorMoved(anchorLeft, anchorTop, left, top)
    anchorLeft = left
    anchorTop = top
    anchorRight = right
    anchorBottom = bottom
    if (moved) {
      dropOpenMenu()
    }
  }

  /** Record where the composition's own view is on screen - px. UI-thread only. */
  fun noteCompositionOrigin(
    left: Int,
    top: Int,
  ) {
    val moved =
      anchorMoved(
        compositionLeft.toFloat(),
        compositionTop.toFloat(),
        left.toFloat(),
        top.toFloat(),
      )
    compositionLeft = left
    compositionTop = top
    if (moved) {
      dropOpenMenu()
    }
  }

  /** A box that moved, as opposed to one read for the first time (-1) or resized in place. */
  private fun anchorMoved(
    wasLeft: Float,
    wasTop: Float,
    left: Float,
    top: Float,
  ): Boolean = wasLeft >= 0f && (wasLeft != left || wasTop != top)

  /**
   * Closes an open menu whose anchor moved. A Compose `Popup` positions itself once, and
   * React Native moving the view under the composition is not something Compose hears about,
   * so the window would be left pointing at where the anchor used to be.
   */
  private fun dropOpenMenu() {
    if (menuView != null && expanded) {
      expanded = false
    }
  }

  fun noteMenuFrame(
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    menuLeft = left
    menuTop = top
    menuRight = right
    menuBottom = bottom
  }

  fun clearMenuFrame() {
    menuLeft = -1
    menuTop = -1
    menuRight = -1
    menuBottom = -1
    menuRowCount = 0
  }

  fun noteMenuRows(rows: Int) {
    menuRowCount = rows
  }

  fun noteMenuView(view: View?) {
    menuView = view
  }

  /**
   * Re-reads the open menu's window. UI thread only. A window moved by the window manager
   * does not re-run its view's `layout()`, so the view's own layout listener stays quiet.
   */
  fun refreshMenuFrame(where: IntArray) {
    val view = menuView ?: return
    view.getLocationOnScreen(where)
    noteMenuFrame(where[0], where[1], where[0] + view.width, where[1] + view.height)
  }

  /**
   * The anchor is the composition-relative box plus the composition's place on screen; `-1`
   * means one of them was never read. Formatted under a lock because it may be read on the
   * JS thread while the UI thread writes. `live` is process-wide.
   */
  fun readMenuReport(): String {
    val open = expanded
    val live = liveMenus.get()
    val boxLeft = anchorLeft
    val boxTop = anchorTop
    val boxRight = anchorRight
    val boxBottom = anchorBottom
    val originLeft = compositionLeft
    val originTop = compositionTop
    val anchored = boxLeft >= 0f && originLeft >= 0
    return synchronized(reportLock) {
      "expanded=${if (open) 1 else 0};live=$live" +
        ";anchor=" +
        if (anchored) {
          "${(boxLeft + originLeft).toInt()},${(boxTop + originTop).toInt()}," +
            "${(boxRight + originLeft).toInt()},${(boxBottom + originTop).toInt()}"
        } else {
          "-1,-1,-1,-1"
        } +
        ";menu=$menuLeft,$menuTop,$menuRight,$menuBottom;rows=$menuRowCount" +
        ";drawn=${drawn ?: "-1"}"
    }
  }

  override fun reset() {
    options = emptyArray()
    displayed = 0
    // A popup left open across a recycle would be open over the next owner's content.
    expanded = false
    clearMenuFrame()
    drawn = null
    variant = "menu"
    label = null
    enabled = true
    tintColor = null
    accessibilityLabel = null
    wheelRequest = null
    pickStamp = null
    sizingKey = ""
    state.displayed = 0.0
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultSelectedIndex = 0.0
    didApplyDefault = false
    onChange = null
  }

  companion object {
    /** Any name other than `wheel` or `radio` is the menu. */
    fun resolvedVariant(variant: String): String =
      when (variant) {
        "wheel" -> "wheel"
        "radio" -> "radio"
        else -> "menu"
      }

    fun isRadio(variant: String): Boolean = variant == "radio"

    fun isWheel(variant: String): Boolean = variant == "wheel"

    /**
     * Menus open in this process right now. Process-wide, because a mount dropped mid-menu
     * cannot report its own leak.
     */
    val liveMenus = AtomicInteger(0)
  }

  /**
   * [index] as a whole number inside [options]: not-a-number goes to the first choice, past
   * the end to the last. Call it from `afterUpdate()`: `options` and the selection arrive in
   * one batch in no particular order.
   */
  fun clamp(index: Double): Int {
    val count = options.size
    if (count <= 0 || !index.isFinite()) {
      return 0
    }
    val rounded = index.toInt()
    if (rounded < 0) {
      return 0
    }
    return if (rounded > count - 1) count - 1 else rounded
  }

  /** [clamp] for the raw handshake value, which is what gets stored back. */
  fun clampToDouble(index: Double): Double = clamp(index).toDouble()

  /**
   * The one place a pick is applied. The popup closes whatever happens. A disabled control,
   * or a pick of the row already shown, reports nothing and returns false; the host holds its
   * size reports only for a pick that returned true.
   */
  fun applyUserSelection(index: Int): Boolean {
    expanded = false
    if (!enabled) {
      return false
    }
    val chosen = clamp(index.toDouble())
    if (chosen == displayed) {
      return false
    }
    // Optimistic: paint the new title before React has seen the event.
    val eventCount = state.user(chosen.toDouble())
    displayed = chosen
    pickStamp = PickerPickStamp(chosen, options, variant, label)
    onChange?.invoke(chosen.toDouble(), eventCount.toDouble())
    return true
  }

  /**
   * Whether [stamp] is still what this model shows. A pick, new `options` and a new label
   * can arrive in one batch, and a size measured for the pick must not be filed under them.
   */
  fun pickIsStillShown(stamp: PickerPickStamp?): Boolean =
    stamp != null &&
      displayed == stamp.index &&
      variant == stamp.variant &&
      label == stamp.label &&
      options.contentEquals(stamp.options)
}

/** What a pick painted, in the terms that decide the control's size. */
internal class PickerPickStamp(
  val index: Int,
  val options: Array<String>,
  val variant: String,
  val label: String?,
)

/** [serial] makes a repeated request for the same [index] a new request. */
internal class PickerWheelRequest(
  val index: Int,
  val serial: Int,
)

/**
 * One `TextFieldColors` per (colour scheme, tint) instead of one per recomposition: each
 * hosted control is its own composition, so `remember` cannot share it, and
 * `OutlinedTextFieldDefaults.colors()` builds a new object on every call.
 */
private object PickerColorsCache {
  /** The tinted sets are cleared when they reach this many. */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private var untinted: TextFieldColors? = null

  private var tinted: HashMap<Int, TextFieldColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): TextFieldColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: TextFieldColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, TextFieldColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  /** Called with the lock held. */
  private fun adopt(scheme: androidx.compose.material3.ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

/**
 * [tint] (an ARGB int, or `null`) replaces the focused border, floating label and trailing
 * icon; every other role keeps the scheme's colours.
 */
@Composable
private fun pickerFieldColors(tint: Int?): TextFieldColors {
  val scheme = MaterialTheme.colorScheme
  PickerColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      OutlinedTextFieldDefaults.colors()
    } else {
      OutlinedTextFieldDefaults.colors(
        focusedBorderColor = color,
        focusedLabelColor = color,
        focusedTrailingIconColor = color,
        unfocusedLabelColor = color,
      )
    }
  PickerColorsCache.put(scheme, tint, built)
  return built
}

/**
 * One `RadioButtonColors` per (colour scheme, tint), for the same reason as
 * [PickerColorsCache]. The tint replaces `selectedColor` only.
 */
private object PickerRadioColorsCache {
  /** The tinted sets are cleared when they reach this many. */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private var untinted: RadioButtonColors? = null

  private var tinted: HashMap<Int, RadioButtonColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): RadioButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: RadioButtonColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, RadioButtonColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  /** Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

@Composable
private fun pickerRadioColors(tint: Int?): RadioButtonColors {
  val scheme = MaterialTheme.colorScheme
  PickerRadioColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      RadioButtonDefaults.colors()
    } else {
      RadioButtonDefaults.colors(selectedColor = color)
    }
  PickerRadioColorsCache.put(scheme, tint, built)
  return built
}


/**
 * A `ScrollField` is a pager and takes whatever height it is offered, so the wheel sets
 * Material's reference height itself: three rows.
 */
private val WheelHeight = ScrollFieldDefaults.ScrollFieldHeight


/** Material's minimum touch target, which the `RadioButton` inside asks for anyway. */
private val RadioRowMinHeight = 48.dp

/** How far a radio row's content sits from each edge of the group. */
private val RadioRowHorizontalPadding = 16.dp

/** The gap between a radio row's dot and its label. */
private val RadioLabelGap = 16.dp

private class PickerHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: PickerModel,
) : NitroComposeHost<PickerModel>(context, activity, model) {
  /** A `<Host>` may compose this control: its popup belongs to the composition's view. */
  override val isHostable: Boolean
    get() = true

  /**
   * The one entry point for a pick: a row press, the wheel coming to rest, or the test hook.
   * A pick that emitted holds the size report its repaint causes, because the sizing key
   * that names the new title only arrives with the next props batch. A refused pick puts
   * the wheel back on the row the model holds.
   */
  fun choose(index: Int) {
    if (model.applyUserSelection(index)) {
      holdSizingReports()
    } else {
      syncWheelRow(model.displayed)
    }
  }

  /**
   * The wheel's state while a [Wheel] is composed, else `null`. A back-reference written
   * from the composition, so the props pass can move the wheel.
   */
  var wheelState: ScrollFieldState? = null

  /**
   * Whether a finger is on the wheel or it is still turning; `null` while no [Wheel] is
   * composed. A [State], so the props pass reads the live flag. UI thread only.
   */
  var wheelActive: State<Boolean>? = null

  /**
   * Makes the wheel show [row], synchronously from the props pass. An effect keyed on the
   * shown index is not enough: a refused pick writes the index and back within one frame, so
   * the key never changes. Refused while the wheel is touched or turning, because writing
   * `selectedOption` stops a scroll in progress.
   */
  fun syncWheelRow(row: Int) {
    val wheel = wheelState ?: return
    if (wheel.selectedOption == row) {
      return
    }
    if (wheelActive?.value == true) {
      wheelSeatRefusals += 1
      return
    }
    wheelSeatWrites += 1
    wheelRow = row
    wheel.selectedOption = row
  }

  /** Test witnesses for the wheel. Written on the UI thread and read on the JS thread. */
  @Volatile
  var wheelBatches = 0L
    private set

  /** Whether any props batch of this mount landed while the wheel was touched or turning. */
  @Volatile
  var wheelBatchSawRolling = false
    private set

  /** Writes [syncWheelRow] has made to the pager, this mount. */
  @Volatile
  var wheelSeatWrites = 0L
    private set

  /** Writes [syncWheelRow] has refused because the drum was touched or turning. */
  @Volatile
  var wheelSeatRefusals = 0L
    private set

  /** The row the wheel last came to rest on or was moved to; `-1` before either. */
  @Volatile
  var wheelRow = -1
    private set

  fun clearWheelWitness() {
    wheelBatches = 0
    wheelBatchSawRolling = false
    wheelSeatWrites = 0
    wheelSeatRefusals = 0
    wheelRow = -1
  }

  /** UI thread only. */
  fun noteWheelRow(row: Int) {
    wheelRow = row
  }

  /** Called from [afterUpdate] for every batch, whether or not it moves the wheel. */
  fun noteWheelBatch() {
    wheelBatches += 1
    if (wheelActive?.value == true) {
      wheelBatchSawRolling = true
    }
  }

  /** Asks the composition to roll the wheel to [index], as a row press does. */
  fun requestWheelScroll(index: Int) {
    wheelRequestSerial += 1
    model.wheelRequest = PickerWheelRequest(index, wheelRequestSerial)
  }

  private var wheelRequestSerial = 0

  /** A variant change remounts the view, so these branches never swap in a live composition. */
  @Composable
  override fun Component(model: PickerModel) {
    when {
      PickerModel.isRadio(model.variant) -> RadioGroup(model)
      PickerModel.isWheel(model.variant) -> Wheel(model)
      else -> MenuField(model)
    }
  }

  /**
   * Material 3's radio-group pattern. The `selectable` row is the one target and carries the
   * role and state; `selectableGroup()` is what gives "1 of N". [PickerModel.label] is not
   * drawn: it names the group for accessibility.
   */
  @Composable
  private fun RadioGroup(model: PickerModel) {
    val options = model.options
    val shown = model.displayed
    val enabled = model.enabled
    val colors = pickerRadioColors(model.tintColor)
    // An explicit `accessibilityLabel` wins over the visible `label`.
    val spokenGroup = model.accessibilityLabel ?: model.label
    val groupLabel =
      if (spokenGroup != null) Modifier.semantics { contentDescription = spokenGroup } else Modifier
    Column(modifier = groupLabel.selectableGroup()) {
      options.forEachIndexed { index, text ->
        Row(
          modifier =
            Modifier
              // A no-op under the host's unbounded measure, so the column is its widest row.
              // Given a real width, it makes the whole row pressable.
              .fillMaxWidth()
              .heightIn(min = RadioRowMinHeight)
              .selectable(
                selected = index == shown,
                onClick = { choose(index) },
                enabled = enabled,
                role = Role.RadioButton,
              )
              .padding(horizontal = RadioRowHorizontalPadding),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          RadioButton(
            selected = index == shown,
            // null on purpose: the row above is the one target.
            onClick = null,
            enabled = enabled,
            colors = colors,
          )
          Spacer(modifier = Modifier.width(RadioLabelGap))
          // One line with an ellipsis, so a narrow box truncates the label.
          Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }

  /**
   * Material 3's `ScrollField` over [PickerModel.options]. Its `selectedOption` changes at
   * every row the wheel crosses, so the pick is reported once, when the wheel comes to rest,
   * through the same [choose] a row press uses.
   */
  @Composable
  private fun Wheel(model: PickerModel) {
    val options = model.options
    val shown = model.displayed
    val enabled = model.enabled
    val colors = nuiWheelColors(model.tintColor)
    // True while a finger is on the wheel; a roll is not over until it is false.
    val touching = remember { mutableStateOf(false) }
    // The wheel draws no label, so `label` names it for accessibility.
    val spokenLabel = model.accessibilityLabel ?: model.label
    Box(
      modifier =
        Modifier
          // A pager has no size of its own: it takes the box's width and a stated height.
          .fillMaxWidth()
          .height(WheelHeight)
          // Inside React Native's scroll container the page would otherwise intercept the
          // drag and the wheel would never turn.
          .nuiOwnVerticalDrags(enabled, touching),
      contentAlignment = Alignment.Center,
    ) {
      // `rememberScrollFieldState` needs a positive item count: an empty list draws no wheel.
      if (options.isNotEmpty()) {
        val wheelState = rememberScrollFieldState(itemCount = options.size, index = shown)
        // Set in `remember`, not in an effect: the props pass can run before any effect of
        // this mount has.
        remember(wheelState) {
          this@PickerHost.wheelState = wheelState
        }
        // Active while a finger is on the wheel or it is still scrolling; the row it is on
        // when that ends is the pick.
        val active =
          remember(wheelState, touching) {
            derivedStateOf { wheelState.isScrollInProgress || touching.value }
          }
        remember(wheelState, active) {
          this@PickerHost.wheelActive = active
        }
        nuiReportAtWheelRest(active) {
          // Recorded before the pick is applied, so a refused pick still says where the wheel is.
          noteWheelRow(wheelState.selectedOption)
          choose(wheelState.selectedOption)
        }
        // The value React holds moves the wheel, instantly. Keyed on the state object too:
        // it is rebuilt when `options` changes length while the pager keeps its page, which
        // leaves `selectedOption` on a row nobody chose.
        LaunchedEffect(wheelState, shown) {
          if (wheelState.selectedOption != shown) {
            wheelState.scrollToOption(shown)
          }
        }
        // A request from `nuiTestSelect`, on the animated road a real row press takes.
        val request = model.wheelRequest
        var readRequestSerial by remember { mutableStateOf(0) }
        LaunchedEffect(wheelState, request) {
          if (request != null && request.serial > readRequestSerial) {
            readRequestSerial = request.serial
            // Consumed by serial, and the field is cleared only after the roll: writing it
            // here would re-key this effect and cancel its own scroll.
            wheelState.animateScrollToOption(request.index)
            if (model.wheelRequest === request) {
              model.wheelRequest = null
            }
          }
        }
        ScrollField(
          state = wheelState,
          contentDescription = spokenLabel,
          // `ScrollField` publishes one semantics node and no disabled state. This modifier
          // is on the same layout node, so the flag lands on the node TalkBack stops on.
          modifier = if (enabled) Modifier else Modifier.semantics { disabled() },
          enabled = enabled,
          colors = colors,
          // The spoken value, spelled from the same `options` the rows paint.
          fieldAccessibilityDescription = { index -> options.getOrElse(index) { "" } },
          interactionSource = null,
          field = { index, selected, rowEnabled ->
            NuiWheelRow(
              text = options.getOrElse(index) { "" },
              selected = selected,
              enabled = rowEnabled,
              colors = colors,
            )
          },
        )
      }
    }
  }


  /** The `menu` variant: the field anchor and the popup it opens. */
  @Composable
  private fun MenuField(model: PickerModel) {
    val options = model.options
    val selectedIndex = model.displayed
    val expanded = model.expanded
    val enabled = model.enabled
    val labelText = model.label
    val accessibilityLabel = model.accessibilityLabel
    val colors = pickerFieldColors(model.tintColor)
    // An empty `options` shows an empty field.
    val selectedText = options.getOrNull(selectedIndex) ?: ""
    // The label goes on the anchor; an explicit `accessibilityLabel` wins over `label`.
    val spokenLabel = accessibilityLabel ?: labelText
    // The view that owns this composition: the control's own, or the `<Host>`'s when it
    // is hosted. A popup positions itself against the composition it was opened from.
    val compositionView = LocalView.current
    val screenPoint = remember(compositionView) { IntArray(2) }
    // A Compose view stays at `0,0` inside its parent however far the parent moves, so
    // the layout listener goes on the view Fabric actually places.
    val placedView = remember(compositionView) { placedViewOf(compositionView) }
    DisposableEffect(placedView) {
      val listener =
        View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
          compositionView.getLocationOnScreen(screenPoint)
          model.noteCompositionOrigin(screenPoint[0], screenPoint[1])
          model.refreshMenuFrame(screenPoint)
        }
      // Read once now: the mount's own layout pass ran before this effect could subscribe.
      compositionView.getLocationOnScreen(screenPoint)
      model.noteCompositionOrigin(screenPoint[0], screenPoint[1])
      placedView.addOnLayoutChangeListener(listener)
      onDispose { placedView.removeOnLayoutChangeListener(listener) }
    }
    ExposedDropdownMenuBox(
      expanded = expanded,
      // Also called for the dismissals the box starts itself: an outside tap and Back.
      onExpandedChange = { request ->
        model.expanded = request && enabled
      },
    ) {
      // `menuAnchor` is a member of the box's scope, so the anchor's Modifier is
      // built here rather than beside the other reads of the model.
      val anchorModifier =
        Modifier
          .menuAnchor(
            ExposedDropdownMenuAnchorType.PrimaryNotEditable,
            enabled = enabled,
          )
          // A layout callback, so it costs no recomposition and writes no observed state.
          .onGloballyPositioned { coordinates ->
            val box = coordinates.boundsInRoot()
            model.noteAnchorBox(box.left, box.top, box.right, box.bottom)
          }
          // One accessibility node for the control. `clearAndSetSemantics`, because
          // `semantics` would add a node beside the text field's own, which TalkBack stops on
          // and which has no name. Clearing also drops the click `menuAnchor` added, so it is
          // restated here; pointer input is untouched.
          .clearAndSetSemantics {
            // The name: `accessibilityLabel`, else `label`, else the title itself.
            contentDescription = spokenLabel ?: selectedText
            // The value as the node's text too: clearing removed the field's own text, and
            // `uiautomator dump` does not print `stateDescription`.
            this[SemanticsProperties.Text] = listOf(AnnotatedString(selectedText))
            stateDescription = selectedText
            role = Role.DropdownList
            if (enabled) {
              onClick {
                model.expanded = true
                true
              }
            } else {
              disabled()
            }
          }
      OutlinedTextField(
        value = selectedText,
        // Required by the signature; the field is read-only.
        onValueChange = {},
        readOnly = true,
        enabled = enabled,
        label = labelText?.let { text ->
          @Composable
          {
            Text(text)
          }
        },
        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
        colors = colors,
        // One line with an ellipsis, in the field's own typography.
        singleLine = true,
        // No `fillMaxWidth()`: under the intrinsic policy the field is as wide as its title.
        modifier = anchorModifier,
      )
      ExposedDropdownMenu(
        expanded = expanded,
        onDismissRequest = {
          // Reachable from everything that closes a popup without a choice: outside
          // tap, the system back gesture, and the composition going away.
          model.expanded = false
        },
        // The exposed dropdown has no Expressive form, so it takes the standalone group's
        // shape and container colour.
        shape = MenuDefaults.standaloneGroupShape,
        containerColor = MenuDefaults.groupStandardContainerColor,
      ) {
        // Must be first: it reads `LocalView`, which inside this lambda is the popup's view.
        MenuWitness(model)
        var listedRows = 0
        val count = options.size
        options.forEachIndexed { index, text ->
          listedRows += 1
          // Draws the selected row with a check and reports `Role.RadioButton` and `selected`.
          SelectableDropdownMenuItem(
            selected = index == selectedIndex,
            onClick = { choose(index) },
            text = { Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            shapes = MenuDefaults.itemShape(index, count),
            selectedLeadingIcon = MenuLeadingCheck,
            enabled = enabled,
          )
        }
        // Published after the composition rather than written during it.
        SideEffect { model.noteMenuRows(listedRows) }
      }
    }
  }

  /**
   * Composed only while the menu is open. Counts live menus, reports the popup window's
   * frame, and clears `expanded` when the popup leaves the composition, so a child that
   * re-enters a Host's child list does not reopen it.
   */
  @Composable
  private fun MenuWitness(model: PickerModel) {
    val menuView = LocalView.current
    DisposableEffect(menuView) {
      val live = PickerModel.liveMenus
      live.incrementAndGet()
      val where = IntArray(2)
      model.noteMenuView(menuView)
      val listener =
        View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
          view.getLocationOnScreen(where)
          model.noteMenuFrame(
            where[0],
            where[1],
            where[0] + view.width,
            where[1] + view.height,
          )
          // Only once a test has asked for it.
          if (MenuDrawnWitness.wanted) {
            describeMenuSemantics(view)?.let(model::noteMenuDrawn)
          }
        }
      menuView.addOnLayoutChangeListener(listener)
      onDispose {
        menuView.removeOnLayoutChangeListener(listener)
        model.noteMenuView(null)
        model.clearMenuFrame()
        live.decrementAndGet()
        model.expanded = false
      }
    }
  }
}

/**
 * The first ancestor of [start] that React Native places. Compose lays its own views out at
 * `0,0` inside their parent, so their frames never change and a layout listener on them
 * never fires. Shared with Menu.
 */
internal fun placedViewOf(start: View): View {
  var view = start
  while (view.parent is View && isComposeView(view)) {
    view = view.parent as View
  }
  return view
}

/** `AndroidComposeView` is internal to Compose, so it is recognised by package prefix. */
internal fun isComposeView(view: View): Boolean =
  view is AbstractComposeView ||
    view.javaClass.name.startsWith("androidx.compose.")

class HybridNitroUiPicker(
  reactContext: ThemedReactContext,
) : HybridNitroUiPickerSpec(), RecyclableView {

  private val model = PickerModel()
  private val host = PickerHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // A backstop: fallbacks are normally declared at package init.
    declareFallback()
  }

  companion object {
    /** Must match the name in the generated C++ and in the generated manager's `getName()`. */
    private const val SIZING_COMPONENT_NAME = "NitroUiPicker"

    /**
     * The size used before anything has been measured, in dp: the `menu` variant's, which is
     * Material's minimum text-field width (280 dp) by 56 dp. Fallbacks are keyed by component,
     * so a labelled field, a radio group and a wheel are corrected after their first measure.
     */
    private const val FALLBACK_WIDTH_DP = 280.0
    private const val FALLBACK_HEIGHT_DP = 56.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process. Called at package init, because Fabric can measure before this
     * class is first instantiated, and from `init` as a backstop, on a different thread.
     */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_INTRINSIC,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var options: Array<String>
    get() = model.options
    set(next) {
      // Compared by content: React re-sends an equal array on every render.
      if (next.contentEquals(model.options)) {
        return
      }
      model.options = next
      // The titles decide the anchor's width; Compose's own measure pass reports the new size.
      host.markDirty()
    }

  override var selectedIndex: Variant_NullType_Double
    get() =
      model.state.js?.let {
        Variant_NullType_Double.Second(model.clampToDouble(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // `afterUpdate()` applies it: the index only means something once `options` is known.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultSelectedIndex: Double
    get() = model.defaultSelectedIndex
    set(next) {
      // Stored raw: `options` may arrive after it in the same batch.
      model.defaultSelectedIndex = next
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var variant: String
    get() = model.variant
    set(next) {
      // Anything but the three names behaves as `'menu'`.
      val resolved = PickerModel.resolvedVariant(next)
      if (resolved == model.variant) {
        return
      }
      model.variant = resolved
      // The sizing policy follows the variant: a wheel is a pager with no intrinsic width,
      // so it fills the box's width; the menu and the radio group are intrinsic.
      host.sizingPolicy =
        if (resolved == "wheel") {
          NitroUiSizing.POLICY_FILL_WIDTH
        } else {
          NitroUiSizing.POLICY_INTRINSIC
        }
      host.markDirty()
    }

  override var label: Variant_NullType_String
    get() =
      model.label?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val text = next.asSecondOrNull()
      if (text == model.label) {
        return
      }
      model.label = text
      // The floating label is part of the field's size; Compose's next measure reports it.
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      if (!enabled) {
        // A disabled control shows no list. `onExpandedChange` stops firing for a disabled
        // anchor, so an open popup would otherwise ignore the taps that should dismiss it.
        model.expanded = false
      }
      // Repaints only: a disabled control is the same size.
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // The view tag is what testID matchers read.
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val text = next.asSecondOrNull()
      if (text == model.accessibilityLabel) {
        return
      }
      // The label is on the anchor's semantics node, so a change needs a commit.
      model.accessibilityLabel = text
      host.markDirty()
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
      }
    set(next) {
      val raw = next.asSecondOrNull()
      host.perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      if (next == model.sizingKey) {
        return
      }
      model.sizingKey = next
      // A new key needs a fresh measure and a report, even if the size is unchanged.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((Double, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    val optionCount = model.options.size
    // Only a batch that moves the shown index may move the wheel.
    val shownBefore = model.displayed
    // The props of one batch arrive in any order, so they are interpreted here.
    model.state.js?.let { js ->
      val clamped = model.clampToDouble(js)
      if (clamped != js) {
        model.state.js = clamped
      }
    }
    if (model.state.js == null && !model.didApplyDefault && optionCount > 0) {
      model.didApplyDefault = true
      val seeded = model.clamp(model.defaultSelectedIndex)
      if (seeded != model.displayed) {
        model.state.displayed = seeded.toDouble()
        model.displayed = seeded
        host.markDirty()
      }
    }
    // The handshake decides whether React's index wins over what the user just chose.
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // A list that shrank can leave the shown index past the end.
    val shown = model.clamp(model.state.displayed)
    if (shown != model.displayed) {
      model.state.displayed = shown.toDouble()
      model.displayed = shown
      host.markDirty()
    }
    // The wheel is not painted from `displayed`, so it has to be told. Other batches
    // must not interrupt a roll in progress.
    host.noteWheelBatch()
    if (model.displayed != shownBefore) {
      host.syncWheelRow(model.displayed)
    }
    // The batch a held size report was waiting for has landed. The report is filed only
    // if the index, choices, variant and label are still the ones the pick painted.
    val stamped = model.pickStamp
    model.pickStamp = null
    host.releaseSizingReports(model.pickIsStillShown(stamped))
    host.commit()
  }

  override fun prepareForRecycle() {
    // The wheel's state belonged to the composition that is ending.
    host.wheelState = null
    host.wheelActive = null
    host.clearWheelWitness()
    host.tag = null
    // The policy is host state, not model state: reset it to the default variant's.
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // Resets the model and releases the sizing instance; the composition does not survive.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    host.wheelState = null
    host.wheelActive = null
    model.onChange = null
    // Disposes the composition, which dismisses an open popup with it.
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiPickerSize {
    val size = host.contentSize ?: return NitroUiPickerSize(0.0, 0.0)
    return NitroUiPickerSize(size.width, size.height)
  }

  /**
   * Test-only: picks [index] by the path a real pick takes. The model is UI-thread state,
   * so this posts when called from another thread and never waits.
   */
  override fun nuiTestSelect(index: Double) {
    val run = {
      // A wheel has no row to press: the hook asks for a roll, and the rest at its end emits.
      if (PickerModel.isWheel(model.variant)) {
        host.requestWheelScroll(model.clamp(index))
      } else {
        host.choose(model.clamp(index))
      }
      // A real press runs inside Compose's input handling, which applies the snapshot
      // writes. A plain post does not, so apply them here.
      host.applyModelWrites()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  /**
   * Test-only. Reads a locked snapshot, so it is safe on the JS thread. The wheel's counters
   * are appended as named trailing fields.
   */
  override fun nuiTestMenuReport(): String {
    MenuDrawnWitness.wanted = true
    return (
      model.readMenuReport() +
        ";batches=" +
        host.wheelBatches +
        ";sawRolling=" +
        (if (host.wheelBatchSawRolling) 1 else 0) +
        ";seats=" +
        host.wheelSeatWrites +
        ";refusals=" +
        host.wheelSeatRefusals +
        ";row=" +
        host.wheelRow
      )
  }
}
