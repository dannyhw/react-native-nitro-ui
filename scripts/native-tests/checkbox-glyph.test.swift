//
//  checkbox-glyph.test.swift
//
//  Host-side vectors for the iOS Checkbox's glyph rule (see
//  ios/components/Checkbox/NitroUiCheckboxGlyph.swift): which style a name means,
//  which SF Symbol each of its states draws, and which of the two colours draws it.
//
//  Here rather than only on a device because the table has six answers and a device
//  run sees the one combination it mounted, and because the two rules worth proving
//  are the ones no fixture produces on demand: `checked` outranking `indeterminate`
//  (the state an app reaches by leaving its third-state prop set after a tap, which
//  is exactly the case `docs/components/checkbox.md` warns callers about), and the
//  two glyph styles agreeing about *colour* while disagreeing about shape - the pair
//  that lets them share one sizing rule.
//
//  There is no Kotlin twin: Android ignores `iosStyle` (`HybridNitroUiCheckbox.kt`),
//  so the table is one platform's and says so.
//
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

  /// The glyph one state draws, spelled `symbol(filled)` for the log, or `none`.
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

    // The three names DECISIONS D47 item 2 settles, and the default.
    checkStyle("circle", .circle, "the default is the circle")
    checkStyle("square", .square, "the square is the square")
    checkStyle("switch", .toggle, "switch is the old look")
    checkStyle("", .circle, "the empty name is the default")
    checkStyle("Circle", .circle, "a capitalised name is not a style")
    checkStyle("checkmark", .circle, "a symbol name is not a style")
    checkStyle("toggle", .circle, "the Swift case name is not the prop's word")
    checkStyle("square ", .circle, "a trailing space is not a style")

    // Which question the hybrid view asks: `'switch'` draws nothing of ours.
    check(NitroUiCheckboxStyle.circle.drawsGlyph, "the circle draws a glyph")
    check(NitroUiCheckboxStyle.square.drawsGlyph, "the square draws a glyph")
    check(!NitroUiCheckboxStyle.toggle.drawsGlyph, "the switch draws no glyph of ours")

    // The table: D47 item 1's two pairs, and item 3's dash.
    checkDrawn(.circle, false, false, "circle(secondary)", "an unchecked circle is the empty box")
    checkDrawn(.circle, true, false, "checkmark.circle.fill(accent)", "a checked circle is the check mark")
    checkDrawn(.circle, false, true, "minus.circle.fill(accent)", "the third state is the dash")
    checkDrawn(.square, false, false, "square(secondary)", "an unchecked square is the empty box")
    checkDrawn(.square, true, false, "checkmark.square.fill(accent)", "a checked square is the check mark")
    checkDrawn(.square, false, true, "minus.square.fill(accent)", "the third state of the square is the dash")

    // `checked` outranks `indeterminate`, which is Android's rule and the one a caller
    // reaches by leaving `indeterminate` set after a tap. If the dash won, the same
    // props would draw a check mark on Android and a dash here.
    checkDrawn(.circle, true, true, "checkmark.circle.fill(accent)", "a checked indeterminate box is a check mark")
    checkDrawn(.square, true, true, "checkmark.square.fill(accent)", "and so is the square's")

    // The switch look draws nothing here - SwiftUI's `.switch` style draws all of it,
    // which is what makes it "today's look, unchanged".
    for (checked, indeterminate) in [(false, false), (true, false), (false, true), (true, true)] {
      checkDrawn(.toggle, checked, indeterminate, "none", "the switch draws nothing for checked=\(checked) indeterminate=\(indeterminate)")
    }

    // Checked and unchecked have to be *different* pictures in both glyph styles: this
    // is the claim `Checkbox.harness.tsx` makes on the device by reading the symbol
    // name back, and it is worth one line here because the pair the content draws and
    // the pair a test compares are the same two strings.
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

    // The two glyph styles agree about colour and disagree only about shape - the pair
    // of facts that lets one sizing rule cover both.
    for (checked, indeterminate) in [(false, false), (true, false), (false, true), (true, true)] {
      let circle = NitroUiCheckboxGlyphs.glyph(style: .circle, checked: checked, indeterminate: indeterminate)
      let square = NitroUiCheckboxGlyphs.glyph(style: .square, checked: checked, indeterminate: indeterminate)
      check(circle?.filled == square?.filled, "checked=\(checked) indeterminate=\(indeterminate): both styles pick the same colour")
      check(circle?.symbol != square?.symbol, "checked=\(checked) indeterminate=\(indeterminate): the styles draw different symbols")
      check(circle?.symbol.count == square?.symbol.count, "checked=\(checked) indeterminate=\(indeterminate): the two names are one shape apart")
    }

    // The value a reader is handed: only the third state overrides the Toggle's own,
    // and it says Android's word for it so one sentence describes both platforms.
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
