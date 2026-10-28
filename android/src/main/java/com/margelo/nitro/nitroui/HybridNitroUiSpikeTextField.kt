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

  /**
   * Focus, cached here so the mirror can be rendered from anywhere on main.
   *
   * Snapshot state rather than a plain field for one reason: the mirror is republished when `snapshotFlow`
   * below observes a change, and a tap that only moves focus changes nothing else. As a plain `var` the tap
   * called `onFocus` and left the cached line saying `focused=0`, so the first thing the typing oracle
   * asserts — that the tap focused the field — never went green.
   */
  var focused by mutableStateOf(false)

  /** Outcome of the last programmatic write: `none` / `applied` / `stale` / `composing` / `same`. */
  var lastWrite = "none"

  /**
   * [writeSeq] of the attempt [lastWrite] describes.
   *
   * The outcome is written from two places — the posted write itself (the outcomes that change no text:
   * `ignored`, `stale`) and the composable that carries out an accepted one (`applied`, `same`, `composing`) —
   * and those two do not run in a fixed order. Measured: two writes posted back to back (`start`, then
   * `other`), and the effect for the *first* one ran after the second had already recorded `ignored`, putting
   * `lastWrite=same` back in the mirror. A caller reading the outcome was being told about the older write.
   * So every attempt is numbered and only a newer number may replace the answer.
   */
  private var lastWriteSeq = 0

  /**
   * Counts every write attempt, accepted or not, so [recordWriteOutcome] can tell which one is newest.
   *
   * [writeTick] cannot do this job: it only counts *accepted* writes, and the outcomes that matter most —
   * `ignored`, `stale` — are precisely the ones that change nothing and so do not bump it.
   */
  private var writeSeq = 0

  /**
   * The attempt whose outcome the composable is about to report.
   *
   * Only an *accepted* write moves it: the composable reports for the newest accepted attempt, and a refusal
   * (`ignored` / `stale`) never had a composable visit to report, so it must not claim one.
   */
  var writeSeqForTick = 0
    private set

  /** Record the outcome of attempt [seq]; a superseded attempt's answer is dropped. */
  fun recordWriteOutcome(seq: Int, outcome: String) {
    if (seq >= lastWriteSeq) {
      lastWriteSeq = seq
      lastWrite = outcome
    }
  }

  /** Accept [text] as a new edit attempt, numbered for [recordWriteOutcome]. */
  fun acceptWrite(text: String) {
    writeSeqForTick = ++writeSeq
    state.displayed = text
    writeText = text
    writeTick += 1
  }

  /** Refuse a write that never becomes an edit, and say why. */
  fun refuseWrite(outcome: String) {
    recordWriteOutcome(++writeSeq, outcome)
  }

  /**
   * A React write that [reconcileForWrite] accepted, as a tick + payload.
   *
   * A tick rather than a bare value because writing `state.text` during composition is not allowed, and a
   * `LaunchedEffect` keyed on the *text* would not fire for a second write of the same string.
   */
  var writeTick by mutableIntStateOf(0)
  var writeText = ""

  /**
   * The highest [writeTick] the composable has already carried out.
   *
   * What makes a write idempotent across a recomposition. `LaunchedEffect(model.writeTick)` is keyed on the
   * tick, so it does not re-run while the composable lives — but when the hosted subtree is *recreated*, the
   * effect is brand new and runs again for the tick that is sitting there, replaying a write that already
   * happened. Measured: the P3 scenario's `placeholder` change recomposed the subtree, the old `other` write
   * re-ran, and it overwrote `lastWrite` from `ignored` back to `same` — so a caller reading the outcome after
   * an unrelated re-render was told a different answer about a write that had not been re-attempted. A
   * shipped field has the same hazard in the shape of a stale render writing old text back into the field,
   * which is Q2 §2.1's failure mode; the guard belongs in the model, not in the composable's `remember`.
   */
  var writeConsumed by mutableIntStateOf(0)

  /** `focus()` / `blur()` as ticks, for the same reason: they must run where a focus owner exists. */
  var focusTick by mutableIntStateOf(0)
  var blurTick by mutableIntStateOf(0)

  /** Posted when focus has to be *taken away*; the host's view is the only thing that can do it. */
  var requestClearFocus: (() -> Unit)? = null

  /**
   * Republishes the mirror line from the live `TextFieldState`. Installed by the composable, which is the
   * only place that may read it, and called by [userEdited] / [focusMoved] / an applied write *before* the
   * corresponding callback fires.
   *
   * The order is the whole point, and it was a device run that found it: `onFocus` reaches JS synchronously
   * and the spike screen's echo calls `nuiTestState()` right there, so a mirror published afterwards renders
   * a line that says `focused=0` under `focus=1` — and the typing oracle's first assertion ("the tap focused
   * the field") reads exactly that line. Publishing first costs nothing (the line is a `String` under a lock)
   * and makes every cached read agree with the event that triggered it.
   */
  var renderMirror: (() -> Unit)? = null

  /**
   * Republishes [renderMirror]'s line only if one is installed.
   *
   * The guard is not decoration: a recycled host keeps its model, and between the composable disposing and
   * the next one installing, `renderMirror` is null. Calling through it unguarded is a crash, and calling
   * nothing silently leaves the cached line describing a state that no longer exists — which is how "the
   * write was ignored" gets reported as "the write was applied".
   */
  fun publishRenderedMirror() {
    renderMirror?.invoke()
  }

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
    // The JS side of the comparison. Controlled: the `value` React is holding. Uncontrolled: the text the
    // last emit handed JS, because that *is* what JS believes the field says — comparing against `null`
    // instead made every uncontrolled field answer `equal=0 cps=0`, which reads like a broken handshake and
    // is nothing of the sort. `lastEmitted` also makes the key an invariant on this platform: an uncontrolled
    // field that answers `equal=0` emitted a string it is not displaying.
    val js = state.js ?: lastEmitted ?: ""
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
      " equal=${if (text == js) 1 else 0} cps=${spikeCodePoints(js)} lastWrite=$lastWrite" +
      // iOS added these two keys to make its two-shape A/B readable (an instance asked for the
      // `UITextField` branch published arm A's numbers until the representable got built). Android has one
      // shape, so both are constants here — but the schema stays one schema, which is the whole reason the
      // harness can parse all three shapes with one function and why P1 asserts the key sets are equal.
      " frozen=compose live=1"
  }

  /** The user changed the text: native owns it, counts it, emits it. See [lastEmitted]. */
  fun userEdited(text: String) {
    if (lastEmitted == text) {
      return
    }
    lastEmitted = text
    val count = state.user(text)
    renderMirror?.invoke()
    onChange?.invoke(text, count.toDouble())
  }

  /** Focus moved, on both edges. P5 measures focus latency from these, so a missing edge reads as "fast". */
  fun focusMoved(isFocused: Boolean) {
    if (focused == isFocused) {
      return
    }
    focused = isFocused
    renderMirror?.invoke()
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
    writeConsumed = 0
    writeText = ""
    focusTick = 0
    blurTick = 0
    lastEmitted = null
    onChange = null
    onFocus = null
    onBlur = null
    onSubmit = null
    requestClearFocus = null
    renderMirror = null
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
        model.refuseWrite("stale")
      }
      host.commit()
      return
    }
    model.acceptWrite(pending)
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
        js != null && js != text -> model.refuseWrite("ignored")
        model.state.jsEvents < model.state.nativeEvents -> model.refuseWrite("stale")
        else -> model.acceptWrite(text)
      }
      // Published from here as well as from the composable's `writeTick` effect, because the two outcomes
      // that change *nothing* — `ignored` and `stale` — never bump the tick and so would never be republished
      // otherwise. A caller reading `nuiTestState()` after a rejected write would see the previous outcome,
      // which is the exact way to report a guard that worked as a guard that did not.
      model.publishRenderedMirror()
      host.commit()
    }
  }
}
