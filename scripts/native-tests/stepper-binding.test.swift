//
//  stepper-binding.test.swift
//
//  Host-side vectors for what a write to the SwiftUI Stepper's Binding is allowed to
//  do (ios/components/Stepper/NitroUiStepperBinding.swift).
//
//  The rule is "a write is a request to move one step that way". The failure it
//  guards is the other reading of the same write — take the number the control
//  computed and the control's stride becomes the user's step wherever SwiftUI has to
//  supply one itself, which is every range that does not end on a step. G25's review
//  found it on `0...1.05 step 0.1`, where one tap went 0 → 1: ten steps, and
//  `quantize` approved of the result because 1 *is* a legal value there.
//
//  Every fixture below is chosen so the wrong answer differs from the right one:
//  `check` prints what the literal-write reading would have produced next to the
//  answer the rule gives, so a fixture that cannot tell the two apart is visible as
//  one.
//
import Foundation

@main
struct StepperBindingTest {
  private static var failures = 0

  /// One vector: the range, the value on screen, what SwiftUI wrote, and where the
  /// control is allowed to end up (`nil` for "change nothing").
  private static func check(
    _ displayed: Double, afterWrite requested: Double,
    minimum: Double, maximum: Double, step: Double,
    disabled: Bool = false, expected: Double?, _ what: String
  ) {
    let got = NitroUiStepperBinding.value(
      afterWrite: requested, displayed: displayed,
      minimum: minimum, maximum: maximum, step: step, disabled: disabled)
    // The reading this rule exists to refuse, for the log line: take the write as the
    // destination and this is where the control would land.
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

    // 1. The reviewed bug. `0...1.05` does not end on a 0.1 step, so the control is
    //    drawn without one and its first tap writes 1.
    check(0, afterWrite: 1, minimum: 0, maximum: 1.05, step: 0.1, expected: 0.1,
      "one plus tap on 0...1.05 by 0.1 moves one tenth")
    check(0.5, afterWrite: -0.5, minimum: 0, maximum: 1.05, step: 0.1, expected: 0.4,
      "one minus tap on the same range moves one tenth down")
    // The same range, at the top: `maximumValue` is off the grid and has to stay
    // reachable, which is why the range was not handed a step in the first place.
    check(1.0, afterWrite: 2, minimum: 0, maximum: 1.05, step: 0.1, expected: 1.05,
      "the last step on an off-grid range lands on the maximum")
    check(1.05, afterWrite: 3, minimum: 0, maximum: 1.05, step: 0.1, expected: 1.05,
      "and one more asks for the value it holds, which reports nothing")

    // 2. The grid from the docs: `0...10 step 3` steps 0, 3, 6, 9, 10. A write of 4 is
    //    SwiftUI's stride, not a stop of this grid, and the answer is the next stop.
    check(3, afterWrite: 4, minimum: 0, maximum: 10, step: 3, expected: 6,
      "a write beside the grid moves to the next stop, not onto the write")
    check(6, afterWrite: 5, minimum: 0, maximum: 10, step: 3, expected: 3,
      "downward too")
    check(9, afterWrite: 10, minimum: 0, maximum: 10, step: 3, expected: 10,
      "9 goes to the maximum, the stop the grid would otherwise never reach")

    // 3. A range SwiftUI *is* handed the step for: its write is already a stop, and the
    //    rule has to agree with it — this is the case that must not regress.
    check(4, afterWrite: 5, minimum: 0, maximum: 10, step: 1, expected: 5,
      "a stepped write is one step up")
    check(4, afterWrite: 3, minimum: 0, maximum: 10, step: 1, expected: 3,
      "and one down")
    // A coarse step against SwiftUI's 1 is the same shape as the tenths case, only
    // bigger: the write is smaller than one step, and it must still be one whole step.
    check(10, afterWrite: 11, minimum: 0, maximum: 1000.7, step: 0.5, expected: 10.5,
      "a write smaller than the step still moves a whole step")

    // 4. The silences. A half at a bound, a half that is disabled, and a write of the
    //    value already showing all have to change nothing.
    check(0, afterWrite: -1, minimum: 0, maximum: 10, step: 1, expected: 0,
      "a write below the minimum asks for the minimum it already holds")
    check(4, afterWrite: 4, minimum: 0, maximum: 10, step: 1, expected: nil,
      "a write of the displayed value is refused before anything is computed")
    check(4, afterWrite: 5, minimum: 0, maximum: 10, step: 1, disabled: true, expected: nil,
      "a disabled control takes no write at all")

    // 5. Fixture sanity: the two readings really do disagree on the fixtures that
    //    matter, or this file would pass with the old rule restored.
    let tenths = NitroUiStepperBinding.value(
      afterWrite: 1, displayed: 0, minimum: 0, maximum: 1.05, step: 0.1, disabled: false)
    check(tenths != 1, "the tenths fixture is not the literal write (fixture sanity)")
    let grid = NitroUiStepperBinding.value(
      afterWrite: 4, displayed: 3, minimum: 0, maximum: 10, step: 3, disabled: false)
    check(grid != 4, "the step-3 fixture is not the literal write (fixture sanity)")

    if failures > 0 {
      print("stepper-binding.test: \(failures) failure(s)")
      exit(1)
    }
    print("stepper-binding.test: all passed")
  }
}
