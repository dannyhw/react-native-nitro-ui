package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit test for the two Button rules that only exist inside the model (E1).
 *
 * The first is the recycle reset. A Button's props are all re-sent on every mount
 * (`Button.tsx` sends each one, so a recycled instance cannot inherit a handler -
 * the reason `example/__tests__/Conformance.harness.tsx` files Button's recycle rule
 * as `noProbe`), which also means the device can never *see* a reset line that was
 * forgotten. `prepareForRecycle` on iOS and [ButtonModel.reset] here are the two
 * copies of that line, and this is the only one a test can reach: mutate the model
 * the way three props would, reset it, and ask what is left.
 *
 * The second is the size ladder. `small` / `medium` / `large` are now Material 3's
 * XS / S / M container heights, and every other number in the control - padding,
 * label style, resting and pressed corner, the connected group's items - is derived
 * from that one height. If the mapping slips by one rung, no measurement on a device
 * says "you meant the token above": the control is simply a different height, and the
 * screenshots and the fallbacks move with it. So the three numbers are written out.
 */
class ButtonModelTest {
  @Test
  fun aRecycledModelForgetsTheCornerAndEverythingElseSentWithIt() {
    val model =
      ButtonModel().apply {
        title = "Save"
        variant = ButtonVariant.Text
        scale = ButtonScale.Large
        shape = ButtonShape.Square
        enabled = false
        tintColor = 0x11223344
        accessibilityLabel = "Save the file"
        systemImage = "square.and.arrow.down"
        androidIcon = "share"
        sizingKey = "text|large|square.and.arrow.down|share|Save"
      }

    model.reset()

    assertEquals(ButtonShape.Round, model.shape)
    assertEquals(ButtonScale.Medium, model.scale)
    assertEquals(ButtonVariant.Filled, model.variant)
    assertEquals("", model.title)
    assertEquals(true, model.enabled)
    assertEquals(null, model.tintColor)
    assertEquals(null, model.accessibilityLabel)
    assertEquals(null, model.systemImage)
    // `androidIcon` is the one icon prop a recycled row is guaranteed to re-send
    // with a *different* value - a list row's glyph is per item - so a forgotten
    // reset here shows the previous row's name until React's write lands. The
    // bitmap that goes with it cannot be built on the JVM at all (see
    // `NitroUiIconTest`), so what it is cleared to is asserted on the device, in
    // `example/__tests__`'s recycle rule for a Button that changes `androidIcon`.
    assertEquals(null, model.androidIcon)
    assertEquals("", model.sizingKey)
  }

  @Test
  fun theThreeSizeNamesAreMaterialsThreeSmallestContainerHeights() {
    assertEquals(32f, ButtonScale.Small.height.value)
    assertEquals(40f, ButtonScale.Medium.height.value)
    assertEquals(56f, ButtonScale.Large.height.value)
  }

  /**
   * The other half of the ladder: the token is what the padding and the corner are
   * read *from*, and the touch target is what the box is laid out *at*. Reaching
   * for `Modifier.height(scale.height)` draws exactly what Q8 predicted (a 32 dp
   * `small`) and takes the finger target down with the picture, so the floor is
   * asserted next to the tokens it sits under.
   */
  @Test
  fun theBoxMaterialLaysOutNeverGoesBelowTheTouchTarget() {
    assertEquals(48f, ButtonScale.Small.layoutHeight.value)
    assertEquals(48f, ButtonScale.Medium.layoutHeight.value)
    assertEquals(56f, ButtonScale.Large.layoutHeight.value)
    assertEquals(48f, MinTouchTargetHeight.value)
  }

  /**
   * The corner each variant actually draws for a requested `shape`.
   *
   * This is the one Button rule on Android that no device can see: the `text`
   * variant's container is transparent, so `shape` there changes only what the
   * ripple is clipped to, and a screenshot at rest or a harness measurement looks
   * the same either way. It is therefore exactly the rule that would quietly stop
   * being applied - `docs/components/button.md`'s Corners table says `text` ignores
   * the prop, and only this line keeps that sentence honest. [cornerFor] is where
   * `NitroUiM3Button` resolves the corner before asking [buttonShapes] for a pair,
   * so an assertion on the table is an assertion on what the one renderer draws.
   */
  @Test
  fun onlyTheTextVariantIgnoresTheCornerItWasSent() {
    for (variant in ButtonVariant.entries.filter { it != ButtonVariant.Text }) {
      assertEquals(ButtonShape.Square, cornerFor(variant, ButtonShape.Square))
      assertEquals(ButtonShape.Round, cornerFor(variant, ButtonShape.Round))
    }
    assertEquals(ButtonShape.Round, cornerFor(ButtonVariant.Text, ButtonShape.Square))
    assertEquals(ButtonShape.Round, cornerFor(ButtonVariant.Text, ButtonShape.Round))
  }

  @Test
  fun anUnknownCornerNameIsRoundLikeEveryOtherUnrecognisedButtonName() {
    assertEquals(ButtonShape.Square, ButtonShape.from("square"))
    assertEquals(ButtonShape.Round, ButtonShape.from("round"))
    assertEquals(ButtonShape.Round, ButtonShape.from("pill"))
    assertEquals(ButtonShape.Round, ButtonShape.from(""))
  }
}
