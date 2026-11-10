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
}
