package com.margelo.nitro.nitroui

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.round

/*
 * The value rules of a Slider: clamp to the range, snap to the step, and shed the
 * noise a binary fraction leaves behind. The Android twin of
 * `ios/components/Slider/NitroUiSliderValue.swift`, and the vectors in
 * `android/src/test/.../NitroUiSliderValueTest.kt` are the vectors in
 * `scripts/native-tests/slider-value.test.swift`.
 *
 * Pure arithmetic with no Compose or Android in it, so it runs on the JVM. Change
 * the rule, change all three copies.
 */

/**
 * How a Slider turns whatever the finger, an accessibility increment or React
 * produced into a value it is allowed to show.
 *
 * Both platforms implement this rule identically, and native is the only place it
 * runs: `docs/architecture/core.md` §11 is explicit about why - a control
 * quantises *before* emitting and then compares React's `value` exactly, and
 * re-deriving the number in JS with different rounding makes native revert to a
 * value nobody dragged to.
 */
internal object NitroUiSliderValue {
  /**
   * Significant digits a reported value is rounded to.
   *
   * A tenth is not representable in binary, so three tenths added up is
   * 0.30000000000000004. That number is almost the value the user set the thumb
   * to, and it is enough to break the exact comparison the handshake does between
   * native's displayed value and React's: React holds 0.3, native holds
   * 0.30000000000000004, so every write looks like a change and native snaps the
   * thumb back under the finger. Fifteen significant digits is below the
   * resolution anything a slider can express and above the noise, so this drops
   * exactly the digits the arithmetic invented.
   *
   * On Android it does a second job: Material 3's Slider is float-based, so a
   * value that goes to the control and comes back has been through 32 bits. The
   * tidying is what lets a Double API sit on top of that.
   */
  const val SIGNIFICANT_DIGITS = 15

  /**
   * Relative tolerance for "this range is a whole number of steps".
   *
   * (1.0 - 0.0) / 0.1 is not exactly 10, and a rule about snapping that broke on
   * the last binary bit would be a rule about not snapping.
   */
  const val DIVISION_TOLERANCE = 1e-9

  /**
   * How many whole steps of [step] fit between two bounds.
   *
   * @param wholeSteps the exact count when the range ends on a step, and the
   * floored count when it does not. Always at least 1 when [endsOnStep].
   * @param endsOnStep whether `maximumValue` is itself a multiple of the step from
   * `minimumValue` - in which case the platform's own stepped control can draw
   * this range, because the top of the track is one of its stops.
   */
  internal class Division(val wholeSteps: Double, val endsOnStep: Boolean)

  /**
   * The stepped shape of `minimumValue..maximumValue` at [step], or `null` when
   * the inputs cannot describe one: an empty or inverted range, or a step that is
   * not a finite positive number. `null` means *continuous*.
   */
  fun division(
    minimum: Double,
    maximum: Double,
    step: Double,
  ): Division? {
    if (!minimum.isFinite() || !maximum.isFinite() || !step.isFinite() || step <= 0.0 || maximum <= minimum) {
      return null
    }
    val intervals = (maximum - minimum) / step
    val nearest = round(intervals)
    val tolerance = maxOf(DIVISION_TOLERANCE, abs(intervals) * DIVISION_TOLERANCE)
    // A range shorter than a hair of one step is not "exactly one step wide", and
    // calling it that would make the minimum unreachable.
    if (nearest >= 1 && abs(intervals - nearest) <= tolerance) {
      return Division(nearest, true)
    }
    return Division(maxOf(0.0, floor(intervals)), false)
  }

  /**
   * The value a Slider shows and reports for [raw]: clamped into the range, and
   * with a usable step snapped to the nearest legal value - the multiples of the
   * step measured from `minimumValue`, plus the maximum itself when the range is
   * not a whole number of steps. Always rounded to [SIGNIFICANT_DIGITS] digits.
   *
   * The maximum is a legal value even when it is not a multiple of the step: a
   * control whose top end cannot be reached is a bug nobody can work around from
   * JS, and it is what Material 3's `steps` does too (its endpoints are always
   * stops). Where the range *does* end on a step, this rule and the platform's own
   * are the same rule - which is what lets the control be handed the step to draw.
   *
   * There is no NaN out of this function, in or out: a NaN in a Compose snapshot
   * or a SwiftUI Binding is a broken control nobody can trace back to a prop.
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
      // min and max answer NaN whenever either side is NaN, on both platforms, so
      // a non-finite raw cannot be clamped - it has to be decided. An infinity is
      // honestly out of range; a NaN has no reading at all, so it goes to the
      // bottom of the range where an untouched control starts.
      return if (raw.isNaN()) tidy(minimum) else tidy(if (raw > 0) maximum else minimum)
    }
    val clamped = minOf(maxOf(raw, minimum), maximum)
    val division = division(minimum, maximum, step) ?: return tidy(clamped)

    val stepsFromMinimum = round((clamped - minimum) / step)
    if (stepsFromMinimum < division.wholeSteps) {
      return tidy(minimum + stepsFromMinimum * step)
    }

    // At or past the last whole step. Either that step *is* the maximum, or the
    // maximum is one extra stop and the thumb snaps to whichever of the two it is
    // nearer - the same rule one step down, not a special case at the top.
    if (division.endsOnStep) {
      return tidy(maximum)
    }
    val lastStepValue = minimum + division.wholeSteps * step
    return if (clamped - lastStepValue >= maximum - clamped) tidy(maximum) else tidy(lastStepValue)
  }

  /**
   * [value] rounded to [SIGNIFICANT_DIGITS] significant digits.
   *
   * Returns [value] untouched for 0, a non-finite number, or an exponent far
   * enough out that the scale factor would overflow - none of which have noise
   * left to remove at 15 digits.
   */
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
    return round(scaled) / scale
  }
}
