@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.margelo.nitro.nitroui

import android.app.Activity
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
import java.util.concurrent.atomic.AtomicBoolean

/*
 * The SearchField component (G17): Material 3's search input field -
 * `SearchBarDefaults.InputField(TextFieldState, SearchBarState, …)` in a plain
 * `Surface`, held collapsed (G27, and the shape G17's review asked for).
 *
 * Why not `SearchBar`/`DockedSearchBar`: material3 1.5's `SearchBar` routes its
 * `inputField` slot through `SearchBarImpl`, which wraps the field in
 * `DisableSoftKeyboard`, so no soft keyboard ever opens for a field the app types
 * into (`InterceptPlatformTextInput` whose interceptor never returns, so the field is
 * handed no input session at all): the harness and `adb input text` could type into it
 * anyway, because both send key events, which is why the gap stayed invisible. What the
 * bar added around the field was a `Surface` - same shape (`inputFieldShape`), same
 * colours (`SearchBarDefaults.colors()`), no tonal or shadow elevation (both `Level0`, so
 * its defaults were nothing) - and that Surface is drawn here instead. The bar's own value
 * is the expand/collapse motion around a results view, which this component does not have.
 *
 * The one thing not copied from the bar is its `Modifier.imePadding()`. With no input
 * session the bar never had an IME inset, so that padding was always zero and nobody
 * noticed; a field that really does open a keyboard finds its box grown by the keyboard's
 * own height, which is not what a search field in an app's layout asks for - `TextField`
 * has no such padding either. The box stays the field's own height whatever the keyboard
 * does (`SearchField.harness.tsx` keeps it honest); room for the keyboard is the app's
 * `KeyboardAvoidingView` or `ScrollView`, as it is for every other control here.
 *
 * The stateful `InputField` is the thing the 1.4 call could not do: it takes
 * `keyboardOptions`, so `keyboardType`, `autoCapitalize` and `autoCorrect` reach the
 * field (D38 item 2 held them back until this API existed). Material still merges
 * `KeyboardOptions(imeAction = Search)` over whatever is passed, which keeps this
 * component's "the Return key is always Search" rule Material's own rather than ours.
 *
 * The bar used to expand on focus and collapse back; the field's own `SearchBarState`
 * still advances when it takes focus - that is what `InputField` does with the state it
 * is handed - and nothing is drawn from it, so [SearchFieldHost.expanded] stays false
 * and the box never moves under a keyboard.
 *
 * The model is TextField's (`TextFieldModel`), so the whole controlled-value half of the
 * component is shared rather than copied: the `TextFieldState`, the `snapshotFlow` that
 * counts and reports edits, the `afterUpdate()` catch-up, `NitroUiTextLimit`, the focus
 * ticks and the composition guard (D38 item 2). What this file decides is what a
 * *search* field looks like: the Search IME action (which Material fixes for this
 * input), a leading search glyph, a clear button that appears with the text, and the
 * platform's own localized "Search…" for a placeholder nobody asked for.
 *
 * It is its own Hybrid View rather than `variant="search"` on TextField because a
 * declared fallback is keyed by component (docs/architecture/sizing.md §5): as a
 * variant, every cold SearchField would lay out at TextField's 24 dp line for one frame
 * and then correct to the 56 dp bar - a jump at the top of a search screen.
 */

/**
 * The test tag on the search glyph, so the example app's pixel probe can find the icon's
 * box (`NitroUiProbe.searchGlyphPixels`) and check it draws a magnifier's ring rather than
 * a filled disc - the shape the hand-typed path 0.7.0 shipped got wrong.
 *
 * Both glyphs are Google's Material Symbols (`nitroui_search`, `nitroui_close`; see
 * `core/NitroUiIcons.kt`). The search glyph is decorative - the field next to it says
 * what it is - and the close glyph carries the localized "clear" label instead.
 */
internal const val SEARCH_FIELD_GLYPH_TAG = "nitroui.searchfield.glyph"

/**
 * The platform's own localized words for a search field.
 *
 * The library writes no English literal of its own: Android ships "Search…" and "Clear
 * query" as framework string resources (`search_hint`,
 * `searchview_description_clear`), which the platform translates into every locale.
 * Both are private to the framework, so there is no `android.R.string` constant to name
 * - checked against the android-35 stub, whose `android.R.string` offers only
 * `search_go` of the search family - and a name lookup is the only way to reach a
 * private resource. So each name is resolved once, on the first field drawn, and an
 * answer of 0 (the shape a device without them gives) falls back to the English the
 * platform itself uses, which is what the value above says in en-US.
 *
 * The hint falls back to plain "Search" rather than "Search…": a placeholder with an
 * ellipsis no other locale is known to use is a worse guess than the word.
 */
private object SearchFieldStrings {
  /** Framework resource lookup, cached for the process; 0 means "not on this device". */
  private fun frameworkResId(name: String): Int =
    FRAMEWORK_RESOURCES.getIdentifier(name, "string", "android")

  private val FRAMEWORK_RESOURCES: Resources = Resources.getSystem()

  val hint: String by lazy {
    val id = frameworkResId("search_hint")
    if (id != 0) FRAMEWORK_RESOURCES.getString(id) else "Search"
  }

  val clear: String by lazy {
    val id = frameworkResId("searchview_description_clear")
    if (id != 0) FRAMEWORK_RESOURCES.getString(id) else "Clear query"
  }
}

/**
 * The bar's and the input's colours, one pair per colour scheme.
 *
 * Material's factories return a fresh object graph per call, and a hosted control is its
 * own composition, so `remember` could not share them even if this were hosted
 * (`docs/architecture/core.md` §3, "Shared objects"). Both factories are composables, so
 * the cache is *filled* inside the composition and read outside it - see
 * [SearchFieldContent].
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

/** The bar's host: [NitroComposeHost] plus the composable, plus what it drew. */
private class SearchFieldHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: TextFieldModel,
) : NitroComposeHost<TextFieldModel>(context, activity, model) {

  /** The field fills its box (`fillWidth`); centring would leave a gap at the start. */
  override val centersContent: Boolean
    get() = false

  /**
   * `nuiTestSubmit()` as a tick, the way TextField does its `focus()`/`blur()`: the
   * Search key's handler lives in the composition (it needs the focus manager), and a
   * call made before this view is attached must not throw.
   */
  var submitTick by mutableIntStateOf(0)
    internal set

  /**
   * Whether a results view is drawn under the field. There is none, so this stays
   * `false` for the life of the view - and it is state rather than a literal because a
   * results view is what would have to change it, and because the harness reports what
   * the composition drew, not what a constant said.
   *
   * What this is *not*: the field's own `SearchBarState` does advance to expanded when
   * it takes focus, because that is what `SearchBarDefaults.InputField` does with the
   * state it is handed. Nothing here is drawn from it, so the box does not move and
   * this stays false.
   */
  var expanded by mutableStateOf(false)
    internal set

  /**
   * The field asking to expand, read off its own `SearchBarState`. With no results view
   * to expand *into*, the request is dropped and the box never moves under a keyboard.
   * Storing `next` in [expanded] - and drawing a column under the field from it - is the
   * one change a results view would make, and the harness's "the box did not change
   * height while focused" case is what says so out loud if it ever happens by accident.
   */
  fun onExpandedRequest(next: Boolean) {
    // Intentionally drops `next`: collapsed is the only shape this component draws.
  }

  @Composable
  override fun Component(model: TextFieldModel) {
    SearchFieldContent(model)
  }
}

@Composable
private fun SearchFieldHost.SearchFieldContent(model: TextFieldModel) {
  val state = model.textState
  val limit = remember(model) { NitroUiTextLimit(model) }
  val focusRequester = remember { FocusRequester() }
  val focusManager = LocalFocusManager.current

  // One pair of Material colour objects per scheme, not one per recomposition. Both
  // factories are composables, so this is where they may be called - guarded, so a
  // recomposition under the same scheme builds nothing (core.md §3). The bar's pair is
  // no longer a `SearchBar`'s: it is the box's container and content colours, which are
  // the same two values the collapsed bar drew the box with.
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
  // What the collapsed bar passed its Surface: the content colour resolved from the
  // container it drew, not a colour of its own.
  val contentColor = contentColorFor(barColor)

  // A user edit is counted and emitted from here, exactly as TextField does it:
  // `snapshotFlow` sees every change to the state's text, the IME's and the clear
  // button's included; a React write is not a user edit, and `catchUp` tells the two
  // apart. `afterUpdate()` calls the same function, so an edit this collector has not
  // reached yet is counted before a write can land over it.
  LaunchedEffect(state) {
    snapshotFlow { state.text.toString() to (state.composition != null) }
      .collect { model.catchUp() }
  }

  // `focus()`/`blur()` arrive as ticks on the model, shared with TextField
  // (`TextFieldModel.focusTick`), so a call made before this composable is attached
  // cannot throw and one made before it exists is still honoured once it does.
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

  // The Search key, as the input's own `onSearch`. Two rules live here:
  // - an empty query never submits, which is iOS's `enablesReturnKeyAutomatically`
  //   turned into a statement rather than left to two platforms' defaults;
  // - a submit gives focus up, as TextField's single-line rule does.
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
      // The same handler a keyboard press reaches, guard included.
      onSearch(state.text.toString())
    }
  }

  val label = model.accessibilityLabel
  val modifier =
    Modifier
      // The name goes on the field, never on the host around it (core.md §3, "testID and
      // accessibility"): the editable node publishes these semantics as a child of the
      // same box, which is the shape `scripts/real-input/a11y.mjs` reads as one named
      // control.
      .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier)
      .focusRequester(focusRequester)
      .onFocusChanged { focus -> model.focusMoved(focus.isFocused) }

  // The clear button is the trailing slot, and it appears with the text: Material 3's
  // search input has no built-in one, and an always-present clear would sit in an empty
  // field taking a tap. `clearText()` is what the button does; the `snapshotFlow` above
  // reports it as the edit it is, and focus stays.
  val hasText by derivedStateOf { state.text.isNotEmpty() }
  val trailing: (@Composable () -> Unit)? =
    if (hasText && model.editable) {
      {
        IconButton(
          onClick = { state.clearText() },
          // The name goes on the button, not on the glyph inside it. Compose publishes the
          // clickable box and the icon as two accessibility nodes and does not merge the
          // glyph's name into the box, so naming the glyph leaves the node TalkBack can act
          // on silent - measured in a dump of this screen: the clickable box reads
          // `content-desc=""` around a child reading `content-desc="Clear query"`. The glyph
          // is decorative (`null`) so the name is stated once, on the node that answers the
          // tap. iOS needs no equivalent line: UIKit's own clear button already carries the
          // system's localized "Clear text".
          modifier = Modifier.semantics { contentDescription = SearchFieldStrings.clear },
        ) {
          Icon(imageVector = nitroUiIcon(R.drawable.nitroui_close), contentDescription = null)
        }
      }
    } else {
      null
    }

  // The keyboard, from the same three model values and the same two mapping functions
  // `HybridNitroUiTextField` uses (`docs/components/text-field.md`'s table is the only
  // mapping table in the library). `imeAction` is stated rather than left out because
  // `InputField` overwrites it with `Search` either way: writing it here keeps the
  // options this composition holds honest about the key it will produce.
  val keyboardOptions =
    KeyboardOptions(
      capitalization = capitalizationOf(model.autoCapitalize),
      autoCorrectEnabled = model.autoCorrect,
      keyboardType = keyboardTypeOf(model.keyboardType, secure = false),
      imeAction = ImeAction.Search,
    )

  // The field's own expand/collapse state. Nothing is drawn from it - see
  // [SearchFieldHost.expanded] - but it is what `InputField` drives when the field
  // takes focus, and mirroring it into the host is where a results view would one day
  // hook in. LaunchedEffect rather than a read during composition: watching the state
  // must not subscribe this composition to the animation behind it.
  val searchBarState = rememberSearchBarState()
  LaunchedEffect(searchBarState) {
    // `isExpanded` is internal to material3; `currentValue` is its public twin.
    snapshotFlow { searchBarState.currentValue == SearchBarValue.Expanded }
      .collect { onExpandedRequest(it) }
  }

  // The box, which is what `DockedSearchBar` used to draw around this field: a `Surface`
  // in the input field's shape with the search-bar colours and no elevation. No
  // `imePadding()` - see the file header: the bar could never see an IME inset, and a
  // field that can see one must not grow its own box by the keyboard's height. The field
  // paints its own container inside it, exactly as it did inside the bar.
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
      // The app's word when it gave one, the platform's when it did not. Reading
      // `model.placeholder` here (a `mutableStateOf`) is what makes a `placeholder`
      // change recompose the slot, and `SearchFieldStrings.hint` is the framework's
      // own localized prompt, not a literal written here.
      placeholder = { Text(model.placeholder ?: SearchFieldStrings.hint) },
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

/** The Hybrid View React renders as `NitroUiSearchField`. */
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
      "default", "none", true, false, false,
    )

  init {
    host.wantsContentSize = true
    // Height is the field's; width is the box.
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
    /** This component's name in the sizing engine. */
    private const val SIZING_COMPONENT_NAME = "NitroUiSearchField"

    /**
     * `SearchBarDefaults.InputFieldHeight` - 56 dp at the default font scale - and the
     * width a field draws under a parent that gives it none (a row with no `flex`).
     * TextField's one line is 24 dp, so the two differ by design, and
     * `SearchField.harness.tsx` has an assertion against a SearchField that measured
     * like a TextField.
     */
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

  /**
   * The traits a search field fixes or defaults, as the model's own values - so the
   * shared keyboard mapping stays the one thing that decides what the field is
   * configured with.
   *
   * `returnKeyType`, `multiline` and `secureTextEntry` have no prop and cannot move
   * (D38 item 2). The other three are a search field's *defaults*: they are what v1
   * fixed them to, so a field whose app passes no keyboard prop is configured exactly as
   * it was, and this is also what a recycled field comes back with ([prepareForRecycle])
   * rather than [TextFieldModel.reset]'s text-field defaults. `returnKeyType` is what
   * the harness reads back as "the Search key was applied".
   */
  private fun applySearchPresets() {
    model.returnKeyType = "search"
    model.keyboardType = "default"
    model.autoCapitalize = "none"
    model.autoCorrect = true
    model.multiline = false
    model.secureTextEntry = false
    // Not a prop write, but the same change of what the field is configured with, and a
    // recycled view has to be read back fresh rather than reported from the last owner.
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
      // There is one configuration, so this only ever arms the reporting.
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
    // The model is shared with TextField, whose defaults are a text field's.
    applySearchPresets()
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

  /**
   * Bumped by the three keyboard setters, and the stamp [appliedKeyboard] was last read
   * at. Together they mean the read-back below runs when a keyboard prop moved or the
   * field changed focus - and not on every keystroke, which is what [publishState] is
   * otherwise called for (a keystroke latency is the one budget this component shares
   * with TextField's timing gate).
   */
  private var keyboardStamp = 0
  private var keyboardStampRead = -1
  private var keyboardFocusRead: Boolean? = null

  /** The keyboard as [publishState] reported it, decoded from whatever it read. */
  private var appliedKeyboard = AppliedKeyboard("default", "none", true)

  /** [appliedKeyboard]'s three RN names. */
  private data class AppliedKeyboard(
    val keyboardType: String,
    val autoCapitalize: String,
    val autoCorrect: Boolean,
  )

  /**
   * The keyboard the field is configured with, in RN's spellings.
   *
   * Two sources, in that order of authority:
   *
   * - While the field holds focus, the [EditorInfo] its own input connection hands the
   *   IME ([currentEditorInfo]) - the same object the keyboard is built from, so this
   *   says what the IME was told, not what the wrapper asked for.
   * - With no input connection up (an unfocused field, a fresh recycle), the
   *   [KeyboardOptions] the composition would be given, decoded from the same mapping
   *   functions it uses.
   *
   * What neither can say is that the IME *redrew* its keyboard after a prop changed
   * while focused: Compose rebuilds the `EditorInfo` on request and nothing restarts the
   * input session for a `keyboardOptions` change, so the open keyboard keeps the type it
   * opened with until the field is focused again. `docs/components/search-field.md` says
   * exactly that, and the real-input suite is the one that can watch the IME itself.
   */
  private fun appliedKeyboard(): AppliedKeyboard {
    val focused = model.focused
    if (keyboardStamp == keyboardStampRead && focused == keyboardFocusRead) {
      return appliedKeyboard
    }
    val info = if (focused) currentEditorInfo() else null
    appliedKeyboard =
      if (info != null) {
        AppliedKeyboard(
          keyboardType = NitroUiKeyboardNames.nameOfInputType(info.inputType),
          autoCapitalize = NitroUiKeyboardNames.nameOfCapitalization(info.inputType),
          autoCorrect = NitroUiKeyboardNames.autoCorrectOf(info.inputType, model.autoCorrect),
        )
      } else {
        AppliedKeyboard(
          keyboardType =
            NitroUiKeyboardNames.nameOfKeyboardType(
              keyboardTypeOf(model.keyboardType, secure = false)
            ),
          autoCapitalize =
            NitroUiKeyboardNames.nameOfCapitalization(
              capitalizationOf(model.autoCapitalize)
            ),
          autoCorrect = model.autoCorrect,
        )
      }
    keyboardStampRead = keyboardStamp
    keyboardFocusRead = focused
    return appliedKeyboard
  }

  /**
   * The `EditorInfo` the focused field would hand the IME right now, or `null` when no
   * input connection is up.
   *
   * Compose draws its text fields itself and keeps the input connection on the
   * `AndroidComposeView` under the host, so the way to ask is the same one the IME uses:
   * find the descendant that says it is a text editor and call
   * [View.onCreateInputConnection] on it, which fills the [EditorInfo] it is given from
   * the field's current state. Only asked while the field holds focus: that is when a
   * session exists, and the only time the call has anything honest to answer with.
   */
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
    val keyboard = appliedKeyboard()
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
        // What the field is *drawing*, which is the app's word or - when the app passed
        // none - the platform's own localized prompt. iOS reports the same thing
        // (`control.placeholder`), and the harness asserts on it: a recycle that left the
        // previous owner's prompt on screen has to be visible from JS, and a report of
        // `""` here would hide it behind the very fallback the control is drawing.
        model.placeholder ?: SearchFieldStrings.hint,
        model.accessibilityLabel ?: "",
        model.returnKeyType,
        keyboard.keyboardType,
        keyboard.autoCapitalize,
        keyboard.autoCorrect,
        host.expanded,
        model.editable && text.isNotEmpty(),
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

  /**
   * The snapshot [publishState] wrote, and one more look.
   *
   * JS must not wait for the UI thread, so this reads the snapshot rather than the
   * control. That is a moment behind reality in one place: the keyboard a focused field
   * reports comes from the input session, and Compose starts that session a frame after
   * focus lands. So asking for the state also asks the UI thread to refresh it — coalesced,
   * because [stateWhen]-style tests poll this every 20 ms, and the harness sees what the
   * control is configured with on the next poll instead of what was true when focus moved.
   *
   * The refresh re-reads the keyboard and nothing else. The text, the focus and the event
   * counts are published where their events are emitted, so a test that waits for the
   * state to show a change has the change's event in hand too; refreshing them here would
   * let a poll see a cleared query or a blur before its `change:` or `blur` reached JS.
   */
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

  /** Bring the snapshot's three keyboard fields up to date, leaving every other field. */
  private fun publishKeyboard() {
    val keyboard = appliedKeyboard()
    val current = snapshot
    if (
      current.keyboardType == keyboard.keyboardType &&
        current.autoCapitalize == keyboard.autoCapitalize &&
        current.autoCorrect == keyboard.autoCorrect
    ) {
      return
    }
    snapshot =
      current.copy(
        keyboardType = keyboard.keyboardType,
        autoCapitalize = keyboard.autoCapitalize,
        autoCorrect = keyboard.autoCorrect,
      )
  }

  /** The clear button's own call, on the UI thread: the `snapshotFlow` reports it. */
  override fun nuiTestClear() {
    host.post {
      if (model.editable && model.textState.text.isNotEmpty()) {
        model.textState.clearText()
      }
    }
  }

  /** Runs the Search key's handler, empty-query guard included (see `onSearch`). */
  override fun nuiTestSubmit() {
    host.post { host.submitTick += 1 }
  }

  override fun nuiTestLifetimeReport(): String = host.lifetimeReport()
}
