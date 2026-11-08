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

/**
 * The five rungs, and which Material 3 container height the control's padding,
 * label style and corner are read from.
 *
 * The names are the library's, the numbers are Material's (D42 item 4): the
 * Expressive ladder is indexed by a container height, and Material publishes five
 * of them, so the ladder has five rungs. `small` / `medium` / `large` keep the
 * heights they had; `xlarge` and `xxlarge` are the two taller tokens, which is how
 * Material names its own XS–XL button row lines up with this one:
 *
 * | Material | XS | S | M | L | XL |
 * | -------- | -- | - | - | - | -- |
 * | nitro-ui | `small` | `medium` | `large` | `xlarge` | `xxlarge` |
 *
 * IconButton (G19) is documented in Material's names because its tokens are
 * Material's own, and this table is the bridge between the two spellings.
 */
internal enum class ButtonScale(val wireName: String) {
  Small("small"),
  Medium("medium"),
  Large("large"),
  XLarge("xlarge"),
  XXLarge("xxlarge");

  companion object {
    /** The scale for a wire string; anything unrecognised is `medium`. */
    fun from(value: String): ButtonScale = entries.firstOrNull { it.wireName == value } ?: Medium
  }

  /**
   * The control's height: Material 3's own XS / S / M container-height tokens.
   *
   * The three public names stay `small` / `medium` / `large` and now *mean* M3's
   * three smallest button heights (32 / 40 / 56 dp) rather than three sets of
   * hand-rolled padding. Every other number in this file hangs off this one -
   * `ButtonDefaults.contentPaddingFor`, `textStyleFor`, `shapesFor` and the
   * connected button group all take a height, which is why the ladder is
   * expressible at all (Q8 Appendix A row 2).
   *
   * This is the height the *tokens* are indexed by, not the height the box is
   * given: nothing here sets a height on the composable, because Material 3 lays
   * a button out at [MinTouchTargetHeight] or taller whatever its container token
   * says. Requesting `height(32.dp)` instead would measure what Q8 predicted
   * (57.9x32.0 for `small`) and take the touch target down with it, so the
   * Expressive ladder is what moves here and the 48 dp target is what stays
   * (`docs/components/button.md`, "Sizing").
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
   * The height the box is actually laid out at: the container token, never below
   * the touch target. Measured on the API 35 emulator: 48.0 / 48.0 / 56.0 dp.
   *
   * The corner is read from *this*, not from [height] - a radius belongs to the
   * box that is drawn, and a 48 dp pill with a 32 dp corner is two designs.
   */
  val layoutHeight: Dp
    get() = if (height > MinTouchTargetHeight) height else MinTouchTargetHeight
}

/**
 * Material 3's own minimum interactive component size, in dp.
 *
 * Material applies it inside `Button`, which is why no height on our side is
 * needed to keep a `small` Button hittable at 48 dp; it is named here so the
 * corner and the JVM test can say the same number as the framework does.
 */
internal val MinTouchTargetHeight = 48.dp

/**
 * The `shape` prop: which pair of corners the button draws, and which pair it
 * morphs *from* while pressed.
 *
 * Material 3 Expressive morphs a button's shape as it is pressed, so the prop
 * picks the resting shape and Material supplies the other end of the morph:
 * `round` rests on the height's own shape and presses toward
 * [ButtonDefaults.squareShape], `square` rests square and presses toward the
 * rounded one. iOS has no cornerless button, so there the same value maps to
 * `.roundedRectangle(radius: 8)` and does not morph
 * (`docs/components/button.md`).
 */
internal enum class ButtonShape(val wireName: String) {
  Round("round"),
  Square("square");

  companion object {
    /** The shape for a wire string; anything unrecognised is `round`. */
    fun from(value: String): ButtonShape = entries.firstOrNull { it.wireName == value } ?: Round
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

  /** The resting corner, and therefore the direction of the press morph. */
  var shape by mutableStateOf(ButtonShape.Round)

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
   * The icon React asked for, verbatim: a resource name, or a `url:` string for a
   * file to read (`NitroUiIconSource`).
   *
   * The wire form is kept rather than the parsed source because it is what
   * `hybridRef` reports back and what a test compares against the string the
   * wrapper built; [iconSlot] holds the parsed half.
   */
  var androidIcon: String? = null

  /**
   * Everything derived from [androidIcon], shared with `Menu`'s trigger.
   *
   * The rules live in [NitroUiIconSlot]: resolve once per change from
   * `afterUpdate()`, reserve a file's slot before the bytes arrive, retire an answer
   * whose generation has moved, and treat unresolvable artwork as no icon at all.
   * Read it here as a property because the composition reads *this* model, and the
   * state behind it is observed — so a glyph arriving is a recomposition of this
   * control and nothing else.
   */
  val iconSlot = NitroUiIconSlot()

  /** What the composition lays the label next to. Observed, through [iconSlot]. */
  val androidIconContent: NitroUiIconContent
    get() = iconSlot.content

  /** Apply [androidIcon] if it is not what [androidIconContent] already is. */
  fun resolveAndroidIcon(
    artwork: NitroUiIconArtwork,
  ) {
    iconSlot.resolve(androidIcon, artwork)
  }

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

  /**
   * What the last `nuiTestPixelProbe` saw, as one line, or empty before the first.
   *
   * Plain rather than observed - nothing may recompose because a test reading moved -
   * and stored behind a lock because the probe is posted to the main thread while
   * `nuiTestPixelReport` answers from whichever thread Nitro called it on. The `n=`
   * prefix counts probes, which is the only way a harness can tell its own answer
   * from the previous control's. Cleared with everything else: a recycled Button that
   * still reported another owner's pixels would let a test credit a hit that is not
   * its control's.
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
 * `internal`, not `private`, because `HybridNitroUiMenu.kt` builds its trigger from
 * the same three helpers ([buttonColors], [ButtonLabelStyles], [contentPaddingFor]):
 * a Menu's box is documented to *be* a Button's box, and a second copy of these
 * numbers is how that sentence stops being true.
 *
 * The tint replaces only what [tintRole] says: the container for the three filled
 * variants, the label (and the border that follows it) for `outlined` and `text`,
 * whose container is transparent by design. Everything else keeps the M3 role
 * colours, which is the same trade the Switch's `tintColor` makes.
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

/**
 * The label style of one scale, served per `Typography` identity.
 *
 * `small` and `medium` are the theme's own `labelMedium` / `labelLarge`, so they
 * cost a field read. Only `large` derives anything (`labelLarge` at 18 sp), and
 * that copy happens once per theme rather than per recomposition - the same rule
 * as [ButtonColorsCache]: an object derived from the theme is shared, not built
 * inline in the composable.
 */
/**
 * The label style of one scale, served per `Typography` identity.
 *
 * The style is Material 3's own for the scale's height - `textStyleFor` is a
 * composable read of the theme, so the *miss* has to be computed in the
 * composable and stored here, exactly as [ButtonColorsCache] does for colours.
 * Building it inline instead would be one `TextStyle` per recomposition per
 * mounted Button, on the path the `update` bench scenario exercises.
 */
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

/**
 * The label style for [scale]: Material's `textStyleFor` for that height,
 * cached per [Typography] by [ButtonLabelStyles].
 *
 * `internal` for the same reason as the three other shared helpers: a Menu's
 * trigger is this Button's box.
 */
@Composable
internal fun buttonLabelStyle(scale: ButtonScale): TextStyle {
  val typography = MaterialTheme.typography
  ButtonLabelStyles.get(typography, scale)?.let { cached -> return cached }
  val built = ButtonDefaults.textStyleFor(scale.height)
  ButtonLabelStyles.put(typography, scale, built)
  return built
}

/**
 * The label's own padding for a variant at [scale].
 *
 * The four contained variants take Material's padding for the scale's height, so
 * padding follows the box instead of being a second, hand-rolled table of the
 * same numbers. `text` does not: material3 1.5.0-beta02 has no height ladder for
 * text buttons (there is no `TextButtonDefaults` in it), and its
 * `TextButtonContentPadding` is 12 dp against the ladder's 24, which is the
 * difference between a text button and a filled one. So `text` keeps Material's
 * own padding at every scale, and its measured width keeps its own shape.
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

/**
 * The resting + pressed shapes for a corner at [scale].
 *
 * [cornerFor] decides the corner before this is called: a caller with a variant
 * resolves it first, so `text` reaches here with [ButtonShape.Round] whatever its
 * prop says and there is no second copy of that rule to forget.
 *
 * [ButtonShape.Round] is Material's own answer for the height - which is already
 * a pair: Expressive morphs it toward [ButtonDefaults.squareShape] while the
 * button is held. [ButtonShape.Square] rests on `squareShape` and morphs the
 * other way, onto the rounded shape, because a press that does not change
 * anything is not the morph the design language asks for.
 *
 * The result is cached per (motion scheme, scale, corner): `shapesFor` is a
 * composable read of the theme, and a hosted control is its own composition, so
 * without a cache every recomposition of every Button builds two `Shape` objects
 * to draw the same corner ([ButtonColorsCache] is the same rule for colours).
 *
 * The cache is keyed by [ButtonScale], not by the height it reads: two rungs share
 * a layout height once the touch target floors them (`small` and `medium` are both
 * 48 dp of box), and a height-keyed slot would put them in the same entry.
 */
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
 * The corner a [variant] actually draws for a requested [shape].
 *
 * `text` has no container: there is no surface to give a corner, so the prop has
 * nothing to act on and the variant rests on Material's own rounded answer - which
 * is also what it drew before the prop existed. It still gets the morph that comes
 * with the round corner, because that belongs to the height, not to the choice.
 * Every other variant draws what it is sent.
 *
 * `internal` and separate from [buttonShapes] so the JVM test can read the table:
 * the corner is the one Button rule here that a device cannot see - a `text`
 * variant paints no container, so a clipped ripple is the only difference, and no
 * screenshot at rest or in the harness can tell one from the other.
 */
internal fun cornerFor(
  variant: ButtonVariant,
  shape: ButtonShape,
): ButtonShape = if (variant == ButtonVariant.Text) ButtonShape.Round else shape

/** The [buttonShapes] store: one motion scheme at a time, [ButtonScale] x [ButtonShape] entries. */
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

  /** The slot for a corner at a rung of the ladder - both are fixed-size enums. */
  private fun index(
    scale: ButtonScale,
    shape: ButtonShape,
  ): Int = scale.ordinal * ButtonShape.entries.size + shape.ordinal
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

  /**
   * A `<Host>` composes this control (H2a). Same line as the Switch's, same JS row.
   *
   * The press is the thing to check here, and it checks out for a reason worth
   * naming: the tap is taken by the *Host's* `AndroidComposeView`, which routes it to
   * the node under the finger - this Button's M3 `clickable` - so `onClick`, the
   * ripple and `model.onPress` all run in the shared composition. What a hosted
   * Button does *not* get is RN's own press handling, because RN never sees the touch
   * (D24: the child's view is laid out at nothing).
   */
  override val isHostable: Boolean
    get() = true

  @Composable
  override fun Component(model: ButtonModel) {
    val label = model.accessibilityLabel
    val press = model.onPress
    // The label goes on the control, which is the node TalkBack focuses (M3 gives
    // it `Role.Button`). On the container instead, the empty box becomes a second
    // focus stop and the button announces itself nameless.
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

/**
 * The five Material 3 button components, drawn from one set of trigger fields.
 *
 * `internal`, not `private`, because `HybridNitroUiMenu.kt` draws its trigger with
 * this: `docs/components/menu.md` says a Menu's box *is* a Button's box, and one
 * composition is what keeps that sentence true as the numbers move. The helpers it
 * is built from ([buttonColors], [buttonLabelStyle], [contentPaddingFor],
 * [buttonShapes]) are `internal` for the same reason.
 *
 * `shape` defaults to [ButtonShape.Round] because a Menu's trigger has no corner of
 * its own to ask for in this pass: it inherits the button's resting shape, and gets
 * the same press morph for free.
 */
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
  // No height is set: the scale picks Material's padding, label style and corner,
  // and Material itself lays the box out at no less than MinTouchTargetHeight, so
  // the ladder reaches down to the XS token (32 dp of padding and type) without
  // shipping a control a thumb cannot hit. Measured box: 48 / 48 / 56 dp.
  val colors = buttonColors(variant, tint)
  // `hasStartIcon` is Material's own input to the padding, and it is the difference
  // between a row of two things and a row of one: the ladder widens the leading
  // edge so the glyph does not sit where the label's own inset used to be. Passing
  // it unconditionally is how an icon and a no-icon Button end up the same width
  // when the name resolves to nothing.
  // `Pending` takes the slot too. That is the point of it: the box the ladder
  // describes is the box the first frame draws, and the glyph arriving later
  // changes what is in the slot and not the size of it.
  val showsGlyph = glyph != ButtonGlyph.TitleOnly && icon != NitroUiIconContent.Absent
  val padding =
    if (!showsGlyph) {
      contentPaddingFor(variant, scale)
    } else {
      ButtonDefaults.contentPaddingFor(scale.height, hasStartIcon = true)
    }
  // The caller's corner wins when it has one: a `ButtonGroup` item is sent the
  // connected leading/middle/trailing shape, which is the group's whole look, and
  // `null` keeps the variant's own (Button's and Menu's trigger's) answer.
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

/**
 * Which half of an item's label to draw: the glyph, the text, or both.
 *
 * The three answers a `ButtonGroup`'s `labelStyle` reduces to on this platform.
 * `ButtonGlyph.Both` is what a `Button` and a Menu's trigger have always drawn, so
 * they pass nothing and see nothing change.
 */
internal enum class ButtonGlyph {
  Both,
  TitleOnly,
  IconOnly,
}

/**
 * The label of a Material 3 button: the icon slot, then the title.
 *
 * Extracted from [NitroUiM3Button] so a `ButtonGroup`'s toggle items - which are
 * `ToggleButton`s and cannot go through [NitroUiM3Button] at all - draw the *same*
 * label as its action items. Two copies of this composition is how a group's
 * buttons and its toggles stop lining up.
 *
 * The glyph goes in the slot Material's `Button` would use, in the one helper
 * Menu's split trigger uses too - [NitroUiIconSlotContent]. It draws the artwork
 * tinted with `LocalContentColor` (not [buttonColors]' resting `contentColor`,
 * which ignores `enabled` and would leave a disabled control's glyph at full
 * strength - the harness's disabled probe catches that), and it paints an empty
 * slot for `Pending`, which is the whole of D43's sizing rule: the box comes from
 * `iconSizeFor(scale)`, the same rung that sets the control's height, so the frame
 * before a dev-server file and the frame after it are one box.
 */
@Composable
internal fun NitroUiButtonLabel(
  title: String,
  scale: ButtonScale,
  icon: NitroUiIconContent,
  glyph: ButtonGlyph = ButtonGlyph.Both,
) {
  if (glyph != ButtonGlyph.TitleOnly && icon != NitroUiIconContent.Absent) {
    NitroUiIconSlotContent(
      icon = icon,
      size = ButtonDefaults.iconSizeFor(scale.height),
      spacing = ButtonDefaults.iconSpacingFor(scale.height),
    )
  }
  if (glyph != ButtonGlyph.IconOnly) {
    // One line, tail-truncated: the control's intrinsic width is the title's
    // width, and a caller who wants a narrower box gives it a `width` - then the
    // label truncates instead of painting outside its box (the iOS content does
    // the same).
    Text(
      text = title,
      style = buttonLabelStyle(scale),
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** The Hybrid View React renders as `NitroUiButton`. */
class HybridNitroUiButton(
  reactContext: ThemedReactContext,
) : HybridNitroUiButtonSpec(), RecyclableView {

  private val model = ButtonModel()
  private val host = ButtonHost(reactContext, reactContext.currentActivity, model)

  /**
   * The control's half of icon resolution: the app's resources and the shared
   * file cache, bound to this control's `Context` ([NitroUiIconArtwork]).
   *
   * Held rather than built per commit — a prop commit is not a place to allocate,
   * and the `Context` it captures is the one [host] already holds.
   */
  private val iconArtwork = NitroUiAppIconArtwork(reactContext)

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
     * Measured on the AVD this library's tests run on (the lease's `nitroui_a`,
     * pixel_9 profile at 420 dpi, API 35), rounded up to the point: with E1's
     * ladder, medium + filled + "Cancel" is 75.05 x 48.0 dp. Sixteen dp of that
     * width is Material's own `contentPaddingFor(40.dp)` replacing this file's
     * older, wider hand-rolled padding; the height stays 48 because Material lays
     * a button out no shorter than its 48 dp minimum interactive component at every
     * size but `large` (56). Guessing 40 wide here would make the first frame of
     * every Button too short and shift the row it sits in.
     * `docs/components/button.md` has the whole table.
     */
    private const val FALLBACK_WIDTH_DP = 75.1
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

  override var shape: String
    get() = model.shape.wireName
    set(next) {
      val resolved = ButtonShape.from(next)
      if (resolved == model.shape) {
        return
      }
      model.shape = resolved
      // A corner is not a layout input, so this repaints without asking for a new
      // measure - the same call `disabled` makes, and the reason `shape` is not in
      // `nuiSizingKey`.
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

  /**
   * `androidIcon`: the icon to draw before the label - an app drawable's resource
   * name, or a `url:` string naming a file to read (G19 fix round 1, D43).
   *
   * Stores and marks dirty, nothing else. Resolving is the expensive half - a
   * resource lookup takes a lock on a shared table, and the file form starts a
   * network read - so it happens once per commit in [afterUpdate], behind
   * [ButtonModel.resolveAndroidIcon]'s comparison, and never in composition, which
   * runs again for reasons that have nothing to do with icons.
   *
   * The string is stored as React sent it. The wrapper has already normalised a
   * name and marked a URL ([NitroUiIconSource] reads the marker), and the getter is
   * what `hybridRef` reports back - a harness comparing it against the string it
   * built wants the answer verbatim, not a third spelling of it.
   */
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
    // The icon first, if it changed: a resource resolved here is drawn in this
    // commit, and a file that has to be read reserves its slot in this commit and
    // fills it later. Both are cheaper here than in the setter, which may run for
    // every prop of the commit (AGENTS' perf contract).
    model.resolveAndroidIcon(iconArtwork)
    // No controlled value, so nothing to reconcile: one commit per React commit
    // (`docs/architecture/core.md` §12).
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // `host.perfInstanceId` is cleared inside `host.prepareForRecycle()`, after it has
    // marked the recycle: clearing it here would hide that mark.
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

  /**
   * Sample what this Button is drawing for [color], and store the answer.
   *
   * Posted rather than run inline: reading pixels needs the view drawn, and a Nitro
   * method may not block for the UI thread. Same shape as SegmentedControl's pair and
   * the same sampler (`nitroUiSamplePixels`), so the harness reads one report format
   * from either control.
   */
  override fun nuiTestPixelProbe(color: Double) {
    val run = { model.publishPixelReport(host.nitroUiSamplePixels(color)) }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run()
    } else {
      host.post { run() }
    }
  }

  /** The last probe's line - see [ButtonModel.pixelReport]. */
  override fun nuiTestPixelReport(): String = model.readPixelReport()
}
