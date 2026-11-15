import UIKit

extension UIColor {
  /// Decode the ARGB integer RN's `processColor` produces. It is signed on Android and unsigned on
  /// iOS, so only the low 32 bits are taken: an `Int32(exactly:)` guard would reject every opaque
  /// iOS colour.
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
