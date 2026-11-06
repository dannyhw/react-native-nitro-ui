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

  // MARK: - configuration (E4)

  @Test
  fun aResetClearsTheConfigurationToo() {
    // `prepareForRecycle` resets the model, and E4 added two configuration fields to
    // it. A recycled view that kept `wavy` would show its previous owner's Material
    // wave to the next one - and the wrapper re-sends every prop on each mount, so
    // this reset is the belt rather than the braces: nothing on either platform can
    // show it missing through a prop read, which is why it is asserted here.
    val model = ProgressModel().apply {
      variant = ProgressModel.VARIANT_LOADING
      appearance = ProgressModel.APPEARANCE_WAVY
      contained = true
    }

    model.reset()

    assertEquals(ProgressModel.VARIANT_LINEAR, model.variant)
    assertEquals(ProgressModel.APPEARANCE_FLAT, model.appearance)
    assertFalse(model.contained)
    assertFalse(model.drawsWavy)
    assertFalse(model.drawsContainer)
    assertFalse(model.isIntrinsicShape)
  }

  @Test
  fun onlyAShapeThatHasAWavyFormDrawsWavy() {
    // `appearance` is one of the two props E4 adds, and it is not a promise the
    // loading indicator makes: Material has no wavy form of it. The drawing code asks
    // [drawsWavy] rather than the field, so this is the whole of that rule.
    val model = ProgressModel().apply { appearance = ProgressModel.APPEARANCE_WAVY }
    assertTrue(model.drawsWavy)
    model.variant = ProgressModel.VARIANT_CIRCULAR
    assertTrue(model.drawsWavy)
    model.variant = ProgressModel.VARIANT_LOADING
    assertFalse(model.drawsWavy)
    model.appearance = ProgressModel.APPEARANCE_FLAT
    assertFalse(model.drawsWavy)
  }

  @Test
  fun onlyTheLoadingShapeHasAContainer() {
    val model = ProgressModel().apply { contained = true }
    assertFalse(model.drawsContainer)
    model.variant = ProgressModel.VARIANT_CIRCULAR
    assertFalse(model.drawsContainer)
    model.variant = ProgressModel.VARIANT_LOADING
    assertTrue(model.drawsContainer)
    model.contained = false
    assertFalse(model.drawsContainer)
  }

  @Test
  fun aRingAndALoadingIndicatorBothAskTheIntrinsicQuestion() {
    // The sizing policy `host.sizingPolicy` is set from this, and a shape that got
    // the wrong one is a control that measures the wrong thing forever: a `fillWidth`
    // bar has no width of its own to answer with, and a 48 dp square asked at the
    // box's width is a stretched ring.
    val model = ProgressModel()
    assertFalse(model.isIntrinsicShape)
    model.variant = ProgressModel.VARIANT_CIRCULAR
    assertTrue(model.isIntrinsicShape)
    model.variant = ProgressModel.VARIANT_LOADING
    assertTrue(model.isIntrinsicShape)
    // `appearance` moves a box (10 dp against 4) but not the *question*, which is why
    // an appearance change re-measures instead of remounting.
    model.appearance = ProgressModel.APPEARANCE_WAVY
    assertTrue(model.isIntrinsicShape)
    model.variant = ProgressModel.VARIANT_LINEAR
    assertFalse(model.isIntrinsicShape)
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
