//
//  NitroUiSliderValue.swift
//  react-native-nitro-ui
//
//  The value rules of a Slider: clamp to the range, snap to the step, and shed
//  the noise a binary fraction leaves behind. A separate file with no UIKit in
//  it, so `bun run test:native` compiles and runs it on the host next to the
//  handshake - and so the Kotlin twin in
//  `android/src/test/.../NitroUiSliderValueTest.kt` has one rule to mirror.
//
import Foundation

/// How a Slider turns whatever the finger, an accessibility increment or React
/// produced into a value it is allowed to show.
///
/// Both platforms implement this rule identically, and native is the only place
/// it runs. `docs/architecture/core.md` §11 is explicit about why: a control
/// quantises *before* emitting and then compares React's `value` exactly, and
/// re-deriving the number in JS with different rounding makes native revert to a
/// value nobody dragged to.
enum NitroUiSliderValue {
  /// Significant digits a reported value is rounded to.
  ///
  /// A tenth is not representable in binary, so three tenths added up is
  /// `0.30000000000000004`. That number is *almost* the value the user set the
  /// thumb to, and it is enough to break the exact comparison the handshake does
  /// between native's displayed value and React's (`NitroUiControlledValue`,
  /// §4): React holds `0.3`, native holds `0.30000000000000004`, so every write
  /// looks like a change and native snaps the thumb back under the finger.
  /// Fifteen significant digits is below the resolution anything a slider can
  /// express and above the noise, so this drops exactly the digits the
  /// arithmetic invented.
  static let significantDigits = 15

  /// Relative tolerance for "this range is a whole number of steps".
  ///
  /// `(1.0 - 0.0) / 0.1` is not exactly 10, and a rule about snapping that broke
  /// on the last binary bit would be a rule about not snapping.
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

  /// Rounds to the nearest integer with a tie going **away from zero**.
  ///
  /// Spelled as a function of its own so the two platforms cannot drift: Kotlin's
  /// `kotlin.math.round` is `Math.rint`, which sends a tie to the **even**
  /// neighbour, and every quantity this library rounds is a count of steps measured
  /// from `minimumValue`, where "the thumb goes to the next stop" has to be the same
  /// stop on both OSes. With `Math.rint`, `quantize(2.5, 0...10, step: 1)` answered 2
  /// on Android and 3 on iOS, so a controlled `value={2.5}` put the thumb on
  /// different stops per platform. `Double.rounded()` is already away-from-zero;
  /// naming it here is the guard, and `roundHalfAway` is the Kotlin twin.
  static func roundHalfAway(_ x: Double) -> Double {
    return x.rounded()
  }

  /// The value a Slider shows and reports for `raw`.
  ///
  /// - clamped into `[minimum, maximum]`;
  /// - with a usable `step > 0`, snapped to the nearest legal value - the
  ///   multiples of `step` measured from `minimum`, plus the maximum itself when
  ///   the range is not a whole number of steps;
  /// - always rounded to ``significantDigits`` digits.
  ///
  /// The maximum is a legal value even when it is not a multiple of the step: a
  /// control whose top end cannot be reached is a bug nobody can work around
  /// from JS, and it is what Material 3's `steps` does too (its endpoints are
  /// always stops). Where the range *does* end on a step, this rule and the
  /// platform's own are the same rule - which is what lets the control be handed
  /// to SwiftUI/M3 to draw natively.
  ///
  /// There is no `NaN` out of this function, in or out: a `NaN` in a SwiftUI
  /// `Binding` or a Compose snapshot is a broken control nobody can trace back to
  /// a prop.
  static func quantize(raw: Double, minimum: Double, maximum: Double, step: Double) -> Double {
    guard minimum.isFinite, maximum.isFinite else {
      // Without finite bounds there is nothing to clamp to, and a nonsense number
      // is worse than no number: keep the control where it is.
      return raw.isFinite ? raw : 0
    }
    guard maximum > minimum else {
      // A range with no width has one value.
      return tidy(minimum)
    }
    guard raw.isFinite else {
      // min and max answer NaN whenever either side is NaN, on both platforms,
      // so a non-finite raw cannot be clamped - it has to be decided. An
      // infinity is honestly out of range; a NaN has no reading at all, so it
      // goes to the bottom of the range where an untouched control starts.
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

    // At or past the last whole step. Either that step *is* the maximum, or the
    // maximum is one extra stop and the thumb snaps to whichever of the two it is
    // nearer - the same rule one step down, not a special case at the top.
    if division.endsOnStep {
      return tidy(maximum)
    }
    let lastStepValue = minimum + division.wholeSteps * step
    if clamped - lastStepValue >= maximum - clamped {
      return tidy(maximum)
    }
    return tidy(lastStepValue)
  }

  /// `value` rounded to ``significantDigits`` significant digits.
  ///
  /// Returns `value` untouched for `0`, a non-finite number, or an exponent far
  /// enough out that the scale factor would overflow - none of which have noise
  /// left to remove at 15 digits.
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
}
