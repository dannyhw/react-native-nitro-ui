//
//  NitroUiCheckboxGlyph.swift
//  react-native-nitro-ui
//
//  What `iosStyle` names on iOS, and which SF Symbol the state it describes draws
//  (DECISIONS D47). A separate file with no SwiftUI in it, so `bun run test:native`
//  compiles and runs the table on the host next to the handshake and the Picker's
//  variant rule - which is the only place the *whole* table can run: a device sees
//  the one combination it mounted, and `Checkbox.harness.tsx` reads back the symbol
//  the drawing code was handed so a device can still say "this style drew that
//  glyph". Nothing here imitates a control: the symbols are Apple's, the control is
//  Apple's `Toggle`, and D47 is the owner's call that a Checkbox should look like
//  the checklist glyph iOS ships rather than like a Switch.
//
//  There is no Kotlin twin on purpose. Android has a checkbox - `Checkbox`, and
//  `TriStateCheckbox` for the dash - and `HybridNitroUiCheckbox.kt` stores `iosStyle`
//  without reading it, which both Android gates keep green rather than restating.
//

import Foundation

/// What `iosStyle` names on this platform (DECISIONS D47 item 2).
enum NitroUiCheckboxStyle: String {
  /// The default: `checkmark.circle.fill` over `circle` - what a Reminders or Notes
  /// checklist draws, which is why it is the iOS idiom rather than `'square'`.
  case circle
  /// The same glyph, squared: `checkmark.square.fill` over `square`.
  case square
  /// The look this component shipped with (D38 item 1): SwiftUI's own
  /// `Toggle(isOn:).toggleStyle(.switch)`, drawn by the system and untouched.
  ///
  /// The case is not named `switch` because that is a keyword here; the raw value is
  /// what the prop carries, and it is the string `Checkbox.tsx` sends.
  case toggle = "switch"

  /// The style a name means. Anything unrecognised is the default - Button's and
  /// Chip's rule, and the reason the prop can be a plain `string` in the spec: Fabric
  /// hands over what JS sent, and a name this platform has no glyph for is not a
  /// crash, it is the default.
  static func resolve(_ name: String) -> NitroUiCheckboxStyle {
    return NitroUiCheckboxStyle(rawValue: name) ?? .circle
  }

  /// Whether this style draws one of the checkmark glyphs rather than the switch.
  ///
  /// The one answer the *hybrid view* needs on its own: `'switch'` is today's control
  /// with nothing of ours drawn, so it keeps today's sizing key, today's tap target
  /// question and today's accessibility element. Derived from the case rather than
  /// compared to the string again, so the drawing code and the layout policy cannot
  /// disagree about which control is on screen.
  var drawsGlyph: Bool {
    return self != .toggle
  }
}

/// One glyph: the SF Symbol to draw, and which of the two colours draws it.
struct NitroUiCheckboxGlyph: Equatable {
  /// The SF Symbol name. Apple's symbol, never a drawing of our own (D38 item 1).
  let symbol: String
  /// `true` is a *state* - the check mark or the dash - and takes the accent colour
  /// (`tintColor`, or the app's accent when unset). `false` is the empty box, which
  /// takes the system's secondary label colour, as an unchecked checklist row does.
  ///
  /// Carried next to the name instead of inferred from it (`symbol.hasSuffix(".fill")`)
  /// by the Picker's `isWheel` rule: one question, asked once, so the content cannot
  /// answer it differently from the test.
  let filled: Bool
}

/// The glyph one state of one style draws (DECISIONS D47 items 1 and 3).
enum NitroUiCheckboxGlyphs {
  /// The glyph for `checked`/`indeterminate` in `style`, or `nil` for the switch look,
  /// which draws nothing here.
  ///
  /// `checked` outranks `indeterminate`, which is Android's rule and has to stay
  /// Android's: `TriStateCheckbox` shows the dash only while the value is *off*
  /// (`docs/components/checkbox.md`'s "What a tap reports" table), so a box that is
  /// `indeterminate` *and* checked draws the check mark there. Were the dash stronger
  /// here, the same props would draw a check mark on one platform and a dash on the
  /// other, and the table this component documents would be a table about one
  /// platform. It is also the behaviour a caller wants: the press on a dash reports
  /// `true`, and the box has to answer with the check mark that asked for.
  static func glyph(
    style: NitroUiCheckboxStyle,
    checked: Bool,
    indeterminate: Bool
  ) -> NitroUiCheckboxGlyph? {
    guard style.drawsGlyph else { return nil }
    // The two shapes are the only difference between the two glyph styles, which is
    // why one table covers both: `checkmark.circle.fill`/`checkmark.square.fill`,
    // `minus.circle.fill`/`minus.square.fill` and `circle`/`square` are the same
    // symbol in either shape. They are *near* each other but not the same box - the
    // device measures the circle row 26 pt tall and the square row 24 pt
    // (`Checkbox.harness.tsx`, and `docs/components/checkbox.md` carries both) - which
    // is one reason `iosStyle` is in the iOS sizing key rather than the two styles
    // sharing a measured size.
    let shape = style == .square ? "square" : "circle"
    if checked {
      return NitroUiCheckboxGlyph(symbol: "checkmark.\(shape).fill", filled: true)
    }
    if indeterminate {
      return NitroUiCheckboxGlyph(symbol: "minus.\(shape).fill", filled: true)
    }
    return NitroUiCheckboxGlyph(symbol: shape, filled: false)
  }

  /// The accessibility value a reader is handed for a state: what an indeterminate
  /// row says, or `nil` to leave the `Toggle`'s own checked/unchecked value alone.
  ///
  /// Only the third state is overridden. A SwiftUI `Toggle` is a two-position control,
  /// so its element can only ever say checked or unchecked - and that is the right
  /// answer for both of those states, which is what XCUITest reads as `value` 0/1 for
  /// the switch look today. The dash is the one state whose picture and value
  /// disagree, so it is the one state that says so out loud, with Android's word for
  /// it: TalkBack reads Material's third state as "Mixed"
  /// (`ToggleableState.Indeterminate`), so both platforms name the third state the
  /// same thing and neither invents a third `checked` value.
  ///
  /// `nil` means "apply nothing", not "say nothing": an empty
  /// `accessibilityValue(_:)` would silence the value the control has, which is this
  /// component's own rule for an empty name (`nameOrNull` in `Checkbox.tsx`).
  static func accessibilityValue(
    checked: Bool,
    indeterminate: Bool
  ) -> String? {
    return (!checked && indeterminate) ? "mixed" : nil
  }
}
