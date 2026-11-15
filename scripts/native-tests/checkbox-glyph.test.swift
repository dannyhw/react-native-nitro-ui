import Foundation

/// `@main` because `swiftc` only allows top-level statements in a file named
/// `main.swift`, and this compiles together with the shipping file.
@main
struct CheckboxGlyphTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  private static func checkStyle(_ sent: String, _ expected: NitroUiCheckboxStyle, _ what: String) {
    let actual = NitroUiCheckboxStyle.resolve(sent)
    check(actual == expected, "\(what): \"\(sent)\" -> \(actual.rawValue), want \(expected.rawValue)")
  }

  private static func drawn(_ style: NitroUiCheckboxStyle, _ checked: Bool, _ indeterminate: Bool) -> String {
    guard let glyph = NitroUiCheckboxGlyphs.glyph(style: style, checked: checked, indeterminate: indeterminate) else {
      return "none"
    }
    return "\(glyph.symbol)(\(glyph.filled ? "accent" : "secondary"))"
  }

  private static func checkDrawn(
    _ style: NitroUiCheckboxStyle,
    _ checked: Bool,
    _ indeterminate: Bool,
    _ expected: String,
    _ what: String
  ) {
    let actual = drawn(style, checked, indeterminate)
    check(actual == expected, "\(what): \(actual), want \(expected)")
  }

  static func main() {
    print("NitroUiCheckboxGlyph")

    checkStyle("circle", .circle, "the default is the circle")
    checkStyle("square", .square, "the square is the square")
    checkStyle("switch", .toggle, "switch is the old look")
    checkStyle("", .circle, "the empty name is the default")
    checkStyle("Circle", .circle, "a capitalised name is not a style")
    checkStyle("checkmark", .circle, "a symbol name is not a style")
    checkStyle("toggle", .circle, "the Swift case name is not the prop's word")
    checkStyle("square ", .circle, "a trailing space is not a style")

    check(NitroUiCheckboxStyle.circle.drawsGlyph, "the circle draws a glyph")
    check(NitroUiCheckboxStyle.square.drawsGlyph, "the square draws a glyph")
    check(!NitroUiCheckboxStyle.toggle.drawsGlyph, "the switch draws no glyph of ours")

    checkDrawn(.circle, false, false, "circle(secondary)", "an unchecked circle is the empty box")
    checkDrawn(.circle, true, false, "checkmark.circle.fill(accent)", "a checked circle is the check mark")
    checkDrawn(.circle, false, true, "minus.circle.fill(accent)", "the third state is the dash")
    checkDrawn(.square, false, false, "square(secondary)", "an unchecked square is the empty box")
    checkDrawn(.square, true, false, "checkmark.square.fill(accent)", "a checked square is the check mark")
    checkDrawn(.square, false, true, "minus.square.fill(accent)", "the third state of the square is the dash")

    // `checked` outranks `indeterminate`, as on Android, so the same props draw the
    // same mark on both platforms.
    checkDrawn(.circle, true, true, "checkmark.circle.fill(accent)", "a checked indeterminate box is a check mark")
    checkDrawn(.square, true, true, "checkmark.square.fill(accent)", "and so is the square's")

    // SwiftUI's `.switch` toggle style draws the whole switch look itself.
    for (checked, indeterminate) in [(false, false), (true, false), (false, true), (true, true)] {
      checkDrawn(.toggle, checked, indeterminate, "none", "the switch draws nothing for checked=\(checked) indeterminate=\(indeterminate)")
    }

    for style in [NitroUiCheckboxStyle.circle, .square] {
      let off = NitroUiCheckboxGlyphs.glyph(style: style, checked: false, indeterminate: false)
      let on = NitroUiCheckboxGlyphs.glyph(style: style, checked: true, indeterminate: false)
      let mixed = NitroUiCheckboxGlyphs.glyph(style: style, checked: false, indeterminate: true)
      check(off != on && on != mixed && off != mixed, "\(style.rawValue): the three states draw three glyphs")
      check(off?.filled == false, "\(style.rawValue): only the empty box is the secondary colour")
      check(on?.filled == true && mixed?.filled == true, "\(style.rawValue): a state takes the accent")
      check(off?.symbol.hasSuffix(style.rawValue) == true, "\(style.rawValue): the empty box is the bare shape")
      check(on?.symbol.hasSuffix(".fill") == true && mixed?.symbol.hasSuffix(".fill") == true,
            "\(style.rawValue): a state is a filled symbol")
    }

    for (checked, indeterminate) in [(false, false), (true, false), (false, true), (true, true)] {
      let circle = NitroUiCheckboxGlyphs.glyph(style: .circle, checked: checked, indeterminate: indeterminate)
      let square = NitroUiCheckboxGlyphs.glyph(style: .square, checked: checked, indeterminate: indeterminate)
      check(circle?.filled == square?.filled, "checked=\(checked) indeterminate=\(indeterminate): both styles pick the same colour")
      check(circle?.symbol != square?.symbol, "checked=\(checked) indeterminate=\(indeterminate): the styles draw different symbols")
      check(circle?.symbol.count == square?.symbol.count, "checked=\(checked) indeterminate=\(indeterminate): the two names are one shape apart")
    }

    check(NitroUiCheckboxGlyphs.accessibilityValue(checked: false, indeterminate: true) == "mixed",
          "the dash is announced as mixed")
    check(NitroUiCheckboxGlyphs.accessibilityValue(checked: false, indeterminate: false) == nil,
          "the empty box keeps the Toggle's own unchecked value")
    check(NitroUiCheckboxGlyphs.accessibilityValue(checked: true, indeterminate: false) == nil,
          "a check mark keeps the Toggle's own checked value")
    check(NitroUiCheckboxGlyphs.accessibilityValue(checked: true, indeterminate: true) == nil,
          "a checked indeterminate box announces the state it drew, not the prop")

    if failures > 0 {
      print("FAIL: \(failures) checkbox-glyph vector(s)")
      exit(1)
    }
    print("checkbox-glyph: all vectors pass")
  }
}
