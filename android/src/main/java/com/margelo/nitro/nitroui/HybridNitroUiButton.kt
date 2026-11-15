package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// The Button component: the five Material 3 buttons. Must stay in this package, which the
// generated view manager imports with a wildcard.

internal enum class ButtonVariant(val wireName: String) {
  Filled("filled"),
  Tonal("tonal"),
  Outlined("outlined"),
  Text("text"),
  Elevated("elevated");

  companion object {
    fun from(value: String): ButtonVariant = entries.firstOrNull { it.wireName == value } ?: Filled
  }
}

/**
 * The library's size names against Material's container heights: `small` is XS, `medium`
 * S, `large` M, `xlarge` L and `xxlarge` XL.
 */
internal enum class ButtonScale(val wireName: String) {
  Small("small"),
  Medium("medium"),
  Large("large"),
  XLarge("xlarge"),
  XXLarge("xxlarge");

  companion object {
    fun from(value: String): ButtonScale = entries.firstOrNull { it.wireName == value } ?: Medium
  }

  /**
   * The Material container height that padding, label style and corner are read from. Not
   * set on the composable: Material lays a button out at [MinTouchTargetHeight] or taller.
   */
  val height: Dp
    get() =
      when (this) {
        Small -> ButtonDefaults.ExtraSmallContainerHeight
        Medium -> ButtonDefaults.MinHeight
        Large -> ButtonDefaults.MediumContainerHeight
        XLarge -> ButtonDefaults.LargeContainerHeight
        XXLarge -> ButtonDefaults.ExtraLargeContainerHeight
      }

  /**
   * The height the box is laid out at: the container token, never below the touch target.
   * The corner radius is read from this, because it belongs to the box that is drawn.
   */
  val layoutHeight: Dp
    get() = if (height > MinTouchTargetHeight) height else MinTouchTargetHeight
}

/** Material 3's minimum interactive component size, which `Button` applies itself. */
internal val MinTouchTargetHeight = 48.dp

/**
 * The resting corner. Material 3 Expressive morphs a pressed button toward the other
 * shape: `round` presses toward square, `square` toward round.
 */
internal enum class ButtonShape(val wireName: String) {
  Round("round"),
  Square("square");

  companion object {
    fun from(value: String): ButtonShape = entries.firstOrNull { it.wireName == value } ?: Round
  }
}

/** Which colour `tintColor` replaces for a variant. */
internal enum class TintRole {
  Container,

  /** The label (and, for `outlined`, the border that follows it). */
  Content,
}

internal val ButtonVariant.tintRole: TintRole
  get() =
    when (this) {
      ButtonVariant.Outlined,
      ButtonVariant.Text,
      -> TintRole.Content
      else -> TintRole.Container
    }

internal class ButtonModel : NitroUiModel() {
  var title by mutableStateOf("")

  var variant by mutableStateOf(ButtonVariant.Filled)

  var scale by mutableStateOf(ButtonScale.Medium)

  var shape by mutableStateOf(ButtonShape.Round)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  /** The SF Symbol name. Ignored on Android; stored only so the getter can return it. */
  var systemImage: String? = null

  /** The icon string exactly as React sent it; [iconSlot] holds what it resolved to. */
  var androidIcon: String? = null

  val iconSlot = NitroUiIconSlot()

  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

  var sizingKey = ""

  var onPress: (() -> Unit)? = null

  // The last pixel probe's answer. Not observed, and behind a lock: the probe runs on the
  // main thread and the report is read from whichever thread Nitro calls on.
  var pixelReport = ""
    private set

  private val pixelReportLock = Any()

  private var pixelProbes = 0

  fun publishPixelReport(report: String) {
    synchronized(pixelReportLock) {
      pixelProbes += 1
      pixelReport = "n=$pixelProbes $report"
    }
  }

  fun readPixelReport(): String {
    synchronized(pixelReportLock) { return pixelReport }
  }

  override fun reset() {
    title = ""
    variant = ButtonVariant.Filled
    scale = ButtonScale.Medium
    shape = ButtonShape.Round
    enabled = true
    tintColor = null
    accessibilityLabel = null
    systemImage = null
    androidIcon = null
    iconSlot.reset()
    sizingKey = ""
    onPress = null
    pixelReport = ""
    pixelProbes = 0
  }
}

/**
 * Button colours per (colour scheme, variant, tint). Process-wide because every hosted
 * control is its own composition, so `remember` shares nothing between controls. The
 * caller fills a miss, because building the colours is a composable call.
 */
private object ButtonColorsCache {
  // A cap, so an app that derives a colour per list row cannot grow this without bound.
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private val untinted = arrayOfNulls<ButtonColors>(ButtonVariant.entries.size)

  private var tinted: HashMap<Long, ButtonColors>? = null

  private fun key(
    variant: ButtonVariant,
    tint: Int,
  ): Long = (variant.ordinal.toLong() shl 32) or (tint.toLong() and 0xFFFF_FFFFL)

  // Synchronized because a second window can compose against another `Choreographer`.
  @Synchronized
  fun get(
    scheme: ColorScheme,
    variant: ButtonVariant,
    tint: Int?,
  ): ButtonColors? {
    adopt(scheme)
    return if (tint == null) untinted[variant.ordinal] else tinted?.get(key(variant, tint))
  }

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

  // Call with the lock held.
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
 * The colours for [variant], with [tint] (an ARGB int) replacing only what [tintRole]
 * names. Shared with the Menu trigger, whose box must match a Button's.
 */
@Composable
internal fun buttonColors(
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

/** Material's label style per scale, cached per `Typography` like [ButtonColorsCache]. */
internal object ButtonLabelStyles {
  private var typography: Typography? = null
  private val styles = arrayOfNulls<TextStyle>(ButtonScale.entries.size)

  @Synchronized
  fun get(
    typography: Typography,
    scale: ButtonScale,
  ): TextStyle? =
    if (this.typography === typography) {
      styles[scale.ordinal]
    } else {
      null
    }

  @Synchronized
  fun put(
    typography: Typography,
    scale: ButtonScale,
    style: TextStyle,
  ) {
    if (this.typography !== typography) {
      this.typography = typography
      styles.fill(null)
    }
    styles[scale.ordinal] = style
  }
}

@Composable
internal fun buttonLabelStyle(scale: ButtonScale): TextStyle {
  val typography = MaterialTheme.typography
  ButtonLabelStyles.get(typography, scale)?.let { cached -> return cached }
  val built = ButtonDefaults.textStyleFor(scale.height)
  ButtonLabelStyles.put(typography, scale, built)
  return built
}

/**
 * Material's padding for the scale's height. `text` keeps `TextButtonContentPadding` at
 * every scale: material3 1.5 has no height ladder for text buttons.
 */
internal fun contentPaddingFor(
  variant: ButtonVariant,
  scale: ButtonScale,
): PaddingValues =
  if (variant == ButtonVariant.Text) {
    ButtonDefaults.TextButtonContentPadding
  } else {
    ButtonDefaults.contentPaddingFor(scale.height)
  }

/** The resting and pressed shapes for [corner] at [scale], cached per motion scheme. */
@Composable
internal fun buttonShapes(
  corner: ButtonShape,
  scale: ButtonScale,
): ButtonShapes {
  val motion = MaterialTheme.motionScheme
  ButtonShapesCache.get(motion, scale, corner)?.let { cached -> return cached }
  val rounded = ButtonDefaults.shapesFor(scale.layoutHeight)
  val built =
    if (corner == ButtonShape.Round) {
      rounded
    } else {
      ButtonShapes(shape = ButtonDefaults.squareShape, pressedShape = rounded.shape)
    }
  ButtonShapesCache.put(motion, scale, corner, built)
  return built
}

/**
 * The corner a variant draws. `text` has no container to give a corner, so it always
 * rests on Material's rounded shape.
 */
internal fun cornerFor(
  variant: ButtonVariant,
  shape: ButtonShape,
): ButtonShape = if (variant == ButtonVariant.Text) ButtonShape.Round else shape

private object ButtonShapesCache {
  private var motion: MotionScheme? = null
  private val entries = arrayOfNulls<ButtonShapes>(ButtonScale.entries.size * ButtonShape.entries.size)

  @Synchronized
  fun get(
    motion: MotionScheme,
    scale: ButtonScale,
    shape: ButtonShape,
  ): ButtonShapes? = if (this.motion === motion) entries[index(scale, shape)] else null

  @Synchronized
  fun put(
    motion: MotionScheme,
    scale: ButtonScale,
    shape: ButtonShape,
    shapes: ButtonShapes,
  ) {
    if (this.motion !== motion) {
      this.motion = motion
      entries.fill(null)
    }
    entries[index(scale, shape)] = shapes
  }

  private fun index(
    scale: ButtonScale,
    shape: ButtonShape,
  ): Int = scale.ordinal * ButtonShape.entries.size + shape.ordinal
}

private class ButtonHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: ButtonModel,
) : NitroComposeHost<ButtonModel>(context, activity, model) {

  // A `<Host>` may compose this control. The tap then reaches the Material `clickable`
  // through the Host's composition; RN never sees the touch.
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: ButtonModel) {
    val label = model.accessibilityLabel
    val press = model.onPress
    // The label goes on the control, the node TalkBack focuses. On the container it
    // would add a second, nameless focus stop.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    NitroUiM3Button(
      title = model.title,
      variant = model.variant,
      scale = model.scale,
      shape = model.shape,
      enabled = model.enabled,
      tint = model.tintColor,
      modifier = labelModifier,
      onClick = { press?.invoke() },
      icon = model.androidIconContent,
    )
  }
}

/** The five Material 3 buttons. Shared with the Menu trigger and `ButtonGroup` items. */
@Composable
internal fun NitroUiM3Button(
  title: String,
  variant: ButtonVariant,
  scale: ButtonScale,
  shape: ButtonShape = ButtonShape.Round,
  enabled: Boolean,
  tint: Int?,
  modifier: Modifier,
  onClick: () -> Unit,
  icon: NitroUiIconContent = NitroUiIconContent.Absent,
  shapes: ButtonShapes? = null,
  glyph: ButtonGlyph = ButtonGlyph.Both,
) {
  // No height is set: Material lays the box out at no less than the 48 dp touch target,
  // so the smallest scale changes padding and type without shrinking the target.
  val colors = buttonColors(variant, tint)
  // A pending icon takes the slot too, so the box does not change when the file arrives.
  val showsGlyph = glyph != ButtonGlyph.TitleOnly && icon != NitroUiIconContent.Absent
  // An `iconOnly` item with no glyph draws its title, so it is padded for the title.
  val drawsTitle = buttonGlyphDrawsTitle(glyph, icon)
  val padding =
    if (!showsGlyph || !drawsTitle) {
      // Title alone or glyph alone: symmetric padding.
      contentPaddingFor(variant, scale)
    } else {
      ButtonDefaults.contentPaddingFor(scale.height, hasStartIcon = true)
    }
  // A `ButtonGroup` item passes its connected shape; `null` keeps the variant's own.
  val resting = shapes ?: buttonShapes(cornerFor(variant, shape), scale)
  val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
    NitroUiButtonLabel(title = title, scale = scale, icon = icon, glyph = glyph)
  }
  val target: Modifier = modifier
  when (variant) {
      ButtonVariant.Filled ->
        Button(
          onClick = onClick,
          shapes = resting,
          modifier = target,
          enabled = enabled,
          colors = colors,
          contentPadding = padding,
          content = content,
        )
      ButtonVariant.Tonal ->
        FilledTonalButton(
          onClick = onClick,
          shapes = resting,
          modifier = target,
          enabled = enabled,
          colors = colors,
          contentPadding = padding,
          content = content,
        )
      ButtonVariant.Outlined ->
        OutlinedButton(
          onClick = onClick,
          shapes = resting,
          modifier = target,
          enabled = enabled,
          colors = colors,
          contentPadding = padding,
          content = content,
        )
      ButtonVariant.Text ->
        TextButton(
          onClick = onClick,
          shapes = resting,
          modifier = target,
          enabled = enabled,
          colors = colors,
          contentPadding = padding,
          content = content,
        )
      ButtonVariant.Elevated ->
        ElevatedButton(
          onClick = onClick,
          shapes = resting,
          modifier = target,
          enabled = enabled,
          colors = colors,
          contentPadding = padding,
          content = content,
        )
    }
}

internal enum class ButtonGlyph {
  Both,
  TitleOnly,
  IconOnly,
}

/**
 * Whether the label draws a title. `iconOnly` falls back to the title when there is no
 * icon, so the button is never empty.
 */
internal fun buttonGlyphDrawsTitle(
  glyph: ButtonGlyph,
  icon: NitroUiIconContent,
): Boolean = glyph != ButtonGlyph.IconOnly || icon == NitroUiIconContent.Absent

/**
 * The icon slot, then the title. Shared with `ButtonGroup` toggle items, which are
 * `ToggleButton`s and cannot use [NitroUiM3Button].
 */
@Composable
internal fun NitroUiButtonLabel(
  title: String,
  scale: ButtonScale,
  icon: NitroUiIconContent,
  glyph: ButtonGlyph = ButtonGlyph.Both,
) {
  val drawsTitle = buttonGlyphDrawsTitle(glyph, icon)
  if (glyph != ButtonGlyph.TitleOnly && icon != NitroUiIconContent.Absent) {
    NitroUiIconSlotContent(
      icon = icon,
      size = ButtonDefaults.iconSizeFor(scale.height),
      // No gap when the glyph is the whole content, or it would sit off centre.
      spacing =
        if (drawsTitle) {
          ButtonDefaults.iconSpacingFor(scale.height)
        } else {
          0.dp
        },
    )
  }
  if (drawsTitle) {
    // One line, tail-truncated: a narrower box truncates the label, not overflows it.
    Text(
      text = title,
      style = buttonLabelStyle(scale),
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

class HybridNitroUiButton(
  reactContext: ThemedReactContext,
) : HybridNitroUiButtonSpec(), RecyclableView {

  private val model = ButtonModel()
  private val host = ButtonHost(reactContext, reactContext.currentActivity, model)

  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

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
    private const val SIZING_COMPONENT_NAME = "NitroUiButton"

    // The size before anything is measured, in dp: a medium filled button with a
    // five-letter title. The engine keeps one fallback per component.
    private const val FALLBACK_WIDTH_DP = 75.1
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

  override var title: String
    get() = model.title
    set(next) {
      if (next == model.title) {
        return
      }
      model.title = next
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

  override var shape: String
    get() = model.shape.wireName
    set(next) {
      val resolved = ButtonShape.from(next)
      if (resolved == model.shape) {
        return
      }
      model.shape = resolved
      // A corner is not a layout input, which is why `shape` is not in the sizing key.
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
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` passes the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, turning an opaque colour into `Int.MAX_VALUE`.
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
      // Stored, never rendered, so nothing is marked dirty.
      model.systemImage = next.asSecondOrNull()
    }

  // Stores and marks dirty only. Resolving takes a lock or starts a network read, so it
  // happens once per commit in [afterUpdate].
  override var androidIcon: Variant_NullType_String
    get() =
      model.androidIcon?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val name = next.asSecondOrNull()
      if (name == model.androidIcon) {
        return
      }
      model.androidIcon = name
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
      // A new key may measure the same size as the old one, which the host's dedupe would
      // drop. Guarded, because React re-sends an unchanged key on every render.
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
    model.resolveAndroidIcon(iconArtwork)
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The perf and sizing ids are cleared by the host, which needs them first.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  // Reads the host's cached size and never calls into Compose, so it is safe on the JS thread.
  override fun measureContent(): NitroUiButtonSize {
    val size = host.contentSize ?: return NitroUiButtonSize(0.0, 0.0)
    return NitroUiButtonSize(size.width, size.height)
  }

  // Posted: reading pixels needs the UI thread, and a Nitro method may not block for it.
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  override fun nuiTestPixelReport(): String = model.readPixelReport()
}
