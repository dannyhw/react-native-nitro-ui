//
//  picker-variant.test.swift
//
//  Host-side vectors for the iOS Picker's variant rule (see
//  ios/components/Picker/NitroUiPickerVariant.swift). The Kotlin twin is
//  `PickerModelTest.theVariantResolvesToTheThreeControlsThisComponentHas`, and the
//  two differ on purpose: Android has a radio group and iOS does not.
//
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

    // The two controls iOS actually has survive the round trip.
    checkResolved(NitroUiPickerVariant.menu, "menu", "the menu is the menu")
    checkResolved(NitroUiPickerVariant.wheel, "wheel", "the wheel is the wheel")

    // The fallback DECISIONS D38 item 4 promises: `radio` is Android's control, so
    // here it is the menu. A `resolved` that passed the name through would leave
    // SwiftUI hosting a menu while the model claimed a radio group.
    checkResolved(NitroUiPickerVariant.radio, "menu", "radio falls back to the menu")

    // Anything else is the documented default, in both senses: a name nobody
    // invented and a name with the right letters in the wrong shape.
    checkResolved("", "menu", "the empty name is the menu")
    checkResolved("Radio", "menu", "the capitalised name is not a variant")
    checkResolved("radio ", "menu", "a trailing space is not a variant")
    checkResolved("segmented", "menu", "a control this component never had is the menu")

    // The layout policy reads the same answer the setter wrote: a wheel fills its
    // box, and the thing `radio` became does not.
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
