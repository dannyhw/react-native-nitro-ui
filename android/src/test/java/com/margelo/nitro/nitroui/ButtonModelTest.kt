package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

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
    assertEquals(null, model.androidIcon)
    assertEquals("", model.sizingKey)
  }

  @Test
  fun theThreeSizeNamesAreMaterialsThreeSmallestContainerHeights() {
    assertEquals(32f, ButtonScale.Small.height.value)
    assertEquals(40f, ButtonScale.Medium.height.value)
    assertEquals(56f, ButtonScale.Large.height.value)
  }

  @Test
  fun theBoxMaterialLaysOutNeverGoesBelowTheTouchTarget() {
    assertEquals(48f, ButtonScale.Small.layoutHeight.value)
    assertEquals(48f, ButtonScale.Medium.layoutHeight.value)
    assertEquals(56f, ButtonScale.Large.layoutHeight.value)
    assertEquals(48f, MinTouchTargetHeight.value)
  }

  // `text` has a transparent container, so its corner rule cannot be seen on a device.
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
