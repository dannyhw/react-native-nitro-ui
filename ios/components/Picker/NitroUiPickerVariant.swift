// Which control a Picker `variant` string names on iOS. No SwiftUI here, so the host-side
// native tests can compile it. The Kotlin twin is `PickerModel.resolvedVariant`.
import Foundation

/// The Picker's variant names, as this platform reads them.
enum NitroUiPickerVariant {
  static let menu = "menu"
  static let wheel = "wheel"
  /// Android's radio group. Legal on the prop; unavailable here.
  static let radio = "radio"

  /// The control a variant name means on this platform.
  ///
  /// SwiftUI's `RadioGroupPickerStyle` is unavailable on iOS, so `"radio"`, like any unknown
  /// name, renders the menu.
  static func resolved(_ variant: String) -> String {
    return variant == wheel ? wheel : menu
  }

  /// A wheel fills its box's width; a menu takes its own size.
  static func isWheel(_ variant: String) -> Bool {
    return resolved(variant) == wheel
  }
}
