package com.margelo.nitro.nitroui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ButtonDefaults
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
import com.margelo.nitro.nitroui.core.nitroUiIcon

// The Menu's split trigger: Material 3's `SplitButtonLayout`. The leading half runs the
// primary action; the trailing half's `checked` is the menu's open state.

/** The trailing half's accessibility name: it shows only a chevron. Not localised. */
internal const val MENU_MORE_OPTIONS_LABEL = "More options"

/**
 * Which of Material's four split-button sets a [ButtonVariant] draws. `text` has no
 * container, and a split button is two containers, so it draws the outlined set.
 */
internal enum class MenuSplitVariant(
  val button: ButtonVariant
) {
  Filled(ButtonVariant.Filled),
  Tonal(ButtonVariant.Tonal),
  Outlined(ButtonVariant.Outlined),
  Elevated(ButtonVariant.Elevated),
  ;

  companion object {
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
 * The corners of both halves at [scale], from `SplitButtonDefaults`' own height ladder,
 * read at [ButtonScale.layoutHeight]. Cached per motion scheme and scale.
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
 * The split trigger. [popup] is composed in the trailing half's slot because the list
 * anchors to the half whose slot composes it. [modifier] carries the anchor callback.
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
  val spokenLabel = model.accessibilityLabel ?: title
  // For `text` these are the outlined set's colours.
  val colors = buttonColors(split.button, model.tintColor)
  val (leadingShapes, trailingShapes) = splitButtonShapes(scale)
  // Button's icon ladder, not `SplitButtonDefaults`' own, so the glyph matches the plain
  // trigger's.
  val iconSize = remember(scale) { ButtonDefaults.iconSizeFor(scale.height) }
  val iconSpacing = remember(scale) { ButtonDefaults.iconSpacingFor(scale.height) }
  val leadingPadding =
    remember(scale) {
      SplitButtonDefaults.leadingButtonContentPaddingFor(scale.height)
    }
  val trailingPadding =
    remember(scale) {
      SplitButtonDefaults.trailingButtonContentPaddingFor(scale.height)
    }
  val chevronSize: Dp =
    remember(scale) { SplitButtonDefaults.trailingButtonIconSizeFor(scale.height) }
  val labelStyle = buttonLabelStyle(scale)
  val rotation by
    animateFloatAsState(
      targetValue = if (expanded) 180f else 0f,
      animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
      label = "nitroUiMenuChevron",
    )

  // Test-harness witness that a split button was composed; cleared on dispose.
  DisposableEffect(model) {
    model.noteSplitDrawn(true)
    onDispose {
      model.noteSplitDrawn(false)
      model.clearSplitBoxes()
    }
  }

  // Material turns the minimum interactive size off inside the halves, so they would rest
  // at the container height (40 dp at `small` and `medium`). This minimum makes them
  // fill the same box as the plain trigger.
  SplitButtonLayout(
    modifier = modifier.heightIn(min = scale.layoutHeight),
    leadingButton = {
      val leadingModifier =
        halfModifier(model, spokenLabel, title, leading = true, enabled = enabled)
      val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
        // The icon goes on the half with the label. Material's leading padding has no
        // start-icon form, so the half grows by the glyph plus its spacing.
        NitroUiIconSlotContent(
          icon = model.androidIconContent,
          size = iconSize,
          spacing = iconSpacing,
        )
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
      // `propagateMinConstraints` passes on what `SplitButtonLayout`'s slot does for its child.
      Box(propagateMinConstraints = true) {
        val trailingModifier =
          halfModifier(model, MENU_MORE_OPTIONS_LABEL, null, leading = false, enabled = enabled)
        // `checked` is the menu's open state; Material fills the half's inner corner while
        // the list is open.
        val onOpenChange: (Boolean) -> Unit = { wantsOpen -> model.setOpen(wantsOpen) }
        val chevron: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
          Icon(
            imageVector = nitroUiIcon(R.drawable.nitroui_keyboard_arrow_down),
            // No description: the half's node already carries the label and the state.
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

// `clearAndSetSemantics`, not `semantics`: Material's own node would be a second, nameless
// focus stop. The clear drops the click action, so it is restated. The trailing half's
// action toggles, so a screen reader can close the list as well as open it.
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
            model.applyListAction()
          }
          true
        }
      } else {
        disabled()
      }
    }
