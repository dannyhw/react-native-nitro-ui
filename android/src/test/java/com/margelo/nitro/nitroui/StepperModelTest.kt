package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the two places an Android Stepper keeps the same number twice, both
 * found in G25's review.
 *
 * **The progress a reader is given.** The semantics node publishes
 * [StepperModel.displayed] through a `Float` ([StepperModel.publishedProgress]), and the
 * target of the `setProgress` action comes back through that same `Float`. A comparison
 * against the `Double` is a comparison between two different numbers on any grid whose
 * stops are not exact in binary, which is every `0.1` grid: the reader asking for the
 * value it can already read is then "one step up", and the control moves, emits and
 * announces a number nobody asked for. The fix is one round-trip in the comparison, and
 * the only witness that fits is arithmetic — TalkBack does not run on the JVM, but the
 * Float the node published is exactly reproducible here.
 *
 * **The value a `defaultValue` starts on.** Compose draws [StepperModel.displayed] and
 * the handshake decides against `state.displayed`
 * ([NitroUiControlledValue.reconcile]). Writing only the first leaves the control on its
 * default and the handshake at the bottom of its range, which drops the one write that
 * asks for the bottom: React holds `0`, the screen keeps `5`, and nothing is ever
 * emitted to tell the two apart.
 *
 * The iOS twin of both rules is [NitroUiStepperBindingTest]-adjacent (one field does
 * both jobs there, which is why it cannot drift the way the pair here could), and the
 * device half of the reader rule is `real-input`'s Stepper case. What lives here is the
 * arithmetic, on the fixtures no screen produces on demand.
 */
class StepperModelTest {
  /** A tenths control — the grid `0.3` is not exact on — showing `0.3`. */
  private fun tenthsShowing(displayed: Double = 0.3): StepperModel =
    StepperModel().apply {
      minimumValue = 0.0
      maximumValue = 1.0
      step = 0.1
      this.displayed = displayed
    }

  /** The events the app is told about, as the callback sees them. */
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
    // The exact number the node publishes for 0.3: a `Double` through a `Float` and
    // back. This is what an accessibility service sends when it sets the value it just
    // read, and the whole test is whether the control recognises it as its own.
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
    // The reviewed bug needs `0.3` and `0.3f.toDouble()` to be different numbers; if a
    // refactor ever makes them equal the first test above passes for free.
    assertTrue(
      "0.3 is not exact in binary, which is why the published progress has to be compared " +
        "as the Float the node carried",
      0.3f.toDouble() != 0.3
    )
    assertEquals(0.3f.toDouble(), tenthsShowing().publishedProgress, 0.0)
  }

  @Test
  fun aReaderAskingForMoreStillGetsOneStep() {
    // The fix must not blunt the action it exists to serve: one step of *this* grid,
    // in the direction the target points, and one event.
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
    // A grid whose stops are exact in binary has no Float noise to shed, and the
    // round-trip must be invisible there — the case the review was worried about
    // breaking.
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
    // The line the review found missing: this is the number the handshake compares
    // React's next write against, and it was left at the bottom of the range.
    assertEquals(5.0, model.state.displayed, 0.0)
    assertFalse("once is once", model.applyDefaultOnce())
  }

  @Test
  fun theFirstControlledWriteAfterADefaultIsJudgedAgainstTheDefault() {
    // The symptom: an app that mounts a `defaultValue={5}` Stepper and then starts
    // controlling it with `value={0}`. With only `displayed` written, `reconcile` sees a
    // control already at 0, drops the write, and React and the screen part company —
    // React holds 0 forever, the screen shows 5, and no event is ever emitted.
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
    // The same handshake from the other side: a write of the value the default already
    // put on screen must not be a change either, which is what the count handshake and
    // `docs/architecture/core.md` §4 both ask of a controlled value.
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
    // Away from zero, the same tie the value rule answers with 3 on both platforms
    // (NitroUiSliderValueTest.roundHalfAwayIsAwayFromZeroOnATie).
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
