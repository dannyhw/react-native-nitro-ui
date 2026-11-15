// What `iosStyle` names on iOS, and which SF Symbol each state draws. No SwiftUI here, so host-side
// tests can run the whole table.

import Foundation

/// What `iosStyle` names on this platform.
enum NitroUiCheckboxStyle: String {
  /// The default: `checkmark.circle.fill` over `circle`, as a Reminders or Notes checklist draws.
  case circle
  /// The same glyph, squared: `checkmark.square.fill` over `square`.
  case square
  /// SwiftUI's own `Toggle` with the `.switch` style, untouched. The case is not named `switch`
  /// because that is a keyword; the raw value is the string the prop carries.
  case toggle = "switch"

  /// The style a name means. Anything unrecognised is the default.
  static func resolve(_ name: String) -> NitroUiCheckboxStyle {
    return NitroUiCheckboxStyle(rawValue: name) ?? .circle
  }

  /// Whether this style draws one of the checkmark glyphs rather than the switch.
  var drawsGlyph: Bool {
    return self != .toggle
  }
}

/// One glyph: the SF Symbol to draw, and which of the two colours draws it.
struct NitroUiCheckboxGlyph: Equatable {
  let symbol: String
  /// `true` is a state (the check mark or the dash) and takes the accent colour. `false` is the
  /// empty box, which takes the secondary label colour.
  let filled: Bool
}

enum NitroUiCheckboxGlyphs {
  /// The glyph for `checked`/`indeterminate` in `style`, or `nil` for the switch look. `checked`
  /// outranks `indeterminate`, matching Android, where `TriStateCheckbox` shows the dash only while
  /// the value is off.
  static func glyph(
    style: NitroUiCheckboxStyle,
    checked: Bool,
    indeterminate: Bool
  ) -> NitroUiCheckboxGlyph? {
    guard style.drawsGlyph else { return nil }
    // The two glyph styles differ only in shape, so one table covers both.
    let shape = style == .square ? "square" : "circle"
    if checked {
      return NitroUiCheckboxGlyph(symbol: "checkmark.\(shape).fill", filled: true)
    }
    if indeterminate {
      return NitroUiCheckboxGlyph(symbol: "minus.\(shape).fill", filled: true)
    }
    return NitroUiCheckboxGlyph(symbol: shape, filled: false)
  }

  /// The accessibility value for a state: `"mixed"` for the dash, or `nil` to leave the `Toggle`'s
  /// own checked/unchecked value alone. `nil` means "apply nothing": an empty
  /// `accessibilityValue(_:)` would silence the control's own value. The word is AppKit's
  /// (`NSControlStateValueMixed`) and is not localized.
  static func accessibilityValue(
    checked: Bool,
    indeterminate: Bool
  ) -> String? {
    return (!checked && indeterminate) ? "mixed" : nil
  }
}
