//
//  NitroUiTextLimit.swift
//  react-native-nitro-ui
//
//  The TextField's text rules that need no UIKit: how two strings compare, and how
//  `maxLength` cuts an edit. Foundation only, so the host-side test
//  (`scripts/native-tests/text-limit.test.swift`) compiles this file unchanged.
//

import Foundation

/// A string compared the way JavaScript compares one: UTF-16 code unit by code
/// unit.
///
/// Swift's `String ==` is canonical equivalence, so `"é"` precomposed equals `e` +
/// U+0301 there and differs in JavaScript and Kotlin. The handshake compares the
/// text React sent with the text native shows, and a field whose two platforms
/// answered that question differently would apply a write on one and drop it on
/// the other. One rule for both platforms: Android's `==` is already this one.
struct NitroUiText: Equatable {
  var string: String

  init(_ string: String) {
    self.string = string
  }

  static func == (lhs: NitroUiText, rhs: NitroUiText) -> Bool {
    lhs.string.utf16.elementsEqual(rhs.string.utf16)
  }
}

/// `maxLength`, enforced the way React Native enforces it: counted in UTF-16 code
/// units (JavaScript's `string.length`), and never by cutting a composed
/// character - an emoji, a flag, a family - in half.
enum NitroUiTextLimit {
  /// The part of `replacement` that may replace `range` of `current` under `limit`,
  /// or `nil` when none of it may (RN's `textInputShouldChangeText:inRange:`).
  static func fitting(current: String, range: NSRange, replacement: String, limit: Int) -> String? {
    let currentLength = (current as NSString).length
    let incoming = replacement as NSString
    var allowed = limit - currentLength + range.length
    if allowed <= 0 {
      return incoming.length == 0 ? replacement : nil
    }
    if incoming.length <= allowed {
      return replacement
    }
    // The composed character the limit falls inside: keep it only if it ends
    // inside the limit, which is what never splits a surrogate pair or a ZWJ
    // sequence.
    let cut = incoming.rangeOfComposedCharacterSequence(at: allowed - 1)
    if cut.location + cut.length > allowed {
      allowed = cut.location
    }
    return allowed <= 0 ? nil : incoming.substring(to: allowed)
  }

  /// `text` cut to `limit` code units at a composed-character boundary - for the one
  /// case the insertion rule above cannot see: a composition that was let through
  /// open and committed past the limit.
  static func truncate(_ text: String, to limit: Int) -> String {
    let string = text as NSString
    guard string.length > limit else { return text }
    guard limit > 0 else { return "" }
    var end = limit
    let cut = string.rangeOfComposedCharacterSequence(at: limit - 1)
    if cut.location + cut.length > limit {
      end = cut.location
    }
    return string.substring(to: end)
  }
}
