@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.margelo.nitro.nitroui

import android.app.Activity
import android.content.res.Resources
import android.view.View
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.DockedSearchBar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBarColors
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
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
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

/*
 * The SearchField component (G17): Material 3's search-bar input field -
 * `DockedSearchBar` around `SearchBarDefaults.InputField(TextFieldState, …)`, held
 * collapsed.
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
 * The two glyphs, as `ImageVector`s built once per process from Material's own geometry
 * (Apache 2.0, the 24-unit viewport), because this library does not depend on
 * `material-icons-core` for two icons (Chip's precedent, `HybridNitroUiChip.kt`).
 *
 * The search glyph is decorative - the field next to it says what it is - and the close
 * glyph carries the localized "clear" label instead.
 */
private val SearchGlyph: ImageVector by lazy {
  ImageVector.Builder(
    name = "NitroUiSearch",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
  ).path(fill = SolidColor(ComposeColor.Black)) {
    moveTo(15.5f, 14f)
    lineToRelative(-0.79f, 0f)
    lineToRelative(-0.28f, -0.27f)
    curveToRelative(0.48f, -0.55f, 0.77f, -1.27f, 0.77f, -2.06f)
    curveToRelative(0f, -1.83f, -1.49f, -3.32f, -3.32f, -3.32f)
    reflectiveCurveToRelative(-3.32f, 1.49f, -3.32f, 3.32f)
    reflectiveCurveToRelative(1.49f, 3.32f, 3.32f, 3.32f)
    curveToRelative(0.79f, 0f, 1.51f, -0.29f, 2.06f, -0.77f)
    lineToRelative(0.28f, 0.28f)
    lineToRelative(0f, 0.79f)
    lineToRelative(5f, 4.99f)
    lineToRelative(1.49f, -1.49f)
    lineToRelative(-4.99f, -5f)
    close()
    moveTo(9.5f, 14f)
    curveToRelative(-2.48f, 0f, -4.5f, -2.02f, -4.5f, -4.5f)
    reflectiveCurveToRelative(2.02f, -4.5f, 4.5f, -4.5f)
    reflectiveCurveToRelative(4.5f, 2.02f, 4.5f, 4.5f)
    reflectiveCurveToRelative(-2.02f, 4.5f, -4.5f, 4.5f)
    close()
  }.build()
}

private val CloseGlyph: ImageVector by lazy {
  ImageVector.Builder(
    name = "NitroUiClose",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
  ).path(fill = SolidColor(ComposeColor.Black)) {
    moveTo(19f, 6.41f)
    lineToRelative(-1.41f, -1.41f)
    lineToRelative(-5.59f, 5.59f)
    lineToRelative(-5.59f, -5.59f)
    lineToRelative(-1.41f, 1.41f)
    lineToRelative(5.59f, 5.59f)
    lineToRelative(-5.59f, 5.59f)
    lineToRelative(1.41f, 1.41f)
    lineToRelative(5.59f, -5.59f)
    lineToRelative(5.59f, 5.59f)
    lineToRelative(1.41f, -1.41f)
    lineToRelative(-5.59f, -5.59f)
    close()
  }.build()
}

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
   * Whether the search bar is expanded. v1 refuses every request to expand
   * ([onExpandedRequest]), so this stays `false` for the life of the view - and it is
   * state rather than a literal because a results view is what would have to change it,
   * and because the harness reports what the composition drew, not what a constant said.
   */
  var expanded by mutableStateOf(false)
    internal set

  /**
   * The bar asking to expand. v1 has no results view to expand *into*, so the request is
   * dropped and the box never moves under a keyboard. Storing `next` in [expanded] is
   * the one change a results view would make - and the harness assertion "the box did
   * not change height while focused" is the thing that says so out loud.
   */
  fun onExpandedRequest(next: Boolean) {
    // Intentionally drops `next`: collapsed is the only shape v1 draws.
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
  // recomposition under the same scheme builds nothing (core.md §3).
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
          Icon(imageVector = CloseGlyph, contentDescription = null)
        }
      }
    } else {
      null
    }

  // material3 1.5 deprecates both of these in favour of `SearchBar(state, inputField)`,
  // which is not a drop-in for a field: that overload routes the field through
  // `SearchBarImpl`, and `SearchBarImpl` wraps it in `DisableSoftKeyboard`, so the soft
  // keyboard never opens; its stateful `InputField` also blurs the field when its state
  // collapses. Both stay on the 1.4 calls until the Expressive pass (D40) can take the
  // keyboard back as its own work.
  @Suppress("DEPRECATION")
  DockedSearchBar(
    inputField = {
      // Deprecated with the bar above: the `SearchBarState` overload is the one that
      // blurs the field when its state collapses.
      @Suppress("DEPRECATION")
      SearchBarDefaults.InputField(
        state = state,
        onSearch = onSearch,
        // Held collapsed: v1 has no results view to expand to, and a bar that grew on
        // focus would move the box under a keyboard. Wiring `onExpandedChange` to a
        // state and passing that state here is the shape a results view needs, and the
        // harness's "the box did not change height while focused" assertion is what
        // catches it being done by accident.
        expanded = this.expanded,
        onExpandedChange = this::onExpandedRequest,
        modifier = modifier,
        enabled = model.editable,
        // The app's word when it gave one, the platform's when it did not. Reading
        // `model.placeholder` here (a `mutableStateOf`) is what makes a `placeholder`
        // change recompose the slot, and `SearchFieldStrings.hint` is the framework's
        // own localized prompt, not a literal written here.
        placeholder = { Text(model.placeholder ?: SearchFieldStrings.hint) },
        leadingIcon = {
          Icon(imageVector = SearchGlyph, contentDescription = null)
        },
        trailingIcon = trailing,
        inputTransformation = limit,
        colors = inputColors ?: SearchBarDefaults.inputFieldColors(),
      )
    },
    expanded = this.expanded,
    onExpandedChange = this::onExpandedRequest,
    modifier = Modifier.fillMaxWidth(),
    colors = barColors ?: SearchBarDefaults.colors(),
  ) {}
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
      "", false, false, 0.0, 0.0, "none", true, -1.0, "", "", "search", false, false,
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
   * The four traits a search field fixes, as the model's own values - so the shared
   * keyboard mapping stays the one thing that decides what the field is configured
   * with, and no prop can move them (D38 item 2). `returnKeyType` is what the harness
   * reads back as "the Search key was applied".
   */
  private fun applySearchPresets() {
    model.returnKeyType = "search"
    model.keyboardType = "default"
    model.autoCapitalize = "none"
    model.autoCorrect = true
    model.multiline = false
    model.secureTextEntry = false
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

  /** Snapshot what the harness reads. UI thread; read from JS through `@Volatile`. */
  private fun publishState() {
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

  override fun nuiTestState(): NitroUiSearchFieldTestState = snapshot

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
