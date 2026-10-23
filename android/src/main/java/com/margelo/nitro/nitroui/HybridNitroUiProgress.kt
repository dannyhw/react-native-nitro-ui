package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/*
 * The Progress component: Material 3 `LinearProgressIndicator` and
 * `CircularProgressIndicator` on the core runtime.
 *
 * It is the library's first **non-interactive** control, so this is the file that
 * shows what a component without a handshake looks like
 * (`docs/architecture/core.md` §12): no `NitroUiControlledValue`, no
 * `mostRecentEventCount`, no callback prop, and an `afterUpdate()` that is only
 * `host.commit()`. That is what makes a `value` written at 60 Hz cheap - one
 * props commit per JS turn, and no round trip to wait for.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * `HybridNitroUiProgressManager` resolves `HybridNitroUiProgress` through a
 * wildcard import of exactly that package. Core helpers live in `...nitroui.core`.
 */

/** State of one Progress. See [NitroUiModel] for the shape this has to have. */
internal class ProgressModel : NitroUiModel() {
  /** `'linear'` or `'circular'`. Rendered (it picks the indicator), so Compose reads it. */
  var variant by mutableStateOf(VARIANT_LINEAR)

  /**
   * The fraction React sent, unclamped, or `null` for an indeterminate indicator.
   *
   * Observed: the indicator reads it (through [drawnValue]) on every recomposition
   * that matters. Clamping happens in [drawnValue], where the drawing code has to
   * stay in range, rather than here, where the prop getter has to answer what was
   * sent.
   */
  var value by mutableStateOf<Double?>(null)

  /** ARGB `processColor` int of the indicator, or `null` for the scheme's. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * ARGB `processColor` int of the track, or `null` for the scheme's.
   *
   * Observed here, unlike on iOS, where SwiftUI's `ProgressView` has nothing that
   * addresses its track and the value is only stored
   * (`docs/components/progress.md`).
   */
  var trackColor by mutableStateOf<Int?>(null)

  /**
   * `accessibilityLabel`, read by the composable so the label can go on the
   * indicator itself - see the a11y rule in `docs/architecture/core.md`.
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * Whether this host is attached to a window. Observed, because it decides which
   * indicator gets composed ([drawnValue]).
   *
   * An indeterminate M3 indicator animates itself from the composition, and a
   * composition outlives the view's detach (`NitroComposeHost` disposes it through
   * the activity's lifecycle, not the window - `AbstractComposeView` has no
   * `onDetachedFromWindow` to dispose it), so an indicator that simply stayed
   * indeterminate would keep asking for frames with nobody watching it. iOS draws
   * the same rule (`HybridNitroUiProgress.swift`).
   */
  var inWindow by mutableStateOf(false)

  /**
   * The size configuration React sent (`''` / `'circular'`). Stored for symmetry
   * with the other props; the sizing engine reads the key out of Fabric state
   * itself, so nothing native looks at this.
   */
  var sizingKey = ""

  /** Guards the two mirrors below: written on the UI thread, read on the JS thread. */
  private val mirrorLock = Any()

  /** What the drawing code was last handed, as one line. */
  private var drawnReport = "displayed=none"

  /** Whether this control is allowed to be animating. See [isAnimating]. */
  private var animating = false

  /**
   * The fraction to hand the drawing code, clamped into range, or `null` for the
   * indeterminate indicator.
   *
   * Out of range clamps (progress that arrives from a download callback overshoots,
   * and an indicator that vanished over it is worse than one that looked full for a
   * frame); `NaN` counts as out of range and lands on 0, because it is what an
   * unfinished division produces.
   *
   * The off-window rule: away from a window an indeterminate indicator is drawn as
   * an **empty determinate** one in the same style - same style, so the measured
   * size does not move, and empty because that is the one determinate state that
   * needs no motion. Re-attaching restores it.
   */
  val drawnValue: Double?
    get() {
      val sent = value
      if (sent != null) {
        return if (sent.isFinite()) sent.coerceIn(0.0, 1.0) else 0.0
      }
      return if (inWindow) null else 0.0
    }

  /**
   * Record what the drawing code was handed, from the composable.
   *
   * Called where the control is drawn rather than in a prop setter, which is what
   * makes [displayedReport] a reading of the hosted control instead of an echo of
   * the prop.
   */
  fun recordDrawn(drawn: Double?) {
    synchronized(mirrorLock) {
      drawnReport = drawn?.let { "displayed=$it" } ?: "displayed=indeterminate"
      animating = drawn == null && inWindow
    }
  }

  /** Say so from somewhere that is not the composable (a detach, a recycle). */
  fun refreshAnimationReport() {
    recordDrawn(drawnValue)
  }

  /** What the control displays, as one line. Thread-safe. */
  val displayedReport: String
    get() = synchronized(mirrorLock) { drawnReport }

  /** Whether the control is allowed to be animating. Thread-safe. */
  val isAnimating: Boolean
    get() = synchronized(mirrorLock) { animating }

  override fun reset() {
    variant = VARIANT_LINEAR
    value = null
    tintColor = null
    trackColor = null
    accessibilityLabel = null
    inWindow = false
    sizingKey = ""
    synchronized(mirrorLock) {
      drawnReport = "displayed=none"
      animating = false
    }
  }

  companion object {
    const val VARIANT_LINEAR = "linear"
    const val VARIANT_CIRCULAR = "circular"

    /** The value as an accessibility percentage: `0.0...1.0` to `"0%"..."100%"`. */
    fun percent(value: Double): String {
      return "${(value.coerceIn(0.0, 1.0) * 100).roundToInt()}%"
    }
  }
}

/**
 * The Progress's host: [NitroComposeHost] plus this component's composable and the
 * window flag the animation gate needs.
 *
 * [Component] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class ProgressHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ProgressModel,
) : NitroComposeHost<ProgressModel>(context, activity, model) {

  @Composable
  override fun Component(model: ProgressModel) {
    ProgressContent(model)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (model.inWindow) {
      return
    }
    model.inWindow = true
    // Not `host.commit()`: nothing about a window change is a props apply, and
    // `commit()` would mark `propsApplied` for a turn in which no props arrived
    // (`docs/architecture/core.md` §8). The snapshot write is already visible to
    // the composition; this is what makes it land now rather than at the next
    // global apply.
    Snapshot.sendApplyNotifications()
  }

  override fun onDetachedFromWindow() {
    // Before `super`, so the gate is closed even if detaching tears anything down.
    if (model.inWindow) {
      model.inWindow = false
      model.refreshAnimationReport()
      Snapshot.sendApplyNotifications()
    }
    super.onDetachedFromWindow()
  }
}

/**
 * The indicator itself.
 *
 * Reads [ProgressModel.drawnValue] here, in the smallest composable that needs it:
 * a `value` write at 60 Hz invalidates this group and nothing else, and Material 3
 * reads the lambda during its own composition, so the new fraction reaches the
 * canvas without a recomposition of anything above it.
 *
 * Colours are resolved to explicit values rather than being left to M3's defaults:
 * `ProgressIndicatorDefaults.linearColor` and friends are `@ReadOnlyComposable`
 * reads of the shared scheme (not allocations), so passing them costs the same as
 * letting M3 read them, and it keeps one code path for tinted and untinted.
 */
@Composable
private fun ProgressContent(model: ProgressModel) {
  val drawn = model.drawnValue
  // The reading of the hosted control that `nuiTestDisplayedValue()` answers with.
  model.recordDrawn(drawn)

  val tint = model.tintColor
  val track = model.trackColor
  val label = model.accessibilityLabel
  val circular = model.variant == ProgressModel.VARIANT_CIRCULAR

  // One accessibility node for the control: the label it was given, and the value
  // as a progress range (indeterminate says so with M3's own `Indeterminate`).
  // `clearAndSetSemantics` rather than an extra `semantics { }`, the Slider's
  // reasoning (`HybridNitroUiSlider.kt`): the subtree is cleared to exactly this
  // node, so a screen reader hears one rule from one place.
  val semantics =
    Modifier.clearAndSetSemantics {
      if (label != null) {
        contentDescription = label
      }
      progressBarRangeInfo =
        if (drawn == null) {
          ProgressBarRangeInfo.Indeterminate
        } else {
          ProgressBarRangeInfo(drawn.toFloat(), 0f..1f, 0)
        }
    }

  if (circular) {
    val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.circularColor
    if (drawn == null) {
      // Material 3 has separate track defaults for the two states, so each branch
      // falls back to its own - `circularTrackColor` is the deprecated alias of one
      // of them, and an app that sets `trackColor` overrides both.
      val trackTint =
        track?.let { ComposeColor(it) }
          ?: ProgressIndicatorDefaults.circularIndeterminateTrackColor
      CircularProgressIndicator(modifier = semantics, color = color, trackColor = trackTint)
    } else {
      val trackTint =
        track?.let { ComposeColor(it) }
          ?: ProgressIndicatorDefaults.circularDeterminateTrackColor
      CircularProgressIndicator(
        progress = { drawn.toFloat() },
        modifier = semantics,
        color = color,
        trackColor = trackTint,
      )
    }
  } else {
    val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.linearColor
    val trackTint =
      track?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.linearTrackColor
    if (drawn == null) {
      LinearProgressIndicator(modifier = semantics, color = color, trackColor = trackTint)
    } else {
      LinearProgressIndicator(
        progress = { drawn.toFloat() },
        modifier = semantics,
        color = color,
        trackColor = trackTint,
      )
    }
  }
}

/** The Hybrid View React renders as `NitroUiProgress`. */
class HybridNitroUiProgress(
  reactContext: ThemedReactContext,
) : HybridNitroUiProgressSpec(), RecyclableView {

  private val model = ProgressModel()
  private val host = ProgressHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // Both variants are self-sized: a linear bar measures its height, a circular
    // one its square.
    host.wantsContentSize = true
    // The default variant is linear, so the default policy is `fillWidth`; the
    // `variant` setter moves it along with the rest of the variant change.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which is
    // the point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiProgressComponentName`
     * in the generated C++, and `getName()` in the generated Kotlin manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiProgress"

    /**
     * The size to lay a Progress out with before anything has been measured, in dp:
     * the first Progress of an app's first launch.
     *
     * **The linear variant's numbers**, because the engine's declared-fallback map is
     * keyed by *component*, not by configuration (`docs/architecture/sizing.md` §2),
     * so one pair has to serve both shapes and the default variant is the one to
     * serve. A cold first *circular* mount is therefore laid out at the linear box for
     * one frame before its own measurement corrects it - D17's one-frame budget, and
     * the harness test that names it.
     *
     * For a `fillWidth` fallback the width barely matters (the box's width replaces
     * it) and the height is the number that has to be right (sizing.md §5). It is:
     * on the API 35 / 420 dpi emulator this task measured on, M3's
     * `LinearProgressIndicator` is 11 whole pixels - **4.19 dp** - and
     * `CircularProgressIndicator` is a **40 dp** square, the pair with iOS's in the
     * table in `docs/components/progress.md`. The declared 4 dp is 4.19 dp's
     * nearest whole dp, so a cold bar is one tenth of a dp off on its first frame
     * and the correction path has nothing to chase.
     */
    private const val FALLBACK_WIDTH_DP = 320.0
    private const val FALLBACK_HEIGHT_DP = 4.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process, before the first Progress can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a Fabric
     * measure can happen before this class has ever been instantiated, so a fallback
     * declared from `init` is one measure too late for the first instance (T14) - and
     * from `init` as the backstop. The two calls land on different threads, hence the
     * atomic.
     */
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

  override var variant: String
    get() = model.variant
    set(next) {
      // The wrapper is the only writer and sends one of two names; anything else
      // behaves as `'linear'`, which is what the spec documents.
      val normalized = if (next == ProgressModel.VARIANT_CIRCULAR) {
        ProgressModel.VARIANT_CIRCULAR
      } else {
        ProgressModel.VARIANT_LINEAR
      }
      if (normalized == model.variant) {
        return
      }
      model.variant = normalized
      // The one prop that changes the control's size, and the question the measure
      // pass asks (an `intrinsic` square vs a bar at the box's width), so the policy
      // moves with it. A *fresh* composition is what picks the question up:
      // `NitroUiMeasuredRoot` captures it when the composition is built, so
      // `Progress.tsx` keys the native view on the variant and a change remounts
      // (see the doc comment there). The setter still runs before that mount's first
      // measure, which is what makes the new policy the one its first frame uses.
      host.sizingPolicy =
        if (normalized == ProgressModel.VARIANT_CIRCULAR) {
          NitroUiSizing.POLICY_INTRINSIC
        } else {
          NitroUiSizing.POLICY_FILL_WIDTH
        }
      host.markDirty()
    }

  override var value: Variant_NullType_Double
    get() =
      model.value?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Stored exactly as sent - `NaN` included, so the getter round-trips - and
      // clamped where it is drawn ([ProgressModel.drawnValue]), like iOS.
      val sent = next.asSecondOrNull()
      if (sent == model.value) {
        return
      }
      model.value = sent
      host.markDirty()
      // Not size-affecting: a bar at 0.2 and a bar at 0.9 are the same box on both
      // toolkits.
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

  override var trackColor: Variant_NullType_Double
    get() =
      model.trackColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.trackColor) {
        return
      }
      model.trackColor = argb
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
      val label = next.asSecondOrNull()
      if (label == model.accessibilityLabel) {
        return
      }
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
      // Store only: the engine reads the key out of Fabric state.
      model.sizingKey = next
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // Nothing to reconcile (`docs/architecture/core.md` §12): React's `value` is the
    // whole story, so one commit per turn is the entire update path.
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // Back to the default policy, matching the reset variant - a host that kept
    // `intrinsic` would ask the next owner's linear bar the wrong question, and the
    // composition rebuilt for the next owner reads the policy as it is built.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    // Resets the model, including `inWindow`, and releases the sizing instance. The
    // composition does not survive a recycle: Nitro's generated manager calls
    // `onDropView()` (-> [onDropView], which disposes it) first.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    // No callbacks to release (there are none), but the window flag and the
    // animation mirror still belong to the mount that is ending.
    model.inWindow = false
    model.refreshAnimationReport()
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this indicator, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (§1.4).
   */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  /** What the control is displaying - see `NitroUiProgressMethods.nuiTestDisplayedValue`. */
  override fun nuiTestDisplayedValue(): String = model.displayedReport

  /**
   * Whether the control is allowed to be animating - see
   * `NitroUiProgressMethods.nuiTestIsAnimating`. On Android that is "indeterminate,
   * and the host is attached to a window", which is the rule
   * [ProgressModel.drawnValue] actually draws under.
   */
  override fun nuiTestIsAnimating(): Boolean = model.isAnimating
}
