//
//  UIColor+NitroUiColor.swift
//  react-native-nitro-ui
//

import UIKit

extension UIColor {
  /// Decode the ARGB integer RN's `processColor` produces.
  ///
  /// JS hands us a signed 32-bit value (`Int32` semantics), so reinterpreting the
  /// bits as unsigned is required before shifting, or a fully opaque colour turns
  /// transparent.
  convenience init?(nitroUiARGB value: Double) {
    guard let int = Int32(exactly: value) else {
      return nil
    }
    let argb = UInt32(bitPattern: int)
    self.init(
      red: CGFloat((argb >> 16) & 0xff) / 255.0,
      green: CGFloat((argb >> 8) & 0xff) / 255.0,
      blue: CGFloat(argb & 0xff) / 255.0,
      alpha: CGFloat((argb >> 24) & 0xff) / 255.0
    )
  }

  /// The inverse, for prop getters.
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
    return Double(Int32(bitPattern: argb))
  }
}
