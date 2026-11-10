//
//  NitroUiPickerVariant.swift
//  react-native-nitro-ui
//
//  Which control a Picker `variant` string names on iOS. A separate file with no
//  SwiftUI in it, so `bun run test:native` compiles and runs the rule on the host
//  next to the handshake and the Slider's value rule - which is the only place
//  this rule *can* run: `Picker.tsx` resolves the variant per platform before the
//  prop is sent, so a device test can never arrive here with a name the wrapper
//  refused to send. The Kotlin twin is `PickerModel.resolvedVariant` in
//  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`, whose
//  `when` answers `"radio" -> "radio"` - change one platform, change both and the
//  vectors.
//
import Foundation

/// The Picker's variant names, as this platform reads them.
///
/// Three names are legal on the prop (`docs/components/picker.md`), and iOS has
/// controls for two of them.
enum NitroUiPickerVariant {
  static let menu = "menu"
  static let wheel = "wheel"
  /// Android's radio group. Legal on the prop; unavailable here.
  static let radio = "radio"

  /// The control a variant name means on this platform.
  ///
  /// `'radio'` is Android's: SwiftUI's radio-group style, `RadioGroupPickerStyle`,
  /// is `@available(iOS, unavailable)`, so there is nothing to host, and DECISIONS
  /// D38 item 4 rules that `variant="radio"` renders the menu here rather than an
  /// imitation of a control Apple does not ship - the same rule that makes
  /// `'wheel'` the menu on Android, where Material 3 has no wheel. Everything
  /// outside the two iOS controls is the menu, which is what the spec documents for
  /// an unknown name; an app that needs every option visible on iOS uses
  /// `SegmentedControl` for up to about five.
  ///
  /// `Picker.tsx` answers the same question first (it decides the sizing key too,
  /// and a key has to name the control that is drawn), so this is the guard rather
  /// than the route. It is tested here because a guard that only runs when the
  /// route is broken is exactly the code that rots.
  static func resolved(_ variant: String) -> String {
    return variant == wheel ? wheel : menu
  }

  /// Whether [resolved](#resolved) names the wheel rather than the menu.
  ///
  /// The one answer the layout policy depends on: a wheel fills its box's width, a
  /// menu takes its own size. Derived from `resolved` rather than compared to the
  /// string again, so the setter and the content cannot disagree.
  static func isWheel(_ variant: String) -> Bool {
    return resolved(variant) == wheel
  }
}
