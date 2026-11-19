@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.margelo.nitro.nitroui

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBarColors
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.SearchBarValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.material3.contentColorFor
import androidx.compose.material3.rememberSearchBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiIcon
import com.margelo.nitro.views.RecyclableView
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

// The SearchField component: Material's search `InputField` in a `Surface`, sharing
// TextField's model. Not `SearchBar`: material3 1.5's `SearchBar` disables the soft keyboard.

/** Test tag on the search glyph, so the example app's pixel probe can find its box. */
internal const val SEARCH_FIELD_GLYPH_TAG = "nitroui.searchfield.glyph"

/**
 * The platform's localized "Search…" and "Clear query". Both are private framework
 * strings, so they are looked up by name, with English fallbacks.
 *
 * They are read from the configuration a field draws in, not from the device's: an app
 * shown in another language than the device's, including a per-app language on Android 13
 * and later, gets its own words, and the next draw after a language change has the new
 * ones. Cached per locale list, and bounded, so rendering under many locales cannot grow
 * the cache for the life of the process.
 */
object SearchFieldStrings {
  /** The prompt a field with no `placeholder` draws for [context]. */
  internal fun hint(
    context: Context,
  ): String = entryFor(context).first

  /** The clear button's screen-reader label for [context]. */
  internal fun clear(
    context: Context,
  ): String = entryFor(context).second

  /**
   * The pair a field draws for [context], or for the language [localeTag] names when one
   * is given. Public for the example app's probe, which asks what a field would draw in
   * another language; an app reads its own strings through a field.
   */
  fun forLocale(
    context: Context,
    localeTag: String,
  ): Pair<String, String> {
    if (localeTag.isEmpty()) {
      return hint(context) to clear(context)
    }
    val configuration = Configuration(context.resources.configuration)
    configuration.setLocale(Locale.forLanguageTag(localeTag))
    val other = context.createConfigurationContext(configuration)
    return hint(other) to clear(other)
  }

  private const val MAX_ENTRIES = 8

  private val cache = HashMap<String, Pair<String, String>>()

  @Synchronized
  private fun entryFor(context: Context): Pair<String, String> {
    val resources = context.resources
    val key = resources.configuration.locales.toLanguageTags()
    cache[key]?.let { return it }
    val built =
      frameworkString(resources, "search_hint", "Search") to
        frameworkString(resources, "searchview_description_clear", "Clear query")
    if (cache.size >= MAX_ENTRIES) {
      cache.clear()
    }
    cache[key] = built
    return built
  }

  private fun frameworkString(
    resources: Resources,
    name: String,
    fallback: String,
  ): String {
    val id = resources.getIdentifier(name, "string", "android")
    return if (id != 0) resources.getString(id) else fallback
  }
}

/**
 * The bar's and the input's colours, one pair per colour scheme. Material's factories
 * build new objects per call and are composables, so the cache is filled in composition.
 */
private object SearchFieldColorsCache {
  private var scheme: ColorScheme? = null
  private var bar: SearchBarColors? = null
  private var input: TextFieldColors? = null

  @Synchronized
  fun holds(scheme: ColorScheme): Boolean = this.scheme === scheme

  @Synchronized
  fun fill(
    scheme: ColorScheme,
    bar: SearchBarColors,
    input: TextFieldColors,
  ) {
    this.scheme = scheme
    this.bar = bar
    this.input = input
  }

  @Synchronized
  fun bar(): SearchBarColors? = bar

  @Synchronized
  fun input(): TextFieldColors? = input
}

private class SearchFieldHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: TextFieldModel,
) : NitroComposeHost<TextFieldModel>(context, activity, model) {

  /** The field fills its box (`fillWidth`); centring would leave a gap at the start. */
  override val centersContent: Boolean
    get() = false

  /**
   * A test submit arrives as a tick: the Search handler lives in the composition, and a
   * call made before the view is attached must not throw.
   */
  var submitTick by mutableIntStateOf(0)
    internal set

  /** Whether a results view is drawn under the field. There is none, so this stays false. */
  var expanded by mutableStateOf(false)
    internal set

  /** The field asks to expand when it takes focus. With no results view this is dropped. */
  fun onExpandedRequest(next: Boolean) {
    // Intentionally drops `next`: collapsed is the only shape this component draws.
  }

  @Composable
  override fun Component(model: TextFieldModel) {
    InterceptPlatformTextInput(remember(model) { NitroUiAutoCorrectInterceptor(model) }) {
      SearchFieldContent(model)
    }
  }
}

@Composable
private fun SearchFieldHost.SearchFieldContent(model: TextFieldModel) {
  val state = model.textState
  // The configuration this composition draws in: where the framework's strings come from.
  val context = LocalContext.current
  val limit = remember(model) { NitroUiTextLimit(model) }
  val focusRequester = remember { FocusRequester() }
  val focusManager = LocalFocusManager.current

  // Both colour factories are composables, so the cache is filled here, once per scheme.
  val scheme = MaterialTheme.colorScheme
  if (!SearchFieldColorsCache.holds(scheme)) {
    SearchFieldColorsCache.fill(
      scheme,
      SearchBarDefaults.colors(),
      SearchBarDefaults.inputFieldColors(),
    )
  }
  val barColors = SearchFieldColorsCache.bar()
  val inputColors = SearchFieldColorsCache.input()
  val boxColors = barColors ?: SearchBarDefaults.colors()
  val barColor = boxColors.containerColor
  val contentColor = contentColorFor(barColor)

  // `snapshotFlow` sees every change to the text, the IME's and the clear button's
  // included. `catchUp` tells a user edit from a React write.
  LaunchedEffect(state) {
    snapshotFlow { state.text.toString() to (state.composition != null) }
      .collect { model.catchUp() }
  }

  // `focus()` and `blur()` arrive as ticks, so a call made before attach is honoured later.
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
    onDispose { model.focused = false }
  }

  // An empty query never submits, and a submit gives focus up.
  val onSearch: (String) -> Unit = { text ->
    if (text.isNotEmpty()) {
      model.onSubmit?.invoke(text)
      focusManager.clearFocus(force = true)
    }
  }
  var seenSubmit by remember { mutableIntStateOf(submitTick) }
  LaunchedEffect(submitTick) {
    if (submitTick != seenSubmit) {
      seenSubmit = submitTick
      onSearch(state.text.toString())
    }
  }

  val label = model.accessibilityLabel
  val modifier =
    Modifier
      // The name goes on the field, not on the host view around it.
      .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier)
      .focusRequester(focusRequester)
      .onFocusChanged { focus -> model.focusMoved(focus.isFocused) }

  // Material's search input has no clear button. This one appears only with text, so it
  // never takes a tap in an empty field.
  val hasText by derivedStateOf { state.text.isNotEmpty() }
  val trailing: (@Composable () -> Unit)? =
    if (hasText && model.editable) {
      {
        IconButton(
          onClick = { state.clearText() },
          // The name goes on the button, not the glyph: Compose does not merge the glyph's
          // description into the clickable node, which would leave that node unnamed.
          modifier = Modifier.semantics {
            contentDescription = SearchFieldStrings.clear(context)
          },
        ) {
          Icon(imageVector = nitroUiIcon(R.drawable.nitroui_close), contentDescription = null)
        }
      }
    } else {
      null
    }

  // `InputField` overwrites `imeAction` with `Search` regardless; stated so the options match.
  val keyboardOptions =
    KeyboardOptions(
      capitalization = capitalizationOf(model.autoCapitalize),
      autoCorrectEnabled = model.autoCorrect,
      keyboardType = keyboardTypeOf(model.keyboardType, secure = false),
      imeAction = ImeAction.Search,
    )

  // `InputField` drives this state when the field takes focus. Observed in an effect, not
  // read in composition, so the composition does not subscribe to its animation.
  val searchBarState = rememberSearchBarState()
  LaunchedEffect(searchBarState) {
    // `isExpanded` is internal to material3; `currentValue` is its public twin.
    snapshotFlow { searchBarState.currentValue == SearchBarValue.Expanded }
      .collect { onExpandedRequest(it) }
  }

  // The box `SearchBar` would draw: a `Surface` in the input field's shape. No
  // `imePadding()`: it would grow the box by the keyboard's height.
  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = SearchBarDefaults.inputFieldShape,
    color = barColor,
    contentColor = contentColor,
  ) {
    SearchBarDefaults.InputField(
      textFieldState = state,
      searchBarState = searchBarState,
      onSearch = onSearch,
      modifier = modifier,
      enabled = model.editable,
      placeholder = { Text(model.placeholder ?: SearchFieldStrings.hint(context)) },
      leadingIcon = {
        Icon(
          imageVector = nitroUiIcon(R.drawable.nitroui_search),
          contentDescription = null,
          modifier = Modifier.testTag(SEARCH_FIELD_GLYPH_TAG),
        )
      },
      trailingIcon = trailing,
      inputTransformation = limit,
      colors = inputColors ?: SearchBarDefaults.inputFieldColors(),
      keyboardOptions = keyboardOptions,
    )
  }
}

class HybridNitroUiSearchField(
  reactContext: ThemedReactContext,
) : HybridNitroUiSearchFieldSpec(), RecyclableView {

  private val model = TextFieldModel()
  private val host = SearchFieldHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  /** The snapshot `nuiTestState` answers from; written on the UI thread. */
  @Volatile
  private var snapshot =
    NitroUiSearchFieldTestState(
      "", false, false, 0.0, 0.0, "none", true, -1.0, "", "", "search",
      "default", "none", true, false, false, SUGGESTIONS_UNKNOWN,
    )

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    declareFallback()
    model.publish = ::publishState
    model.settle = {
      applyWrite()
      syncText()
      publishState()
    }
    applySearchPresets()
  }

  companion object {
    // Must match the component name in the generated view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiSearchField"

    // What the test state reports for `suggestions`.
    private const val SUGGESTIONS_OFFERED = "offered"
    private const val SUGGESTIONS_REFUSED = "refused"
    private const val SUGGESTIONS_UNKNOWN = "unknown"

    // The size before anything is measured, in dp: Material's 56 dp input field height,
    // and the width a field draws at under a parent that gives it none.
    private const val FALLBACK_WIDTH_DP = 200.0
    private const val FALLBACK_HEIGHT_DP = 56.0

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

  // The model is shared with TextField, so set a search field's fixed traits and
  // defaults on it. Also what a recycled field comes back with.
  private fun applySearchPresets() {
    model.returnKeyType = "search"
    model.keyboardType = "default"
    model.autoCapitalize = "none"
    model.autoCorrect = true
    model.multiline = false
    model.secureTextEntry = false
    // Invalidates any keyboard read-back taken before this.
    keyboardStamp += 1
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

  override var keyboardType: String
    get() = model.keyboardType
    set(next) {
      if (next == model.keyboardType) return
      model.keyboardType = next
      keyboardStamp += 1
      host.markDirty()
    }

  override var autoCapitalize: String
    get() = model.autoCapitalize
    set(next) {
      if (next == model.autoCapitalize) return
      model.autoCapitalize = next
      keyboardStamp += 1
      host.markDirty()
    }

  override var autoCorrect: Boolean
    get() = model.autoCorrect
    set(next) {
      if (next == model.autoCorrect) return
      model.autoCorrect = next
      keyboardStamp += 1
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
    // An edit the collector has not reached yet is counted first, so a write that raced
    // it is judged stale - not applied over a keystroke native never reported.
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
          // A write under an open IME composition destroys it. Held back, not queued:
          // `settle` decides again when the composition ends.
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
    // The model is shared with TextField, whose defaults are a text field's.
    applySearchPresets()
    // Recorded for tests, which cannot read between the reset and the next owner's first props.
    resetKeyboard = "${model.keyboardType}/${model.autoCapitalize}/${model.autoCorrect}"
    publishState()
  }

  private var resetKeyboard = "never"

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

  // Bumped whenever the keyboard configuration changes; an older read-back is stale.
  private var keyboardStamp = 0

  private var probedKeyboard: AppliedKeyboard? = null
  private var probedStamp = -1

  private data class AppliedKeyboard(
    val keyboardType: String,
    val autoCapitalize: String,
    val autoCorrect: Boolean,
    val suggestions: String,
  )

  // A focused field whose `EditorInfo` is not read yet. `pending` is a value no prop can have.
  private val PENDING_KEYBOARD = AppliedKeyboard("pending", "pending", true, SUGGESTIONS_UNKNOWN)

  // The keyboard the options describe, without walking the view tree.
  private fun optionsKeyboard(): AppliedKeyboard =
    AppliedKeyboard(
      keyboardType =
        NitroUiKeyboardNames.nameOfKeyboardType(keyboardTypeOf(model.keyboardType, secure = false)),
      autoCapitalize =
        NitroUiKeyboardNames.nameOfCapitalization(capitalizationOf(model.autoCapitalize)),
      autoCorrect = model.autoCorrect,
      // What the IME is told is only known from a focused field's `EditorInfo`.
      suggestions = SUGGESTIONS_UNKNOWN,
    )

  // Unfocused: the options. Focused: the last read-back for the current stamp, or pending.
  // Never the options while focused: that report means "what the IME was handed".
  private fun publishedKeyboard(): AppliedKeyboard {
    if (!model.focused) {
      probedKeyboard = null
      return optionsKeyboard()
    }
    val probed = probedKeyboard
    return if (probed != null && probedStamp == keyboardStamp) probed else PENDING_KEYBOARD
  }

  // Test-only: decodes the `EditorInfo` the focused field hands the IME. It cannot say
  // what the IME drew: a new `EditorInfo` is built from current options on every call.
  private fun readBackKeyboard(): AppliedKeyboard {
    if (!model.focused) {
      probedKeyboard = null
      return optionsKeyboard()
    }
    val cached = probedKeyboard
    if (cached != null && probedStamp == keyboardStamp) {
      return cached
    }
    val info = currentEditorInfo() ?: return PENDING_KEYBOARD
    val read =
      AppliedKeyboard(
        keyboardType = NitroUiKeyboardNames.nameOfInputType(info.inputType),
        autoCapitalize = NitroUiKeyboardNames.nameOfCapitalization(info.inputType),
        autoCorrect = NitroUiKeyboardNames.autoCorrectOf(info.inputType, model.autoCorrect),
        suggestions =
          if (NitroUiKeyboardNames.suggestionsOf(info.inputType)) {
            SUGGESTIONS_OFFERED
          } else {
            SUGGESTIONS_REFUSED
          },
      )
    probedKeyboard = read
    probedStamp = keyboardStamp
    return read
  }

  // Compose keeps the input connection on the `AndroidComposeView` under the host. Ask as
  // the IME does: find the descendant that is a text editor and create an input connection.
  private fun currentEditorInfo(): EditorInfo? {
    val queue = ArrayDeque<View>()
    queue.add(host)
    while (queue.isNotEmpty()) {
      val candidate = queue.removeFirst()
      if (candidate !== host && candidate.onCheckIsTextEditor()) {
        val info = EditorInfo()
        if (candidate.onCreateInputConnection(info) != null) {
          return info
        }
      }
      if (candidate is ViewGroup) {
        for (index in 0 until candidate.childCount) {
          queue.add(candidate.getChildAt(index))
        }
      }
    }
    return null
  }

  /** Snapshot what the harness reads. UI thread; read from JS through `@Volatile`. */
  private fun publishState() {
    val keyboard = publishedKeyboard()
    val field = model.textState
    val text = field.text.toString()
    snapshot =
      NitroUiSearchFieldTestState(
        text,
        model.focused,
        model.composing,
        model.state.nativeEvents.toDouble(),
        model.state.jsEvents.toDouble(),
        model.lastWrite,
        model.editable,
        (model.maxLength ?: -1).toDouble(),
        // What the field draws: the app's placeholder, or the platform's localized one.
        model.placeholder ?: SearchFieldStrings.hint(host.context),
        model.accessibilityLabel ?: "",
        model.returnKeyType,
        keyboard.keyboardType,
        keyboard.autoCapitalize,
        keyboard.autoCorrect,
        host.expanded,
        model.editable && text.isNotEmpty(),
        keyboard.suggestions,
      )
  }

  // MARK: - Methods

  // Reads the host's cached size, so it is safe on the JS thread.
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

  // Returns the last snapshot, because JS must not wait for the UI thread, and queues a
  // refresh of the keyboard fields only: the input session starts a frame after focus.
  override fun nuiTestState(): NitroUiSearchFieldTestState {
    requestStateRefresh()
    return snapshot
  }

  private val stateRefreshQueued = AtomicBoolean(false)

  /** Queue one [publishState] on the UI thread, however many reads ask for one. */
  private fun requestStateRefresh() {
    if (!stateRefreshQueued.compareAndSet(false, true)) {
      return
    }
    host.post {
      stateRefreshQueued.set(false)
      publishKeyboard()
    }
  }

  private fun publishKeyboard() {
    val keyboard = readBackKeyboard()
    val current = snapshot
    if (
      current.keyboardType == keyboard.keyboardType &&
        current.autoCapitalize == keyboard.autoCapitalize &&
        current.autoCorrect == keyboard.autoCorrect &&
        current.suggestions == keyboard.suggestions
    ) {
      return
    }
    snapshot =
      current.copy(
        keyboardType = keyboard.keyboardType,
        autoCapitalize = keyboard.autoCapitalize,
        autoCorrect = keyboard.autoCorrect,
        suggestions = keyboard.suggestions,
      )
  }

  override fun nuiTestClear() {
    host.post {
      if (model.editable && model.textState.text.isNotEmpty()) {
        model.textState.clearText()
      }
    }
  }

  override fun nuiTestSubmit() {
    host.post { host.submitTick += 1 }
  }

  override fun nuiTestLifetimeReport(): String =
    "${host.lifetimeReport()} resetKeyboard=$resetKeyboard"
}
