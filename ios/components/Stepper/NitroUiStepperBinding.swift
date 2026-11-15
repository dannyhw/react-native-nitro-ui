// What one write to the hosting `Stepper`'s `Binding` means. Foundation only, so the
// host-side native tests can compile it.

import Foundation

/// Turns a write to the SwiftUI `Stepper`'s `Binding` into the value this control should
/// move to. The write is read only for its direction, never as the destination: a range
/// that does not end on a step is drawn without `step:`, and SwiftUI then moves by its
/// default stride of 1, which on `0...1.05 step 0.1` would be ten steps.
enum NitroUiStepperBinding {
  /// The value to display after SwiftUI wrote `requested` to its Binding, or `nil` when the
  /// write should change nothing: the control is disabled, or the write is the value
  /// already displayed.
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

  /// The range to hand SwiftUI's `Stepper`. Always a valid `ClosedRange`: one with inverted
  /// bounds traps at runtime.
  ///
  /// The bounds are tidied like the displayed value. SwiftUI disables a half by comparing
  /// its bound with the value, so a raw `maximumValue` of `0.1 + 0.2`
  /// (`0.30000000000000004`) would leave the plus half live at `0.3`.
  static func trackBounds(minimum: Double, maximum: Double) -> ClosedRange<Double> {
    guard minimum.isFinite, maximum.isFinite else {
      return 0...1
    }
    let low = NitroUiSliderValue.tidy(Swift.min(minimum, maximum))
    let high = NitroUiSliderValue.tidy(Swift.max(minimum, maximum))
    // Ordered again: an inverted range traps.
    return Swift.min(low, high)...Swift.max(low, high)
  }
}
