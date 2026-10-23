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
}
