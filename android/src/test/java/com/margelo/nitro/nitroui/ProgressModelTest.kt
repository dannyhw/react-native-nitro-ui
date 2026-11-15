package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import androidx.compose.ui.unit.dp

// Double comparisons pass a delta of 0.0: JUnit 4's two-argument form always fails.
class ProgressModelTest {
  // MARK: - drawnValue

  @Test
  fun aFractionInsideTheRangeIsDrawnAsSent() {
    val model = ProgressModel().apply { value = 0.25 }
    assertEquals(0.25, model.drawnValue!!, 0.0)
  }

  @Test
  fun anOvershootOrUndershootDrawsTheEndItPassed() {
    val model = ProgressModel()
    model.value = 1.7
    assertEquals(1.0, model.drawnValue!!, 0.0)
    model.value = -0.4
    assertEquals(0.0, model.drawnValue!!, 0.0)
  }

  @Test
  fun notANumberDrawsEmptyRatherThanPropagating() {
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
    // Away from a window an indeterminate control is drawn as an empty determinate one,
    // because the indeterminate one asks for frames forever. `null` means "still animating".
    val model = ProgressModel()
    assertEquals(0.0, model.drawnValue!!, 0.0)
    model.recordDrawn(model.drawnValue)
    assertEquals("displayed=0.0", model.displayedReport)
    assertFalse(model.isAnimating)
  }

  @Test
  fun aDeterminateIndicatorDrawsItsValueWhetherOrNotItIsVisible() {
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

  // MARK: - waveSpeed

  @Test
  fun anOffWindowWaveIsPinnedWhileAnInWindowOneKeepsMaterialsSpeed() {
    // Material's determinate wave animates whenever it is attached and its speed is above
    // zero. Zero stops it; `null` leaves Material's default.
    val model = ProgressModel().apply {
      appearance = ProgressModel.APPEARANCE_WAVY
      value = 0.4
    }
    assertEquals(0.dp, model.waveSpeed)

    model.inWindow = true
    assertNull(model.waveSpeed)
  }

  @Test
  fun aDeterminateWaveInAWindowCountsAsAnimatingBecauseMaterialMovesIt() {
    val model = ProgressModel().apply {
      appearance = ProgressModel.APPEARANCE_WAVY
      value = 0.4
      inWindow = true
    }
    model.recordDrawn(model.drawnValue)
    assertTrue(model.isAnimating)

    model.appearance = ProgressModel.APPEARANCE_FLAT
    model.recordDrawn(model.drawnValue)
    assertFalse(model.isAnimating)

    model.appearance = ProgressModel.APPEARANCE_WAVY
    model.inWindow = false
    model.recordDrawn(model.drawnValue)
    assertFalse(model.isAnimating)
  }

  // MARK: - the test-only mirrors

  @Test
  fun nothingHasBeenDrawnBeforeTheComposableRuns() {
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

  // MARK: - configuration

  @Test
  fun aResetClearsTheConfigurationToo() {
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
    // Material's loading indicator has no wavy form.
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
    val model = ProgressModel()
    assertFalse(model.isIntrinsicShape)
    model.variant = ProgressModel.VARIANT_CIRCULAR
    assertTrue(model.isIntrinsicShape)
    model.variant = ProgressModel.VARIANT_LOADING
    assertTrue(model.isIntrinsicShape)
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
    assertEquals("100%", ProgressModel.percent(1.7))
    assertEquals("0%", ProgressModel.percent(-2.0))
  }
}
