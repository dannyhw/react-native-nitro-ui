//
//  NitroUiStepperBinding.swift
//  react-native-nitro-ui
//
//  What one write to the hosting `Stepper`'s `Binding` means, with no UIKit in it.
//  Foundation only, so the host-side test
//  (`scripts/native-tests/stepper-binding.test.swift`) compiles this file and the
//  value rule it calls (`NitroUiSliderValue.swift`) unchanged.
//

import Foundation

/// The rule that turns a write to the SwiftUI `Stepper`'s `Binding` into the value this
/// control should move to.
///
/// The control is asked for the *direction* of a step and never for its destination,
/// because the two platforms' strides are not this control's step:
///
/// - when the range ends on a step (`StepperModel.isStepped`) the control is handed
///   `step:`, so its write is already one of the grid's stops;
/// - when it does not, handing it a `step:` would make `maximumValue` unreachable
///   (`NitroUiSliderValue.Division.endsOnStep`), so it is drawn without one — and
///   SwiftUI then moves by its own default stride of **1**. On `0...1.05 step 0.1`
///   that first tap writes `1`, a number the grid has never held: taking it as the
///   destination would send the value from `0` to `1` — ten steps — while `quantize`
///   happily nods at it, because `1` *is* a legal value on that range.
///
/// The second case is the reason the first case is written the same way: one rule
/// ("a write is a request to move one step that way") for every range, rather than a
/// rule that depends on which shape the range happens to have. `NitroUiSliderValue`'s
/// own comment on `stepped` argues the same for the accessibility increment.
enum NitroUiStepperBinding {
  /// The value the control should display after SwiftUI wrote `requested` to its
  /// Binding, or `nil` when the write should change nothing.
  ///
  /// `nil` for a disabled control is what makes a write to a disabled stepper report
  /// no event at all — SwiftUI refuses the tap before any write reaches here, and the
  /// harness seam must not invent one the finger could not have produced. `nil` for a
  /// write of the value already displayed is the same rule one step on: a half at its
  /// bound asks for the value it holds, and both platforms answer that with silence.
  static func value(
    afterWrite requested: Double,
    displayed: Double,
    minimum: Double,
    maximum: Double,
    step: Double,
    disabled: Bool
  ) -> Double? {
    guard !disabled else { return nil }
    guard requested != displayed else { return nil }
    return NitroUiSliderValue.stepped(
      from: displayed,
      up: requested > displayed,
      minimum: minimum,
      maximum: maximum,
      step: step
    )
  }

  /// The range to hand SwiftUI's `Stepper`, tidied the way the value it displays is.
  ///
  /// Always a valid `ClosedRange`: `ClosedRange(a...b)` with `a > b` traps at runtime,
  /// and a `maximumValue` below `minimumValue` is app data, not a crash.
  ///
  /// The tidying is the point (`NitroUiSliderValue.tidy`, the same last step
  /// `quantize` takes). SwiftUI disables the half that cannot move by comparing its own
  /// bound with the value it is showing, and this control shows a tidied value — so
  /// handing it the raw prop leaves the two disagreeing by one binary hair:
  /// `maximumValue = 0.1 + 0.2` is `0.30000000000000004`, the top of the grid is `0.3`,
  /// and at `0.3` SwiftUI's plus half is still live. It answers with no event, because
  /// the write quantises back to where it was, which is correct behaviour with the look
  /// of a dead control (G25 review). A bound that is one of the grid's stops is the
  /// only thing that makes "this half is at its end" visible.
  static func trackBounds(minimum: Double, maximum: Double) -> ClosedRange<Double> {
    guard minimum.isFinite, maximum.isFinite else {
      return 0...1
    }
    let low = NitroUiSliderValue.tidy(Swift.min(minimum, maximum))
    let high = NitroUiSliderValue.tidy(Swift.max(minimum, maximum))
    // Ordered again, because a tidied pair is only as ordered as the arithmetic that
    // produced it, and trapping here would be an app's `maximumValue` killing a view.
    return Swift.min(low, high)...Swift.max(low, high)
  }
}
