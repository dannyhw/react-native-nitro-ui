//
//  slider-value.test.swift
//
//  Host-side vectors for the Slider's value rule (see
//  ios/components/Slider/NitroUiSliderValue.swift). The Kotlin twin is
//  android/src/test/java/com/margelo/nitro/nitroui/NitroUiSliderValueTest.kt and
//  the vectors are the same set: change one semantics, change all three.
//
import Foundation

/// `@main` because `swiftc` only allows top-level statements in a file named
/// `main.swift`, and this compiles together with the shipping file.
@main
struct SliderValueTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  /// Asserts *exact* `Double` equality on purpose. The whole point of tidying is
  /// that the value native holds is bit-for-bit the value React holds, so a test
  /// that allowed an epsilon would pass the bug it exists to catch.
  private static func checkEquals(_ actual: Double, _ expected: Double, _ what: String) {
    check(actual == expected, "\(what) (got \(actual), want \(expected))")
  }

  private static func quantize(_ raw: Double, _ min: Double, _ max: Double, _ step: Double) -> Double {
    NitroUiSliderValue.quantize(raw: raw, minimum: min, maximum: max, step: step)
  }

  static func main() {
    print("NitroUiSliderValue")

    // Continuous: clamp, and nothing else.
    checkEquals(quantize(0.4, 0, 1, 0), 0.4, "continuous keeps a value in range")
    checkEquals(quantize(-3, 0, 1, 0), 0, "continuous clamps below the minimum")
    checkEquals(quantize(3, 0, 1, 0), 1, "continuous clamps above the maximum")
    checkEquals(quantize(0.4, 0, 1, -1), 0.4, "a negative step is continuous")
    checkEquals(quantize(0.4, 0, 1, .nan), 0.4, "a NaN step is continuous")

    // The tidying case this file exists for: three binary tenths are not 0.3.
    check(0.1 + 0.1 + 0.1 != 0.3, "the float noise is real (fixture sanity)")
    checkEquals(quantize(0.1 + 0.1 + 0.1, 0, 1, 0.1), 0.3, "three tenths are 0.3")
    checkEquals(quantize(0.34, 0, 1, 0.1), 0.3, "0.34 snaps down to 0.3")
    checkEquals(quantize(0.36, 0, 1, 0.1), 0.4, "0.36 snaps up to 0.4")
    checkEquals(quantize(0.04, 0, 1, 0.1), 0, "the minimum is reachable")
    checkEquals(quantize(1, 0, 1, 0.1), 1, "the maximum of a range that ends on a step")
    checkEquals(quantize(5, 0, 1, 0.1), 1, "clamped before it is snapped")
    // A minimum that is not itself a multiple of the step: snapping counts up
    // from the bottom of the range, not from zero.
    checkEquals(quantize(0.4, -0.75, 1, 0.5), 0.25, "snapping is measured from the minimum")

    // A range that does NOT end on a step keeps the maximum as an extra stop.
    checkEquals(quantize(0.1, 0, 1, 0.3), 0, "0.1 is nearer 0 than 0.3")
    checkEquals(quantize(0.2, 0, 1, 0.3), 0.3, "0.2 snaps to the first step")
    checkEquals(quantize(0.85, 0, 1, 0.3), 0.9, "0.85 snaps to the last whole step")
    checkEquals(quantize(0.96, 0, 1, 0.3), 1, "the maximum is reachable...")
    checkEquals(quantize(1, 0, 1, 0.3), 1, "...including at the very end")
    checkEquals(quantize(0.5, 0, 1, 0.3), 0.6, "mid-range still snaps to a step")

    // A step larger than the range: the two endpoints are the only values.
    checkEquals(quantize(0.4, 0, 1, 5), 0, "a step bigger than the range: below the middle")
    checkEquals(quantize(0.6, 0, 1, 5), 1, "a step bigger than the range: above it")
    checkEquals(quantize(0.5, 0, 1, 5), 1, "a tie goes up")

    // Degenerate ranges have one value; nonsense input has no NaN in it.
    checkEquals(quantize(0.4, 2, 2, 0), 2, "an empty range answers its minimum")
    checkEquals(quantize(0.4, 5, 1, 0), 5, "an inverted range answers its minimum")
    checkEquals(quantize(.nan, 0, 1, 0.1), 0, "a NaN in does not come out as NaN")
    checkEquals(quantize(.infinity, 0, 1, 0), 1, "an infinity clamps high")
    checkEquals(quantize(-.infinity, -5, 2, 0), -5, "a negative infinity clamps low")
    checkEquals(quantize(.nan, 2, 5, 0), 2, "a NaN lands on the minimum")
    checkEquals(quantize(0.4, .nan, 1, 0), 0.4, "an unbounded range keeps the value")

    // Tidying beyond the tenth.
    checkEquals(quantize(512.33999999999993, 0, 1000, 0.01), 512.34, "a noisy hundredth tidies")
    checkEquals(quantize(0.7 + 0.1, 0, 1, 0.1), 0.8, "seven tenths plus a tenth is 0.8")
    checkEquals(quantize(1.00000000000001e+20, 0, 1e+21, 0), 1.00000000000001e+20,
                "a huge value keeps its 15 digits")
    checkEquals(NitroUiSliderValue.tidy(1e+20 + 1e+5), 1e+20,
                "a 16th significant digit is the one shed")
    checkEquals(NitroUiSliderValue.tidy(1e20), 1e20, "tidying leaves a clean huge value alone")

    // Ties. Kotlin's `round` is `Math.rint`, which rounds a tie to the **even**
    // neighbour; Swift's `.rounded()` goes away from zero. The rule is
    // `roundHalfAway`, spelled the same on both platforms — see that function's
    // comment — and these are the vectors that caught the divergence.
    checkEquals(NitroUiSliderValue.roundHalfAway(0.5), 1, "0.5 goes to 1, not to the even 0")
    checkEquals(NitroUiSliderValue.roundHalfAway(2.5), 3, "2.5 goes to 3, not to the even 2")
    checkEquals(NitroUiSliderValue.roundHalfAway(-0.5), -1, "a negative tie goes away from zero")
    checkEquals(NitroUiSliderValue.roundHalfAway(-2.5), -3, "...all the way down")
    checkEquals(NitroUiSliderValue.roundHalfAway(0.4), 0, "a non-tie still rounds to nearest")
    checkEquals(NitroUiSliderValue.roundHalfAway(0.6), 1, "...in either direction")
    checkEquals(NitroUiSliderValue.roundHalfAway(-0.6), -1, "...including below zero")
    checkEquals(quantize(0.5, 0, 2, 1), 1, "a mid-range tie goes up")
    checkEquals(quantize(2.5, 0, 10, 1), 3, "a mid-range tie goes up, not to the even 2")
    // The steps are counted *up from the minimum*, so -2.5 in -5...5 is 2.5 steps
    // in: the tie is in the step count, and it goes up (old Kotlin answered -3).
    checkEquals(quantize(-2.5, -5, 5, 1), -2, "a tie in a negative range counts steps up from the minimum")
    checkEquals(quantize(0.25, 0, 1, 0.5), 0.5, "a tie in a fraction goes up to the next stop")
    checkEquals(quantize(1.5, 0, 3, 1), 2, "an integer-valued tie is the same either way")

    // Which ranges a platform's own stepped control can draw.
    let tenths = NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 0.1)
    check(tenths?.wholeSteps == 10 && tenths?.endsOnStep == true, "0...1 by tenths ends on a step")
    let thirds = NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 0.3)
    check(thirds?.wholeSteps == 3 && thirds?.endsOnStep == false, "0...1 by 0.3 does not")
    let whole = NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 1)
    check(whole?.wholeSteps == 1 && whole?.endsOnStep == true, "one whole step ends on a step")
    check(NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 5)?.endsOnStep == false,
          "a step past the range does not end on a step")
    check(NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 5)?.wholeSteps == 0,
          "...and has no whole steps")
    check(NitroUiSliderValue.division(minimum: 0, maximum: 1e-12, step: 1)?.endsOnStep == false,
          "a range far shorter than a step is not one step wide")
    check(NitroUiSliderValue.division(minimum: 0, maximum: 1, step: 0) == nil,
          "step 0 is continuous")
    check(NitroUiSliderValue.division(minimum: 1, maximum: 1, step: 0.1) == nil,
          "an empty range is not stepped")

    if failures > 0 {
      print("slider-value.test: \(failures) failure(s)")
      exit(1)
    }
    print("slider-value.test: PASS")
  }
}
