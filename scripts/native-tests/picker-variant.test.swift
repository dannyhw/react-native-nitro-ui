import Foundation

/// `@main` because `swiftc` only allows top-level statements in a file named
/// `main.swift`, and this compiles together with the shipping file.
@main
struct PickerVariantTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  private static func checkResolved(_ sent: String, _ expected: String, _ what: String) {
    let actual = NitroUiPickerVariant.resolved(sent)
    check(actual == expected, "\(what): \"\(sent)\" -> \"\(actual)\", want \"\(expected)\"")
  }

  static func main() {
    print("NitroUiPickerVariant")

    checkResolved(NitroUiPickerVariant.menu, "menu", "the menu is the menu")
    checkResolved(NitroUiPickerVariant.wheel, "wheel", "the wheel is the wheel")

    checkResolved(NitroUiPickerVariant.radio, "menu", "radio falls back to the menu")

    checkResolved("", "menu", "the empty name is the menu")
    checkResolved("Radio", "menu", "the capitalised name is not a variant")
    checkResolved("radio ", "menu", "a trailing space is not a variant")
    checkResolved("segmented", "menu", "a control this component never had is the menu")

    check(NitroUiPickerVariant.isWheel("wheel"), "the wheel is fillWidth")
    check(!NitroUiPickerVariant.isWheel("radio"), "radio does not become a wheel")
    check(!NitroUiPickerVariant.isWheel("menu"), "the menu is intrinsic")
    check(!NitroUiPickerVariant.isWheel("WHEEL"), "an upper-case name does not become a wheel")

    if failures > 0 {
      print("FAIL: \(failures) picker-variant vector(s)")
      exit(1)
    }
    print("picker-variant: all vectors pass")
  }
}
