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

  /**
   * `accessibilityLabel`, read by the composable so it can put the label on the
   * Switch itself. Not the container's `contentDescription` - see the a11y rule
   * in `docs/architecture/core.md`.
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The size configuration React sent (empty for a Switch today). Stored for
   * symmetry with the other props; the sizing engine reads the key out of Fabric
   * state itself, so nothing native looks at this.
   */
  var sizingKey = ""

  /**
   * Test-only control width, in dp: see `nuiTestWidth`. Observed, because a
   * change to it has to recompose the control for its size to move.
   */
  var testWidth by mutableStateOf<Double?>(null)

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
    sizingKey = ""
    accessibilityLabel = null
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultValue = null
    didApplyDefault = false
    onChange = null
    // iOS clears this in `prepareForRecycle` (`HybridNitroUiSwitch.swift:309`), and a
    // test-only prop surviving a recycle would make the next mount of this host
    // render at the previous test's width while JS believes it sent nothing.
    testWidth = null
  }
}

/**
 * The library's `SwitchColors`, so that the *tinted* Switch costs one
 * `SwitchColors` per (colour scheme, tint) instead of one per recomposition.
 *
 * What Material 3 1.4 already does: `SwitchDefaults.colors()` with no arguments
 * returns `colorScheme`'s own memoised default set (a `defaultSwitchColorsCached`
 * field), so an untinted Switch pays a field read per recomposition, not an
 * allocation. What it does not do: `SwitchDefaults.colors(checkedTrackColor = …)`
 * - the tinted path, and the one an app using `tintColor` is on - builds a fresh
 * 18-`Color` object from the scheme on every call, which at one call per
 * recomposition per mounted Switch is per-frame garbage on the UI thread, on the
 * exact path the `update` bench scenario exercises.
 *
 * It cannot be a `remember`: `remember`'s calculation lambda is
 * `@DisallowComposableCalls` and building the colours needs a composable read of
 * the scheme. So a cache with the miss in the composable - and it only pays
 * across instances while the *scheme identity* is shared, which is what
 * `NitroUiTheme`'s process-wide scheme is for (see `NitroComposeHost.kt`).
 *
 * Bounded and self-clearing: one scheme at a time (identity is the key because
 * identity is what the memo and `SwitchDefaults` both read), at most
 * [MAX_TINTED_ENTRIES] tints, and a scheme change drops everything.
 */
private object SwitchColorsCache {
  /**
   * Tints to remember before starting over. An app tints a few Switches at most;
   * the cap is what stops a component that derives a colour per list row from
   * growing this for the life of the process.
   */
  private const val MAX_TINTED_ENTRIES = 8

  private var scheme: ColorScheme? = null
  private var untinted: SwitchColors? = null
  private var tinted: HashMap<Int, SwitchColors>? = null

  /**
   * The cached colours for this scheme and tint, or `null` on a miss - which the
   * caller fills by *calling the composable*, because building them is a
   * `@ReadOnlyComposable` and cannot be handed to this object as a lambda.
   *
   * Composition happens on the UI thread today, but a second window can compose
   * against another `Choreographer`, and a half-written entry here would show one
   * Switch wearing a stale theme; the guard is one uncontended monitor per
   * recomposition, paid for by the allocation and 18 colour reads it avoids.
   */
  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): SwitchColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  /** Record a colour set the caller just built. */
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

  /** Drop what a different scheme invalidates. Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

/**
 * The Switch's colours for [tint] (an ARGB int, or `null` for the scheme's own),
 * served by [SwitchColorsCache].
 *
 * A hit is a lookup. The composable call is on the miss only - once per
 * (scheme, tint) for the process rather than once per recomposition - and it has
 * to sit here rather than inside the cache, because a building lambda would be a
 * composable in disguise (and `remember`'s calculation lambda is explicitly not
 * one). Plain `@Composable` rather than `@ReadOnlyComposable` for the same reason:
 * Material 3 1.4's `colors()` is not read-only, so a read-only context cannot
 * call it - the group that costs is around the miss, which runs once.
 */
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
    val label = model.accessibilityLabel
    // The label goes on the control, which is the node TalkBack focuses (it
    // carries M3's `Role.Switch`). Setting `contentDescription` on the host View
    // instead would put a second, focusable empty box around it.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    // Test-only: give the control a wider *intrinsic* size so a test can watch a
    // sizing-key change re-measure (see `nuiTestWidth`). Nothing in a real
    // app sets it, and `null` - the default - adds no modifier at all.
    val widthModifier =
      model.testWidth?.let { Modifier.width(it.dp) } ?: Modifier
    Switch(
      modifier = labelModifier.then(widthModifier),
      checked = model.displayed,
      onCheckedChange = { requested ->
        // Native is optimistic: show the new value now, before React has seen the
        // event, so there is no visual latency (§4).
        val eventCount = model.state.user(requested)
        model.displayed = requested
        model.onChange?.invoke(requested, eventCount.toDouble())
      },
      enabled = model.enabled,
      colors = switchColors(tint),
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
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiSwitchComponentName`
     * in the generated C++, and `getName()` in the generated Kotlin manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiSwitch"

    /**
     * The size to lay a Switch out with before anything has been measured, in dp:
     * the first Switch of an app's first launch. Material 3's Switch is 51x31 dp
     * of control inside a 48 dp minimum interactive size, which measures 52x48. A
     * measurement replaces it on the first report, and a Switch has one
     * configuration, so this is a one-frame thing - it still has to be close,
     * because Compose clips a control to a box that is too small.
     */
    private const val FALLBACK_WIDTH_DP = 52.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private var fallbackDeclared = false

    /** One `JNI` call per process, before the first Switch can be measured. */
    private fun declareFallback() {
      if (fallbackDeclared) {
        return
      }
      fallbackDeclared = true
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
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates, so an
      // opaque colour above `Int.MAX_VALUE` would become `Int.MAX_VALUE`.
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
      // Store only: the engine reads the key out of Fabric state, and a Switch has
      // one configuration, so a change here cannot even dirty its measurement.
      model.sizingKey = next
    }

  override var nuiTestWidth: Variant_NullType_Double
    get() =
      model.testWidth?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // A real size change: the composable recomposes (the model field is observed)
      // and Compose's own measure pass reports the new intrinsic size, which the
      // host hands to the sizing engine. No `invalidateContentSize` here - Compose
      // is the one that measures.
      model.testWidth = next.asSecondOrNull()
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
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // Not cleared here: `host.prepareForRecycle()` releases the sizing instance
    // (which needs the id to tell the engine), and `onDropView` has already run.
    // Resets the model. The composition does not survive a recycle: Nitro's
    // generated manager calls `onDropView()` (-> [onDropView] below, which
    // disposes it) before `prepareToRecycleView`, and `AbstractComposeView`
    // rebuilds it on the next attach. What recycling still saves is this object
    // graph: View, Hybrid, model and host allocations plus the owner wiring.
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
