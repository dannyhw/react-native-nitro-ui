package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

class MenuSplitButtonTest {
  @Test
  fun everyTriggerVariantHasASplitButtonSet() {
    assertEquals(
      listOf("filled", "tonal", "outlined", "outlined", "elevated"),
      ButtonVariant.entries.map { MenuSplitVariant.of(it).button.wireName }
    )
  }

  @Test
  fun aTextTriggerDrawsTheOutlinedSplitButton() {
    // Material has no text split button, so a text trigger draws the outlined one.
    assertEquals(ButtonVariant.Outlined, MenuSplitVariant.of(ButtonVariant.Text).button)
  }

  @Test
  fun theSplitButtonHasAMoreOptionsLabel() {
    // The trailing half shows only a chevron, so this constant is its accessible name.
    assertEquals("More options", MENU_MORE_OPTIONS_LABEL)
  }
}
