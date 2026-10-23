package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the Slider's value rule, the Android twin of
 * `scripts/native-tests/slider-value.test.swift`.
 *
 * The vectors are that file's vectors, one for one: the rule is duplicated in
 * Swift and Kotlin on purpose, and a platform that snaps a drag to a different
 * number than the other is a control whose value changes with the OS.
 *
 * Every assertion is an *exact* Double comparison - the whole point of tidying is
 * that the value native holds is bit-for-bit the value React holds, so a test that
 * allowed an epsilon would pass the bug it exists to catch.
 */
class NitroUiSliderValueTest {
  private fun quantize(
    raw: Double,
    minimum: Double,
    maximum: Double,
    step: Double,
  ) = NitroUiSliderValue.quantize(raw, minimum, maximum, step)

  private fun stepped(
    from: Double,
    up: Boolean,
    minimum: Double,
    maximum: Double,
    step: Double,
  ) = NitroUiSliderValue.stepped(from, up, minimum, maximum, step)

  private fun expect(
    actual: Double,
    expected: Double,
    what: String,
  ) {
    assertEquals("$what (got $actual, want $expected)", expected, actual, 0.0)
  }

  @Test
  fun continuousClampsAndNothingElse() {
    expect(quantize(0.4, 0.0, 1.0, 0.0), 0.4, "continuous keeps a value in range")
    expect(quantize(-3.0, 0.0, 1.0, 0.0), 0.0, "continuous clamps below the minimum")
    expect(quantize(3.0, 0.0, 1.0, 0.0), 1.0, "continuous clamps above the maximum")
    expect(quantize(0.4, 0.0, 1.0, -1.0), 0.4, "a negative step is continuous")
    expect(quantize(0.4, 0.0, 1.0, Double.NaN), 0.4, "a NaN step is continuous")
  }

  @Test
  fun tidyingRemovesBinaryFractionNoise() {
    val threeTenths = 0.1 + 0.1 + 0.1
    assertTrue("the float noise is real (fixture sanity)", threeTenths != 0.3)
    expect(quantize(threeTenths, 0.0, 1.0, 0.1), 0.3, "three tenths are 0.3")
    expect(quantize(0.34, 0.0, 1.0, 0.1), 0.3, "0.34 snaps down to 0.3")
    expect(quantize(0.36, 0.0, 1.0, 0.1), 0.4, "0.36 snaps up to 0.4")
    expect(quantize(0.7 + 0.1, 0.0, 1.0, 0.1), 0.8, "seven tenths plus a tenth is 0.8")
    expect(quantize(512.33999999999993, 0.0, 1000.0, 0.01), 512.34, "a noisy hundredth tidies")
    expect(NitroUiSliderValue.tidy(1e20 + 1e5), 1e20, "a 16th significant digit is the one shed")
    expect(NitroUiSliderValue.tidy(1.00000000000001e20), 1.00000000000001e20, "a huge value keeps its 15 digits")
    expect(NitroUiSliderValue.tidy(100.0), 100.0, "a round number is not moved")
    expect(NitroUiSliderValue.tidy(1e-7), 1e-7, "a small round number is not moved")
  }

  @Test
  fun snappingIsMeasuredFromTheMinimum() {
    expect(quantize(0.04, 0.0, 1.0, 0.1), 0.0, "the minimum is reachable")
    expect(quantize(1.0, 0.0, 1.0, 0.1), 1.0, "the maximum of a range that ends on a step")
    expect(quantize(5.0, 0.0, 1.0, 0.1), 1.0, "clamped before it is snapped")
    // A minimum that is not itself a multiple of the step.
    expect(quantize(0.4, -0.75, 1.0, 0.5), 0.25, "snapping is measured from the minimum")
  }

  @Test
  fun maximumIsAnExtraStopWhenTheRangeDoesNotEndOnOne() {
    expect(quantize(0.1, 0.0, 1.0, 0.3), 0.0, "0.1 is nearer 0 than 0.3")
    expect(quantize(0.2, 0.0, 1.0, 0.3), 0.3, "0.2 snaps to the first step")
    expect(quantize(0.5, 0.0, 1.0, 0.3), 0.6, "mid-range still snaps to a step")
    expect(quantize(0.85, 0.0, 1.0, 0.3), 0.9, "0.85 snaps to the last whole step")
    expect(quantize(0.96, 0.0, 1.0, 0.3), 1.0, "the maximum is reachable")
    expect(quantize(1.0, 0.0, 1.0, 0.3), 1.0, "...including at the very end")
  }

  @Test
  fun stepLargerThanTheRangeLeavesTheEndpoints() {
    expect(quantize(0.4, 0.0, 1.0, 5.0), 0.0, "below the middle")
    expect(quantize(0.6, 0.0, 1.0, 5.0), 1.0, "above it")
    expect(quantize(0.5, 0.0, 1.0, 5.0), 1.0, "a tie goes up")
  }

  @Test
  fun nonsenseInputNeverProducesNaN() {
    expect(quantize(0.4, 2.0, 2.0, 0.0), 2.0, "an empty range answers its minimum")
    expect(quantize(0.4, 5.0, 1.0, 0.0), 5.0, "an inverted range answers its minimum")
    expect(quantize(Double.NaN, 0.0, 1.0, 0.1), 0.0, "a NaN in does not come out as NaN")
    expect(quantize(Double.NaN, 2.0, 5.0, 0.0), 2.0, "a NaN lands on the minimum")
    expect(quantize(Double.POSITIVE_INFINITY, 0.0, 1.0, 0.0), 1.0, "an infinity clamps high")
    expect(quantize(Double.NEGATIVE_INFINITY, -5.0, 2.0, 0.0), -5.0, "a negative infinity clamps low")
    expect(quantize(0.4, Double.NaN, 1.0, 0.0), 0.4, "an unbounded range keeps the value")
  }

  /**
   * Ties, the reason [NitroUiSliderValue.roundHalfAway] exists.
   *
   * `kotlin.math.round` is `Math.rint`: it rounds a tie to the **even** neighbour.
   * Swift's `.rounded()` goes away from zero, and every quantity this rule rounds is
   * a count of steps, where "up" is the rule. Before `roundHalfAway` these four
   * vectors were the reviewer's repro: Android answered 0, 2, 0 and 0 where iOS
   * answered 1, 3, 0.5 and 1, so a JS `value={2.5}` with `step={1}` put the thumb on
   * a different stop per OS.
   */
  @Test
  fun tiesGoAwayFromZeroNotToTheEvenNeighbour() {
    expect(NitroUiSliderValue.roundHalfAway(0.5), 1.0, "0.5 goes to 1, not to the even 0")
    expect(NitroUiSliderValue.roundHalfAway(2.5), 3.0, "2.5 goes to 3, not to the even 2")
    expect(NitroUiSliderValue.roundHalfAway(-0.5), -1.0, "a negative tie goes away from zero")
    expect(NitroUiSliderValue.roundHalfAway(-2.5), -3.0, "...all the way down")
    expect(NitroUiSliderValue.roundHalfAway(0.4), 0.0, "a non-tie still rounds to nearest")
    expect(NitroUiSliderValue.roundHalfAway(0.6), 1.0, "...in either direction")
    expect(NitroUiSliderValue.roundHalfAway(-0.6), -1.0, "...including below zero")
    expect(quantize(0.5, 0.0, 2.0, 1.0), 1.0, "a mid-range tie goes up")
    expect(quantize(2.5, 0.0, 10.0, 1.0), 3.0, "a mid-range tie goes up, not to the even 2")
    // The steps are counted *up from the minimum*, so -2.5 in -5..5 is 2.5 steps in:
    // the tie is in the step count, and it goes up the track (old Kotlin: -3).
    expect(quantize(-2.5, -5.0, 5.0, 1.0), -2.0, "a tie in a negative range counts steps up from the minimum")
    expect(quantize(0.25, 0.0, 1.0, 0.5), 0.5, "a tie in a fraction goes up to the next stop")
    expect(quantize(1.5, 0.0, 3.0, 1.0), 2.0, "an integer-valued tie is the same either way")
  }

  @Test
  fun divisionKnowsWhichRangesASteppedControlCanDraw() {
    val tenths = NitroUiSliderValue.division(0.0, 1.0, 0.1)
    assertTrue("0..1 by tenths ends on a step", tenths != null && tenths.wholeSteps == 10.0 && tenths.endsOnStep)
    val thirds = NitroUiSliderValue.division(0.0, 1.0, 0.3)
    assertFalse("0..1 by 0.3 does not end on a step", thirds!!.endsOnStep)
    assertEquals("...and has three whole steps", 3.0, thirds.wholeSteps, 0.0)
    val whole = NitroUiSliderValue.division(0.0, 1.0, 1.0)
    assertTrue("one whole step ends on a step", whole != null && whole.wholeSteps == 1.0 && whole.endsOnStep)
    val oversized = NitroUiSliderValue.division(0.0, 1.0, 5.0)
    assertFalse("a step past the range does not end on a step", oversized!!.endsOnStep)
    assertEquals("...and has no whole steps", 0.0, oversized.wholeSteps, 0.0)
    assertFalse(
      "a range far shorter than a step is not one step wide",
      NitroUiSliderValue.division(0.0, 1e-12, 1.0)!!.endsOnStep,
    )
    assertNull("step 0 is continuous", NitroUiSliderValue.division(0.0, 1.0, 0.0))
    assertNull("an empty range is not stepped", NitroUiSliderValue.division(1.0, 1.0, 0.1))
  }

  /**
   * The accessibility increment: the next legal value in one direction.
   *
   * 0..10 step 3 is the docs' own example and the range that breaks a platform's
   * own increment - it does not end on a step, so the control is continuous, the
   * platform moves by a fraction of the range, and quantising that fraction lands
   * back on the value it started from. Every answer here is a value [quantize]
   * accepts, and both ends must be reachable.
   */
  @Test
  fun accessibilityStepGoesToTheNextLegalValueOnANonAlignedRange() {
    expect(stepped(0.0, true, 0.0, 10.0, 3.0), 3.0, "0..10 step 3: up from the bottom")
    expect(stepped(3.0, true, 0.0, 10.0, 3.0), 6.0, "0..10 step 3: up again")
    expect(stepped(6.0, true, 0.0, 10.0, 3.0), 9.0, "0..10 step 3: up again")
    expect(stepped(9.0, true, 0.0, 10.0, 3.0), 10.0, "0..10 step 3: the last move is to the maximum")
    expect(stepped(10.0, true, 0.0, 10.0, 3.0), 10.0, "0..10 step 3: nothing above the maximum")
    expect(stepped(10.0, false, 0.0, 10.0, 3.0), 9.0, "0..10 step 3: down from the maximum")
    expect(stepped(9.0, false, 0.0, 10.0, 3.0), 6.0, "0..10 step 3: down again")
    expect(stepped(6.0, false, 0.0, 10.0, 3.0), 3.0, "0..10 step 3: down again")
    expect(stepped(3.0, false, 0.0, 10.0, 3.0), 0.0, "0..10 step 3: down to the bottom")
    expect(stepped(0.0, false, 0.0, 10.0, 3.0), 0.0, "0..10 step 3: nothing below the minimum")
    expect(stepped(0.5, true, 0.0, 10.0, 3.0), 3.0, "a step is always a whole step, whatever it starts from")
  }

  @Test
  fun accessibilityStepFollowsTheSameGridTheControlDraws() {
    expect(stepped(0.0, true, 0.0, 100.0, 25.0), 25.0, "0..100 step 25: up")
    expect(stepped(50.0, true, 0.0, 100.0, 25.0), 75.0, "0..100 step 25: up from the middle")
    expect(stepped(75.0, true, 0.0, 100.0, 25.0), 100.0, "0..100 step 25: up to the top")
    expect(stepped(100.0, true, 0.0, 100.0, 25.0), 100.0, "0..100 step 25: no overshoot")
    expect(stepped(100.0, false, 0.0, 100.0, 25.0), 75.0, "0..100 step 25: down")
    expect(stepped(0.0, false, 0.0, 100.0, 25.0), 0.0, "0..100 step 25: no undershoot")
    // A fractional grid: (0.3 - 0) / 0.1 is 2.9999999999999996, so without the
    // tolerance an increment from 0.3 computes 0.30000000000000004 and quantises
    // back to 0.3 - the stuck increment again.
    expect(stepped(0.3, true, 0.0, 1.0, 0.1), 0.4, "tenths: up from 0.3 clears the binary fraction")
    expect(stepped(0.3, false, 0.0, 1.0, 0.1), 0.2, "tenths: down from 0.3")
    expect(stepped(0.9, true, 0.0, 1.0, 0.1), 1.0, "tenths: up to the top")
  }

  @Test
  fun accessibilityStepOnAContinuousRangeMovesAFractionOfTheSpan() {
    expect(stepped(0.0, true, 0.0, 1.0, 0.0), 0.05, "continuous: one twentieth of the range up")
    expect(stepped(0.05, false, 0.0, 1.0, 0.0), 0.0, "continuous: back down to the bottom")
    expect(stepped(1.0, false, 0.0, 1.0, 0.0), 0.95, "continuous: down from the top")
    expect(stepped(1.0, true, 0.0, 1.0, 0.0), 1.0, "continuous: nothing above the top")
    expect(stepped(0.0, false, 0.0, 1.0, 0.0), 0.0, "continuous: nothing below the bottom")
  }

  @Test
  fun accessibilityStepCannotInventMovementInTheDegenerateRanges() {
    expect(stepped(0.0, true, 0.0, 0.0, 1.0), 0.0, "an empty range cannot be incremented")
    expect(stepped(5.0, true, 5.0, 1.0, 1.0), 5.0, "an inverted range cannot be incremented")
    expect(stepped(0.0, true, 0.0, 1.0, 5.0), 1.0, "a step past the range has two stops: up")
    expect(stepped(1.0, false, 0.0, 1.0, 5.0), 0.0, "...and down")
    expect(stepped(1.0, true, 0.0, 1.0, 5.0), 1.0, "...and nothing past the top")
    expect(stepped(-10.0, true, -10.0, -1.0, 3.0), -7.0, "-10..-1 step 3: up")
    expect(stepped(-4.0, true, -10.0, -1.0, 3.0), -1.0, "-10..-1 step 3: up to the maximum")
    expect(stepped(-1.0, false, -10.0, -1.0, 3.0), -4.0, "-10..-1 step 3: down")
    expect(stepped(-10.0, false, -10.0, -1.0, 3.0), -10.0, "-10..-1 step 3: nothing below")
    expect(
      stepped(-8.5, false, -10.0, -1.0, 3.0),
      -10.0,
      "a step down from off-grid lands on a stop, not between",
    )
  }
}
