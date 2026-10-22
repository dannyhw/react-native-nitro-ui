package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color as ComposeColor
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.views.RecyclableView

/*
 * The Switch component: Material 3 `Switch` on the core runtime. It is the
 * reference for every later component, so it stays short.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * `HybridNitroUiSwitchManager` resolves `HybridNitroUiSwitch` through a wildcard
 * import of exactly that package. Core helpers live in `...nitroui.core`.
 */

/** State of one Switch. See [NitroUiModel] for the shape this has to have. */
internal class SwitchModel : NitroUiModel() {
  /** What the Switch shows. Snapshot-observed, so writing it recomposes. */
  var displayed by mutableStateOf(false)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int of the checked track, or `null` for the scheme's. */
  var checkedTrackColor by mutableStateOf<Int?>(null)

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultValue: Boolean? = null
  var didApplyDefault = false
  /**
   * `onValueChange`, as Nitro delivered it. The generated spec types the prop as
   * a plain Kotlin function, which `Func_void_bool_double` implements.
   */
  var onChange: ((Boolean, Double) -> Unit)? = null

  override fun reset() {
    displayed = false
    enabled = true
    checkedTrackColor = null
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultValue = null
    didApplyDefault = false
    onChange = null
  }
}

/**
 * The Switch's host: [NitroComposeHost] plus this component's composable.
 *
 * [Content] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class SwitchHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: SwitchModel,
) : NitroComposeHost<SwitchModel>(context, activity, model) {
  @Composable
  override fun Component(model: SwitchModel) {
    val tint = model.checkedTrackColor
    Switch(
      checked = model.displayed,
      onCheckedChange = { requested ->
        // Native is optimistic: show the new value now, before React has seen the
        // event, so there is no visual latency (§4).
        val eventCount = model.state.user(requested)
        model.displayed = requested
        model.onChange?.invoke(requested, eventCount.toDouble())
      },
      enabled = model.enabled,
      colors =
        if (tint != null) {
          // The checked track is the closest analogue of iOS `.tint()`.
          SwitchDefaults.colors(checkedTrackColor = ComposeColor(tint))
        } else {
          SwitchDefaults.colors()
        },
    )
  }
}

/** The Hybrid View React renders as `NitroUiSwitch`. */
class HybridNitroUiSwitch(
  reactContext: ThemedReactContext,
) : HybridNitroUiSwitchSpec(), RecyclableView {

  private val model = SwitchModel()
  private val host = SwitchHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // T11 and `measureContent()` want the fitting size.
    host.wantsContentSize = true
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var value: Variant_Boolean_NullType
    get() =
      model.state.js?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`.
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
      val argb = if (raw != null && raw.isFinite()) raw.toInt() else null
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
      host.contentDescription?.toString()?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      host.contentDescription = next.asSecondOrNull()
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

  override var onValueChange: ((Boolean, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The event-count handshake decides whether React's `value` wins over what
    // the user just did - including a change JS rejected (§4).
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.contentDescription = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // Resets the model; the composition and its owners survive on purpose.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this Switch, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (§1.4).
   */
  override fun measureContent(): NitroUiSize {
    val size = host.contentSize ?: return NitroUiSize(0.0, 0.0)
    return NitroUiSize(size.width, size.height)
  }
}
