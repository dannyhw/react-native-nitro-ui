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

/*
 * The IconButton component: Material 3's four icon buttons and their four toggle
 * forms, on the core runtime.
 *
 * Two siblings meet here, because that is what the control is
 * (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` C4): the press form is
 * Button's (`HybridNitroUiButton.kt`: a control whose *size* comes from its props,
 * a glyph drawn through G19's path) and the toggle form is Chip's
 * (`HybridNitroUiChip.kt`: the event-count handshake, and a semantics node a test
 * can read). What is new is the size ladder: a rung here is one of Material's own
 * `IconButtonDefaults` container tokens, so the numbers are Material's and not
 * this file's - the same rule D43 spells out for the glyphs.
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/**
 * The four looks, named after the M3 components they are (`IconButton` /
 * `FilledIconButton` / `FilledTonalIconButton` / `OutlinedIconButton`).
 *
 * `tintRole` is Button's rule: a tint replaces the container where there is one,
 * and the label where the container is transparent by design.
 */
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

/**
 * The five rungs, and which M3 icon-button tokens the container, the glyph and the
 * corner are read from.
 *
 * The names are the library's, the numbers are Material's (D42 item 4): this
 * ladder's rungs *are* Material's XS / S / M / L / XL icon-button tokens, which is
 * how `Button`'s ladder and this one agree on what `large` means.
 */
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
   * The container token: what the control's own box is asked to be.
   *
   * A `DpSize`, not a square - Material's own table gives each rung a height and
   * then three widths for it (`Q9` C4's table), so `narrow` costs width and never
   * height. `docs/components/icon-button.md` prints the measured grid.
   *
   * It has to be asked for on the control's own modifier: each of the eight
   * composables below already applies `IconButtonDefaults.smallContainerSize()` to
   * its own Box, and a size asked for inside that is coerced into it. See
   * [Component]'s `controlModifier`.
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

  /** The glyph token for the rung - the ladder sizes the art, never the file. */
  fun iconSize(): Dp =
    when (this) {
      Small -> IconButtonDefaults.extraSmallIconSize
      Medium -> IconButtonDefaults.smallIconSize
      Large -> IconButtonDefaults.mediumIconSize
      XLarge -> IconButtonDefaults.largeIconSize
      XXLarge -> IconButtonDefaults.extraLargeIconSize
    }

  /** The resting corner, for `shape="round"`. */
  @Composable
  fun roundShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallRoundShape
      Medium -> IconButtonDefaults.smallRoundShape
      Large -> IconButtonDefaults.mediumRoundShape
      XLarge -> IconButtonDefaults.largeRoundShape
      XXLarge -> IconButtonDefaults.extraLargeRoundShape
    }

  /** The resting corner, for `shape="square"`. */
  @Composable
  fun squareShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallSquareShape
      Medium -> IconButtonDefaults.smallSquareShape
      Large -> IconButtonDefaults.mediumSquareShape
      XLarge -> IconButtonDefaults.largeSquareShape
      XXLarge -> IconButtonDefaults.extraLargeSquareShape
    }

  /** The corner the control morphs to while pressed - the theme's, not this file's. */
  @Composable
  fun pressedShape(): Shape =
    when (this) {
      Small -> IconButtonDefaults.extraSmallPressedShape
      Medium -> IconButtonDefaults.smallPressedShape
      Large -> IconButtonDefaults.mediumPressedShape
      XLarge -> IconButtonDefaults.largePressedShape
      XXLarge -> IconButtonDefaults.extraLargePressedShape
    }

  /** The corner a *selected* toggle draws with - Material's Expressive answer. */
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

/**
 * Material's three width options for a rung.
 *
 * `width` is part of the size configuration on both platforms and *acts* on one:
 * iOS has no counterpart (`HybridNitroUiIconButton.swift`), and the docs page says
 * so where the ladder is documented.
 */
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

/** The corner vocabulary, shared with `Button.shape`. */
internal enum class IconButtonCorner(val wireName: String) {
  Round("round"),
  Square("square"),
  ;

  companion object {
    /** The corner for a wire string; anything unrecognised is `round`. */
    fun from(value: String): IconButtonCorner = entries.firstOrNull { it.wireName == value } ?: Round
  }
}

/** What one IconButton is showing. */
internal class IconButtonModel : NitroUiModel() {
  /** The control's only name, put on the button's own node (never the container). */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /** Which M3 component to compose. */
  var variant by mutableStateOf(IconButtonVariant.Standard)

  /** What a toggle shows. Snapshot-observed, so writing it recomposes. */
  var displayed by mutableStateOf(false)

  /**
   * Whether the control is a toggle at all. Observed: it decides which composable is
   * composed. Written from `defaultChecked != null` in `afterUpdate()`, never by a
   * prop setter, so that the form can be switched off as well as on.
   */
  var isToggle by mutableStateOf(false)

  /** `!disabled`, spelled positively for M3. */
  var enabled by mutableStateOf(true)

  /** The rung. Observed: it is the box and the glyph size. */
  var scale by mutableStateOf(IconButtonScale.Medium)

  /** The width option. Observed: on Android it is half the box. */
  var width by mutableStateOf(IconButtonWidth.Uniform)

  /** The corner. Observed: a paint, so nothing measures it. */
  var corner by mutableStateOf(IconButtonCorner.Round)

  /** The tint (`processColor`'s ARGB int), or `null` for the scheme's own roles. */
  var tintColor by mutableStateOf<Int?>(null)

  /**
   * The SF Symbol name. Ignored on Android, as a Button's is: each platform draws
   * its own glyph and a caller names both on one control.
   */
  var systemImage: String? = null

  /** Stored, not observed: [androidIconContent] is what draws, and it is observed. */
  var androidIcon: String? = null

  /**
   * Everything derived from [androidIcon], on G19's slot: the same rules as the
   * Button's (resolve from `afterUpdate`, a file reserves its slot before it
   * arrives, a recycled control cannot be painted by its previous owner's load).
   */
  val iconSlot = NitroUiIconSlot()

  /** What the composition draws. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  /** Apply [androidIcon] if it is not what [androidIconContent] already is. */
  fun resolveAndroidIcon(artwork: NitroUiIconArtwork) {
    iconSlot.resolve(androidIcon, artwork)
  }

  /** The size configuration React sent; the engine reads it out of Fabric state. */
  var sizingKey = ""

  /** Event-count handshake. Not observed: it drives [displayed], never renders. */
  val state = NitroUiControlledValue<Boolean>(false)

  var defaultChecked: Boolean? = null
  var didApplyDefault = false

  var onCheckedChange: ((Boolean, Double) -> Unit)? = null
  var onPress: (() -> Unit)? = null

  /** Test-only read-outs (`nuiTestStateReport`), behind one lock. */
  private val reportLock = Any()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"

  /** Record what the composable was handed. Plain storage, never observed. */
  fun recordDrawn(value: String) {
    synchronized(reportLock) { drawn = value }
  }

  fun recordAccessibility(report: String) {
    synchronized(reportLock) {
      probes += 1
      accessibilityReport = report
    }
  }

  /** `displayed=<0|1|none>;probes=<n>;a11y=<...>`. Safe from any thread. */
  fun stateReport(): String =
    synchronized(reportLock) { "displayed=$drawn;probes=$probes;a11y=$accessibilityReport" }

  /**
   * What the last `nuiTestPixelProbe` saw, as one line, or empty before the first.
   *
   * Plain rather than observed - nothing may recompose because a test reading
   * moved - and stored behind a lock because the probe is posted to the main thread
   * while `nuiTestPixelReport` answers from whichever thread Nitro called it on
   * (Button's shape, including the `n=` prefix that lets a harness tell its own
   * answer from the previous control's).
   */
  var pixelReport = ""
    private set

  private val pixelReportLock = Any()

  /** How many probes have reported, under [pixelReportLock]. */
  private var pixelProbes = 0

  /** Store what a probe found, numbered. Safe from any thread. */
  fun publishPixelReport(report: String) {
    synchronized(pixelReportLock) {
      pixelProbes += 1
      pixelReport = "n=$pixelProbes $report"
    }
  }

  /** The last published probe, or empty before the first one. */
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
    // The reset the brief asks for: a recycled control that still held its
    // previous owner's parsed glyph would draw it before the new one resolved.
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
 * The colours of one variant, served by a per-scheme cache.
 *
 * The untinted path is already memoised inside Material (a no-argument
 * `*IconButtonColors()` reads a cached field), so the only allocation here is ours:
 * the tinted set, which without a cache is one object per recomposition on the path
 * the `update` bench scenario exercises. `docs/architecture/core.md` ("Shared
 * objects") is why it is a cache and not a `remember`: a hosted control is its own
 * composition, so nothing is shared between two of them.
 */
private class VariantColorCache<Value : Any> {
  private companion object {
    /** Tinted sets to remember before starting over (Button's cap, Button's reason). */
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

private val PressColors = VariantColorCache<IconButtonColors>()
private val ToggleColors = VariantColorCache<IconToggleButtonColors>()

/**
 * The press form's colours for [tint] (an ARGB int, or `null` for the scheme's).
 *
 * `internal` and not `private` because the Stepper composes its two halves out of
 * them (`HybridNitroUiStepper.kt`): Android has no stepper control (D38 item 1), and
 * that brief says the composition reuses IconButton's colours, container and touch
 * target rather than carrying a second copy of them - a second copy is two controls
 * that drift, which is also why [iconButtonShapes] is shared.
 */
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

/** The toggle form's colours, including the *checked* pair a toggle needs. */
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
      // Both containers: a tinted toggle that went back to the scheme's colour the
      // moment it was switched on would read as two different controls.
      base.copy(containerColor = color, checkedContainerColor = color)
    } else {
      base.copy(contentColor = color, checkedContentColor = color)
    }
  ToggleColors.put(scheme, variant, tint, built)
  return built
}

/**
 * The corners of one rung, cached per (motion scheme, rung, corner, form).
 *
 * `shapes()` and `toggleableShapes()` are composable reads of the theme that build
 * two `Shape` objects and a holder each time; Button caches its shapes for the same
 * reason (`ButtonShapesCache`), and a screen of icon buttons recomposes all of them
 * on every theme touch.
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

/**
 * The press form's `shapes` overload for the rung and corner. Shared with the Stepper
 * for [iconButtonColors]'s reason.
 */
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

/** The toggle form's `shapes` overload, which also carries the selected corner. */
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

/**
 * The `outlined` variant's hairline, in the control's own tint if it has one.
 *
 * The *width* always comes from Material's own default border, so a tinted outline
 * is one colour different from an untinted one and nothing else.
 */
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
 * The chain one icon-button half is laid out with: the platform's minimum interactive
 * size *outside* the rung's container token, in that order.
 *
 * The order is not a style choice. `Modifier.size(40.dp)
 * .minimumInteractiveComponentSize()` cannot grow past what the child asked for, so a
 * 40 dp container swapped this way stops being a 48 dp touch target.
 *
 * Shared with the Stepper (`HybridNitroUiStepper.kt`), whose Android half is two of
 * these - Material has no stepper control (D38 item 1), and its brief asks for
 * IconButton's container, colours and touch target rather than a second copy.
 */
@Composable
internal fun nitroUiIconButtonContainer(
  scale: IconButtonScale,
  width: IconButtonWidth,
  leading: Modifier = Modifier,
): Modifier = leading.minimumInteractiveComponentSize().size(scale.containerSize(width))

/**
 * The hairline width Material strokes an outlined icon button with, used only when
 * Material's own default border cannot be read - which it can, in practice, so this
 * is a fall-back for an API change rather than a number the control draws with.
 */
private val NITRO_UI_OUTLINED_BORDER_WIDTH = 1.dp

private class IconButtonHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: IconButtonModel,
) : NitroComposeHost<IconButtonModel>(context, activity, model) {
  /** The platform's own answer to "can a reader receive events right now?". */
  private val systemAccessibility = context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one - the
   * Chip and Slider hosts' guard, for their reason: `nuiTestProbeAccessibility`
   * forces Compose's semantics on with no reader connected, and an announcement
   * with no recipient throws `Accessibility off. Did you forget to check that?`.
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

  /**
   * One press, through the path a tap takes - M3's `onClick`/`onCheckedChange`, and
   * the `nuiTestPress` harness hook - so the two cannot disagree about what a press
   * means. Refused while disabled, as M3 refuses the tap.
   */
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

  /**
   * The user's flip. Native is optimistic: show the new value now, before React has
   * seen the event, so there is no visual latency (§4).
   *
   * No size-report hold (Chip has one): a selected icon button changes its corner,
   * its colours and its border, and none of those is a layout input - which is what
   * `IconButtonsKeepOneBoxAcrossStates` measures rather than assumes.
   */
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
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the control is handed rather than what React sent.
    model.recordDrawn(if (toggle) (if (selected) "1" else "0") else "none")
    val label = model.accessibilityLabel
    // The name goes on the control, which is the node TalkBack focuses. On the
    // container instead, the empty box becomes a second focus stop and the button
    // announces itself nameless - which for this control is fatal, since a name is
    // all it has.
    val labelModifier =
      if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    val enabled = model.enabled
    val tint = model.tintColor
    val scale = model.scale
    val corner = model.corner
    val glyphSize = scale.iconSize()
    // The rung goes on the *control's* modifier, not inside its content, and that
    // placement is not a style choice: each of these eight composables builds its Box
    // as `modifier.minimumInteractiveComponentSize().size(IconButtonDefaults.
    // smallContainerSize())` (read off the artifact's bytecode), so a container asked
    // for *inside* the content is measured under the `small` token's constraints —
    // and `Modifier.size` coerces into the constraints it is given, so all five rungs
    // come back 48 x 48. The first device run measured exactly that:
    // `small narrow=48.00x48.00 … xxlarge wide=48.00x48.00`.
    //
    // The caller's modifier is the outermost of the chain, so the order inside it
    // stays Material's own: the minimum interactive size *outside* the container
    // token, so a 40 dp control is still a 48 dp target while the painted container
    // stays the token. Swapping the two would clip the target — `Modifier.size(40.dp)
    // .minimumInteractiveComponentSize()` cannot grow past what the child asked for.
    val controlModifier = nitroUiIconButtonContainer(scale, model.width, labelModifier)
    val content: @Composable () -> Unit = {
      // The glyph alone: the composable's own Box centres its content, and the
      // container's size and shape are the composable's business now.
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

/** The Hybrid View React renders as `NitroUiIconButton`. */
class HybridNitroUiIconButton(
  reactContext: ThemedReactContext,
) : HybridNitroUiIconButtonSpec(),
  RecyclableView {
  private val model = IconButtonModel()
  private val host = IconButtonHost(reactContext, reactContext.currentActivity, model)

  /**
   * The control's half of icon resolution: the app's resources and the shared file
   * cache, bound to this control's `Context`. Held rather than built per commit -
   * a prop commit is not a place to allocate (G19's rule).
   */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    declareFallback()
  }

  companion object {
    /** This component's name in the sizing engine (`getName()` in the generated manager). */
    private const val SIZING_COMPONENT_NAME = "NitroUiIconButton"

    /**
     * The size to lay an IconButton out with before anything has been measured, in
     * dp: Material's `MinimumInteractiveComponentSize` (48 dp), which is the laid-out
     * box of the two smallest rungs at any width and of a `large` control's narrow
     * option. It is *not* the smallest container - the container is the rung's token,
     * and Material puts a 48 dp target around anything smaller - and a fallback
     * smaller than the target costs every row on a cold first frame.
     */
    private const val FALLBACK_SIZE_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /** One `JNI` call per process; `NitroUiDeclaredFallbacks` calls it at package init. */
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
      // Rendered (it is the node's name), and never a measure: an empty name is
      // still the same box.
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
      // Only stored: resolving a resource reads a `synchronized` table and a file
      // load opens a socket, and a setter may run for every prop of the commit.
      // `afterUpdate()` resolves it once (G19's rule).
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
      // The rung is the box. Compose observes it and its own measure pass reports
      // the new size, so no extra "the size may have moved" call is needed here
      // (sizing.md §5 - the difference from the iOS half).
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
      // `processColor` on Android hands back the ARGB int as a double; going via
      // `toLong()` keeps the bit pattern (D10), which `Double.toInt()` would
      // saturate for an opaque colour above `Int.MAX_VALUE` (Button's note).
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
      // Not visual on its own: `displayed` follows once the event count says JS has
      // caught up. See `afterUpdate()`. Not a form signal either: `afterUpdate()`
      // re-reads the form from `defaultChecked` on every batch, which is the only
      // reading that also says the caller has *stopped* using the toggle form.
      model.state.js = value
    }

  override var defaultChecked: Variant_Boolean_NullType
    get() =
      model.defaultChecked?.let { Variant_Boolean_NullType.First(it) }
        ?: Variant_Boolean_NullType.Second(NullType.NULL)
    set(next) {
      val seed = next.asFirstOrNull()
      model.defaultChecked = seed
      // The form itself is decided in `afterUpdate()`, from this value: a `null`
      // here is the signal that the caller has stopped using the toggle form, and
      // only `afterUpdate()` can act on it without racing the other setter.
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
    // The host's tag, which is what RN's testID matchers read on Android - Button's
    // answer, and the reason the prop exists on this platform at all.
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
      // A new configuration may measure what the old one did; the host must not
      // swallow that report against its dedupe.
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
    // The icon first, if it changed: a resource resolved here is drawn in this
    // commit, and a file that has to be read reserves its slot in this commit and
    // fills it later (G19's rule, and AGENTS' perf contract).
    model.resolveAndroidIcon(iconArtwork)
    // The form, re-read every batch.
    //
    // `defaultChecked` is non-null exactly when the wrapper is in the toggle form
    // (`IconButton.tsx`: `defaultChecked={isToggle ? controlled.defaultValue :
    // null}`, and `useControlled` answers a `Boolean` for `defaultValue` in that
    // form, never `null`), so it is a signal that goes both ways. Reading it here
    // rather than latching `isToggle = true` in a setter is what makes the form
    // *switchable off*: a control that used `onCheckedChange` and now passes only
    // `onPress` has to compose a press button again, and a latch could only ever
    // answer "still a toggle". `prepareForRecycle` is not the other half of that
    // story - a form flip is one prop update on a live view.
    //
    // It is observed, so writing it recomposes: the two forms are different
    // composables, and the wrapper puts the form in the size configuration for the
    // same reason.
    val isToggle = model.defaultChecked != null
    if (isToggle != model.isToggle) {
      model.isToggle = isToggle
      if (!isToggle) {
        // The value half belongs to the toggle form. Leaving a selection behind
        // would let a control that returns to the toggle form show a value its
        // previous toggle left there.
        model.state.displayed = false
        model.state.js = null
        model.state.nativeEvents = 0
        model.state.jsEvents = 0
        model.didApplyDefault = false
        model.displayed = false
      }
      host.markDirty()
    }
    // The handshake decides whether React's `checked` wins over what the user just
    // did - including a flip JS refused (§4). The press form has no value to
    // reconcile, so this is a no-op there.
    if (model.state.reconcile()) {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The composition does not survive a recycle (core.md §6), and
    // `host.prepareForRecycle()` resets the model - including the resolved icon -
    // and releases the sizing instance.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onCheckedChange = null
    model.onPress = null
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread (§1.4). */
  override fun measureContent(): NitroUiIconButtonSize {
    val size = host.contentSize ?: return NitroUiIconButtonSize(0.0, 0.0)
    return NitroUiIconButtonSize(size.width, size.height)
  }

  /** Press through the tap's path, on the UI thread (see the spec). Returns at once. */
  override fun nuiTestPress() {
    Handler(Looper.getMainLooper()).post { host.press() }
  }

  /** Read the control's semantics node on the UI thread (see the spec). Returns at once. */
  override fun nuiTestProbeAccessibility() {
    Handler(Looper.getMainLooper()).post { model.recordAccessibility(describeAccessibility()) }
  }

  override fun nuiTestStateReport(): String = model.stateReport()

  /**
   * The merged node a reader is handed for this control, as one line - Chip's shape,
   * so the harness reads one format from either control:
   * `role=<role>,selected=<bool|none>,toggle=<state|none>,disabled=<bool>,clickable=<bool>,label=<text>`.
   *
   * This is how "a toggle's checked state reads in the accessibility tree" is
   * proved on Android: the node is the one M3 gives the toggle, and `ToggleableState`
   * is what TalkBack turns into "selected"/"not selected".
   */
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

  /** The Compose view under [root], as [RootForTest] (the Slider's helper). */
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

  /**
   * Ask whether [color] is among the pixels this control draws, on the UI thread.
   * Returns at once; the answer is for [nuiTestPixelReport].
   *
   * Android is the platform with something to sample: it draws `androidIcon`, and
   * "the glyph is drawn, at this rung, in the control's content colour" is a drawing
   * contract no prop echo answers (G19's Button probe is the sampler).
   */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  /** The last probe's line - see [IconButtonModel.pixelReport]. */
  override fun nuiTestPixelReport(): String = model.readPixelReport()
}
