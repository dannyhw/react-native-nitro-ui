import Foundation

@main
struct StepperBindingTest {
  private static var failures = 0

  /// `expected` is where the control may end up; `nil` means the write changes nothing.
  private static func check(
    _ displayed: Double, afterWrite requested: Double,
    minimum: Double, maximum: Double, step: Double,
    disabled: Bool = false, expected: Double?, _ what: String
  ) {
    let got = NitroUiStepperBinding.value(
      afterWrite: requested, displayed: displayed,
      minimum: minimum, maximum: maximum, step: step, disabled: disabled)
    // Where taking the write as the destination would land, printed for comparison.
    let literal = NitroUiSliderValue.quantize(
      raw: requested, minimum: minimum, maximum: maximum, step: step)
    let same: Bool
    switch (got, expected) {
    case (nil, nil): same = true
    case let (got?, want?): same = got == want
    default: same = false
    }
    let gotText = got.map { String($0) } ?? "nil"
    let wantText = expected.map { String($0) } ?? "nil"
    check(same, "\(what) (got \(gotText), want \(wantText); a literal write would land on \(literal))")
  }

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  static func main() {
    print("NitroUiStepperBinding ==")

    // `0...1.05` does not end on a 0.1 step, so SwiftUI is given no step and a tap
    // writes its own stride of 1.
    check(0, afterWrite: 1, minimum: 0, maximum: 1.05, step: 0.1, expected: 0.1,
      "one plus tap on 0...1.05 by 0.1 moves one tenth")
    check(0.5, afterWrite: -0.5, minimum: 0, maximum: 1.05, step: 0.1, expected: 0.4,
      "one minus tap on the same range moves one tenth down")
    check(1.0, afterWrite: 2, minimum: 0, maximum: 1.05, step: 0.1, expected: 1.05,
      "the last step on an off-grid range lands on the maximum")
    check(1.05, afterWrite: 3, minimum: 0, maximum: 1.05, step: 0.1, expected: 1.05,
      "and one more asks for the value it holds, which reports nothing")

    // `0...10 step 3` stops at 0, 3, 6, 9 and 10.
    check(3, afterWrite: 4, minimum: 0, maximum: 10, step: 3, expected: 6,
      "a write beside the grid moves to the next stop, not onto the write")
    check(6, afterWrite: 5, minimum: 0, maximum: 10, step: 3, expected: 3,
      "downward too")
    check(9, afterWrite: 10, minimum: 0, maximum: 10, step: 3, expected: 10,
      "9 goes to the maximum, the stop the grid would otherwise never reach")

    check(4, afterWrite: 5, minimum: 0, maximum: 10, step: 1, expected: 5,
      "a stepped write is one step up")
    check(4, afterWrite: 3, minimum: 0, maximum: 10, step: 1, expected: 3,
      "and one down")
    check(10, afterWrite: 11, minimum: 0, maximum: 1000.7, step: 0.5, expected: 10.5,
      "a write smaller than the step still moves a whole step")

    check(0, afterWrite: -1, minimum: 0, maximum: 10, step: 1, expected: 0,
      "a write below the minimum asks for the minimum it already holds")
    check(4, afterWrite: 4, minimum: 0, maximum: 10, step: 1, expected: nil,
      "a write of the displayed value is refused before anything is computed")
    check(4, afterWrite: 5, minimum: 0, maximum: 10, step: 1, disabled: true, expected: nil,
      "a disabled control takes no write at all")

    // SwiftUI disables a half by comparing the value shown with the bound it was given.
    // The control shows a tidied value, so a raw bound such as `0.1 + 0.2` would leave
    // the plus half live at the top of the grid.
    check(
      NitroUiStepperBinding.trackBounds(minimum: 0, maximum: 0.1 + 0.2).upperBound == 0.3,
      "a maximum of 0.1 + 0.2 is handed over as 0.3, the value the control shows"
    )
    check(
      NitroUiStepperBinding.trackBounds(minimum: 0.1 + 0.2, maximum: 1).lowerBound == 0.3,
      "the same hair on a minimum is tidied too"
    )
    check(
      NitroUiStepperBinding.trackBounds(minimum: 0, maximum: 0.1 + 0.2).upperBound
        == NitroUiSliderValue.quantize(
          raw: 0.1 + 0.2, minimum: 0, maximum: 0.1 + 0.2, step: 0.1),
      "the bound is the grid's top stop, not a value above it"
    )
    // `a...b` traps when a > b, so a nonsense bound is decided before the range is built.
    check(
      NitroUiStepperBinding.trackBounds(minimum: 0, maximum: 10) == 0...10,
      "bounds that are already stops are handed over untouched"
    )
    check(
      NitroUiStepperBinding.trackBounds(minimum: 10, maximum: 0) == 0...10,
      "an inverted range comes back ordered instead of trapping"
    )
    check(
      NitroUiStepperBinding.trackBounds(minimum: .nan, maximum: 1) == 0...1,
      "a non-finite bound falls back to the unit range"
    )

    let tenths = NitroUiStepperBinding.value(
      afterWrite: 1, displayed: 0, minimum: 0, maximum: 1.05, step: 0.1, disabled: false)
    check(tenths != 1, "the tenths fixture is not the literal write (fixture sanity)")
    let grid = NitroUiStepperBinding.value(
      afterWrite: 4, displayed: 3, minimum: 0, maximum: 10, step: 3, disabled: false)
    check(grid != 4, "the step-3 fixture is not the literal write (fixture sanity)")
    check(
      0.1 + 0.2 != 0.3
        && NitroUiStepperBinding.trackBounds(minimum: 0, maximum: 0.1 + 0.2).upperBound != 0.1 + 0.2,
      "the tidied bound is not the raw prop (fixture sanity)"
    )

    if failures > 0 {
      print("stepper-binding.test: \(failures) failure(s)")
      exit(1)
    }
    print("stepper-binding.test: all passed")
  }
}
