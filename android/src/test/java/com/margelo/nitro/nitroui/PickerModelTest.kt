package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PickerModelTest {
  /** A model that has lived: picked, tinted, labelled, and mid-handshake. */
  private fun usedModel(): PickerModel =
    PickerModel().apply {
      options = arrayOf("One", "Two", "Three")
      defaultSelectedIndex = 2.0
      didApplyDefault = true
      displayed = 2
      state.displayed = 2.0
      state.js = 1.0
      state.unreported = 0.0
      state.nativeEvents = 4
      state.jsEvents = 3
      expanded = true
      variant = "wheel"
      label = "Size"
      enabled = false
      tintColor = 0xFF112233.toInt()
      accessibilityLabel = "Size of the box"
      sizingKey = "wheel|3|One|Two|Three|sel:Three|lbl:Size"
      pickStamp = PickerPickStamp(2, options, "wheel", "Size")
      onChange = { _, _ -> }
    }

  @Test
  fun aRecycleResetLeavesNothingOfTheMountBeforeIt() {
    val model = usedModel()
    model.reset()
    assertEquals(0, model.options.size)
    assertEquals(0, model.displayed)
    assertEquals(0.0, model.state.displayed, 0.0)
    assertNull(model.state.js)
    assertNull(model.state.unreported)
    assertEquals(0, model.state.nativeEvents)
    assertEquals(0, model.state.jsEvents)
    // A spent seed leaves the next mount on index 0 whatever it asked for, and a surviving
    // `expanded` opens a popup over a row that never asked for one.
    assertFalse("the uncontrolled seed must be applicable again", model.didApplyDefault)
    assertFalse("a recycled host starts closed", model.expanded)
    assertEquals("menu", model.variant)
    assertNull(model.label)
    assertTrue("a recycled host starts enabled", model.enabled)
    assertNull(model.tintColor)
    assertNull(model.accessibilityLabel)
    assertEquals("", model.sizingKey)
    assertNull(model.pickStamp)
    assertNull(model.onChange)
  }

  @Test
  fun theUncontrolledSeedIsApplicableAgainAfterAReset() {
    val model = usedModel()
    assertTrue(model.didApplyDefault)
    model.reset()
    assertFalse(model.didApplyDefault)
    model.options = arrayOf("Small", "Medium", "Large")
    model.defaultSelectedIndex = 1.0
    model.didApplyDefault = true
    model.displayed = model.clamp(model.defaultSelectedIndex)
    assertEquals(1, model.displayed)
  }

  @Test
  fun aPickClosesThePopupPaintsItsTitleAndStampsItsConfiguration() {
    val events = mutableListOf<Pair<Double, Double>>()
    val model = PickerModel().apply {
      options = arrayOf("One", "Two", "Three")
      onChange = { index, count -> events.add(index to count) }
    }
    model.expanded = true
    model.applyUserSelection(2)
    assertFalse("the press that chose must close the list", model.expanded)
    assertEquals(2, model.displayed)
    assertEquals(2.0, model.state.displayed, 0.0)
    assertEquals(listOf(2.0 to 1.0), events)
    val stamp = model.pickStamp
    assertNotNull("a pick leaves a stamp for the batch that follows", stamp)
    assertEquals(2, stamp!!.index)
    assertEquals("menu", stamp.variant)
    assertNull(stamp.label)
    assertEquals(3, stamp.options.size)
  }

  @Test
  fun aDisabledControlOrTheShownRowRefusesThePick() {
    val events = mutableListOf<Double>()
    val model = PickerModel().apply {
      options = arrayOf("One", "Two", "Three")
      displayed = 1
      state.displayed = 1.0
      onChange = { index, _ -> events.add(index) }
    }
    model.applyUserSelection(1)
    assertEquals(emptyList<Double>(), events)
    model.enabled = false
    model.applyUserSelection(0)
    assertEquals(emptyList<Double>(), events)
    assertEquals(1, model.displayed)
    assertNull(model.pickStamp)
    // The popup still closes on a refusal - a press is a press.
    assertFalse(model.expanded)
  }

  @Test
  fun aPickReportsWhetherItEmitted() {
    // The host holds its size reports only for a pick that emitted, so a refusal must say so.
    val model = PickerModel().apply {
      options = arrayOf("One", "Two", "Three")
      displayed = 1
      state.displayed = 1.0
      onChange = { _, _ -> }
    }
    assertFalse(
      "re-tapping the shown row emits nothing, so nothing may be held for it",
      model.applyUserSelection(1)
    )
    model.enabled = false
    assertFalse(
      "a disabled control is inert, so nothing may be held for it either",
      model.applyUserSelection(0)
    )
    assertNull("a refusal leaves no stamp", model.pickStamp)
    model.enabled = true
    model.expanded = true
    assertTrue("a choice that moves the selection emits", model.applyUserSelection(2))
    assertNotNull("and it leaves a stamp for the batch that follows", model.pickStamp)
  }

  @Test
  fun aStampOnlyNamesTheConfigurationItWasMadeUnder() {
    val model = PickerModel().apply {
      options = arrayOf("One", "Two", "Three")
      label = "Size"
    }
    model.applyUserSelection(2)
    val stamp = requireNotNull(model.pickStamp)
    assertTrue(model.pickIsStillShown(stamp))
    // Any change to what the size depends on makes the stamp stale.
    assertFalse(model.pickIsStillShown(null))
    model.options = arrayOf("One", "Two", "Three", "Four")
    assertFalse("a longer list is a different title", model.pickIsStillShown(stamp))
    model.options = arrayOf("One", "Two", "Three")
    model.variant = "wheel"
    assertFalse("a wheel answers a different question", model.pickIsStillShown(stamp))
    model.variant = "menu"
    model.label = "Box"
    assertFalse("the caption costs width on Android", model.pickIsStillShown(stamp))
    model.label = "Size"
    model.displayed = 0
    assertFalse("the pick is no longer what is painted", model.pickIsStillShown(stamp))
  }

  @Test
  fun theClampPutsEveryIndexInsideTheList() {
    val model = PickerModel().apply { options = arrayOf("One", "Two", "Three") }
    assertEquals(0, model.clamp(-4.0))
    assertEquals(2, model.clamp(9.0))
    assertEquals(1, model.clamp(1.9))
    assertEquals(0, model.clamp(Double.NaN))
    assertEquals(0.0, model.clampToDouble(-1.0), 0.0)
    model.options = emptyArray()
    assertEquals("an empty list has no index at all", 0, model.clamp(2.0))
  }

  @Test
  fun theVariantResolvesToTheThreeControlsThisComponentHas() {
    assertEquals("menu", PickerModel.resolvedVariant("menu"))
    assertEquals("wheel", PickerModel.resolvedVariant("wheel"))
    assertEquals("radio", PickerModel.resolvedVariant("radio"))
    assertEquals("unknown names are the default", "menu", PickerModel.resolvedVariant("popover"))
    assertEquals("empty is the default", "menu", PickerModel.resolvedVariant(""))
    assertTrue("'radio' is the radio group", PickerModel.isRadio("radio"))
    assertFalse("a menu is not", PickerModel.isRadio("menu"))
    assertFalse("nor is a wheel", PickerModel.isRadio("wheel"))
  }

  @Test
  fun aRadioPickMeansTheSameThingAsAMenuPick() {
    val model =
      PickerModel().apply {
        options = arrayOf("One", "Two", "Three")
        displayed = 0
        state.displayed = 0.0
        variant = "radio"
        // A radio group has no popup; set here so the assertion below can see the pick close it.
        expanded = true
      }
    assertTrue("a pick of a different row is a choice", model.applyUserSelection(2))
    assertEquals(2, model.displayed)
    assertFalse("a pick leaves a radio group nothing open", model.expanded)
    assertFalse(
      "a pick of the row already shown reports nothing",
      model.applyUserSelection(2),
    )
    assertFalse(
      "9 clamps to the last row, which is the one already shown",
      model.applyUserSelection(9),
    )
    assertEquals(2, model.displayed)
  }
}
