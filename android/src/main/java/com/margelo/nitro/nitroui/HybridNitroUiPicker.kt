package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

/*
 * The Picker component: Material 3's `ExposedDropdownMenuBox` (a text-field anchor
 * that opens a `ExposedDropdownMenu` popup) on the core runtime. The structure is
 * SegmentedControl's (`HybridNitroUiSegmentedControl.kt`) - same controlled index,
 * same clamps, same escaped sizing key - plus Progress's policy switch
 * (`HybridNitroUiProgress.kt`), because the variant changes what the control's
 * width means: a menu is as wide as the title it shows, a wheel fills its box.
 *
 * `'wheel'` has no Material 3 equivalent. It renders this same dropdown under the
 * wheel's *layout* policy and says so (`docs/components/picker.md`); the alternative
 * is a hand-drawn wheel, which is not the platform control and not what the brief
 * asks for.
 *
 * This is also the library's first control whose UI leaves the host's window: the
 * menu is a Compose `Popup` with its own `PopupWindow`. It is disposed with the
 * composition, which is what `NitroComposeHost.drop()` ends, so it cannot outlive
 * the mount - and that is the case `MountChurn.harness.tsx` and
 * `scripts/real-input` exist to keep true (B1).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one Picker. See [NitroUiModel] for the shape this has to have. */
internal class PickerModel : NitroUiModel() {
  /**
   * The choices, in order.
   *
   * Observed: they are both what the popup lists and what decides the anchor's
   * width. Written only through a content check (see the `options` setter), so a
   * React render that re-sends an equal list costs no recomposition.
   */
  var options by mutableStateOf(emptyArray<String>())

  /**
   * The selected index the composable renders.
   *
   * A mirror of [state]'s `displayed` as an `Int`, because that is what a list
   * index wants, and observed because writing the handshake is invisible to
   * Compose - `NitroUiControlledValue` is plain state, and only a write to snapshot
   * state reaches the UI. Every write to one happens next to a write of the other.
   */
  var displayed by mutableStateOf(0)

  /**
   * Whether the popup is open. Observed, and the only piece of this control that
   * lives outside the host's window while it is showing.
   *
   * Reset with the rest of the model, so a recycled view never opens on the row
   * that owned it before, and never stays open past a mount: the popup is a child
   * of the composition, and `drop()` ends the composition.
   */
  var expanded by mutableStateOf(false)

  /** `'menu'` or `'wheel'`; the wrapper normalises, and the setter guards again. */
  var variant by mutableStateOf("menu")

  /** The picker's label, drawn as the field's floating label. */
  var label by mutableStateOf<String?>(null)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the field's accent, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * `accessibilityLabel`, read by the composable so the label can go on the anchor.
   * The anchor is the thing a label describes here - the popup's rows are its own
   * children in their own window (`docs/architecture/core.md` section 3).
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The size configuration React sent. The sizing engine reads the key out of
   * Fabric state itself; the host only needs to hear that it changed (see
   * [NitroComposeHost.noteSizingKeyChanged]).
   */
  var sizingKey = ""

  /**
   * Event-count handshake, over the selected index.
   *
   * A `Double` rather than an `Int` for the same reason Slider's `value` is one:
   * the handshake stores what React sent *raw*, and a raw number is not a legal
   * index before it has been normalised against [options] - which can arrive in
   * this same batch, after it (`docs/architecture/core.md` section 3).
   * Not observed: it drives [displayed], it never renders directly.
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in units of [options]. Applied once, in `afterUpdate()`. */
  var defaultSelectedIndex: Double = 0.0

  var didApplyDefault = false

  /**
   * `onValueChange`, as Nitro delivered it. The generated spec types the prop as a
   * plain Kotlin function, which `Func_double_double` implements.
   */
  var onChange: ((Double, Double) -> Unit)? = null

  override fun reset() {
    options = emptyArray()
    displayed = 0
    // A popup that stayed open across a recycle would hang over the next row's
    // content, so it goes back to closed like everything else.
    expanded = false
    variant = "menu"
    label = null
    enabled = true
    tintColor = null
    accessibilityLabel = null
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

  /**
   * A choice index that exists in [options], as a whole number in range.
   *
   * Identical to SegmentedControl's [SegmentedControlModel.clamp] for the same
   * reason: `options` and the selection arrive in one batch in no particular order,
   * so neither can be checked against the other in a setter - this runs in
   * `afterUpdate()`, where the batch is finished. Anything that is not a usable
   * number goes to the first choice; a number past the end goes to the last one. An
   * empty [options] has no valid index at all, and the answer there is only ever
   * read by an anchor that draws no title.
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
}

/**
 * The library's `TextFieldColors`, so that a *tinted* Picker costs one colour set
 * per (colour scheme, tint) instead of one per recomposition.
 *
 * The rule is `docs/architecture/core.md` ("Shared objects"): a hosted control is
 * its own composition, so `remember` cannot share anything between controls, and
 * anything derived from the theme has to be a process-wide keyed cache. Unlike
 * `SegmentedButtonDefaults.colors()`, `OutlinedTextFieldDefaults.colors()` builds a
 * fresh object on every call, so an untinted Picker needs a slot too.
 *
 * Bounded and self-clearing, exactly like `SegmentedColorsCache`: one scheme at a
 * time (identity is the key because identity is what Material's own memo reads), at
 * most [MAX_TINTED_ENTRIES] tinted sets, and a scheme change drops everything.
 */
private object PickerColorsCache {
  /**
   * Tinted sets to remember before starting over. An app tints a handful of
   * controls; the cap is what stops a component that derives a colour per list row
   * from growing this for the life of the process.
   */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  /** The untinted set - one slot, filled once per scheme. */
  private var untinted: TextFieldColors? = null

  /** Tinted sets, keyed by ARGB int. */
  private var tinted: HashMap<Int, TextFieldColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): TextFieldColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  /** Record a colour set the caller just built. */
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

  /** Drop what a different scheme invalidates. Called with the lock held. */
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
 * The field's colours for [tint] (an ARGB int, or `null` for the scheme's own),
 * served by [PickerColorsCache].
 *
 * The tint replaces the **focused border, floating label and trailing icon** - the
 * field's accent roles, this control's analogue of iOS `.tint()`. Every other role
 * keeps the scheme's colours, the same one-role trade the Switch and Button make.
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
 * The control's host: [NitroComposeHost] plus this component's composable.
 *
 * [Content] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class PickerHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: PickerModel,
) : NitroComposeHost<PickerModel>(context, activity, model) {
  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  override fun Component(model: PickerModel) {
    val options = model.options
    val selectedIndex = model.displayed
    val expanded = model.expanded
    val enabled = model.enabled
    val labelText = model.label
    val accessibilityLabel = model.accessibilityLabel
    val colors = pickerFieldColors(model.tintColor)
    // The title the anchor shows. An empty `options` has no title at all, which is
    // an empty field: the alternative is inventing placeholder text a caller never
    // asked for.
    val selectedText = options.getOrNull(selectedIndex) ?: ""
    // The label goes on the anchor, because for this control the anchor is the
    // thing a label describes - the rows are in a popup of their own. An explicit
    // `accessibilityLabel` wins over the visible `label`, which is what both
    // platforms' own controls do.
    val spokenLabel = accessibilityLabel ?: labelText
    // A `wheel` fills the box it was offered - that is the whole point of its
    // `fillWidth` policy, and the only visual difference Android's wheel has from
    // its menu (`docs/components/picker.md`). A `menu` takes no width modifier at
    // all: under the `intrinsic` policy the host asks Compose with no maximum, so
    // the field is as wide as the title it shows plus M3's own minimum for a text
    // field, and `fillMaxWidth()` there would be ignored by the constraints anyway.
    val widthModifier =
      if (model.variant == "wheel") Modifier.fillMaxWidth() else Modifier
    ExposedDropdownMenuBox(
      expanded = expanded,
      // The box reports the reason (`MenuAnchorType` + `enabled`), so a disabled
      // anchor simply never gets asked to open. Anything it does report is obeyed,
      // including the dismissals it initiates itself - outside tap, back, and the
      // popup's own scroll-into-window handling.
      onExpandedChange = { request ->
        model.expanded = request && enabled
      },
    ) {
      // `menuAnchor` is a member of the box's scope, so the anchor's Modifier is
      // built here rather than beside the other reads of the model.
      val anchorModifier =
        widthModifier
          .menuAnchor(
            ExposedDropdownMenuAnchorType.PrimaryNotEditable,
            enabled = enabled,
          )
          .then(
            if (spokenLabel != null || !enabled) {
              Modifier.semantics {
                if (spokenLabel != null) {
                  contentDescription = spokenLabel
                }
                // State the refusal in the semantics tree, as the Slider does
                // (`HybridNitroUiSlider.kt`). Measured on `nitroui_t01`: Compose
                // renders the anchor as two accessibility nodes - M3's merged
                // field node, which already reports `enabled=false`, and this one,
                // which still reports `enabled=true` even with `Disabled` set on
                // it (Compose derives `isEnabled` for a node from its unmerged
                // *children*, and this one has none). So this line is what the
                // semantics tree says, not yet what a screen reader hears; the
                // functional refusal (a disabled anchor never opens a menu) is what
                // `scripts/real-input/android.mjs` proves.
                if (!enabled) {
                  disabled()
                }
              }
            } else {
              Modifier
            },
          )
      OutlinedTextField(
        value = selectedText,
        // `readOnly` makes this a no-op for real, and `onValueChange` exists only
        // because the signature wants one: a picker's text is never typed.
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
        // One line, ellipsised: the value of a picker is a title, and an
        // over-long one has to truncate inside its box rather than grow the box or
        // lose its ends (`C1`: the placement measure gives the field the box's
        // width and Material truncates it).
        // `singleLine` is what truncates: it makes the field a one-line text with
        // an ellipsis, and it keeps the field's own typography (overriding
        // `textStyle` here would fight Material's own field styling).
        singleLine = true,
        // Deliberately not `fillMaxWidth()`: this control's policy is `intrinsic`,
        // so the field is as wide as the title it shows (plus M3's own minimum for
        // a text field). A caller who wants it to fill sets `style`/`flex`, and the
        // shadow node's `fillWidth` story only applies to the `wheel` variant.
        modifier = anchorModifier,
      )
      ExposedDropdownMenu(
        expanded = expanded,
        onDismissRequest = {
          // Reachable from everything that closes a popup without a choice: outside
          // tap, the system back gesture, and the composition going away.
          model.expanded = false
        },
        modifier = Modifier.exposedDropdownSize(),
      ) {
        options.forEachIndexed { index, text ->
          val isSelected = index == selectedIndex
          DropdownMenuItem(
            text = { Text(text = text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            onClick = {
              // Close first, whatever the choice does: the popup must not survive
              // the press that made the choice, and must not stay open when the
              // press changed nothing.
              model.expanded = false
              if (index == model.displayed) {
                // No event for a choice that changed nothing, so that `onChange`
                // means the selection moved on both platforms. G6 measured that a
                // SwiftUI `.menu` Picker does *not* give this for free - its
                // binding writes for the row already on show too - so iOS guards
                // it in its own setter (`HybridNitroUiPicker.swift`) and the pair is
                // what makes a refused choice observable: only a rolled-back
                // selection makes the next tap on that row a fresh choice.
                return@DropdownMenuItem
              }
              // Native is optimistic: paint the new title now, before React has seen
              // the event, so there is no visual latency (core.md section 4).
              val eventCount = model.state.user(index.toDouble())
              model.displayed = index
              model.onChange?.invoke(index.toDouble(), eventCount.toDouble())
            },
            enabled = enabled,
            // The selected row says so to TalkBack. Material 1.4's
            // `DropdownMenuItem` has no `selected` argument, and a check mark would
            // be an affordance the iOS menu does not have, so it is semantics only
            // (`docs/components/picker.md`).
            modifier =
              Modifier.semantics {
                selected = isSelected
              },
          )
        }
      }
    }
  }
}

/** The Hybrid View React renders as `NitroUiPicker`. */
class HybridNitroUiPicker(
  reactContext: ThemedReactContext,
) : HybridNitroUiPickerSpec(), RecyclableView {

  private val model = PickerModel()
  private val host = PickerHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which is
    // the point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiPickerComponentName`
     * in the generated C++, and `getName()` in the generated manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiPicker"

    /**
     * The size to lay a Picker out with before anything has been measured, in dp.
     *
     * One pair for the component, which is all the engine can hold: the `menu`
     * variant is the default, so these are the menu's numbers. A `wheel`'s box is
     * its caller's width anyway - a `fillWidth` shadow node replaces the width with
     * the box's, so the width half of a fallback never reaches it (Progress declares
     * its linear shape for the same reason).
     *
     * Measured on the AVD this library's tests run on (`nitroui_t01`, 420 dpi,
     * API 35) with `options = ["One", "Two", "Three"]`, no label: the field
     * measures exactly 280 x 56 dp, which is Material's own floor rather than a
     * coincidence - `MinTextFieldWidth` in Material's `TextField.kt` is 280.dp, so
     * *any* title up to roughly 30 characters measures 280 x 56 and only a longer
     * one grows it (a 40-character title measures 384.76 x 56). That makes this
     * pair a better guess for Android than it can be for iOS, where the same
     * control measures 72 x 34.67 (`docs/components/picker.md` has both tables).
     *
     * Not covered by one pair: a `label` raises an Android field to 64 dp tall,
     * which the `lbl:` part of the sizing key corrects on the first measure.
     */
    private const val FALLBACK_WIDTH_DP = 280.0
    private const val FALLBACK_HEIGHT_DP = 56.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process, before the first Picker can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a
     * Fabric measure can happen before this class has ever been instantiated, so a
     * fallback declared from `init` is one measure too late for the first instance
     * (T14) - and from `init` as the backstop. The two calls land on different
     * threads, hence the atomic.
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
      // Content, not identity: React re-sends the array on every render that
      // rebuilds it, and an equal list must not cost a recomposition - still less a
      // re-measure of a size that did not move.
      if (next.contentEquals(model.options)) {
        return
      }
      model.options = next
      // The titles decide the anchor's width. Compose recomposes, its own measure
      // pass reports the new width, and the host hands it to the engine - Android
      // needs no explicit "the size may have moved" call (sizing.md section 5).
      host.markDirty()
    }

  override var selectedIndex: Variant_NullType_Double
    get() =
      model.state.js?.let {
        Variant_NullType_Double.Second(model.clampToDouble(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up, and the number only means something once `options` is
      // known. Both happen in `afterUpdate()`.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultSelectedIndex: Double
    get() = model.defaultSelectedIndex
    set(next) {
      // Stored raw. A Switch applies its `defaultValue` in the setter because a
      // Bool has nothing to normalise against; an index has `options`, which may
      // arrive in this same batch after it (core.md section 3).
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
      // The wrapper is the only writer and sends one of two names; anything else
      // behaves as `'menu'`, which is what the spec documents.
      val resolved = if (next == "wheel") "wheel" else "menu"
      if (resolved == model.variant) {
        return
      }
      model.variant = resolved
      // The one prop that changes the control's *size policy*. On Android the wheel
      // renders this same dropdown (Material 3 has no wheel), so what the variant
      // buys here is the policy: `fillWidth` asks Compose for the height this
      // control wants at the box's width, and the field is told to take that width
      // - which is the only sense in which Android's "wheel" differs from its menu.
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
      // Rendered as the field's floating label, which is part of the field's box on
      // this platform - Compose's next measure reports the new size.
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
        // Closing on the way in is the easy half of "a disabled control cannot be
        // open": an app that disables a picker while its popup is showing would
        // otherwise leave a live list of choices on screen that nothing can close -
        // `onExpandedChange` stops firing for a disabled anchor, so the popup would
        // ignore the very taps that should dismiss it.
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
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates, so an
      // opaque colour above `Int.MAX_VALUE` would become `Int.MAX_VALUE`.
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
    // Same as RN's own `BaseViewManager.setTestID`: the tag is what
    // `findNodeByName`/testID matchers read on Android.
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
      // Rendered, not bookkeeping: the label goes on the anchor's semantics node, so
      // it needs a commit or a late-set label never reaches TalkBack.
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
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback; the new configuration may measure exactly what the
      // old one did, and that is the size the host's dedupe would swallow the
      // correcting report against (review F1). Guarded, because React re-sends an
      // unchanged key on every render and the reset costs a measure.
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
    // `options`, `selectedIndex` and `defaultSelectedIndex` can all land in one
    // batch in any order, so none of them is interpreted until the batch is
    // complete - an index of 4 only means something once the choice list it belongs
    // to is known (core.md section 3, and Slider's `value` does the same thing
    // against its range).
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
    // The event-count handshake decides whether React's index wins over what the
    // user just chose - including a change JS rejected (core.md section 4).
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // A choice list that shrank under an existing selection can leave the shown
    // index past the end. The same rule, and idempotent, so an index that is
    // already legal comes back unchanged.
    val shown = model.clamp(model.state.displayed)
    if (shown != model.displayed) {
      model.state.displayed = shown.toDouble()
      model.displayed = shown
      host.markDirty()
    }
    // A list that shrank under an *open* popup has fewer rows than the window
    // already showed. It does not close itself here (the user did not ask it to),
    // but an index that no longer exists can leave it pointing at nothing, and the
    // rows recompose from `options` anyway.
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // The policy is per-host state, not model state: a recycled host left
    // `fillWidth` would answer a menu's next measure with the box's width.
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // Not cleared here: `host.prepareForRecycle()` releases the sizing instance
    // (which needs the id to tell the engine), and `onDropView` has already run.
    // It also resets the model - including `expanded`, whose popup is gone by now
    // either way (core.md section 6: the composition does not survive a recycle).
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    // Ends the composition, which dismisses the popup with it - the one
    // "unmount while the menu is open" case that has to hold on both platforms.
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this control, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (core.md section 5).
   */
  override fun measureContent(): NitroUiPickerSize {
    val size = host.contentSize ?: return NitroUiPickerSize(0.0, 0.0)
    return NitroUiPickerSize(size.width, size.height)
  }
}
