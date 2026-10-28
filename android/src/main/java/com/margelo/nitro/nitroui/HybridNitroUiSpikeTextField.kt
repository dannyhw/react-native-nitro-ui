package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
 * T18 spike — the Android side of the spike text field. Spike-only; see
 * `src/spike/TextField/TextField.nitro.ts` for why this is in the library tree at all, and delete these
 * files with the spike. The composable is in `NitroSpikeTextFieldCompose.kt`.
 *
 * Like every other component here, this file must stay in the package `com.margelo.nitro.nitroui`: the
 * generated `HybridNitroUiSpikeTextFieldManager` resolves the class through a wildcard import of exactly
 * that package.
 *
 * Threading is the shipped rule, not a spike exception (`docs/research/core-architecture.md` §5):
 * `nuiTestState()` answers from a lock-guarded `String` the UI thread writes, and `focus()` / `blur()` /
 * `nuiTestApplyWrite()` post to the view's handler and never wait.
 */

/** State of one spike field. See [NitroUiModel] for the shape this has to have. */
internal class SpikeTextFieldModel : NitroUiModel() {
  /**
   * Controlled text on the shipped handshake.
   *
   * The one deliberate thing: `unreported` is **never set**. It exists for values sampled faster than
   * frames (a drag); a field's edits are discrete, and setting it per keystroke would make a fast typist's
   * writes permanently stale (Q2 §2.4). P3 asserts it stays `0`.
   */
  val state = NitroUiControlledValue<String>("")
  var defaultValue: String? = null
  var didApplyDefault = false
  var placeholder: String? = null
  var disabled by mutableStateOf(false)
  var maxLength: Int? = null
  var multiline by mutableStateOf(false)
  var maxLines: Int? = null
  var keyboardHints: Double = 0.0
  var autoFocus = false
  var accessibilityLabel: String? = null
  var sizingKey = ""

  /** What the live `BasicTextField` last measured itself at, from `onTextLayout`. Observed. */
  var lines by mutableIntStateOf(0)

  /** Focus, cached here so the mirror can be rendered from anywhere on main. */
  var focused = false

  /** Outcome of the last programmatic write: `none` / `applied` / `stale` / `composing` / `same`. */
  var lastWrite = "none"

  /**
   * A React write that [reconcileForWrite] accepted, as a tick + payload.
   *
   * A tick rather than a bare value because writing `state.text` during composition is not allowed, and a
   * `LaunchedEffect` keyed on the *text* would not fire for a second write of the same string.
   */
  var writeTick by mutableIntStateOf(0)
  var writeText = ""

  /** `focus()` / `blur()` as ticks, for the same reason: they must run where a focus owner exists. */
  var focusTick by mutableIntStateOf(0)
  var blurTick by mutableIntStateOf(0)

  /** Posted when focus has to be *taken away*; the host's view is the only thing that can do it. */
  var requestClearFocus: (() -> Unit)? = null

  var onChange: ((String, Double) -> Unit)? = null
  var onFocus: (() -> Unit)? = null
  var onBlur: (() -> Unit)? = null
  var onSubmit: (() -> Unit)? = null

  /**
   * The text the last emit carried.
   *
   * Not an optimisation. `snapshotFlow` emits once when collection starts with the text the field was
   * *built* with, and counting that as a user edit would put `nativeEvents` ahead of `jsEvents` before
   * anyone has typed — which makes the first controlled write React sends look stale and get dropped. A
   * field that did that fails exactly one test and passes everything else, so the guard is the test.
   */
  var lastEmitted: String? = null

  private val mirrorLock = Any()
  private var mirrorSnapshot = ""

  /** Render [line] and store it. UI thread; read from any thread by [readMirror]. */
  fun publishMirror(line: String) {
    synchronized(mirrorLock) {
      mirrorSnapshot = line
    }
  }

  /** The last published line. Safe on the JS thread. */
  fun readMirror(): String = synchronized(mirrorLock) { mirrorSnapshot }

  /**
   * One mirror line, with the same keys as iOS's `NitroSpikeTextMirror`.
   *
   * Same keys on purpose: the harness reads both platforms with one parser, and a cross-shape comparison
   * (`swiftui` vs `textfield` vs `compose`) is a string comparison rather than two schemas that can drift.
   * `selection` is in UTF-16 code units — the one unit both platforms' text APIs agree on.
   */
  fun mirrorLine(
    text: String,
    composing: Boolean,
    selectionStart: Int,
    selectionLength: Int
  ): String {
    val js = state.js ?: ""
    return "displayed=$text nativeEvents=${state.nativeEvents} jsEvents=${state.jsEvents}" +
      " unreported=${if (state.unreported != null) 1 else 0}" +
      " composing=${if (composing) 1 else 0}" +
      " editable=${if (!disabled) 1 else 0}" +
      " focused=${if (focused) 1 else 0}" +
      " selection=$selectionStart-$selectionLength" +
      " impl=compose lines=$lines" +
      // Kotlin's `==`, i.e. a UTF-16 sequence comparison — the same rule JS's `===` uses, and *not* the rule
      // Swift's `==` uses. This key is the vector: iOS and Android can answer it differently for the same
      // user action, and P3 is where that gets measured rather than argued about.
      " equal=${if (text == js) 1 else 0} cps=${spikeCodePoints(js)} lastWrite=$lastWrite"
  }

  /** The user changed the text: native owns it, counts it, emits it. See [lastEmitted]. */
  fun userEdited(text: String) {
    if (lastEmitted == text) {
      return
    }
    lastEmitted = text
    val count = state.user(text)
    onChange?.invoke(text, count.toDouble())
  }

  /** Focus moved, on both edges. P5 measures focus latency from these, so a missing edge reads as "fast". */
  fun focusMoved(isFocused: Boolean) {
    if (focused == isFocused) {
      return
    }
    focused = isFocused
    if (isFocused) onFocus?.invoke() else onBlur?.invoke()
  }

  fun emitSubmit() {
    onSubmit?.invoke()
  }

  fun clearFocus() {
    requestClearFocus?.invoke()
  }

  override fun reset() {
    state.displayed = ""
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    state.unreported = null
    defaultValue = null
    didApplyDefault = false
    placeholder = null
    disabled = false
    maxLength = null
    multiline = false
    maxLines = null
    keyboardHints = 0.0
    autoFocus = false
    accessibilityLabel = null
    sizingKey = ""
    lines = 0
    focused = false
    lastWrite = "none"
    writeTick = 0
    writeText = ""
    focusTick = 0
    blurTick = 0
    lastEmitted = null
    onChange = null
    onFocus = null
    onBlur = null
    onSubmit = null
    requestClearFocus = null
    publishMirror("")
  }
}

/** The spike's host: [NitroComposeHost] plus the field's composable. */
private class SpikeTextFieldHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SpikeTextFieldModel,
) : NitroComposeHost<SpikeTextFieldModel>(context, activity, model) {

  /** A field composes inside a `<Host>` like every other control (H2a). */
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: SpikeTextFieldModel) {
    NitroSpikeAndroidField(model) { line -> model.publishMirror(line) }
  }
}

/** The Hybrid View React renders as `NitroUiSpikeTextField`. */
class HybridNitroUiSpikeTextField(
  reactContext: ThemedReactContext,
) : HybridNitroUiSpikeTextFieldSpec(), RecyclableView {

  private val model = SpikeTextFieldModel()
  private val host = SpikeTextFieldHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    // P4 is a sizing spike: a field's height is its own and its width is Yoga's box.
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    model.requestClearFocus = { host.clearFocus() }
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine. */
    private const val SIZING_COMPONENT_NAME = "NitroUiSpikeTextField"

    /**
     * A fallback deliberately unlike anything the field measures (X4's rule: a fallback equal to the answer
     * makes a failed correction invisible). 44 dp is not a height a one-line field reports on Android.
     */
    private const val FALLBACK_WIDTH_DP = 40.0
    private const val FALLBACK_HEIGHT_DP = 44.0

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

  /**
   * Inert on Android, which is the assertion: there is one shape here, so both values have to answer the
   * same way, and `nuiTestState()` reports `impl=compose` for both.
   */
  override var iosImplementation: String
    get() = ""
    set(_) {}

  override var value: Variant_NullType_String
    get() = model.state.js?.let { Variant_NullType_String.Second(it) }
      ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValue: Variant_NullType_String
    get() = model.defaultValue?.let { Variant_NullType_String.Second(it) }
      ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      model.defaultValue = next.asSecondOrNull()
      val sent = model.defaultValue
      if (model.state.js == null && !model.didApplyDefault && sent != null) {
        model.didApplyDefault = true
        if (sent != model.state.displayed) {
          model.state.displayed = sent
          model.lastEmitted = sent
          host.markDirty()
        }
      }
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var placeholder: Variant_NullType_String
    get() = model.placeholder?.let { Variant_NullType_String.Second(it) }
      ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val sent = next.asSecondOrNull()
      if (sent == model.placeholder) {
        return
      }
      model.placeholder = sent
      host.markDirty()
    }

  override var disabled: Boolean
    get() = model.disabled
    set(next) {
      if (next == model.disabled) {
        return
      }
      model.disabled = next
      host.markDirty()
    }

  override var maxLength: Variant_NullType_Double
    get() = model.maxLength?.let { Variant_NullType_Double.Second(it.toDouble()) }
      ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val sent = next.asSecondOrNull()?.toInt()
      if (sent == model.maxLength) {
        return
      }
      model.maxLength = sent
      host.markDirty()
    }

  override var multiline: Boolean
    get() = model.multiline
    set(next) {
      if (next == model.multiline) {
        return
      }
      model.multiline = next
      host.markDirty()
      host.noteSizingKeyChanged()
    }

  override var maxLines: Variant_NullType_Double
    get() = model.maxLines?.let { Variant_NullType_Double.Second(it.toDouble()) }
      ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val sent = next.asSecondOrNull()?.toInt()
      if (sent == model.maxLines) {
        return
      }
      model.maxLines = sent
      host.markDirty()
      host.noteSizingKeyChanged()
    }

  override var keyboardHints: Double
    get() = model.keyboardHints
    set(next) {
      if (next == model.keyboardHints) {
        return
      }
      model.keyboardHints = next
      host.markDirty()
      host.noteSizingKeyChanged()
    }

  override var autoFocus: Boolean
    get() = model.autoFocus
    set(next) {
      model.autoFocus = next
      if (next && !model.disabled) {
        // Not deferred: Q2 §5 measured 580 ms of keyboard churn behind Nitro-input's deferred autofocus,
        // so the spike's `autoFocus` asks for focus as early as the platform allows. The composition may not
        // have a focus owner yet, which is what the tick is for.
        model.focusTick += 1
      }
    }

  override var accessibilityLabel: Variant_NullType_String
    get() = model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
      ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val sent = next.asSecondOrNull()
      if (sent == model.accessibilityLabel) {
        return
      }
      model.accessibilityLabel = sent
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() = (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
      ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var nuiPerfId: Variant_NullType_Double
    get() = if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
      Variant_NullType_Double.First(NullType.NULL)
    } else {
      Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
    }
    set(next) {
      val raw = next.asSecondOrNull()
      host.perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var onValueChange: ((value: String, eventCount: Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  override var onFocus: (() -> Unit)?
    get() = model.onFocus
    set(next) {
      model.onFocus = next
    }

  override var onBlur: (() -> Unit)?
    get() = model.onBlur
    set(next) {
      model.onBlur = next
    }

  override var onSubmitEditing: (() -> Unit)?
    get() = model.onSubmit
    set(next) {
      model.onSubmit = next
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      if (next != model.sizingKey) {
        model.sizingKey = next
        host.noteSizingKeyChanged()
      }
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The handshake decides whether React's `value` wins over what the user just typed (§4). The decision
    // is made here and the *edit* happens in the composable, because `TextFieldState` may only be edited
    // outside the composition — which is one real difference from iOS, where `textField.text = …` runs
    // straight here on main.
    val pending = model.state.js ?: return run { host.commit() }
    if (model.state.unreported != null ||
      model.state.jsEvents < model.state.nativeEvents ||
      pending == model.state.displayed
    ) {
      if (model.state.jsEvents < model.state.nativeEvents && pending != model.state.displayed) {
        model.lastWrite = "stale"
      }
      host.commit()
      return
    }
    model.state.displayed = pending
    model.writeText = pending
    model.writeTick += 1
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    model.onFocus = null
    model.onBlur = null
    model.onSubmit = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Never touches the UI thread (§1.4). */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  override fun focus(): Unit {
    host.post { model.focusTick += 1 }
  }

  override fun blur(): Unit {
    host.post { model.blurTick += 1 }
  }

  /** Answered on the JS thread from the mirror the UI thread wrote. Never touches Compose. */
  override fun nuiTestState(): String = model.readMirror()

  /**
   * A programmatic write, applied through the handshake on the UI thread.
   *
   * The outcome is recorded rather than returned, because returning it would mean waiting for main from JS
   * (core-architecture §5). The three ways it can not-apply — stale, composing, already-that-text — are the
   * measurement.
   */
  override fun nuiTestApplyWrite(text: String): Unit {
    host.post {
      val js = model.state.js
      when {
        js != null && js != text -> model.lastWrite = "ignored"
        model.state.jsEvents < model.state.nativeEvents -> model.lastWrite = "stale"
        else -> {
          model.state.displayed = text
          model.writeText = text
          model.writeTick += 1
        }
      }
      host.commit()
    }
  }
}
