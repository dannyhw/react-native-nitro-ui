package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the two rules a Progress has that are worth testing without a
 * device: what the drawing code is allowed to be handed ([ProgressModel.drawnValue]),
 * and what the accessibility percentage says about it ([ProgressModel.percent]).
 *
 * Both are the Android twin of the same rule (`ProgressModel.drawnValue` /
 * `ProgressModel.percent` in `ios/components/Progress/HybridNitroUiProgress.swift`),
 * and the harness compares the two by reading `nuiTestDisplayedValue()` on each
 * platform; what lives here is the part that does not need a screen to be wrong -
 * an unclamped overshoot, a `NaN` reaching a canvas, or an indeterminate indicator
 * that stays indeterminate after its view left the window.
 *
 * Every Double comparison passes a delta of `0.0`: JUnit 4's two-argument
 * `assertEquals(double, double)` is deprecated *and throws*, and these numbers are
 * exact by construction, so the loose form would only hide a wrong clamp.
 */
class ProgressModelTest {
  // MARK: - drawnValue

  @Test
  fun aFractionInsideTheRangeIsDrawnAsSent() {
    val model = ProgressModel().apply { value = 0.25 }
    assertEquals(0.25, model.drawnValue!!, 0.0)
  }

  @Test
  fun anOvershootOrUndershootDrawsTheEndItPassed() {
    // Progress that arrives from a download callback overshoots; an indicator that
    // vanished over it would be worse than one that looked full for a frame.
    val model = ProgressModel()
    model.value = 1.7
    assertEquals(1.0, model.drawnValue!!, 0.0)
    model.value = -0.4
    assertEquals(0.0, model.drawnValue!!, 0.0)
  }

  @Test
  fun notANumberDrawsEmptyRatherThanPropagating() {
    // The unfinished division an app actually produces. `NaN` is not a number a
    // canvas can use, and it never equals anything, so it has to land on 0 here.
    val model = ProgressModel().apply { value = Double.NaN }
    assertEquals(0.0, model.drawnValue!!, 0.0)
  }

  @Test
  fun anIndeterminateIndicatorInAWindowIsIndeterminate() {
    val model = ProgressModel().apply { inWindow = true }
    assertNull(model.drawnValue)
    model.recordDrawn(model.drawnValue)
    assertEquals("displayed=indeterminate", model.displayedReport)
    assertTrue(model.isAnimating)
  }

  @Test
  fun anIndeterminateIndicatorOffWindowDrawsEmpty() {
    // The animation gate: away from a window the *indeterminate* control is drawn as
    // an empty determinate one, because the indeterminate one asks for frames
    // forever. `null` here means "still animating", so the assertion that matters is
    // that it is *not* null.
    val model = ProgressModel()
    assertEquals(0.0, model.drawnValue!!, 0.0)
    model.recordDrawn(model.drawnValue)
    assertEquals("displayed=0.0", model.displayedReport)
    assertFalse(model.isAnimating)
  }

  @Test
  fun aDeterminateIndicatorDrawsItsValueWhetherOrNotItIsVisible() {
    // Only indeterminate motion is gated - a determinate bar paints its fraction,
    // visible or not, and its box does not move either way.
    val model = ProgressModel().apply { value = 0.7 }
    assertEquals(0.7, model.drawnValue!!, 0.0)
    model.inWindow = true
    assertEquals(0.7, model.drawnValue!!, 0.0)
  }

  @Test
  fun enteringAndLeavingAWindowMovesAnIndeterminateIndicatorBothWays() {
    val model = ProgressModel()
    assertEquals(0.0, model.drawnValue!!, 0.0)
    model.inWindow = true
    assertNull(model.drawnValue)
    model.inWindow = false
    assertEquals(0.0, model.drawnValue!!, 0.0)
  }

  // MARK: - the test-only mirrors

  @Test
  fun nothingHasBeenDrawnBeforeTheComposableRuns() {
    // `nuiTestDisplayedValue()` answers with what the *drawing code* was handed, so
    // a model whose props arrived but whose composition did not must say "none"
    // rather than echo the prop.
    val model = ProgressModel().apply { value = 0.5 }
    assertEquals("displayed=none", model.displayedReport)
    assertFalse(model.isAnimating)
  }

  @Test
  fun aResetRecycleClearsTheGateAndTheReport() {
    val model = ProgressModel().apply {
      variant = ProgressModel.VARIANT_CIRCULAR
      inWindow = true
    }
    model.recordDrawn(model.drawnValue)
    assertTrue(model.isAnimating)

    model.reset()

    // Reset while still indeterminate: a host that kept `animating = true` would
    // report an animation the next owner never asked for.
    assertFalse(model.isAnimating)
    assertEquals("displayed=none", model.displayedReport)
    assertEquals(ProgressModel.VARIANT_LINEAR, model.variant)
    assertNull(model.value)
    assertFalse(model.inWindow)
    assertNull(model.tintColor)
    assertNull(model.trackColor)
    assertNull(model.accessibilityLabel)
    assertEquals("", model.sizingKey)
  }

  // MARK: - percent

  @Test
  fun percentRoundsTheFractionToAWholePercent() {
    assertEquals("0%", ProgressModel.percent(0.0))
    assertEquals("50%", ProgressModel.percent(0.5))
    assertEquals("100%", ProgressModel.percent(1.0))
    assertEquals("33%", ProgressModel.percent(0.33))
    // Half a percent goes up, the way SwiftUI's `.rounded()` does it on iOS.
    assertEquals("1%", ProgressModel.percent(0.005))
    assertEquals("63%", ProgressModel.percent(0.6264))
  }

  @Test
  fun percentSaysTheEndForAValueOutsideTheRange() {
    // The a11y value describes what is drawn, and [drawnValue] clamps - so the
    // percentage clamps the same way rather than announcing 170%.
    assertEquals("100%", ProgressModel.percent(1.7))
    assertEquals("0%", ProgressModel.percent(-2.0))
  }
}
