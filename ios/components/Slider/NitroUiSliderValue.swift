// The value rules of a Slider: clamp to the range, snap to the step, and drop floating-point
// noise. No UIKit here, so the host-side native tests can compile it. Kotlin has a twin.
import Foundation

/// How a Slider turns a raw value from a finger, an accessibility increment or React into
/// one it may show. Both platforms implement the rule identically and only native runs it:
/// React's `value` is compared exactly, so rounding again in JS would cause reverts.
enum NitroUiSliderValue {
  /// Significant digits a reported value is rounded to. Three tenths added up is
  /// `0.30000000000000004`, which fails the exact comparison with React's `0.3` and would
  /// snap the thumb back. Fifteen digits removes that noise and nothing a slider can express.
  static let significantDigits = 15

  /// Relative tolerance for "this range is a whole number of steps": `(1.0 - 0.0) / 0.1` is
  /// not exactly 10.
  static let divisionTolerance = 1e-9

  /// How many whole steps of `step` fit between two bounds.
  struct Division {
    /// Whole steps between the bounds: the exact count when the range ends on a
    /// step, and `floor`ed count when it does not. Always >= 1 when
    /// ``endsOnStep`` is `true`.
    let wholeSteps: Double
    /// Whether `maximum` is itself a multiple of `step` from `minimum` - in which
    /// case the platform's own stepped control can draw this range, because the
    /// top of the track is one of its stops.
    let endsOnStep: Bool
  }

  /// The stepped shape of `[minimum, maximum]` at `step`, or `nil` when the
  /// inputs cannot describe one (an empty or inverted range, a `step` that is
  /// not a finite positive number). `nil` means *continuous*.
  static func division(minimum: Double, maximum: Double, step: Double) -> Division? {
    guard minimum.isFinite, maximum.isFinite, step.isFinite, step > 0, maximum > minimum else {
      return nil
    }
    let intervals = (maximum - minimum) / step
    let nearest = roundHalfAway(intervals)
    let tolerance = max(divisionTolerance, abs(intervals) * divisionTolerance)
    // `nearest >= 1`: a range shorter than a hair of one step is not "exactly one
    // step wide", and calling it that would make the minimum unreachable.
    if nearest >= 1, abs(intervals - nearest) <= tolerance {
      return Division(wholeSteps: nearest, endsOnStep: true)
    }
    return Division(wholeSteps: max(0, floor(intervals)), endsOnStep: false)
  }

  /// Rounds to the nearest integer, with a tie going away from zero. Named so the platforms
  /// cannot drift: Kotlin's `round` sends a tie to the even neighbour, which would put a
  /// value of 2.5 on a different stop per platform.
  static func roundHalfAway(_ x: Double) -> Double {
    return x.rounded()
  }

  /// The value a Slider shows and reports for `raw`:
  ///
  /// - clamped into `[minimum, maximum]`;
  /// - with a usable `step > 0`, snapped to the nearest multiple of `step` from `minimum`,
  ///   or to the maximum, which is a legal value even when it is not on the grid;
  /// - rounded to `significantDigits` digits.
  ///
  /// Never returns NaN.
  static func quantize(raw: Double, minimum: Double, maximum: Double, step: Double) -> Double {
    guard minimum.isFinite, maximum.isFinite else {
      // Without finite bounds there is nothing to clamp to.
      return raw.isFinite ? raw : 0
    }
    guard maximum > minimum else {
      // A range with no width has one value.
      return tidy(minimum)
    }
    guard raw.isFinite else {
      // `min` and `max` answer NaN when either side is NaN, so a non-finite raw is decided
      // here: an infinity goes to that end of the range, a NaN to the minimum.
      return raw.isNaN ? tidy(minimum) : tidy(raw > 0 ? maximum : minimum)
    }
    let clamped = min(max(raw, minimum), maximum)
    guard let division = division(minimum: minimum, maximum: maximum, step: step) else {
      return tidy(clamped)
    }

    let stepsFromMinimum = roundHalfAway((clamped - minimum) / step)
    if stepsFromMinimum < division.wholeSteps {
      return tidy(minimum + stepsFromMinimum * step)
    }

    // At or past the last whole step: either that step is the maximum, or the maximum is one
    // extra stop and the nearer of the two wins.
    if division.endsOnStep {
      return tidy(maximum)
    }
    let lastStepValue = minimum + division.wholeSteps * step
    if clamped - lastStepValue >= maximum - clamped {
      return tidy(maximum)
    }
    return tidy(lastStepValue)
  }

  /// `value` rounded to `significantDigits` significant digits. `0`, non-finite numbers and
  /// values whose scale factor would overflow come back untouched.
  static func tidy(_ value: Double) -> Double {
    guard value.isFinite, value != 0 else {
      return value
    }
    let exponent = floor(log10(abs(value)))
    let scale = pow(10, Double(significantDigits - 1) - exponent)
    let scaled = value * scale
    guard scaled.isFinite else {
      return value
    }
    return roundHalfAway(scaled) / scale
  }

  /// A continuous control's accessibility increment moves one twentieth of its range: about
  /// 5% of the track.
  static let continuousStepDivisions = 20.0

  /// The next legal value above `from` (or below it, when `up` is false): the rule an
  /// accessibility increment follows.
  ///
  /// The platform's own increment is a fraction of the range, and on a range that does not
  /// end on a step (`0...10 step 3`) a fraction smaller than half a step quantises back to
  /// where it was. So the platform contributes only the direction. At a bound the answer is
  /// the bound.
  static func stepped(
    from: Double,
    up: Bool,
    minimum: Double,
    maximum: Double,
    step: Double
  ) -> Double {
    // Start from a legal value, so neither branch below has to handle nonsense input.
    let start = quantize(raw: from, minimum: minimum, maximum: maximum, step: step)
    guard division(minimum: minimum, maximum: maximum, step: step) != nil else {
      // Continuous (no usable step, or a range with no width to move along).
      guard maximum > minimum else {
        return start
      }
      let stride = (maximum - minimum) / continuousStepDivisions
      return quantize(
        raw: start + (up ? stride : -stride),
        minimum: minimum,
        maximum: maximum,
        step: step
      )
    }
    // Steps counted from `minimum`, with the same tolerance as `division`.
    let stepsFromMinimum = (start - minimum) / step
    let tolerance = max(divisionTolerance, abs(stepsFromMinimum) * divisionTolerance)
    let target: Double
    if up {
      // The next whole step above. `floor` first so a value sitting *on* a stop
      // moves to the one after it rather than staying put.
      target = minimum + (floor(stepsFromMinimum + tolerance) + 1) * step
    } else {
      target = minimum + (ceil(stepsFromMinimum - tolerance) - 1) * step
    }
    // Past either end, the end is the next stop.
    if target > maximum { return tidy(maximum) }
    if target < minimum { return tidy(minimum) }
    return tidy(target)
  }
}
