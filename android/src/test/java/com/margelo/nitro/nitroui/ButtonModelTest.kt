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
        sizingKey = "text|large|square.and.arrow.down|Save"
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
    assertEquals("", model.sizingKey)
  }

  @Test
  fun theThreeSizeNamesAreMaterialsThreeSmallestContainerHeights() {
    assertEquals(32f, ButtonScale.Small.height.value)
    assertEquals(40f, ButtonScale.Medium.height.value)
    assertEquals(56f, ButtonScale.Large.height.value)
  }

  @Test
  fun anUnknownCornerNameIsRoundLikeEveryOtherUnrecognisedButtonName() {
    assertEquals(ButtonShape.Square, ButtonShape.from("square"))
    assertEquals(ButtonShape.Round, ButtonShape.from("round"))
    assertEquals(ButtonShape.Round, ButtonShape.from("pill"))
    assertEquals(ButtonShape.Round, ButtonShape.from(""))
  }
}
