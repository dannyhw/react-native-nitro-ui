package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the two Picker rules that a device cannot reach.
 *
 * The first is the recycle reset. [NitroUiModel.reset] is the contract B1 is about -
 * a pooled view must not carry a previous mount's choices, title, open popup or
 * handshake into the next one - and no on-device test can show it red: measured on
 * `nitroui_t01`, `prepareForRecycle` is never called while the harness mounts,
 * unmounts and churns 200 Pickers, because nothing in those trees is a recycling
 * container. `example/__tests__/Picker.harness.tsx`'s remount case therefore tests
 * fresh instances, and what is left is this: the reset, asserted directly.
 *
 * The second is what a pick means ([PickerModel.applyUserSelection]) and what the
 * size report it leaves behind is allowed to describe
 * ([PickerModel.pickIsStillShown], G6 review M1). Both are pure logic that an
 * emulator can only test through a popup the harness cannot press into.
 */
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
    // The two flags a recycled host can leak through the *front door*: a seed that is
    // already spent leaves the next mount on index 0 whatever it asked for, and an
    // `expanded` that survived hangs a popup over a row that never opened it.
    assertFalse("the uncontrolled seed must be applicable again", model.didApplyDefault)
    assertFalse("a recycled host starts closed", model.expanded)
    // And the rest of the previous mount's identity.
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
    // The gate itself, spelled as the two batches a recycled view sees: seed once,
    // then never again for that mount, then once again for the next one.
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
    // Both refusals report nothing, which is what makes a refused choice observable
    // from the outside: only a rolled-back selection makes the next tap a fresh one.
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
    // The host holds its size reports for the batch a *choice* is waiting for, so it
    // may only hold them when a choice actually happened (G6 round-2 review N2). A
    // re-tap of the row already shown is common - the real-input case does it - and it
    // brings no batch with it, so a hold taken for it is never released by anything
    // but the next unrelated batch, which drops the held size: every size measured in
    // between is lost to the engine for the life of the mount. This function is the
    // only thing the host can ask, so it has to answer it.
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
    // Any part of the configuration the size depends on moving means the held size
    // describes content that is no longer on screen.
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
}
