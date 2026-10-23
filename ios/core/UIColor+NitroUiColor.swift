//
//  UIColor+NitroUiColor.swift
//  react-native-nitro-ui
//

import UIKit

extension UIColor {
  /// Decode the ARGB integer RN's `processColor` produces.
  ///
  /// `processColor` is signed on Android (`| 0x0`) and unsigned on iOS (`>>> 0`),
  /// so the same colour arrives as two different `Double`s. Only the low 32 bits
  /// matter, and they have to be taken without a range check that rejects either
  /// half - an `Int32(exactly:)` guard drops every opaque iOS colour, because
  /// `0xFF…` is above `Int32.max`.
  convenience init?(nitroUiARGB value: Double) {
    guard value.isFinite, value >= -2_147_483_648, value <= 4_294_967_295 else {
      return nil
    }
    let argb = UInt32(truncatingIfNeeded: Int64(value))
    self.init(
      red: CGFloat((argb >> 16) & 0xff) / 255.0,
      green: CGFloat((argb >> 8) & 0xff) / 255.0,
      blue: CGFloat(argb & 0xff) / 255.0,
      alpha: CGFloat((argb >> 24) & 0xff) / 255.0
    )
  }

  /// The inverse, for prop getters: unsigned, like iOS `processColor`.
  var nitroUiARGBValue: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
      return 0
    }
    let argb =
      (UInt32(round(alpha * 255)) << 24)
      | (UInt32(round(red * 255)) << 16)
      | (UInt32(round(green * 255)) << 8)
      | UInt32(round(blue * 255))
    return Double(argb)
  }
}
