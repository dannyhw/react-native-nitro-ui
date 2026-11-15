package com.margelo.nitro.nitroui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconButtonShapes
import androidx.compose.material3.IconToggleButtonColors
import androidx.compose.material3.IconToggleButtonShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.node.RootForTest
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.nitroui.core.nitroUiSamplePixels
import com.margelo.nitro.views.RecyclableView
import java.util.concurrent.atomic.AtomicBoolean

// Material 3's four icon buttons and their four toggle forms. Must stay in this package:
// the generated manager finds the implementation through a wildcard import of it.

/** A tint replaces the container where the look has one, and the icon where it does not. */
internal enum class IconButtonVariant(
  val wireName: String,
  val tintsContainer: Boolean,
) {
  Standard("standard", false),
  Filled("filled", true),
  Tonal("tonal", true),
  Outlined("outlined", false),
  ;

  companion object {
    /** The look for a wire string; anything unrecognised is `standard`. */
    fun from(value: String): IconButtonVariant = entries.firstOrNull { it.wireName == value } ?: Standard
  }
}

/** The five sizes. They are Material's XS, S, M, L and XL icon-button tokens. */
internal enum class IconButtonScale(val wireName: String) {
  Small("small"),
  Medium("medium"),
  Large("large"),
  XLarge("xlarge"),
  XXLarge("xxlarge"),
  ;

  companion object {
    /** The rung for a wire string; anything unrecognised is `medium`. */
    fun from(value: String): IconButtonScale = entries.firstOrNull { it.wireName == value } ?: Medium
  }

  /**
   * Must be applied on the control's own modifier: each Material icon button already sizes
   * its own box with the small token, and a size requested inside that is coerced into it.
   */
  @Composable
  fun containerSize(width: IconButtonWidth): DpSize =
    when (this) {
      Small -> IconButtonDefaults.extraSmallContainerSize(width.option)
      Medium -> IconButtonDefaults.smallContainerSize(width.option)
      Large -> IconButtonDefaults.mediumContainerSize(width.option)
      XLarge -> IconButtonDefaults.largeContainerSize(width.option)
      XXLarge -> IconButtonDefaults.extraLargeContainerSize(width.option)
    }

  fun iconSize(): Dp =
    when (this) {
      Small -> IconButtonDefaults.extraSmallIconSize
      Medium -> IconButtonDefaults.smallIconSize
      Large -> IconButtonDefaults.mediumIconSize
      XLarge -> IconButtonDefaults.largeIconSize
      XXLarge -> IconButtonDefaults.extraLargeIconSize
    }

  @Composable
  fun roundShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallRoundShape
      Medium -> IconButtonDefaults.smallRoundShape
      Large -> IconButtonDefaults.mediumRoundShape
      XLarge -> IconButtonDefaults.largeRoundShape
      XXLarge -> IconButtonDefaults.extraLargeRoundShape
    }

  @Composable
  fun squareShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallSquareShape
      Medium -> IconButtonDefaults.smallSquareShape
      Large -> IconButtonDefaults.mediumSquareShape
      XLarge -> IconButtonDefaults.largeSquareShape
      XXLarge -> IconButtonDefaults.extraLargeSquareShape
    }

  @Composable
  fun pressedShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallPressedShape
      Medium -> IconButtonDefaults.smallPressedShape
      Large -> IconButtonDefaults.mediumPressedShape
      XLarge -> IconButtonDefaults.largePressedShape
      XXLarge -> IconButtonDefaults.extraLargePressedShape
    }

  @Composable
  fun selectedShape(round: Boolean): Shape =
    when (this) {
      Small -> if (round) IconButtonDefaults.extraSmallSelectedRoundShape else IconButtonDefaults.extraSmallSelectedSquareShape
      Medium -> if (round) IconButtonDefaults.smallSelectedRoundShape else IconButtonDefaults.smallSelectedSquareShape
      Large -> if (round) IconButtonDefaults.mediumSelectedRoundShape else IconButtonDefaults.mediumSelectedSquareShape
      XLarge -> if (round) IconButtonDefaults.largeSelectedRoundShape else IconButtonDefaults.largeSelectedSquareShape
      XXLarge -> if (round) IconButtonDefaults.extraLargeSelectedRoundShape else IconButtonDefaults.extraLargeSelectedSquareShape
    }
}

/** Material's three width options for a size. Android only. */
internal enum class IconButtonWidth(val wireName: String) {
  Narrow("narrow"),
  Uniform("uniform"),
  Wide("wide"),
  ;

  companion object {
    /** The option for a wire string; anything unrecognised is `uniform`. */
    fun from(value: String): IconButtonWidth = entries.firstOrNull { it.wireName == value } ?: Uniform
  }

  val option: IconButtonDefaults.IconButtonWidthOption
    get() =
      when (this) {
        Narrow -> IconButtonDefaults.IconButtonWidthOption.Narrow
        Uniform -> IconButtonDefaults.IconButtonWidthOption.Uniform
        Wide -> IconButtonDefaults.IconButtonWidthOption.Wide
      }
}

internal enum class IconButtonCorner(val wireName: String) {
  Round("round"),
  Square("square"),
  ;

  companion object {
    /** The corner for a wire string; anything unrecognised is `round`. */
    fun from(value: String): IconButtonCorner = entries.firstOrNull { it.wireName == value } ?: Round
  }
}

internal class IconButtonModel : NitroUiModel() {
  /** The control's only name, put on the button's own node (never the container). */
  var accessibilityLabel by mutableStateOf<String?>(null)

  var variant by mutableStateOf(IconButtonVariant.Standard)

  var displayed by mutableStateOf(false)

  /**
   * Whether the control is a toggle. Set from `defaultChecked != null` in `afterUpdate()`,
   * never by a prop setter, so the form can be switched off as well as on.
   */
  var isToggle by mutableStateOf(false)

  var enabled by mutableStateOf(true)

  var scale by mutableStateOf(IconButtonScale.Medium)

  var width by mutableStateOf(IconButtonWidth.Uniform)

  var corner by mutableStateOf(IconButtonCorner.Round)

  /** The tint (`processColor`'s ARGB int), or `null` for the scheme's own roles. */
  var tintColor by mutableStateOf<Int?>(null)

  /** The SF Symbol name. Stored for the getter; Android draws [androidIcon]. */
  var systemImage: String? = null

  /** Stored, not observed: [androidIconContent] is what draws, and it is observed. */
  var androidIcon: String? = null

  val iconSlot = NitroUiIconSlot()

  /** What the composition draws. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  fun resolveAndroidIcon(artwork: NitroUiIconArtwork) {
    iconSlot.resolve(androidIcon, artwork)
  }

  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultChecked: Boolean? = null
  var didApplyDefault = false

  var onCheckedChange: ((Boolean, Double) -> Unit)? = null
  var onPress: (() -> Unit)? = null

  /** Test-only read-outs, behind one lock. */
  private val reportLock = Any()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"

  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** Safe from any thread. */
  fun stateReport(): String =
    synchronized(reportLock) { "displayed=$drawn;probes=$probes;a11y=$accessibilityReport" }

  /**
   * What the last pixel probe saw, prefixed `n=<count>`. Not observed. Locked because the
   * probe runs on the main thread and the report is read from any thread.
   */
  var pixelReport = ""
    private set

  private val pixelReportLock = Any()

  private var pixelProbes = 0

  /** Safe from any thread. */
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
    accessibilityLabel = null
    variant = IconButtonVariant.Standard
    displayed = false
    isToggle = false
    enabled = true
    scale = IconButtonScale.Medium
    width = IconButtonWidth.Uniform
    corner = IconButtonCorner.Round
    tintColor = null
    systemImage = null
    androidIcon = null
    // A recycled control must not draw its previous owner's glyph.
    iconSlot.reset()
    sizingKey = ""
    state.displayed = false
    state.js = null
    state.nativeEvents = 0
    state.jsEvents = 0
    defaultChecked = null
    didApplyDefault = false
    onCheckedChange = null
    onPress = null
    synchronized(reportLock) {
      drawn = "none"
      probes = 0
      accessibilityReport = "none"
    }
    synchronized(pixelReportLock) {
      pixelReport = ""
      pixelProbes = 0
    }
  }
}

/**
 * One colour set per (scheme, variant, tint). Material already caches the untinted set;
 * the tinted one would otherwise be built on every recomposition, and `remember` cannot
 * share it between hosted controls, which are separate compositions.
 */
private class VariantColorCache<Value : Any> {
  private companion object {
    /** The tinted sets are cleared when they reach this many. */
    const val MAX_TINTED_ENTRIES = 24

    const val VARIANTS = 4
  }

  private var scheme: ColorScheme? = null
  private val untinted = arrayOfNulls<Any>(VARIANTS)
  private var tinted: HashMap<Long, Any>? = null

  private fun key(
    variant: IconButtonVariant,
    tint: Int,
  ): Long = (variant.ordinal.toLong() shl 32) or (tint.toLong() and 0xFFFF_FFFFL)

  @Suppress("UNCHECKED_CAST")
  @Synchronized
  fun get(
    scheme: ColorScheme,
    variant: IconButtonVariant,
    tint: Int?,
  ): Value? {
    adopt(scheme)
    return if (tint == null) {
      untinted[variant.ordinal]
    } else {
      tinted?.get(key(variant, tint))
    } as Value?
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    variant: IconButtonVariant,
    tint: Int?,
    colors: Value,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted[variant.ordinal] = colors
      return
    }
    val entries = tinted ?: HashMap<Long, Any>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[key(variant, tint)] = colors
  }

  /** Called with the lock held. */
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

private val PressColors = VariantColorCache<IconButtonColors>()
private val ToggleColors = VariantColorCache<IconToggleButtonColors>()

/** [tint] is an ARGB int, or `null` for the scheme's colours. Shared with the Stepper. */
@Composable
internal fun iconButtonColors(
  variant: IconButtonVariant,
  tint: Int?,
): IconButtonColors {
  val scheme = MaterialTheme.colorScheme
  PressColors.get(scheme, variant, tint)?.let { cached -> return cached }
  val base =
    when (variant) {
      IconButtonVariant.Standard -> IconButtonDefaults.iconButtonColors()
      IconButtonVariant.Filled -> IconButtonDefaults.filledIconButtonColors()
      IconButtonVariant.Tonal -> IconButtonDefaults.filledTonalIconButtonColors()
      IconButtonVariant.Outlined -> IconButtonDefaults.outlinedIconButtonColors()
    }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      base
    } else if (variant.tintsContainer) {
      base.copy(containerColor = color)
    } else {
      base.copy(contentColor = color)
    }
  PressColors.put(scheme, variant, tint, built)
  return built
}

@Composable
private fun iconToggleColors(
  variant: IconButtonVariant,
  tint: Int?,
): IconToggleButtonColors {
  val scheme = MaterialTheme.colorScheme
  ToggleColors.get(scheme, variant, tint)?.let { cached -> return cached }
  val base =
    when (variant) {
      IconButtonVariant.Standard -> IconButtonDefaults.iconToggleButtonColors()
      IconButtonVariant.Filled -> IconButtonDefaults.filledIconToggleButtonColors()
      IconButtonVariant.Tonal -> IconButtonDefaults.filledTonalIconToggleButtonColors()
      IconButtonVariant.Outlined -> IconButtonDefaults.outlinedIconToggleButtonColors()
    }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      base
    } else if (variant.tintsContainer) {
      // Both containers, so a tinted toggle keeps its tint when it is switched on.
      base.copy(containerColor = color, checkedContainerColor = color)
    } else {
      base.copy(contentColor = color, checkedContentColor = color)
    }
  ToggleColors.put(scheme, variant, tint, built)
  return built
}

/**
 * The shapes of one size, cached per (motion scheme, size, corner, form): Material builds
 * new `Shape` objects on every call.
 */
private object IconButtonShapeCache {
  private var motion: MotionScheme? = null

  /** `[scale][corner][toggle]`, flattened into one array of 20 slots. */
  private val entries = arrayOfNulls<Any>(IconButtonScale.entries.size * 2 * 2)

  private fun slot(
    scale: IconButtonScale,
    corner: IconButtonCorner,
    toggle: Boolean,
  ): Int = (scale.ordinal * 2 + corner.ordinal) * 2 + (if (toggle) 1 else 0)

  @Suppress("UNCHECKED_CAST")
  @Synchronized
  fun <Value> get(
    motion: MotionScheme,
    scale: IconButtonScale,
    corner: IconButtonCorner,
    toggle: Boolean,
  ): Value? = if (this.motion === motion) entries[slot(scale, corner, toggle)] as Value? else null

  @Synchronized
  fun <Value> put(
    motion: MotionScheme,
    scale: IconButtonScale,
    corner: IconButtonCorner,
    toggle: Boolean,
    shapes: Value,
  ) {
    if (this.motion !== motion) {
      this.motion = motion
      for (index in entries.indices) {
        entries[index] = null
      }
    }
    entries[slot(scale, corner, toggle)] = shapes
  }
}

/** Shared with the Stepper. */
@Composable
internal fun iconButtonShapes(
  scale: IconButtonScale,
  corner: IconButtonCorner,
): IconButtonShapes {
  val motion = MaterialTheme.motionScheme
  IconButtonShapeCache.get<IconButtonShapes>(motion, scale, corner, false)?.let { cached -> return cached }
  val built =
    IconButtonDefaults.shapes(
      scale.let { if (corner == IconButtonCorner.Round) it.roundShape() else it.squareShape() },
      scale.pressedShape(),
    )
  IconButtonShapeCache.put(motion, scale, corner, false, built)
  return built
}

@Composable
private fun iconToggleShapes(
  scale: IconButtonScale,
  corner: IconButtonCorner,
): IconToggleButtonShapes {
  val motion = MaterialTheme.motionScheme
  IconButtonShapeCache.get<IconToggleButtonShapes>(motion, scale, corner, true)?.let { cached -> return cached }
  val round = corner == IconButtonCorner.Round
  val built =
    IconButtonDefaults.toggleableShapes(
      scale.let { if (round) it.roundShape() else it.squareShape() },
      scale.pressedShape(),
      scale.selectedShape(round),
    )
  IconButtonShapeCache.put(motion, scale, corner, true, built)
  return built
}

/** The outlined variant's border in the control's tint. The width stays Material's own. */
@Composable
private fun outlinedBorder(
  variant: IconButtonVariant,
  tint: Int?,
  disabled: Boolean,
  checked: Boolean?,
): BorderStroke? {
  if (variant != IconButtonVariant.Outlined) {
    return null
  }
  val color = tint?.let { ComposeColor(it) } ?: return null
  val base =
    if (checked == null) {
      IconButtonDefaults.outlinedIconButtonBorder(disabled)
    } else {
      IconButtonDefaults.outlinedIconToggleButtonBorder(checked, disabled)
    }
  return BorderStroke(base?.width ?: NITRO_UI_OUTLINED_BORDER_WIDTH, color)
}

/**
 * The minimum interactive size outside the container token, in that order. Swapped,
 * `size` would stop a 40 dp container growing into a 48 dp touch target. Shared with the
 * Stepper.
 */
@Composable
internal fun nitroUiIconButtonContainer(
  scale: IconButtonScale,
  width: IconButtonWidth,
  leading: Modifier = Modifier,
): Modifier = leading.minimumInteractiveComponentSize().size(scale.containerSize(width))

/** Used only if Material's own default border cannot be read. */
private val NITRO_UI_OUTLINED_BORDER_WIDTH = 1.dp

private class IconButtonHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: IconButtonModel,
) : NitroComposeHost<IconButtonModel>(context, activity, model) {
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  /**
   * The platform throws when sent an accessibility event while no service is enabled, which
   * happens once the test probe has forced Compose semantics on.
   */
  override fun requestSendAccessibilityEvent(
    child: View,
    event: AccessibilityEvent,
  ): Boolean {
    if (systemAccessibility?.isEnabled != true) {
      return false
    }
    return super.requestSendAccessibilityEvent(child, event)
  }

  /** One press, by the path a tap takes. Ignored while disabled. */
  fun press() {
    if (!model.enabled) {
      return
    }
    if (model.isToggle) {
      toggleTo(!model.displayed)
    } else {
      model.onPress?.invoke()
    }
  }

  /** Optimistic: shows the new value before React has seen the event. */
  fun toggleTo(requested: Boolean) {
    if (!model.enabled) {
      return
    }
    val eventCount = model.state.user(requested)
    model.displayed = requested
    model.onCheckedChange?.invoke(requested, eventCount.toDouble())
  }

  @Composable
  override fun Component(model: IconButtonModel) {
    val variant = model.variant
    val toggle = model.isToggle
    val selected = model.displayed
    model.recordDrawn(if (toggle) (if (selected) "1" else "0") else "none")
    val label = model.accessibilityLabel
    // The name goes on the control, the node TalkBack focuses. On the container it would
    // add a second focus stop and leave the button unnamed.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    val enabled = model.enabled
    val tint = model.tintColor
    val scale = model.scale
    val corner = model.corner
    val glyphSize = scale.iconSize()
    // The size goes on the control's modifier, not inside its content: Material sizes its
    // own box with the small token, and a size requested inside that is coerced into it.
    val controlModifier = nitroUiIconButtonContainer(scale, model.width, labelModifier)
    val content: @Composable () -> Unit = {
      NitroUiIconGlyph(
        painter = rememberIconPainter(model.androidIconContent),
        size = glyphSize,
        tint = LocalContentColor.current,
        contentDescription = null,
      )
    }
    if (toggle) {
      val colors = iconToggleColors(variant, tint)
      val shapes = iconToggleShapes(scale, corner)
      val border = outlinedBorder(variant, tint, !enabled, selected)
      val onCheckedChange: (Boolean) -> Unit = { requested -> toggleTo(requested) }
      when (variant) {
        IconButtonVariant.Standard ->
          androidx.compose.material3.IconToggleButton(
            checked = selected,
            onCheckedChange = onCheckedChange,
            modifier = controlModifier,
            enabled = enabled,
            colors = colors,
            shapes = shapes,
            content = content,
          )
        IconButtonVariant.Filled ->
          androidx.compose.material3.FilledIconToggleButton(
            checked = selected,
            onCheckedChange = onCheckedChange,
            modifier = controlModifier,
            enabled = enabled,
            colors = colors,
            shapes = shapes,
            content = content,
          )
        IconButtonVariant.Tonal ->
          androidx.compose.material3.FilledTonalIconToggleButton(
            checked = selected,
            onCheckedChange = onCheckedChange,
            modifier = controlModifier,
            enabled = enabled,
            colors = colors,
            shapes = shapes,
            content = content,
          )
        IconButtonVariant.Outlined ->
          androidx.compose.material3.OutlinedIconToggleButton(
            checked = selected,
            onCheckedChange = onCheckedChange,
            modifier = controlModifier,
            enabled = enabled,
            colors = colors,
            shapes = shapes,
            border = border ?: IconButtonDefaults.outlinedIconToggleButtonBorder(selected, !enabled),
            content = content,
          )
      }
      return
    }
    val colors = iconButtonColors(variant, tint)
    val shapes = iconButtonShapes(scale, corner)
    val onClick: () -> Unit = { press() }
    when (variant) {
      IconButtonVariant.Standard ->
        androidx.compose.material3.IconButton(
          onClick = onClick,
          modifier = controlModifier,
          enabled = enabled,
          colors = colors,
          shapes = shapes,
          content = content,
        )
      IconButtonVariant.Filled ->
        androidx.compose.material3.FilledIconButton(
          onClick = onClick,
          modifier = controlModifier,
          enabled = enabled,
          colors = colors,
          shapes = shapes,
          content = content,
        )
      IconButtonVariant.Tonal ->
        androidx.compose.material3.FilledTonalIconButton(
          onClick = onClick,
          modifier = controlModifier,
          enabled = enabled,
          colors = colors,
          shapes = shapes,
          content = content,
        )
      IconButtonVariant.Outlined ->
        androidx.compose.material3.OutlinedIconButton(
          onClick = onClick,
          modifier = controlModifier,
          enabled = enabled,
          colors = colors,
          shapes = shapes,
          border = outlinedBorder(variant, tint, !enabled, null)
            ?: IconButtonDefaults.outlinedIconButtonBorder(!enabled),
          content = content,
        )
    }
  }
}

class HybridNitroUiIconButton(
  reactContext: ThemedReactContext,
) : HybridNitroUiIconButtonSpec(),
  RecyclableView {
  private val model = IconButtonModel()
  private val host = IconButtonHost(reactContext, reactContext.currentActivity, model)

  /** Resolves icons against the app's resources. Held, so a prop commit allocates nothing. */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    /** Must match `getName()` in the generated manager. */
    private const val SIZING_COMPONENT_NAME = "NitroUiIconButton"

    /**
     * The size used before anything has been measured, in dp: Material's 48 dp minimum touch
     * target, which is the laid-out box of the smaller sizes.
     */
    private const val FALLBACK_SIZE_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One JNI call per process. */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_SIZE_DP,
        FALLBACK_SIZE_DP,
        NitroUiSizing.POLICY_INTRINSIC,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var accessibilityLabel: String
    get() = model.accessibilityLabel ?: ""
    set(next) {
      if (next == model.accessibilityLabel) {
        return
      }
      model.accessibilityLabel = next
      host.markDirty()
    }

  override var systemImage: Variant_NullType_String
    get() =
      model.systemImage?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      // Stored, never drawn: Android has no SF Symbols and draws [androidIcon].
      model.systemImage = next.asSecondOrNull()
    }

  override var androidIcon: Variant_NullType_String
    get() =
      model.androidIcon?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val name = next.asSecondOrNull()
      if (name == model.androidIcon) {
        return
      }
      // Only stored: resolving can take a lock or open a socket, so `afterUpdate()` does it
      // once per commit.
      model.androidIcon = name
    }

  override var variant: String
    get() = model.variant.wireName
    set(next) {
      val value = IconButtonVariant.from(next)
      if (value == model.variant) {
        return
      }
      model.variant = value
      host.markDirty()
    }

  override var size: String
    get() = model.scale.wireName
    set(next) {
      val value = IconButtonScale.from(next)
      if (value == model.scale) {
        return
      }
      // Compose's own measure pass reports the new size.
      model.scale = value
      host.markDirty()
    }

  override var width: String
    get() = model.width.wireName
    set(next) {
      val value = IconButtonWidth.from(next)
      if (value == model.width) {
        return
      }
      model.width = value
      host.markDirty()
    }

  override var shape: String
    get() = model.corner.wireName
    set(next) {
      val value = IconButtonCorner.from(next)
      if (value == model.corner) {
        return
      }
      // A paint, not a layout input.
      model.corner = value
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
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var checked: Variant_Boolean_NullType
    get() =
      model.state.js?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val value = next.asFirstOrNull()
      // `displayed` follows in `afterUpdate()`, once the event count says JS has caught up.
      model.state.js = value
    }

  override var defaultChecked: Variant_Boolean_NullType
    get() =
      model.defaultChecked?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val seed = next.asFirstOrNull()
      model.defaultChecked = seed
      // `afterUpdate()` decides the form from this value; `null` means the press form.
      if (model.state.js != null || model.didApplyDefault || seed == null) {
        return
      }
      model.didApplyDefault = true
      if (seed != model.state.displayed) {
        model.state.displayed = seed
        model.displayed = seed
        host.markDirty()
      }
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // The view tag is what testID matchers read.
    set(next) {
      host.tag = next.asSecondOrNull()
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
      // A new key needs a fresh measure and a report, even if the size is unchanged.
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

  override var onCheckedChange: ((Boolean, Double) -> Unit)?
    get() = model.onCheckedChange
    set(next) {
      model.onCheckedChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    // The icon first: a resource is drawn in this commit, and a file reserves its slot.
    model.resolveAndroidIcon(iconArtwork)
    // The form is re-read every batch: `defaultChecked` is non-null exactly when the
    // wrapper is in the toggle form. A flag latched in a setter could never switch the
    // form off again.
    val isToggle = model.defaultChecked != null
    if (isToggle != model.isToggle) {
      model.isToggle = isToggle
      if (!isToggle) {
        // The value belongs to the toggle form; clear it so a later toggle starts clean.
        model.state.displayed = false
        model.state.js = null
        model.state.nativeEvents = 0
        model.state.jsEvents = 0
        model.didApplyDefault = false
        model.displayed = false
      }
      host.markDirty()
    }
    // The handshake decides whether React's `checked` wins over what the user just did.
    // A no-op for the press form, which has no value.
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle; this also resets the model and the icon.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onCheckedChange = null
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiIconButtonSize {
    val size = host.contentSize ?: return NitroUiIconButtonSize(0.0, 0.0)
    return NitroUiIconButtonSize(size.width, size.height)
  }

  /** Posts to the UI thread and returns at once. */
  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Posts to the UI thread and returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post { model.recordAccessibility(describeAccessibility()) }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  /** The merged semantics node for this control, as one line. Forces semantics on first. */
  private fun describeAccessibility(): String {
    val root = findComposeRoot(host) ?: return "no Compose root"
    root.forceAccessibilityForTesting(true)
    val owner: SemanticsOwner? = root.semanticsOwner
    if (owner == null) {
      return "no SemanticsOwner"
    }
    val nodes = owner.getAllSemanticsNodes(mergingEnabled = true)
    val clickable = nodes.filter { it.config.contains(SemanticsActions.OnClick) }
    val node: SemanticsNode =
      when (clickable.size) {
        0 -> return "no node publishes OnClick (${nodes.size} nodes)"
        1 -> clickable[0]
        else -> return "ambiguous: ${clickable.size} nodes publish OnClick"
      }
    val config = node.config
    val role = config.getOrNull(SemanticsProperties.Role)?.toString() ?: "none"
    val selected = config.getOrNull(SemanticsProperties.Selected)?.toString() ?: "none"
    val toggle = config.getOrNull(SemanticsProperties.ToggleableState)?.toString() ?: "none"
    val disabled = config.contains(SemanticsProperties.Disabled)
    val label =
      config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
        ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }
        ?: ""
    return "role=$role,selected=$selected,toggle=$toggle,disabled=$disabled," +
      "clickable=${config.contains(SemanticsActions.OnClick)},label=$label"
  }

  /** The Compose view under [root]: `AndroidComposeView` implements [RootForTest]. */
  private fun findComposeRoot(root: View): RootForTest? {
    val queue = ArrayDeque<View>()
    queue.add(root)
    while (queue.isNotEmpty()) {
      val node = queue.removeFirst()
      if (node is RootForTest) {
        return node
      }
      if (node is ViewGroup) {
        for (index in 0 until node.childCount) {
          queue.add(node.getChildAt(index))
        }
      }
    }
    return null
  }

  // MARK: - Pixel probe

  /** Samples the control's pixels on the UI thread and returns at once. */
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
