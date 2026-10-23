package com.margelo.nitro.nitroui

import android.app.Activity
import android.view.View
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

/*
 * The Button component: the five Material 3 button components on the core
 * runtime. Structure is the Switch's (`HybridNitroUiSwitch.kt`); what is new
 * here is that the control's *size* comes from its props, which is the one thing
 * the core runtime has to be told about. Compose observes the model, recomposes,
 * and its own measure pass reports the new size, so unlike iOS no extra
 * "the size may have moved" call is needed (`docs/architecture/sizing.md` §5).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** The five roles, named after the Material 3 components they are. */
internal enum class ButtonVariant(val wireName: String) {
  Filled("filled"),
  Tonal("tonal"),
  Outlined("outlined"),
  Text("text"),
  Elevated("elevated");

  companion object {
    /** The role for a wire string; anything unrecognised is `filled`. */
    fun from(value: String): ButtonVariant = entries.firstOrNull { it.wireName == value } ?: Filled
  }
}

/** `small` / `medium` / `large`: content padding, label typography, and a floor for large. */
internal enum class ButtonScale(val wireName: String) {
  Small("small"),
  Medium("medium"),
  Large("large");

  companion object {
    /** The scale for a wire string; anything unrecognised is `medium`. */
    fun from(value: String): ButtonScale = entries.firstOrNull { it.wireName == value } ?: Medium
  }
}

/** Which colour `tintColor` recolors for a variant, and why (`docs/components/button.md`). */
internal enum class TintRole {
  /** The filled container - the analogue of iOS `.tint()` on a prominent button. */
  Container,

  /** The label (and, for `outlined`, the border that follows it). */
  Content,
}

/** What each variant's `tintColor` acts on. */
internal val ButtonVariant.tintRole: TintRole
  get() =
    when (this) {
      ButtonVariant.Outlined,
      ButtonVariant.Text,
      -> TintRole.Content
      else -> TintRole.Container
    }

/** State of one Button. See [NitroUiModel] for the shape this has to have. */
internal class ButtonModel : NitroUiModel() {
  /** The label text. Observed: it is both what renders and what decides the width. */
  var title by mutableStateOf("")

  /** Which of the five M3 button composables to render, and with which colours. */
  var variant by mutableStateOf(ButtonVariant.Filled)

  /** Padding / typography scale. */
  var scale by mutableStateOf(ButtonScale.Medium)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * `accessibilityLabel`, read by the composable so the label can go on the
   * Button itself - the container is never the labelled node
   * (`docs/architecture/core.md` §3).
   */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * The SF Symbol name. v0.1 ignores it on Android - there is no SF Symbols on
   * the platform, and inventing a drawable lookup here would be a different
   * feature (documented on `docs/components/button.md`). Stored, not observed:
   * nothing reads it in a composable.
   */
  var systemImage: String? = null

  /**
   * The size configuration React sent. The sizing engine reads the key out of Fabric
   * state itself; the host only needs to hear that it changed (see
   * [NitroComposeHost.noteSizingKeyChanged]).
   */
  var sizingKey = ""

  /**
   * `onPress`, as Nitro delivered it. The generated spec types the prop as a
   * plain Kotlin function, which `Func_void` implements.
   */
  var onPress: (() -> Unit)? = null

  override fun reset() {
    title = ""
    variant = ButtonVariant.Filled
    scale = ButtonScale.Medium
    enabled = true
    tintColor = null
    accessibilityLabel = null
    systemImage = null
    sizingKey = ""
    onPress = null
  }
}

/**
 * The library's `ButtonColors`, so that a *tinted* Button costs one colour set per
 * (colour scheme, variant, tint) instead of one per recomposition.
 *
 * The rule this follows is in `docs/architecture/core.md` ("Shared objects"): a
 * hosted control is its own composition, so `remember` cannot share anything
 * between controls, and anything built from the theme or a defaults factory has to
 * be a process-wide keyed cache or hoisted out. Material 3 1.4 already memoises
 * the *untinted* path per `ColorScheme` (`ButtonDefaults.buttonColors()` with no
 * arguments reads a cached field), so the only allocation left is ours: the tinted
 * set, which without this cache is one `ButtonColors` per recomposition per
 * mounted Button - on the exact path the `update` bench scenario exercises.
 *
 * It cannot be a `remember`: building the colours is a composable read of the
 * scheme, and `remember`'s calculation lambda is `@DisallowComposableCalls`. So a
 * cache with the miss in the composable, and it only pays across instances while
 * the scheme *identity* is shared, which is what [NitroUiColorSchemes] is for.
 *
 * Bounded and self-clearing: one scheme at a time (identity is the key because
 * identity is what Material's own memo reads), at most [MAX_TINTED_ENTRIES] tinted
 * sets, and a scheme change drops everything.
 */
private object ButtonColorsCache {
  /**
   * Tinted sets to remember before starting over. An app tints a handful of
   * buttons; the cap is what stops a component that derives a colour per list row
   * from growing this for the life of the process.
   */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  /** The untinted set per variant - five slots, filled once per scheme. */
  private val untinted = arrayOfNulls<ButtonColors>(ButtonVariant.entries.size)

  /** Tinted sets, keyed by (variant ordinal, ARGB int). */
  private var tinted: HashMap<Long, ButtonColors>? = null

  private fun key(
    variant: ButtonVariant,
    tint: Int,
  ): Long = (variant.ordinal.toLong() shl 32) or (tint.toLong() and 0xFFFF_FFFFL)

  /**
   * The cached colours for this scheme, variant and tint, or `null` on a miss -
   * which the caller fills by *calling the composable*, because building them is a
   * composable read of the scheme and cannot be handed here as a lambda.
   *
   * Synchronised for the same reason [SwitchColorsCache] is: a second window can
   * compose against another `Choreographer`, and a half-written entry would show
   * one Button wearing a stale theme. One uncontended monitor per recomposition,
   * paid for by the object it avoids.
   */
  @Synchronized
  fun get(
    scheme: ColorScheme,
    variant: ButtonVariant,
    tint: Int?,
  ): ButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted[variant.ordinal] else tinted?.get(key(variant, tint))
  }

  /** Record a colour set the caller just built. */
  @Synchronized
  fun put(
    scheme: ColorScheme,
    variant: ButtonVariant,
    tint: Int?,
    colors: ButtonColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted[variant.ordinal] = colors
      return
    }
    val entries = tinted ?: HashMap<Long, ButtonColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[key(variant, tint)] = colors
  }

  /** Drop what a different scheme invalidates. Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    for (index in untinted.indices) {
      untinted[index] = null
    }
    tinted?.clear()
  }
}

/**
 * The Button's colours for [tint] (an ARGB int, or `null` for the scheme's own),
 * served by [ButtonColorsCache].
 *
 * The tint replaces only what [tintRole] says: the container for the three filled
 * variants, the label (and the border that follows it) for `outlined` and `text`,
 * whose container is transparent by design. Everything else keeps the M3 role
 * colours, which is the same trade the Switch's `tintColor` makes.
 */
@Composable
private fun buttonColors(
  variant: ButtonVariant,
  tint: Int?,
): ButtonColors {
  val scheme = MaterialTheme.colorScheme
  ButtonColorsCache.get(scheme, variant, tint)?.let { cached -> return cached }
  val base =
    when (variant) {
      ButtonVariant.Filled -> ButtonDefaults.buttonColors()
      ButtonVariant.Tonal -> ButtonDefaults.filledTonalButtonColors()
      ButtonVariant.Outlined -> ButtonDefaults.outlinedButtonColors()
      ButtonVariant.Text -> ButtonDefaults.textButtonColors()
      ButtonVariant.Elevated -> ButtonDefaults.elevatedButtonColors()
    }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      base
    } else if (variant.tintRole == TintRole.Container) {
      base.copy(containerColor = color)
    } else {
      base.copy(contentColor = color)
    }
  ButtonColorsCache.put(scheme, variant, tint, built)
  return built
}

/**
 * The label style of one scale, served per `Typography` identity.
 *
 * `small` and `medium` are the theme's own `labelMedium` / `labelLarge`, so they
 * cost a field read. Only `large` derives anything (`labelLarge` at 18 sp), and
 * that copy happens once per theme rather than per recomposition - the same rule
 * as [ButtonColorsCache]: an object derived from the theme is shared, not built
 * inline in the composable.
 */
private object ButtonLabelStyles {
  private var typography: Typography? = null
  private var small: TextStyle? = null
  private var medium: TextStyle? = null
  private var large: TextStyle? = null

  @Synchronized
  fun get(
    typography: Typography,
    scale: ButtonScale,
  ): TextStyle {
    adopt(typography)
    return when (scale) {
      ButtonScale.Small -> small!!
      ButtonScale.Medium -> medium!!
      ButtonScale.Large -> large!!
    }
  }

  private fun adopt(typography: Typography) {
    if (this.typography === typography) {
      return
    }
    this.typography = typography
    small = typography.labelMedium
    medium = typography.labelLarge
    large = typography.labelLarge.copy(fontSize = 18.sp, lineHeight = 22.sp)
  }
}

/** The label's own padding. `medium` is `null`, which means "keep the M3 default". */
private fun contentPaddingFor(
  variant: ButtonVariant,
  scale: ButtonScale,
): PaddingValues? =
  when (scale) {
    ButtonScale.Medium -> null
    ButtonScale.Small -> PaddingValues(horizontal = 12.dp, vertical = 6.dp)
    ButtonScale.Large ->
      if (variant == ButtonVariant.Text) {
        PaddingValues(horizontal = 24.dp, vertical = 14.dp)
      } else {
        PaddingValues(horizontal = 32.dp, vertical = 14.dp)
      }
  }

/**
 * The Button's host: [NitroComposeHost] plus this component's composable.
 *
 * [Content] is fixed for the lifetime of the view, which is why it lives in a
 * subclass rather than being handed in as a lambda - there is no `setContent`
 * anywhere in this library after construction.
 */
private class ButtonHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ButtonModel,
) : NitroComposeHost<ButtonModel>(context, activity, model) {
  @Composable
  override fun Component(model: ButtonModel) {
    val variant = model.variant
    val scale = model.scale
    val tint = model.tintColor
    val label = model.accessibilityLabel
    val enabled = model.enabled
    val press = model.onPress
    // The label goes on the control, which is the node TalkBack focuses (M3 gives
    // it `Role.Button`). On the container instead, the empty box becomes a second
    // focus stop and the button announces itself nameless.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    // `medium` keeps Material's own minimum, which for a Button is 40 dp and is
    // applied inside the control where a caller's modifier cannot shrink it -
    // documented rather than fought. `large` raises the floor.
    val scaleModifier =
      if (scale == ButtonScale.Large) Modifier.heightIn(min = 48.dp) else Modifier
    val colors = buttonColors(variant, tint)
    val padding = contentPaddingFor(variant, scale)
    val labelStyle = ButtonLabelStyles.get(MaterialTheme.typography, scale)
    val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
      // One line, tail-truncated: the control's intrinsic width is the title's
      // width, and a caller who wants a narrower box gives it a `width` - then the
      // label truncates instead of painting outside its box (the iOS content does
      // the same).
      Text(
        text = model.title,
        style = labelStyle,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
    val onClick: () -> Unit = { press?.invoke() }
    when (variant) {
      ButtonVariant.Filled ->
        Button(
          onClick = onClick,
          modifier = labelModifier.then(scaleModifier),
          enabled = enabled,
          colors = colors,
          contentPadding = padding ?: ButtonDefaults.ContentPadding,
          content = content,
        )
      ButtonVariant.Tonal ->
        FilledTonalButton(
          onClick = onClick,
          modifier = labelModifier.then(scaleModifier),
          enabled = enabled,
          colors = colors,
          contentPadding = padding ?: ButtonDefaults.ContentPadding,
          content = content,
        )
      ButtonVariant.Outlined ->
        OutlinedButton(
          onClick = onClick,
          modifier = labelModifier.then(scaleModifier),
          enabled = enabled,
          colors = colors,
          contentPadding = padding ?: ButtonDefaults.ContentPadding,
          content = content,
        )
      ButtonVariant.Text ->
        TextButton(
          onClick = onClick,
          modifier = labelModifier.then(scaleModifier),
          enabled = enabled,
          colors = colors,
          contentPadding = padding ?: ButtonDefaults.TextButtonContentPadding,
          content = content,
        )
      ButtonVariant.Elevated ->
        ElevatedButton(
          onClick = onClick,
          modifier = labelModifier.then(scaleModifier),
          enabled = enabled,
          colors = colors,
          contentPadding = padding ?: ButtonDefaults.ContentPadding,
          content = content,
        )
    }
  }
}

/** The Hybrid View React renders as `NitroUiButton`. */
class HybridNitroUiButton(
  reactContext: ThemedReactContext,
) : HybridNitroUiButtonSpec(), RecyclableView {

  private val model = ButtonModel()
  private val host = ButtonHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which
    // is the point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiButtonComponentName`
     * in the generated C++, and `getName()` in the generated manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiButton"

    /**
     * The size to lay a Button out with before anything has been measured, in dp.
     *
     * A Button has *many* configurations (title, variant, size, symbol) while the
     * engine's fallback is keyed by component alone, so this can only be one
     * number: this platform's medium filled button with a five-letter title.
     * Every other configuration is a first instance of its own configuration and
     * gets corrected the turn it measures (`docs/sizing.md` §9).
     *
     * Measured on the AVD this library's tests run on (`nitroui_t02`, 420 dpi,
     * API 35), rounded up to the point: medium + filled + "Cancel" is
     * 91.0 x 48.0 dp, and the height is 48 for every variant at small and medium
     * because Material 3 puts a 48 dp minimum interactive size under a 36 dp
     * track - the same reason stock `Switch` boxes are 48 tall. Guessing 40 here
     * would make the first frame of every Button ~8 dp too short and shift the row
     * it sits in. `docs/components/button.md` has the whole table.
     */
    private const val FALLBACK_WIDTH_DP = 91.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One `JNI` call per process, before the first Button can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a
     * Fabric measure can happen before this class has ever been instantiated, so
     * a fallback declared from `init` is one measure too late for the first
     * instance (T14) - and from `init` as the backstop. The two calls land on
     * different threads, hence the atomic.
     */
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

  override var title: String
    get() = model.title
    set(next) {
      if (next == model.title) {
        return
      }
      model.title = next
      // The composable recomposes and Compose's own measure pass reports the new
      // width - Android needs no explicit "the size may have moved" call (§5).
      host.markDirty()
    }

  override var variant: String
    get() = model.variant.wireName
    set(next) {
      val resolved = ButtonVariant.from(next)
      if (resolved == model.variant) {
        return
      }
      model.variant = resolved
      host.markDirty()
    }

  override var size: String
    get() = model.scale.wireName
    set(next) {
      val resolved = ButtonScale.from(next)
      if (resolved == model.scale) {
        return
      }
      model.scale = resolved
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      // Repaints only: a disabled control is the same size.
      host.markDirty()
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

  override var systemImage: Variant_NullType_String
    get() =
      model.systemImage?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never rendered: v0.1 ignores the SF Symbol on Android
      // (`docs/components/button.md`). No `markDirty()` - nothing observes it.
      model.systemImage = next.asSecondOrNull()
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
      host.perfInstanceId =
        if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      if (next == model.sizingKey) {
        return
      }
      model.sizingKey = next
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback. A `systemImage` change measures what the old
      // configuration measured, and that is the size the host's dedupe would swallow
      // the correcting report against; Compose also never re-measures a mounted
      // control whose box merely moved, so the host has to be asked for both (F1).
      // Guarded, because React re-sends an unchanged key on every render.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId =
        if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onPress: (() -> Unit)?
    get() = model.onPress
    set(next) {
      model.onPress = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // No controlled value, so nothing to reconcile: one commit per React commit
    // (`docs/architecture/core.md` §12).
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    host.perfInstanceId = NitroUiPerf.NO_INSTANCE
    // Not cleared here: `host.prepareForRecycle()` releases the sizing instance
    // (which needs the id to tell the engine), and `onDropView` has already run.
    // The composition does not survive a recycle (core.md §6); what recycling saves
    // is this object graph.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this Button, from the host's cache. Never calls
   * into Compose, so it is safe on the JS thread (§1.4).
   */
  override fun measureContent(): NitroUiButtonSize {
    val size = host.contentSize ?: return NitroUiButtonSize(0.0, 0.0)
    return NitroUiButtonSize(size.width, size.height)
  }
}
