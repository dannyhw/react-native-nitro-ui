package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit test for the one Menu split-button decision that is not a `when` branch
 * anyone can eyeball: which of Material's four split-button sets a trigger variant
 * draws (E3, `docs/components/menu.md`).
 *
 * [MenuSplitVariant.of] is the whole mapping, and four of its five arms look right by
 * inspection - `filled` draws the filled set, and so on. The fifth is the one the brief
 * had to decide rather than find: Material has no text split button, so `variant="text"`
 * resolves to `Outlined`. That is a documented promise in `menu.md`, and a promise with
 * no observation is the kind that silently becomes `Filled` when someone reorders a
 * `when` and only runs the filled case.
 *
 * This is also the cheapest place to hold the promise. The on-device gates can see a
 * split button's *behaviour* (`example/__tests__/Menu.harness.tsx` presses each half),
 * but reading a container's colour off a screenshot is not an assertion, and the mapping
 * is pure - an enum in, an enum out - so nothing about it needs an emulator.
 */
class MenuSplitButtonTest {
  @Test
  fun everyTriggerVariantHasASplitButtonSet() {
    // Spelled as the whole domain rather than one case per arm, so a sixth
    // `ButtonVariant` arrives as a red line here - `entries` is exhaustive in the
    // `when`, and a mapping that stopped compiling would be caught by the compiler
    // rather than by this file.
    assertEquals(
      listOf("filled", "tonal", "outlined", "outlined", "elevated"),
      ButtonVariant.entries.map { MenuSplitVariant.of(it).button.wireName }
    )
  }

  @Test
  fun aTextTriggerDrawsTheOutlinedSplitButton() {
    // The documented odd one (`docs/components/menu.md`, "Variants"): no split-button
    // set has no container to split, so a text Menu that grows a `primaryAction`
    // changes looks. Asserted alone, and against the set it must *not* quietly become,
    // because "text maps to something" is satisfied by every arm of a `when` and only
    // "text maps to outlined" is the promise.
    assertEquals(ButtonVariant.Outlined, MenuSplitVariant.of(ButtonVariant.Text).button)
  }

  @Test
  fun theSplitButtonHasAMoreOptionsLabel() {
    // The trailing half has no text of its own - only a chevron - so its accessible
    // name is this constant, and TalkBack reads it (`MenuSplitButton.kt`'s
    // `halfModifier`). Empty or null here and the half is an unnamed focus stop.
    assertEquals("More options", MENU_MORE_OPTIONS_LABEL)
  }
}
