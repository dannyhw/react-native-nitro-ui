package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StepperModelTest {
  /** A tenths control — the grid `0.3` is not exact on — showing `0.3`. */
  private fun tenthsShowing(displayed: Double = 0.3): StepperModel =
    StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 1.0
      step = 0.1
      this.displayed = displayed
    }

  private class Recorder {
    val changes = mutableListOf<Double>()

    fun wire(model: StepperModel) {
      model.onValueChange = { value, _ -> changes.add(value) }
    }
  }

  // MARK: - The progress a reader is given

  @Test
  fun aReaderAskingForTheValueAlreadyHeldMovesNothing() {
    val model = tenthsShowing()
    val events = Recorder().also { it.wire(model) }
    // What the semantics node publishes for 0.3: a `Double` through a `Float` and back.
    val published = 0.3f.toDouble()
    assertFalse(
      "asking for the published progress must not step: it is the value on screen",
      model.accessibilityStepToward(published)
    )
    assertEquals(0.3, model.displayed, 0.0)
    assertEquals(emptyList<Double>(), events.changes)
  }

  @Test
  fun theFloatRoundTripIsWhatMakesThatFixtureMeanAnything() {
    // If `0.3` and `0.3f.toDouble()` were equal, the test above would pass for free.
    assertTrue(
      "0.3 is not exact in binary, which is why the published progress has to be compared " +
        "as the Float the node carried",
      0.3f.toDouble() != 0.3
    )
    assertEquals(0.3f.toDouble(), tenthsShowing().publishedProgress, 0.0)
  }

  @Test
  fun aReaderAskingForMoreStillGetsOneStep() {
    val model = tenthsShowing()
    val events = Recorder().also { it.wire(model) }
    assertTrue(model.accessibilityStepToward(0.4f.toDouble()))
    assertEquals(0.4, model.displayed, 0.0)
    assertEquals(listOf(0.4), events.changes)
    assertTrue(model.accessibilityStepToward(0.2f.toDouble()))
    assertEquals(0.3, model.displayed, 0.0)
    assertEquals(listOf(0.4, 0.3), events.changes)
  }

  @Test
  fun anExactGridReadsTheSameEitherWay() {
    // A grid whose stops are exact in binary has no Float noise to shed.
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      displayed = 4.0
    }
    assertEquals(4.0, model.publishedProgress, 0.0)
    assertFalse(model.accessibilityStepToward(4.0))
    assertTrue(model.accessibilityStepToward(5.0))
    assertEquals(5.0, model.displayed, 0.0)
  }

  @Test
  fun aStepAtEitherEndAsksForTheValueItHoldsAndMovesNothing() {
    val model = tenthsShowing(displayed = 1.0)
    assertFalse("the plus half at the maximum is already dead", model.accessibilityStepToward(1.0f.toDouble()))
    assertEquals(1.0, model.displayed, 0.0)
    val bottom = tenthsShowing(displayed = 0.0)
    assertFalse(bottom.accessibilityStepToward(0.0f.toDouble()))
    assertEquals(0.0, bottom.displayed, 0.0)
  }

  // MARK: - Where a defaultValue leaves the control

  @Test
  fun aDefaultMovesTheDrawnValueAndTheHandshakeTogether() {
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      defaultValue = 5.0
    }
    assertTrue(model.applyDefaultOnce())
    assertEquals(5.0, model.displayed, 0.0)
    // The handshake compares React's next write against this, not against `displayed`.
    assertEquals(5.0, model.state.displayed, 0.0)
    assertFalse("once is once", model.applyDefaultOnce())
  }

  @Test
  fun theFirstControlledWriteAfterADefaultIsJudgedAgainstTheDefault() {
    // With only `displayed` written, a controlled `value={0}` after `defaultValue={5}` is
    // dropped as an echo.
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      defaultValue = 5.0
    }
    model.applyDefaultOnce()
    model.state.js = 0.0
    assertTrue(
      "a write of 0 to a control showing its default of 5 is a change, not an echo",
      model.state.reconcile()
    )
    assertEquals(0.0, model.state.displayed, 0.0)
  }

  @Test
  fun aDefaultThatSaysTheSameThingAsTheControlIsNoChange() {
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      defaultValue = 5.0
    }
    model.applyDefaultOnce()
    model.state.js = 5.0
    assertFalse(model.state.reconcile())
    assertEquals(5.0, model.displayed, 0.0)
  }

  @Test
  fun aDefaultIsOffTheTableOnceReactHasSentAValue() {
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      defaultValue = 5.0
    }
    model.state.js = 2.0
    assertFalse("a controlled Stepper has no default to apply", model.applyDefaultOnce())
    assertEquals(0.0, model.displayed, 0.0)
  }

  @Test
  fun aDefaultIsQuantisedLikeEveryOtherWriteToTheShownValue() {
    val model = StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 10.0
      step = 1.0
      defaultValue = 2.5
    }
    model.applyDefaultOnce()
    // A tie rounds away from zero.
    assertEquals(3.0, model.displayed, 0.0)
    assertEquals(3.0, model.state.displayed, 0.0)
  }

  @Test
  fun nothingHappensWithoutADefault() {
    val model = StepperModel().apply { minimumValue = 0.0; maximumValue = 10.0; step = 1.0 }
    assertFalse(model.applyDefaultOnce())
    assertEquals(0.0, model.displayed, 0.0)
  }
}
