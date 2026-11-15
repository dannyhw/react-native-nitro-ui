package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwitchColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// The Switch component: Material 3 `Switch`. Must stay in this package, which the
// generated view manager imports with a wildcard.

internal class SwitchModel : NitroUiModel() {
  var displayed by mutableStateOf(false)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the checked track, or `null` for the scheme's. */
  var checkedTrackColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  var sizingKey = ""

  /** Test-only control width in dp. Observed, so a change recomposes. */
  var testWidth by mutableStateOf<Double?>(null)

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultValue: Boolean? = null
  var didApplyDefault = false
  var onChange: ((Boolean, Double) -> Unit)? = null

  override fun reset() {
    displayed = false
    enabled = true
    checkedTrackColor = null
    sizingKey = ""
    accessibilityLabel = null
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultValue = null
    didApplyDefault = false
    onChange = null
    testWidth = null
  }
}

/**
 * Switch colours per (colour scheme, tint). Process-wide because every hosted control is
 * its own composition, and `SwitchDefaults.colors(checkedTrackColor = …)` builds a new
 * object per call. The caller fills a miss, because building colours is a composable call.
 */
private object SwitchColorsCache {
  // A cap, so an app that derives a colour per list row cannot grow this without bound.
  private const val MAX_TINTED_ENTRIES = 8

  private var scheme: ColorScheme? = null
  private var untinted: SwitchColors? = null
  private var tinted: HashMap<Int, SwitchColors>? = null

  // Synchronized because a second window can compose against another `Choreographer`.
  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): SwitchColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: SwitchColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, SwitchColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  // Call with the lock held.
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
private fun switchColors(tint: Int?): SwitchColors {
  val scheme = MaterialTheme.colorScheme
  SwitchColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val built =
    if (tint != null) {
      // The checked track is the closest analogue of iOS `.tint()`.
      SwitchDefaults.colors(checkedTrackColor = ComposeColor(tint))
    } else {
      SwitchDefaults.colors()
    }
  SwitchColorsCache.put(scheme, tint, built)
  return built
}

private class SwitchHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SwitchModel,
) : NitroComposeHost<SwitchModel>(context, activity, model) {
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: SwitchModel) {
    val tint = model.checkedTrackColor
    val label = model.accessibilityLabel
    // The label goes on the control, the node TalkBack focuses. On the host view it
    // would add a second, empty focus stop.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    // Test-only: a wider intrinsic size, so a test can watch a re-measure.
    val widthModifier =
      model.testWidth?.let { Modifier.width(it.dp) } ?: Modifier
    Switch(
      modifier = labelModifier.then(widthModifier),
      checked = model.displayed,
      onCheckedChange = { requested ->
        // Optimistic: show the new value before React has seen the event.
        val eventCount = model.state.user(requested)
        model.displayed = requested
        model.onChange?.invoke(requested, eventCount.toDouble())
      },
      enabled = model.enabled,
      colors = switchColors(tint),
    )
  }
}

class HybridNitroUiSwitch(
  reactContext: ThemedReactContext,
) : HybridNitroUiSwitchSpec(), RecyclableView {

  private val model = SwitchModel()
  private val host = SwitchHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // A backstop: the fallback is normally declared at startup, before any view exists.
    declareFallback()
  }

  companion object {
    // Must match the component name in the generated C++ and view manager.
    private const val SIZING_COMPONENT_NAME = "NitroUiSwitch"

    // The size before anything is measured, in dp: Material's 51 x 31 Switch inside a
    // 48 dp minimum interactive size measures 52 x 48.
    private const val FALLBACK_WIDTH_DP = 52.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    // Called at package init, because Fabric can measure before this class is first
    // instantiated, and again from `init`. The two calls can be on different threads.
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

  override var value: Variant_Boolean_NullType
    get() =
      model.state.js?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      // Not visual by itself: `displayed` follows in `afterUpdate()`, once JS has caught up.
      model.state.js = next.asFirstOrNull()
    }

  override var defaultValue: Variant_Boolean_NullType
    get() =
      model.defaultValue?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val default = next.asFirstOrNull()
      model.defaultValue = default
      if (model.state.js != null || model.didApplyDefault || default == null) {
        return
      }
      model.didApplyDefault = true
      if (default != model.state.displayed) {
        model.state.displayed = default
        model.displayed = default
        host.markDirty()
      }
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.checkedTrackColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` passes the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, turning an opaque colour into `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.checkedTrackColor) {
        return
      }
      model.checkedTrackColor = argb
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
      // Stored only: a Switch has one size configuration.
      model.sizingKey = next
    }

  override var nuiTestWidth: Variant_NullType_Double
    get() =
      model.testWidth?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      model.testWidth = next.asSecondOrNull()
      host.markDirty()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((Boolean, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The perf and sizing ids are cleared by the host, which needs them first.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size and never calls into Compose, so it is safe on the JS thread.
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }

  override fun nuiTestArmedGuards(): String = host.armedGuardsReport()

  override fun nuiTestLifetimeReport(): String = host.lifetimeReport()
}
