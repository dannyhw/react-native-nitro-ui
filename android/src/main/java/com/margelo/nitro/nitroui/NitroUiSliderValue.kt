package com.margelo.nitro.nitroui

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.round

// The value rules of a Slider: clamp, snap to the step, and drop binary-fraction noise.
// Must match `ios/components/Slider/NitroUiSliderValue.swift`; the test vectors are shared.

/**
 * Runs natively only: a control quantises before it emits and then compares React's
 * `value` exactly, so re-deriving the number in JS with other rounding would revert it.
 */
internal object NitroUiSliderValue {
  /**
   * Significant digits a value is rounded to. Three tenths added up is 0.30000000000000004,
   * which would fail the exact comparison with React's 0.3. Also hides the round trip
   * through Material's `Float`-based Slider.
   */
  const val SIGNIFICANT_DIGITS = 15

  /** Relative tolerance for "a whole number of steps": (1.0 - 0.0) / 0.1 is not exactly 10. */
  const val DIVISION_TOLERANCE = 1e-9

  /**
   * [wholeSteps] is exact when the range ends on a step, floored otherwise. [endsOnStep]
   * means the maximum is a stop, so the platform's own stepped control can draw the range.
   */
  internal class Division(val wholeSteps: Double, val endsOnStep: Boolean)

  /** The stepped shape of the range, or `null` (continuous) for an unusable range or step. */
  fun division(
    minimum: Double,
    maximum: Double,
    step: Double,
  ): Division? {
    if (!minimum.isFinite() || !maximum.isFinite() || !step.isFinite() || step <= 0.0 || maximum <= minimum) {
      return null
    }
    val intervals = (maximum - minimum) / step
    val nearest = roundHalfAway(intervals)
    val tolerance = maxOf(DIVISION_TOLERANCE, abs(intervals) * DIVISION_TOLERANCE)
    // A range shorter than a hair of one step is not "exactly one step wide", and
    // calling it that would make the minimum unreachable.
    if (nearest >= 1 && abs(intervals - nearest) <= tolerance) {
      return Division(nearest, true)
    }
    return Division(maxOf(0.0, floor(intervals)), false)
  }

  /**
   * Rounds half away from zero, like Swift's `rounded()`. Kotlin's [round] sends a tie to
   * the even neighbour, and `floor(x + 0.5)` is wrong just under a tie because the addition
   * itself rounds. So [round] gives the magnitude and the exact tie is handled separately.
   */
  fun roundHalfAway(
    x: Double,
  ): Double {
    if (!x.isFinite() || x == 0.0) {
      return x
    }
    val magnitude = abs(x)
    val whole = floor(magnitude)
    val rounded = if (magnitude - whole == 0.5) whole + 1.0 else round(magnitude)
    return if (x < 0.0) -rounded else rounded
  }

  /**
   * The value shown for [raw]: clamped, snapped to a multiple of the step from the minimum,
   * and tidied. The maximum is always a legal value, even off the step grid, so the top of
   * the track stays reachable. Never returns NaN.
   */
  fun quantize(
    raw: Double,
    minimum: Double,
    maximum: Double,
    step: Double,
  ): Double {
    if (!minimum.isFinite() || !maximum.isFinite()) {
      // Without finite bounds there is nothing to clamp to, and a nonsense number
      // is worse than no number: keep the control where it is.
      return if (raw.isFinite()) raw else 0.0
    }
    if (maximum <= minimum) {
      // A range with no width has one value.
      return tidy(minimum)
    }
    if (!raw.isFinite()) {
      // A NaN cannot be clamped; it goes to the minimum. An infinity goes to its end.
      return if (raw.isNaN()) tidy(minimum) else tidy(if (raw > 0) maximum else minimum)
    }
    val clamped = minOf(maxOf(raw, minimum), maximum)
    val division = division(minimum, maximum, step) ?: return tidy(clamped)

    val stepsFromMinimum = roundHalfAway((clamped - minimum) / step)
    if (stepsFromMinimum < division.wholeSteps) {
      return tidy(minimum + stepsFromMinimum * step)
    }

    // At or past the last whole step: snap to the nearer of that step and the maximum.
    if (division.endsOnStep) {
      return tidy(maximum)
    }
    val lastStepValue = minimum + division.wholeSteps * step
    return if (clamped - lastStepValue >= maximum - clamped) tidy(maximum) else tidy(lastStepValue)
  }

  /** Rounds to [SIGNIFICANT_DIGITS]. Returns 0, non-finite and overflowing values unchanged. */
  fun tidy(value: Double): Double {
    if (!value.isFinite() || value == 0.0) {
      return value
    }
    val exponent = floor(log10(abs(value)))
    val scale = 10.0.pow(SIGNIFICANT_DIGITS - 1 - exponent)
    val scaled = value * scale
    if (!scaled.isFinite()) {
      return value
    }
    return roundHalfAway(scaled) / scale
  }

  /** A continuous control's accessibility step is one twentieth of its range. */
  const val CONTINUOUS_STEP_DIVISIONS = 20.0

  /**
   * The next legal value above or below [from], for an accessibility step. The platform's
   * own step is a fraction of the range, which on a range such as 0..10 step 3 quantises
   * back to where it started. At a bound the answer is the bound.
   */
  fun stepped(
    from: Double,
    up: Boolean,
    minimum: Double,
    maximum: Double,
    step: Double,
  ): Double {
    // Start from a legal value.
    val start = quantize(from, minimum, maximum, step)
    val division = division(minimum, maximum, step)
    if (division == null) {
      // Continuous (no usable step, or a range with no width to move along).
      if (maximum <= minimum) {
        return start
      }
      val stride = (maximum - minimum) / CONTINUOUS_STEP_DIVISIONS
      return quantize(start + if (up) stride else -stride, minimum, maximum, step)
    }
    // The same tolerance as [division]: a step added three times is not three steps in binary.
    val stepsFromMinimum = (start - minimum) / step
    val tolerance = maxOf(DIVISION_TOLERANCE, abs(stepsFromMinimum) * DIVISION_TOLERANCE)
    val target =
      if (up) {
        // The next whole step above. Floor first so a value sitting *on* a stop
        // moves to the one after it rather than staying put.
        minimum + (floor(stepsFromMinimum + tolerance) + 1) * step
      } else {
        minimum + (ceil(stepsFromMinimum - tolerance) - 1) * step
      }
    // Past an end, the end is the next stop.
    if (target > maximum) {
      return tidy(maximum)
    }
    if (target < minimum) {
      return tidy(minimum)
    }
    return tidy(target)
  }
}
