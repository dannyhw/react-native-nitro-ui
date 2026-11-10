package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicSecureTextField
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.KeyboardActionHandler
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.foundation.text.input.TextFieldDecorator
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.TextObfuscationMode
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
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
 * The TextField component (G13): Compose `BasicTextField(TextFieldState)` - the
 * `TextFieldState` API, because its `composition` is the IME flag the controlled
 * value's guard needs (Q2 §4, orchestrator answer 1).
 *
 * The `TextFieldState` belongs to the model, not to the composition. That is what
 * lets a React write be applied where React's writes arrive - `afterUpdate()`, on
 * the UI thread, outside any composition - with `edit {}`, in the same turn, instead
 * of a tick a `LaunchedEffect` picks up a frame later. A recycle disposes the
 * composition anyway (`docs/architecture/core.md` §6), so the model hands the next
 * mount a fresh state rather than a cleared one: no text, selection or undo
 * history can survive into it.
 */

/** State of one TextField. See [NitroUiModel] for the shape this has to have. */
internal class TextFieldModel : NitroUiModel() {
  /**
   * The text on the shipped handshake. `unreported` is never set: a field's edits
   * are discrete, and setting it per keystroke would make a fast typist's writes
   * permanently stale (Q2 §2.4).
   */
  val state = NitroUiControlledValue<String>("")

  /** What the user edits. Replaced, never cleared, by [reset]. Observed. */
  var textState by mutableStateOf(TextFieldState(""))

  var defaultValue: String? = null
  var didApplyDefault = false
  var placeholder by mutableStateOf<String?>(null)
  var multiline by mutableStateOf(false)
  var keyboardType by mutableStateOf("default")
  var autoCapitalize by mutableStateOf("sentences")
  var autoCorrect by mutableStateOf(true)
  var secureTextEntry by mutableStateOf(false)
  /** Read only by [NitroUiTextLimit] inside an edit, so not observed. */
  var maxLength: Int? = null
  var returnKeyType by mutableStateOf("default")
  var editable by mutableStateOf(true)
  var accessibilityLabel by mutableStateOf<String?>(null)
  var sizingKey = ""
  var lastWrite = "none"

  /** Focus, as the field's own `onFocusChanged` reported it. */
  var focused = false

  /**
   * What the last composition drew - the secure field or the plain one, one line or
   * many - so the harness's report says what is on screen rather than what the props
   * asked for. Written from a `SideEffect`, i.e. after the composition that drew it.
   */
  var drawnSecure = false
  var drawnMultiline = false

  /** `focus()` / `blur()` as ticks: they must run where a focus owner exists. */
  var focusTick by mutableIntStateOf(0)
  var blurTick by mutableIntStateOf(0)

  var onChange: ((String, Double) -> Unit)? = null
  var onFocusChange: ((Boolean) -> Unit)? = null
  var onSubmit: ((String) -> Unit)? = null

  /** Republishes the harness snapshot; installed by the Hybrid View. */
  var publish: (() -> Unit)? = null

  val secureApplied: Boolean
    get() = secureTextEntry && !multiline

  /** Whether an IME composition is open in [textState]. */
  val composing: Boolean
    get() = (textState.composition?.length ?: 0) > 0

  /**
   * The text [textState] is known to hold: the last one native wrote into it or
   * counted out of it. A user edit is a difference from *this*, not from
   * `state.displayed` - a `defaultValue` or a reset moves `displayed` before
   * [syncText] has written it, and that gap is not an edit.
   */
  var accounted = ""

  /** Whether the last [observe] saw an open composition; see [settle]. */
  private var wasComposing = false

  /**
   * Whether the `maxLength` backstop is owed: an open composition left the field past the
   * cap, and the cut waits for it to end. Writing an `EditText` inside a composition closes
   * it and clears the IME's undo state, which takes the half-typed word with it - a cap is
   * not worth that, and does not have to be: every way out of a composition reports the
   * field again ([catchUp] through the `snapshotFlow` collector), and the cut is cheap then
   * (G13 review, fix round 2).
   */
  private var capOwed = false

  /**
   * Runs a `value` write a composition held back (`lastWrite == "composing"`) once the
   * composition is over. Installed by the Hybrid View, which owns reconciling and
   * writing the field.
   */
  var settle: (() -> Unit)? = null

  /** [observe] what the field holds now. The `snapshotFlow` collector and `afterUpdate()`. */
  fun catchUp() = observe(textState.text.toString(), composing)

  /**
   * The field holds [observed], inside an open IME composition or not.
   *
   * - An edit native has not counted is counted and emitted, **composing or not**.
   *   Gboard keeps every Latin word in a composing region while autocorrect is on, so
   *   a field that waited for compositions to end reported once per word, and a refused
   *   edit reverted only at the word's end; React Native emits during a composition on
   *   both platforms (G13 review, fix round 1). What stays composition-aware is the
   *   write: `afterUpdate()` still drops a `value` write while one is open.
   * - Text past `maxLength` that grew past what native accounted for is cut back, at a
   *   grapheme boundary. A backstop: [NitroUiTextLimit] cuts an insertion as it
   *   happens, and this catches what reaches the field another way. A JS write is
   *   accounted for when it is written, so it is never cut here. While a composition is
   *   open the cut is deferred ([capOwed]) and applied by the observation that reports the
   *   field once the composition has ended, so the cap holds afterwards either way.
   * - When a composition ends, a write it held back is settled ([settle]), whether or
   *   not its end changed the text: a composition the user deleted leaves the text
   *   native already counted, so no edit and no commit would ever decide it again.
   */
  fun observe(observed: String, isComposing: Boolean) {
    var text = observed
    val limit = maxLength
    if (limit != null && text.length > limit) {
      val grewPastCap = text != accounted && text.length > accounted.length
      if (isComposing) {
        // The composition keeps its text; the cut is owed until one is reported over.
        if (grewPastCap) capOwed = true
      } else if (grewPastCap || capOwed) {
        val keep = NitroUiTextLimit.graphemeFloor(text, limit)
        text = text.substring(0, keep)
        textState.edit { replace(keep, length, "") }
        capOwed = false
      }
    } else {
      capOwed = false
    }
    val ended = wasComposing && !isComposing
    wasComposing = isComposing
    if (text != accounted) {
      accounted = text
      val eventCount = state.user(text)
      publish?.invoke()
      onChange?.invoke(text, eventCount.toDouble())
    }
    if (ended && lastWrite == "composing") {
      settle?.invoke()
    }
  }

  fun focusMoved(isFocused: Boolean) {
    if (focused == isFocused) {
      return
    }
    focused = isFocused
    publish?.invoke()
    onFocusChange?.invoke(isFocused)
  }

  override fun reset() {
    state.displayed = ""
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    textState = TextFieldState("")
    accounted = ""
    wasComposing = false
    capOwed = false
    defaultValue = null
    didApplyDefault = false
    placeholder = null
    multiline = false
    keyboardType = "default"
    autoCapitalize = "sentences"
    autoCorrect = true
    secureTextEntry = false
    maxLength = null
    returnKeyType = "default"
    editable = true
    accessibilityLabel = null
    sizingKey = ""
    lastWrite = "none"
    focused = false
    drawnSecure = false
    drawnMultiline = false
    focusTick = 0
    blurTick = 0
    onChange = null
    onFocusChange = null
    onSubmit = null
  }
}

/**
 * `maxLength`, enforced the way React Native enforces it: counted in UTF-16 code
 * units (JavaScript's `string.length`, `String.length` here), cutting the *inserted*
 * text short rather than the end of the field, and never inside a grapheme cluster -
 * an emoji, a flag, a ZWJ family. Built-in `InputTransformation.maxLength` refuses a
 * whole edit that overflows instead of keeping the part that fits, which is not what
 * RN or iOS do.
 */
internal class NitroUiTextLimit(private val model: TextFieldModel) : InputTransformation {
  // `changes` is the one experimental member read here: it is what says which part
  // of the edit was inserted, which is the part RN cuts.
  @OptIn(ExperimentalFoundationApi::class)
  override fun TextFieldBuffer.transformInput() {
    val limit = model.maxLength ?: return
    // Within the limit, or an edit that did not grow the text (a deletion inside a
    // field a JS write put over it): nothing to cut.
    if (length <= limit || length <= originalText.length) {
      return
    }
    // Composing or not: an IME that keeps a whole word composing (Gboard, autocorrect
    // on) would otherwise take a field past its limit one composition at a time. React
    // Native's `LengthFilter` cuts composing text too.
    val changes = changes
    if (changes.changeCount != 1) {
      replace(graphemeFloor(asCharSequence(), limit), length, "")
      return
    }
    val range = changes.getRange(0)
    val allowed = limit - (length - range.length)
    if (allowed <= 0) {
      revertAllChanges()
      return
    }
    val inserted = asCharSequence().subSequence(range.start, range.end)
    val keep = graphemeFloor(inserted, allowed)
    replace(range.start + keep, range.end, "")
    placeCursorBeforeCharAt(range.start + keep)
  }

  companion object {
    /** The largest grapheme boundary of [text] at or before [limit]. */
    fun graphemeFloor(text: CharSequence, limit: Int): Int {
      if (limit >= text.length) return text.length
      if (limit <= 0) return 0
      // `java.text`, not `android.icu`: on Android it is ICU's character iterator
      // (extended grapheme clusters), and it also runs in a JVM unit test.
      val breaks = java.text.BreakIterator.getCharacterInstance()
      breaks.setText(text.toString())
      return if (breaks.isBoundary(limit)) limit else breaks.preceding(limit).coerceAtLeast(0)
    }
  }
}

/**
 * The field's text style: Material 3 `bodyLarge` in `onSurface`, shared between
 * every field drawn with one colour scheme (`docs/architecture/core.md` §3, "Shared
 * objects") rather than copied per composition.
 */
private object TextFieldStyleCache {
  private var scheme: ColorScheme? = null
  private var typography: Typography? = null
  private var text: TextStyle? = null
  private var placeholder: TextStyle? = null
  private var cursor: SolidColor? = null

  @Synchronized
  fun get(scheme: ColorScheme, typography: Typography): Triple<TextStyle, TextStyle, SolidColor> {
    if (this.scheme !== scheme || this.typography !== typography) {
      this.scheme = scheme
      this.typography = typography
      text = typography.bodyLarge.copy(color = scheme.onSurface)
      placeholder = typography.bodyLarge.copy(color = scheme.onSurfaceVariant)
      cursor = SolidColor(scheme.primary)
    }
    return Triple(text!!, placeholder!!, cursor!!)
  }
}

internal fun keyboardTypeOf(name: String, secure: Boolean): KeyboardType =
  when {
    // A secure number pad stays a number pad, as `inputType` NUMBER_VARIATION_PASSWORD
    // does in React Native.
    secure && name == "number-pad" -> KeyboardType.NumberPassword
    secure -> KeyboardType.Password
    name == "number-pad" -> KeyboardType.Number
    name == "decimal-pad" -> KeyboardType.Decimal
    // RN's `numeric` is a signed decimal on Android; Compose has no signed flag, and
    // `Decimal` is the nearest keyboard it offers.
    name == "numeric" -> KeyboardType.Decimal
    name == "email-address" -> KeyboardType.Email
    name == "phone-pad" -> KeyboardType.Phone
    name == "url" -> KeyboardType.Uri
    else -> KeyboardType.Text
  }

internal fun imeActionOf(name: String, multiline: Boolean): ImeAction =
  when {
    // Return inserts a newline in a multi-line field, as it does in RN; any other
    // action would take the key away from it.
    multiline -> ImeAction.Default
    name == "done" -> ImeAction.Done
    name == "go" -> ImeAction.Go
    name == "next" -> ImeAction.Next
    name == "search" -> ImeAction.Search
    name == "send" -> ImeAction.Send
    else -> ImeAction.Default
  }

internal fun capitalizationOf(name: String): KeyboardCapitalization =
  when (name) {
    "none" -> KeyboardCapitalization.None
    "words" -> KeyboardCapitalization.Words
    "characters" -> KeyboardCapitalization.Characters
    else -> KeyboardCapitalization.Sentences
  }

/**
 * The read-back side of [keyboardTypeOf] and [capitalizationOf]: the RN spelling of a
 * keyboard a Compose field was configured with.
 *
 * `SearchField`'s test state reports what the field was *configured with*, so a prop
 * that never reached the composition is visible from JS. While the field is focused
 * it reads the `EditorInfo` the IME is handed (see
 * `HybridNitroUiSearchField.currentEditorInfo`), and these three functions are the
 * only decoder for that; with no input connection up yet they decode the
 * [KeyboardType] / [KeyboardCapitalization] the mapping produced instead.
 *
 * Android cannot tell `"numeric"` from `"decimal-pad"`, because Compose offers one
 * keyboard for both (`docs/components/text-field.md`'s table): the read-back says
 * `"decimal-pad"` for either, and that is the truth rather than a lost prop.
 */
internal object NitroUiKeyboardNames {
  /**
   * The RN spelling of an `EditorInfo.inputType`'s keyboard.
   *
   * The class is read first and the variation only inside `CLASS_TEXT`, because the
   * `InputType` masks overlap between classes: `TYPE_NUMBER_VARIATION_PASSWORD` and
   * `TYPE_TEXT_VARIATION_URI` are the same bit (0x10), so a secure number pad read by
   * variation alone decodes as a URL keyboard. That is not a hypothetical: it is what
   * an earlier cut of this function did, and `KeyboardNamesTest` keeps it fixed.
   */
  fun nameOfInputType(inputType: Int): String =
    when (inputType and android.text.InputType.TYPE_MASK_CLASS) {
      android.text.InputType.TYPE_CLASS_PHONE -> "phone-pad"
      android.text.InputType.TYPE_CLASS_NUMBER ->
        if (inputType and android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL != 0) {
          "decimal-pad"
        } else {
          "number-pad"
        }
      android.text.InputType.TYPE_CLASS_TEXT ->
        when (inputType and android.text.InputType.TYPE_MASK_VARIATION) {
          android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
          android.text.InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
          -> "email-address"
          android.text.InputType.TYPE_TEXT_VARIATION_URI -> "url"
          else -> "default"
        }
      else -> "default"
    }

  /**
   * The RN spelling of an `EditorInfo.inputType`'s capitalisation flags — for a text
   * keyboard. The `CAP_*` bits overlap another class's flags
   * (`TYPE_TEXT_FLAG_CAP_WORDS` == `TYPE_NUMBER_FLAG_DECIMAL`), so a number keyboard has
   * no capitalisation to read and says `"none"`, which is also what it was told.
   */
  fun nameOfCapitalization(inputType: Int): String =
    when (inputType and android.text.InputType.TYPE_MASK_CLASS) {
      android.text.InputType.TYPE_CLASS_TEXT ->
        when {
          inputType and android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS != 0 ->
            "characters"
          inputType and android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS != 0 -> "words"
          inputType and android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES != 0 ->
            "sentences"
          else -> "none"
        }
      else -> "none"
    }

  /**
   * Whether an `EditorInfo.inputType` allows autocorrection.
   *
   * The flag is [android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT], which is what
   * Compose 1.12.1 writes for `autoCorrectEnabled = true` and does not write for
   * `false` — read out of the artifact's `EditorInfo.update()`, not from memory, because
   * the two readings differ exactly where the prop matters: an
   * [android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS]-only rule calls a field that
   * refused autocorrection an allowed one, since nothing in this mapping ever sets that
   * flag. `TYPE_TEXT_FLAG_NO_SUGGESTIONS` is still honoured, as an outright refusal
   * whoever wrote it.
   *
   * [asked] is what the field was told, and it answers for the keyboards that carry no
   * autocorrection flag at all: Compose writes the capitalisation and autocorrection
   * flags only inside `TYPE_CLASS_TEXT`, so a number or phone keyboard has nothing to
   * read back, and "what did the app ask for" is the only honest answer — which is also
   * what iOS reports for the same keyboard, whose `autocorrectionType` is not consulted
   * by the keys that are up.
   */
  fun autoCorrectOf(inputType: Int, asked: Boolean): Boolean {
    if (inputType and android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS != 0) {
      return false
    }
    return (
      if (inputType and android.text.InputType.TYPE_MASK_CLASS ==
        android.text.InputType.TYPE_CLASS_TEXT
      ) {
        inputType and android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT != 0
      } else {
        asked
      }
    )
  }

  /** The same answer for a mapped [KeyboardType], with no input connection up. */
  fun nameOfKeyboardType(type: KeyboardType): String =
    when (type) {
      KeyboardType.Number, KeyboardType.NumberPassword -> "number-pad"
      KeyboardType.Decimal -> "decimal-pad"
      KeyboardType.Phone -> "phone-pad"
      KeyboardType.Email -> "email-address"
      KeyboardType.Uri -> "url"
      else -> "default"
    }

  /** The same answer for a mapped [KeyboardCapitalization]. */
  fun nameOfCapitalization(capitalization: KeyboardCapitalization): String =
    when (capitalization) {
      KeyboardCapitalization.Words -> "words"
      KeyboardCapitalization.Characters -> "characters"
      KeyboardCapitalization.Sentences -> "sentences"
      else -> "none"
    }
}

/** The field's host: [NitroComposeHost] plus the composable. */
private class TextFieldHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: TextFieldModel,
) : NitroComposeHost<TextFieldModel>(context, activity, model) {

  /** The field fills its box (`fillWidth`); centring would leave a gap at the start. */
  override val centersContent: Boolean
    get() = false

  @Composable
  override fun Component(model: TextFieldModel) {
    TextFieldContent(model)
  }
}

@Composable
private fun TextFieldContent(model: TextFieldModel) {
  val state = model.textState
  val (textStyle, placeholderStyle, cursor) =
    TextFieldStyleCache.get(MaterialTheme.colorScheme, MaterialTheme.typography)
  val limit = remember(model) { NitroUiTextLimit(model) }
  val focusRequester = remember { FocusRequester() }
  val focusManager = LocalFocusManager.current

  // A user edit is counted and emitted from here. `snapshotFlow` sees every change
  // to the state's text, the IME's included; a React write is not a user edit, and
  // `catchUp` tells the two apart by comparing with `displayed`, which a write
  // updates before it edits the state. `afterUpdate()` calls the same function, so
  // an edit this collector has not reached yet is counted before a write can land
  // over it.
  LaunchedEffect(state) {
    snapshotFlow { state.text.toString() to (state.composition != null) }
      .collect { model.catchUp() }
  }

  // `focus()`/`blur()` arrive as ticks so a call made before this composable is
  // attached cannot throw (`FocusRequester.requestFocus()` needs a focus owner).
  // `focus` starts from 0, so a `focus()` that came before this composition existed
  // is still honoured once it does.
  var seenFocus by remember { mutableIntStateOf(0) }
  var seenBlur by remember { mutableIntStateOf(model.blurTick) }
  LaunchedEffect(model.focusTick) {
    if (model.focusTick != seenFocus) {
      seenFocus = model.focusTick
      if (model.editable) {
        runCatching { focusRequester.requestFocus() }
      }
    }
  }
  LaunchedEffect(model.blurTick) {
    if (model.blurTick != seenBlur) {
      seenBlur = model.blurTick
      // Through Compose's focus system, which is the one that holds the field: a
      // `View.clearFocus()` on the host does not release a Compose field (T18).
      if (model.focused) {
        focusManager.clearFocus(force = true)
      }
    }
  }
  // Not editable any more: a focused field gives focus up, as iOS's does.
  LaunchedEffect(model.editable) {
    if (!model.editable && model.focused) {
      focusManager.clearFocus(force = true)
    }
  }
  DisposableEffect(model) {
    onDispose {
      // A disposed field is not focused, whatever its last callback said.
      model.focused = false
    }
  }

  val label = model.accessibilityLabel
  val modifier =
    Modifier.fillMaxWidth()
      // The name goes on the field, never on the host around it
      // (`docs/architecture/core.md` §3, "testID and accessibility"). Measured in a dump:
      // `BasicTextField` publishes its editable node (`EditText`, the text, the actions)
      // with this modifier's semantics as a child node of the same box, which is the
      // shape Material 3's own `TextField` label has, and what X4's rule reads as one
      // named control (`scripts/real-input/a11y.mjs`).
      .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier)
      .focusRequester(focusRequester)
      .onFocusChanged { focus -> model.focusMoved(focus.isFocused) }
  val secure = model.secureApplied
  val multiline = model.multiline
  SideEffect {
    if (model.drawnSecure != secure || model.drawnMultiline != multiline) {
      model.drawnSecure = secure
      model.drawnMultiline = multiline
      model.publish?.invoke()
    }
  }
  val keyboardOptions =
    KeyboardOptions(
      capitalization = capitalizationOf(model.autoCapitalize),
      autoCorrectEnabled = model.autoCorrect && !secure,
      keyboardType = keyboardTypeOf(model.keyboardType, secure),
      imeAction = imeActionOf(model.returnKeyType, model.multiline),
    )
  // RN's default for a single-line field: report the submit, then give focus up.
  val onKeyboardAction =
    KeyboardActionHandler {
      model.onSubmit?.invoke(state.text.toString())
      focusManager.clearFocus(force = true)
    }
  val placeholder = model.placeholder
  val isEmpty by remember(state) { derivedStateOf { state.text.isEmpty() } }
  val decorator =
    TextFieldDecorator { inner ->
      Box {
        if (placeholder != null && isEmpty) {
          Text(placeholder, style = placeholderStyle, maxLines = if (model.multiline) Int.MAX_VALUE else 1)
        }
        inner()
      }
    }

  if (secure) {
    BasicSecureTextField(
      state = state,
      modifier = modifier,
      enabled = model.editable,
      inputTransformation = limit,
      textStyle = textStyle,
      keyboardOptions = keyboardOptions,
      onKeyboardAction = onKeyboardAction,
      cursorBrush = cursor,
      decorator = decorator,
      textObfuscationMode = TextObfuscationMode.RevealLastTyped,
    )
  } else {
    BasicTextField(
      state = state,
      modifier = modifier,
      enabled = model.editable,
      inputTransformation = limit,
      textStyle = textStyle,
      keyboardOptions = keyboardOptions,
      onKeyboardAction = if (model.multiline) null else onKeyboardAction,
      lineLimits =
        if (model.multiline) TextFieldLineLimits.MultiLine() else TextFieldLineLimits.SingleLine,
      cursorBrush = cursor,
      decorator = decorator,
    )
  }
}

/** The Hybrid View React renders as `NitroUiTextField`. */
class HybridNitroUiTextField(
  reactContext: ThemedReactContext,
) : HybridNitroUiTextFieldSpec(), RecyclableView {

  private val model = TextFieldModel()
  private val host = TextFieldHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  /** The snapshot [nuiTestState] answers from; written on the UI thread. */
  @Volatile
  private var snapshot =
    NitroUiTextFieldTestState(
      "", false, false, 0.0, 0.0, "none", true, false, false, "default", "default",
      "sentences", true, -1.0, "", "",
    )

  init {
    host.wantsContentSize = true
    // Height is the field's (one line, or its text at its width); width is the box.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
    model.publish = ::publishState
    model.settle = {
      applyWrite()
      syncText()
      publishState()
    }
  }

  companion object {
    /** This component's name in the sizing engine. */
    private const val SIZING_COMPONENT_NAME = "NitroUiTextField"

    /**
     * One line of `bodyLarge` (24 sp line height) at the default font scale, and the
     * width a field draws at under a parent that gives it none (a row with no
     * `flex`).
     */
    private const val FALLBACK_WIDTH_DP = 200.0
    private const val FALLBACK_HEIGHT_DP = 24.0

    private val fallbackDeclared = AtomicBoolean(false)

    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var value: Variant_NullType_String
    get() =
      model.state.js?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValue: Variant_NullType_String
    get() =
      model.defaultValue?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val initial = next.asSecondOrNull()
      model.defaultValue = initial
      if (model.state.js != null || model.didApplyDefault || initial == null) {
        return
      }
      model.didApplyDefault = true
      if (initial != model.state.displayed) {
        model.state.displayed = initial
        host.markDirty()
      }
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var placeholder: Variant_NullType_String
    get() =
      model.placeholder?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val sent = next.asSecondOrNull()
      if (sent == model.placeholder) return
      model.placeholder = sent
      host.markDirty()
    }

  override var multiline: Boolean
    get() = model.multiline
    set(next) {
      if (next == model.multiline) return
      model.multiline = next
      host.markDirty()
    }

  override var keyboardType: String
    get() = model.keyboardType
    set(next) {
      if (next == model.keyboardType) return
      model.keyboardType = next
      host.markDirty()
    }

  override var autoCapitalize: String
    get() = model.autoCapitalize
    set(next) {
      if (next == model.autoCapitalize) return
      model.autoCapitalize = next
      host.markDirty()
    }

  override var autoCorrect: Boolean
    get() = model.autoCorrect
    set(next) {
      if (next == model.autoCorrect) return
      model.autoCorrect = next
      host.markDirty()
    }

  override var secureTextEntry: Boolean
    get() = model.secureTextEntry
    set(next) {
      if (next == model.secureTextEntry) return
      model.secureTextEntry = next
      host.markDirty()
    }

  override var maxLength: Variant_NullType_Double
    get() =
      model.maxLength?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Read only inside an edit; nothing to render.
      val raw = next.asSecondOrNull()
      model.maxLength = if (raw != null && raw.isFinite()) raw.toInt() else null
    }

  override var returnKeyType: String
    get() = model.returnKeyType
    set(next) {
      if (next == model.returnKeyType) return
      model.returnKeyType = next
      host.markDirty()
    }

  override var editable: Boolean
    get() = model.editable
    set(next) {
      if (next == model.editable) return
      model.editable = next
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val label = next.asSecondOrNull()
      if (label == model.accessibilityLabel) return
      model.accessibilityLabel = label
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
      if (next == model.sizingKey) return
      model.sizingKey = next
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((String, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  override var onFocusChange: ((Boolean) -> Unit)?
    get() = model.onFocusChange
    set(next) {
      model.onFocusChange = next
    }

  override var onSubmitEditing: ((String) -> Unit)?
    get() = model.onSubmit
    set(next) {
      model.onSubmit = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // An edit the collector has not reached yet is counted first, so a write that
    // raced it is judged stale - not applied over a keystroke native never reported.
    model.catchUp()
    applyWrite()
    syncText()
    host.commit()
    publishState()
  }

  /** Decide a pending `value` write: applied, stale, or held back by a composition. */
  private fun applyWrite() {
    val js = model.state.js
    if (js != null && js != model.state.displayed) {
      model.lastWrite =
        when {
          // Q2 §2.2: a write under an open composition destroys it. Held back, not
          // queued: `settle` decides it again when the composition ends.
          model.composing -> "composing"
          model.state.reconcile() -> "applied"
          else -> "stale"
        }
    }
  }

  override fun prepareForRecycle() {
    host.tag = null
    // Resets the model, which hands the next mount a fresh `TextFieldState`.
    host.prepareForRecycle()
    publishState()
  }

  override fun onDropView() {
    model.onChange = null
    model.onFocusChange = null
    model.onSubmit = null
    host.drop()
  }

  /** Write the model's text into the field when they differ, never into a composition. */
  private fun syncText() {
    if (model.composing) {
      return
    }
    val field = model.textState
    val text = model.state.displayed
    if (field.text.toString() != text) {
      field.edit {
        replace(0, length, text)
        placeCursorBeforeCharAt(length)
      }
    }
    model.accounted = text
  }

  /** Snapshot what the harness reads. UI thread; read from JS through `@Volatile`. */
  private fun publishState() {
    val field = model.textState
    snapshot =
      NitroUiTextFieldTestState(
        field.text.toString(),
        model.focused,
        model.composing,
        model.state.nativeEvents.toDouble(),
        model.state.jsEvents.toDouble(),
        model.lastWrite,
        model.editable,
        model.drawnMultiline,
        model.drawnSecure,
        model.keyboardType,
        model.returnKeyType,
        model.autoCapitalize,
        model.autoCorrect,
        (model.maxLength ?: -1).toDouble(),
        model.placeholder ?: "",
        model.accessibilityLabel ?: "",
      )
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Never touches the UI thread. */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  override fun focus() {
    host.post { model.focusTick += 1 }
  }

  override fun blur() {
    host.post { model.blurTick += 1 }
  }

  override fun nuiTestState(): NitroUiTextFieldTestState = snapshot

  /** Android has no public API that opens a composition outside an IME: a no-op. */
  override fun nuiTestSetMarkedText(text: String) {}

  /** iOS-only, like [nuiTestSetMarkedText]: the example app's probe drives Android's IME. */
  override fun nuiTestCancelMarkedText() {}

  /** iOS-only: UIKit's `paste(_:)` is the path it exercises. */
  override fun nuiTestPaste(text: String, at: Double) {}

  override fun nuiTestLifetimeReport(): String = host.lifetimeReport()
}
