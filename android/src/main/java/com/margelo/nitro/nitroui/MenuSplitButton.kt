package com.margelo.nitro.nitroui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.SplitButtonDefaults
import androidx.compose.material3.SplitButtonLayout
import androidx.compose.material3.SplitButtonShapes
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The Menu's split trigger: what Material 3 Expressive draws when a menu has both a
 * primary action and a list (`docs/components/menu.md`, DECISIONS D29 as E3 lifts it).
 *
 * `SplitButtonLayout(leadingButton, trailingButton)` is Material's own split button
 * (material3 1.5.0-beta02). It needs no `@ExperimentalMaterial3ExpressiveApi` opt-in -
 * Q8 Appendix C row 2 checked that against the AAR's annotations, and D39 is what makes
 * a beta02-only control buildable at all. The leading half runs `primaryAction`; the
 * trailing half is Material's *checked* button, whose `checked` is the menu's open state,
 * so Material morphs its inner corner to full for as long as the list is up.
 *
 * Both halves are sized by E1's `ButtonScale` ladder and painted with the trigger's own
 * variant colours, so a Menu that grows a second half is still the same design as the
 * Button beside it.
 */

/**
 * The trailing half's accessibility label.
 *
 * The library bundles no icon set and no string catalogue (DECISIONS D40 item 2), and
 * this half has no text of its own to be read - only a chevron - so its name is written
 * here. It says what the half does, which is what a reader needs: the title belongs to
 * the leading half, and the rows are in a window of their own.
 */
internal const val MENU_MORE_OPTIONS_LABEL = "More options"

/**
 * Which of Material's four split-button sets a [ButtonVariant] draws.
 *
 * `text` has nothing to map to: a split button is two containers, and the text variant
 * has none. It resolves to [Outlined], colours and hairline included, so a
 * `variant="text"` Menu changes looks the moment a `primaryAction` arrives - which
 * `docs/components/menu.md` documents rather than hides. The mapping is one function
 * with a JVM test (`MenuSplitButtonTest.kt`), because a `when` branch inside the
 * composable is the shape that gets forgotten when a sixth variant arrives.
 */
internal enum class MenuSplitVariant(
  /** The variant whose colours and border this set draws. */
  val button: ButtonVariant
) {
  Filled(ButtonVariant.Filled),
  Tonal(ButtonVariant.Tonal),
  Outlined(ButtonVariant.Outlined),
  Elevated(ButtonVariant.Elevated),
  ;

  companion object {
    /** The split-button set for a trigger variant. See the class comment for `text`. */
    fun of(variant: ButtonVariant): MenuSplitVariant =
      when (variant) {
        ButtonVariant.Filled -> Filled
        ButtonVariant.Tonal -> Tonal
        ButtonVariant.Outlined -> Outlined
        ButtonVariant.Text -> Outlined
        ButtonVariant.Elevated -> Elevated
      }
  }
}

/**
 * The chevron of the trailing half.
 *
 * The geometry of Material's `Icons.Filled.ExpandMore` (Apache 2.0, the 24-unit
 * viewport), written out because this library does not depend on `material-icons-core`
 * for one glyph - the same decision [ChipLeadingCheck] records for the chip's check, and
 * the reason `MenuRows.kt` writes its own. Built once per process and shared: a hosted
 * control is its own composition, and `remember` cannot share anything between two of
 * them (`docs/architecture/core.md`, "Shared objects").
 */
private val MenuChevronIcon: ImageVector by lazy {
  ImageVector.Builder(
    name = "NitroUiMenuChevron",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
  ).path(fill = SolidColor(ComposeColor.Black)) {
    moveTo(16.59f, 8.59f)
    lineTo(12f, 13.17f)
    lineTo(7.41f, 8.59f)
    lineTo(6f, 10f)
    lineToRelative(6f, 6f)
    lineToRelative(6f, -6f)
    close()
  }.build()
}

/** [splitButtonShapes]' store: one motion scheme and one rung at a time. */
private object SplitButtonShapesCache {
  private var motion: MotionScheme? = null
  private var scale: ButtonScale? = null
  private var leading: SplitButtonShapes? = null
  private var trailing: SplitButtonShapes? = null

  @Synchronized
  fun get(
    motion: MotionScheme,
    scale: ButtonScale,
  ): Pair<SplitButtonShapes, SplitButtonShapes>? {
    if (this.motion !== motion || this.scale != scale) {
      return null
    }
    val leading = this.leading
    val trailing = this.trailing
    return if (leading != null && trailing != null) leading to trailing else null
  }

  @Synchronized
  fun put(
    motion: MotionScheme,
    scale: ButtonScale,
    leading: SplitButtonShapes,
    trailing: SplitButtonShapes,
  ) {
    this.motion = motion
    this.scale = scale
    this.leading = leading
    this.trailing = trailing
  }

  @Synchronized
  fun clear() {
    motion = null
    scale = null
    leading = null
    trailing = null
  }
}

/**
 * The resting / pressed / checked corners of both halves at [scale].
 *
 * `SplitButtonDefaults` has a height ladder of its own - `leadingButtonShapesFor` and
 * `trailingButtonShapesFor` index an inner-corner size by the button's height - and the
 * split button reads *that* ladder rather than [buttonShapes]: a split button's corner is
 * a pair (each half's outer corner plus the shared inner one), and Material derives the
 * pair from the height the same way E1's ladder derives a single one. The height read is
 * [ButtonScale.layoutHeight] - the box actually drawn, never below the 48 dp touch
 * target - the same number [buttonShapes] reads, so the two triggers of one Menu agree on
 * which rung they are on. `docs/components/menu.md` carries the mapping.
 *
 * Cached per (motion scheme, scale) for the reason [ButtonShapesCache] gives: these are
 * composable reads of the theme, and a hosted control is its own composition, so an
 * uncached call builds four `Shape` objects per recomposition of every mounted split
 * button. Keyed by the scale rather than the height, because two rungs share a layout
 * height once the touch target floors them.
 */
@Composable
private fun splitButtonShapes(scale: ButtonScale): Pair<SplitButtonShapes, SplitButtonShapes> {
  val motion = MaterialTheme.motionScheme
  SplitButtonShapesCache.get(motion, scale)?.let { cached -> return cached }
  val height = scale.layoutHeight
  val leading = SplitButtonDefaults.leadingButtonShapesFor(height)
  val trailing = SplitButtonDefaults.trailingButtonShapesFor(height)
  SplitButtonShapesCache.put(motion, scale, leading, trailing)
  return leading to trailing
}

/**
 * The split-button trigger: `primaryAction` on the left half, the list on the right.
 *
 * [modifier] carries the anchor's `onGloballyPositioned` - the same layout callback that
 * files the control's box with [MenuModel.noteAnchorBox], because the popup still has to
 * agree with a box React Native moves (`docs/components/host.md`) and that box is now the
 * split button's rather than one button's.
 *
 * Where [popup] is composed *is* the anchor question. A Compose `Popup` is positioned
 * against the layout it is composed in - which is why E2 put the list in a `Box` whose
 * only measured child is the trigger - so composing it inside the trailing half's box is
 * what puts the list under the half that opens it. No offset arithmetic, no second
 * anchor, and the popup window still hangs off this composition, which is what lets a
 * layout move or a dispose take it down (`MenuWitness`).
 */
@Composable
internal fun MenuSplitButton(
  model: MenuModel,
  popup: @Composable () -> Unit,
  modifier: Modifier = Modifier,
) {
  val split = MenuSplitVariant.of(model.variant)
  val scale = model.scale
  val enabled = model.enabled
  val expanded = model.expanded
  val title = model.title
  // The leading half's name: an explicit `accessibilityLabel`, else the visible title -
  // the same rule the plain trigger follows, applied to the half that shows the title.
  val spokenLabel = model.accessibilityLabel ?: title
  // The variant's colours, from the trigger's own helper: `tintColor` lands on the
  // container for the three filled sets and on the label (with the hairline that follows
  // it) for `outlined`, which is what the same prop does to the plain trigger. For `text`
  // these are the *outlined* set's colours - see [MenuSplitVariant].
  val colors = buttonColors(split.button, model.tintColor)
  val (leadingShapes, trailingShapes) = splitButtonShapes(scale)
  // Material's own padding and icon-size ladders, read at the same rung as the corners.
  // These two are plain functions of the height, so `remember` keys on the scale alone.
  val leadingPadding =
    remember(scale) {
      SplitButtonDefaults.leadingButtonContentPaddingFor(scale.height)
    }
  val trailingPadding =
    remember(scale) {
      SplitButtonDefaults.trailingButtonContentPaddingFor(scale.height)
    }
  val chevronSize: Dp = remember(scale) { SplitButtonDefaults.trailingButtonIconSizeFor(scale.height) }
  val labelStyle = buttonLabelStyle(scale)
  // The chevron turns as Material's own split-button sample does: half a turn while the
  // list is up, on the theme's effects spec so the spring belongs to the motion scheme
  // (X18's) rather than to a duration written here.
  val rotation by
    animateFloatAsState(
      targetValue = if (expanded) 180f else 0f,
      animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
      label = "nitroUiMenuChevron",
    )

  // The witness: this composition drew a split button. Cleared on dispose, so a control
  // that stops having a `primaryAction` - or one that goes through the pool - cannot
  // leave `split=1` for the next owner to be measured against. It is deliberately a
  // different claim from `hasPrimaryAction`: that is what JS sent, this is what Android
  // composed, and the harness asserts both halves of "the trigger is a split button".
  DisposableEffect(model) {
    model.noteSplitDrawn(true)
    onDispose {
      model.noteSplitDrawn(false)
      model.clearSplitBoxes()
    }
  }

  // Material switches the minimum interactive component size *off* inside the halves and
  // says so: "Enforce it on the parent instead" (`SplitButton.kt`). Its parent's
  // enforcement only expands the outer box, so left alone both halves rest at the rung's
  // own container height - 40 dp at `small` and `medium` - inside a 48 dp box, and a
  // split trigger would sit visibly shorter than the plain trigger it replaces. The floor
  // is therefore enforced on the halves, at [ButtonScale.layoutHeight], which is E1's rule
  // spelled the other way round: the box is the touch target, and the containers fill it.
  SplitButtonLayout(
    modifier = modifier.heightIn(min = scale.layoutHeight),
    leadingButton = {
      val leadingModifier = halfModifier(model, spokenLabel, title, leading = true, enabled = enabled)
      val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
        // One line, tail-truncated, exactly as `NitroUiM3Button` draws its label: the
        // half's intrinsic width is the title's, and a caller who gives the control a
        // narrower box truncates the title rather than painting outside it.
        Text(text = title, style = labelStyle, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      when (split) {
        MenuSplitVariant.Filled ->
          SplitButtonDefaults.LeadingButton(
            onClick = { model.applyPrimaryAction() },
            modifier = leadingModifier,
            enabled = enabled,
            shapes = leadingShapes,
            colors = colors,
            contentPadding = leadingPadding,
            content = content,
          )
        MenuSplitVariant.Tonal ->
          SplitButtonDefaults.TonalLeadingButton(
            onClick = { model.applyPrimaryAction() },
            modifier = leadingModifier,
            enabled = enabled,
            shapes = leadingShapes,
            colors = colors,
            contentPadding = leadingPadding,
            content = content,
          )
        MenuSplitVariant.Outlined ->
          SplitButtonDefaults.OutlinedLeadingButton(
            onClick = { model.applyPrimaryAction() },
            modifier = leadingModifier,
            enabled = enabled,
            shapes = leadingShapes,
            colors = colors,
            contentPadding = leadingPadding,
            content = content,
          )
        MenuSplitVariant.Elevated ->
          SplitButtonDefaults.ElevatedLeadingButton(
            onClick = { model.applyPrimaryAction() },
            modifier = leadingModifier,
            enabled = enabled,
            shapes = leadingShapes,
            colors = colors,
            contentPadding = leadingPadding,
            content = content,
          )
      }
    },
    trailingButton = {
      // The half's own box, and the list composed inside it: see the KDoc above.
      // `propagateMinConstraints` is what `SplitButtonLayout`'s slot box does for its
      // child, and the wrapper has to keep doing it now that it sits in between.
      Box(propagateMinConstraints = true) {
        val trailingModifier =
          halfModifier(model, MENU_MORE_OPTIONS_LABEL, null, leading = false, enabled = enabled)
        // `checked` is the menu's open state, so the half is the list's own toggle:
        // Material fills its corner while the window is up. The callback is the press,
        // and the value it hands over is the one the press asks for - opening when the
        // list is down, closing when it is somehow up - which [MenuModel.setOpen]
        // funnels either way, so one press is never two events.
        val onOpenChange: (Boolean) -> Unit = { wantsOpen -> model.setOpen(wantsOpen) }
        val chevron: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
          Icon(
            imageVector = MenuChevronIcon,
            // Nothing of its own to announce: the half's node carries
            // [MENU_MORE_OPTIONS_LABEL] and the expanded/collapsed state, so a second
            // description here would be read twice.
            contentDescription = null,
            modifier = Modifier.size(chevronSize).rotate(rotation),
          )
        }
        when (split) {
          MenuSplitVariant.Filled ->
            SplitButtonDefaults.TrailingButton(
              checked = expanded,
              onCheckedChange = onOpenChange,
              modifier = trailingModifier,
              enabled = enabled,
              shapes = trailingShapes,
              colors = colors,
              contentPadding = trailingPadding,
              content = chevron,
            )
          MenuSplitVariant.Tonal ->
            SplitButtonDefaults.TonalTrailingButton(
              checked = expanded,
              onCheckedChange = onOpenChange,
              modifier = trailingModifier,
              enabled = enabled,
              shapes = trailingShapes,
              colors = colors,
              contentPadding = trailingPadding,
              content = chevron,
            )
          MenuSplitVariant.Outlined ->
            SplitButtonDefaults.OutlinedTrailingButton(
              checked = expanded,
              onCheckedChange = onOpenChange,
              modifier = trailingModifier,
              enabled = enabled,
              shapes = trailingShapes,
              colors = colors,
              contentPadding = trailingPadding,
              content = chevron,
            )
          MenuSplitVariant.Elevated ->
            SplitButtonDefaults.ElevatedTrailingButton(
              checked = expanded,
              onCheckedChange = onOpenChange,
              modifier = trailingModifier,
              enabled = enabled,
              shapes = trailingShapes,
              colors = colors,
              contentPadding = trailingPadding,
              content = chevron,
            )
        }
        popup()
      }
    },
  )
}

/**
 * One half's modifier: where it ended up, and what a screen reader hears there.
 *
 * `clearAndSetSemantics` rather than `semantics` is the G6 review M3 fix carried over
 * from the plain trigger (`HybridNitroUiPicker.kt` records what `uiautomator dump` said
 * about the alternative): Material's own node would be a second, nameless focus stop
 * beside this one, and the half's own click / toggle action is dropped by the clear and
 * restated here - pointer input is untouched, and the restated action is what makes the
 * dump report the half as actionable at all.
 *
 * That is also how the trigger becomes two announcement sites instead of one:
 *
 * - leading: named by `accessibilityLabel` (falling back to `title`), `Role.Button`, and
 *   TalkBack says the title then "Button" - a press runs the app's `primaryAction`;
 * - trailing: named [MENU_MORE_OPTIONS_LABEL], `Role.Button`, `stateDescription`
 *   `expanded` / `collapsed` - so TalkBack says "More options", then the state, then
 *   "Button", and the state is the menu's, not a local toggle's.
 *
 * The plain trigger's single `Role.DropdownList` node cannot survive a split: there is no
 * single node left to carry it, and a half that opens a list is not the same control as a
 * half that runs an action. `docs/components/menu.md` says which node a screen reader
 * reaches in each configuration.
 *
 * The layout callback comes first and files the half's box with the model: like the
 * anchor's, it costs no recomposition and writes no observed state.
 */
private fun halfModifier(
  model: MenuModel,
  label: String,
  text: String?,
  leading: Boolean,
  enabled: Boolean,
): Modifier =
  Modifier
    .onGloballyPositioned { coordinates ->
      val box = coordinates.boundsInRoot()
      if (leading) {
        model.noteLeadingBox(box.left, box.top, box.right, box.bottom)
      } else {
        model.noteTrailingBox(box.left, box.top, box.right, box.bottom)
      }
    }
    .clearAndSetSemantics {
      contentDescription = label
      if (text != null) {
        this[SemanticsProperties.Text] = listOf(AnnotatedString(text))
        stateDescription = ""
      } else {
        stateDescription = if (model.expanded) "expanded" else "collapsed"
      }
      role = Role.Button
      if (enabled) {
        onClick {
          if (leading) {
            model.applyPrimaryAction()
          } else {
            model.setOpen(true)
          }
          true
        }
      } else {
        disabled()
      }
    }
