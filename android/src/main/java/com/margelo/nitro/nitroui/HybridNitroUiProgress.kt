package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.ContainedLoadingIndicator
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LoadingIndicatorDefaults
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.WavyProgressIndicatorDefaults
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

// Material 3's linear, circular, wavy and loading progress indicators. Must stay in this
// package: the generated manager finds the implementation through a wildcard import of it.

internal class ProgressModel : NitroUiModel() {
  /** `'linear'`, `'circular'` or `'loading'`. */
  var variant by mutableStateOf(VARIANT_LINEAR)

  /** `'flat'` or `'wavy'`. The loading shape has no wavy form, so drawing code asks [drawsWavy]. */
  var appearance by mutableStateOf(APPEARANCE_FLAT)

  /** Whether a `'loading'` indicator is drawn inside Material's tonal container. */
  var contained by mutableStateOf(false)

  /** The fraction React sent, unclamped, or `null` for indeterminate. Clamped in [drawnValue]. */
  var value by mutableStateOf<Double?>(null)

  /** ARGB `processColor` int of the indicator, or `null` for the scheme's. */
  var tintColor by mutableStateOf<Int?>(null)

  /** ARGB int of the track, or `null` for the scheme's. */
  var trackColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * Whether the host is attached to a window. An indeterminate indicator animates from the
   * composition, which outlives a detach, so off-window it must not be drawn indeterminate.
   */
  var inWindow by mutableStateOf(false)

  /** Stored for the getter only: the sizing engine reads the key from Fabric state. */
  var sizingKey = ""

  /** Guards the two mirrors below: written on the UI thread, read on the JS thread. */
  private val mirrorLock = Any()

  private var drawnReport = "displayed=none"

  private var animating = false

  /**
   * The fraction to draw, clamped to 0..1 (`NaN` reads as 0), or `null` for indeterminate.
   * Off-window an indeterminate indicator is drawn as an empty determinate one: the same
   * size, and no animation.
   */
  val drawnValue: Double?
    get() {
      val sent = value
      if (sent != null) {
        return if (sent.isFinite()) sent.coerceIn(0.0, 1.0) else 0.0
      }
      return if (inWindow) null else 0.0
    }

  /** Called from the composable, so the report is what was drawn, not what was sent. */
  fun recordDrawn(drawn: Double?) {
    synchronized(mirrorLock) {
      drawnReport = drawn?.let { "displayed=$it" } ?: "displayed=indeterminate"
      animating = inWindow && (drawn == null || drawsWavy)
    }
  }

  /** Refreshes the report from outside the composable (a detach, a recycle). */
  fun refreshAnimationReport() {
    recordDrawn(drawnValue)
  }

  /** Thread-safe. */
  val displayedReport: String
    get() = synchronized(mirrorLock) { drawnReport }

  /**
   * Thread-safe. Material's determinate wavy indicators animate too, so a wavy configuration
   * counts while it is in the window, with or without a value.
   */
  val isAnimating: Boolean
    get() = synchronized(mirrorLock) { animating }

  /** Whether the shape is a self-sized square: a ring or a loading indicator. */
  val isIntrinsicShape: Boolean
    get() = variant == VARIANT_CIRCULAR || variant == VARIANT_LOADING

  /** The `'loading'` shape has no wavy form in Material 3. */
  val drawsWavy: Boolean
    get() = appearance == APPEARANCE_WAVY && variant != VARIANT_LOADING

  val drawsContainer: Boolean
    get() = contained && variant == VARIANT_LOADING

  /**
   * `null` leaves Material's own wave speed. Material's determinate wave keeps animating
   * while its speed is above zero, so off-window the speed is forced to zero.
   */
  val waveSpeed: Dp?
    get() = if (inWindow) null else 0.dp

  override fun reset() {
    variant = VARIANT_LINEAR
    appearance = APPEARANCE_FLAT
    contained = false
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
    const val VARIANT_LOADING = "loading"

    const val APPEARANCE_FLAT = "flat"
    const val APPEARANCE_WAVY = "wavy"

    /** The value as an accessibility percentage: `0.0...1.0` to `"0%"..."100%"`. */
    fun percent(value: Double): String {
      return "${(value.coerceIn(0.0, 1.0) * 100).roundToInt()}%"
    }
  }
}

private class ProgressHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ProgressModel,
) : NitroComposeHost<ProgressModel>(context, activity, model) {

  /** A `<Host>` may compose this control; it still attaches this view, which sets `inWindow`. */
  override val isHostable: Boolean
    get() = true

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
    // Not `commit()`: a window change is not a props apply. This makes the snapshot write
    // reach the composition now rather than at the next global apply.
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
 * Reads [ProgressModel.drawnValue] in the smallest composable that needs it, so a `value`
 * written every frame invalidates this group and nothing above it.
 */
@Composable
private fun ProgressContent(model: ProgressModel) {
  val drawn = model.drawnValue
  model.recordDrawn(drawn)

  val tint = model.tintColor
  val track = model.trackColor
  val label = model.accessibilityLabel
  val loading = model.variant == ProgressModel.VARIANT_LOADING
  val circular = model.variant == ProgressModel.VARIANT_CIRCULAR
  val wavy = model.drawsWavy
  val contained = model.drawsContainer

  // One accessibility node for the control. `clearAndSetSemantics` also removes the
  // semantics the wavy and loading indicators install themselves.
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

  // Material's bar defaults to `size(240.dp, 4.dp)`; `fillMaxWidth` makes it take the
  // box's width instead, and is a no-op under an unbounded constraint.
  val barModifier = semantics.fillMaxWidth()

  when {
    loading -> LoadingShape(model = model, drawn = drawn, tint = tint, track = track, semantics = semantics)

    circular && wavy -> {
      val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.circularColor
      // Wavy indicators use one visible track default for both states.
      val trackTint =
        track?.let { ComposeColor(it) } ?: WavyProgressIndicatorDefaults.trackColor
      // `null` keeps Material's own speed; a value arrives only off-window, where it is zero.
      val speed = model.waveSpeed
      if (drawn == null) {
        CircularWavyProgressIndicator(modifier = semantics, color = color, trackColor = trackTint)
      } else if (speed == null) {
        CircularWavyProgressIndicator(
          progress = { drawn.toFloat() },
          modifier = semantics,
          color = color,
          trackColor = trackTint,
        )
      } else {
        CircularWavyProgressIndicator(
          progress = { drawn.toFloat() },
          modifier = semantics,
          color = color,
          trackColor = trackTint,
          waveSpeed = speed,
        )
      }
    }

    circular -> {
      val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.circularColor
      if (drawn == null) {
        // Material 3 has separate track defaults for the indeterminate and determinate states.
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
    }

    wavy -> {
      // Material's own amplitude, wavelength and speed, except the off-window zero speed.
      val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.linearColor
      val trackTint =
        track?.let { ComposeColor(it) } ?: WavyProgressIndicatorDefaults.trackColor
      val speed = model.waveSpeed
      if (drawn == null) {
        LinearWavyProgressIndicator(modifier = barModifier, color = color, trackColor = trackTint)
      } else if (speed == null) {
        LinearWavyProgressIndicator(
          progress = { drawn.toFloat() },
          modifier = barModifier,
          color = color,
          trackColor = trackTint,
        )
      } else {
        LinearWavyProgressIndicator(
          progress = { drawn.toFloat() },
          modifier = barModifier,
          color = color,
          trackColor = trackTint,
          waveSpeed = speed,
        )
      }
    }

    else -> {
    val color = tint?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.linearColor
    val trackTint =
      track?.let { ComposeColor(it) } ?: ProgressIndicatorDefaults.linearTrackColor
    if (drawn == null) {
        LinearProgressIndicator(modifier = barModifier, color = color, trackColor = trackTint)
    } else {
      LinearProgressIndicator(
        progress = { drawn.toFloat() },
          modifier = barModifier,
        color = color,
        trackColor = trackTint,
      )
    }
    }
  }
}

/**
 * The `variant="loading"` shape. The only experimental Material 3 API in this file, so the
 * opt-in is on this function rather than on the file.
 */
@Composable
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun LoadingShape(
  model: ProgressModel,
  drawn: Double?,
  tint: Int?,
  track: Int?,
  semantics: Modifier,
) {
  if (model.drawsContainer) {
    val indicator =
      tint?.let { ComposeColor(it) } ?: LoadingIndicatorDefaults.containedIndicatorColor
    // On this shape `trackColor` paints the container behind the indicator.
    val container =
      track?.let { ComposeColor(it) } ?: LoadingIndicatorDefaults.containedContainerColor
    if (drawn == null) {
      ContainedLoadingIndicator(
        modifier = semantics,
        containerColor = container,
        indicatorColor = indicator,
      )
    } else {
      ContainedLoadingIndicator(
        progress = { drawn.toFloat() },
        modifier = semantics,
        containerColor = container,
        indicatorColor = indicator,
      )
    }
  } else {
    val color = tint?.let { ComposeColor(it) } ?: LoadingIndicatorDefaults.indicatorColor
    if (drawn == null) {
      LoadingIndicator(modifier = semantics, color = color)
    } else {
      LoadingIndicator(progress = { drawn.toFloat() }, modifier = semantics, color = color)
    }
  }
}

class HybridNitroUiProgress(
  reactContext: ThemedReactContext,
) : HybridNitroUiProgressSpec(), RecyclableView {

  private val model = ProgressModel()
  private val host = ProgressHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // The default variant is linear; the `variant` setter changes the policy with it.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    // A backstop: fallbacks are normally declared at package init.
    declareFallback()
  }

  companion object {
    /** Must match the name in the generated C++ and in the generated manager's `getName()`. */
    private const val SIZING_COMPONENT_NAME = "NitroUiProgress"

    /**
     * The size used before anything has been measured, in dp. Fallbacks are keyed by component,
     * so this is the linear bar's and the other shapes are corrected after their first measure.
     * Under a parent with no finite width the declared width is what a bar draws at.
     */
    private const val FALLBACK_WIDTH_DP = 320.0
    private const val FALLBACK_HEIGHT_DP = 4.0

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
        NitroUiSizing.POLICY_FILL_WIDTH,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var variant: String
    get() = model.variant
    set(next) {
      // Anything but the three names behaves as `'linear'`.
      val normalized =
        when (next) {
          ProgressModel.VARIANT_CIRCULAR -> ProgressModel.VARIANT_CIRCULAR
          ProgressModel.VARIANT_LOADING -> ProgressModel.VARIANT_LOADING
          else -> ProgressModel.VARIANT_LINEAR
        }
      if (normalized == model.variant) {
        return
      }
      model.variant = normalized
      // The sizing policy follows the shape: a square is intrinsic, a bar fills the width.
      // A composition captures the policy when it is built, so JS remounts the view on a
      // variant change, and this setter runs before that mount's first measure.
      host.sizingPolicy =
        if (model.isIntrinsicShape) {
          NitroUiSizing.POLICY_INTRINSIC
        } else {
          NitroUiSizing.POLICY_FILL_WIDTH
        }
      host.markDirty()
    }

  override var appearance: String
    get() = model.appearance
    set(next) {
      // Anything but `'wavy'` behaves as `'flat'`.
      val normalized = if (next == ProgressModel.APPEARANCE_WAVY) {
        ProgressModel.APPEARANCE_WAVY
      } else {
        ProgressModel.APPEARANCE_FLAT
      }
      if (normalized == model.appearance) {
        return
      }
      model.appearance = normalized
      // Changes the size but not the sizing policy; the `nuiSizingKey` write in the same
      // props batch asks for the measure.
      host.markDirty()
    }

  override var contained: Boolean
    get() = model.contained
    set(next) {
      if (next == model.contained) {
        return
      }
      model.contained = next
      // Same size either way, but a different sizing key; `nuiSizingKey` asks for the measure.
      host.markDirty()
    }

  override var value: Variant_NullType_Double
    get() =
      model.value?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Stored as sent, `NaN` included, so the getter round-trips; clamped where it is drawn.
      val sent = next.asSecondOrNull()
      if (sent == model.value) {
        return
      }
      model.value = sent
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
    // The view tag is what testID matchers read.
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
      // `appearance` and `contained` change the configuration without a remount, and the
      // engine has no size for a key it has not seen, so ask for a measure and a report.
      if (next == model.sizingKey) {
        return
      }
      model.sizingKey = next
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // No controlled value to reconcile: one commit per turn is the whole update path.
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // Back to the default policy to match the reset variant: the next owner's composition
    // reads the policy as it is built.
    host.sizingPolicy = NitroUiSizing.POLICY_FILL_WIDTH
    // Resets the model, `inWindow` included, and releases the sizing instance.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.inWindow = false
    model.refreshAnimationReport()
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  override fun nuiTestDisplayedValue(): String = model.displayedReport

  override fun nuiTestIsAnimating(): Boolean = model.isAnimating
}
