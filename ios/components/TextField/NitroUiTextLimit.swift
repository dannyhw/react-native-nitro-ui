//
//  NitroUiTextLimit.swift
//  react-native-nitro-ui
//
//  The TextField's text rules that need no UIKit: how two strings compare, how
//  `maxLength` cuts an edit, and which part of a field's text the user just typed.
//  Foundation only, so the host-side test
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

/// The edit a text field actually received, recovered from the text before it and after it.
///
/// UIKit does not always say what the user typed: the commit of a marked-text run reports the
/// whole field, and a `UITextField.insertText` says nothing at all. The typed part is what sits
/// between the prefix and the suffix those two strings share, so it can be recovered - and only
/// that part is the user's edit. Everything else in the field is text they did not touch, and a
/// `maxLength` has no claim on it: cutting the whole field instead of the edit takes the end of
/// what the user already wrote, which reads as the field eating their words (G13 review, fix
/// round 2 - `abcd` with `かき` committed after the `a` is `aかきbcd`, and the first five code
/// units of that is not what anyone typed).
///
/// Walking grapheme clusters (`Character`) rather than code units is what keeps a family or a
/// flag whole: where two strings from one field agree up to a cluster, they agree up to a
/// cluster boundary.
enum NitroUiCommitDelta {
  struct Edit: Equatable {
    /// UTF-16 offsets - the units JavaScript, and UIKit's `NSRange`, count in.
    let location: Int
    let deletionLength: Int
    let insertion: String

    func apply(to text: String) -> String {
      (text as NSString).replacingCharacters(
        in: NSRange(location: location, length: deletionLength), with: insertion)
    }
  }

  /// The one edit that turns `displayed` into `incoming`, or `nil` when they are the same text.
  /// Text that differs in two separate places has no single such edit, and `clamped` says what
  /// to do with that rather than pretending.
  static func edit(displayed: String, incoming: String) -> Edit? {
    if displayed == incoming {
      return nil
    }
    let before = Array(displayed)
    let after = Array(incoming)
    var prefix = 0
    while prefix < before.count, prefix < after.count, before[prefix] == after[prefix] {
      prefix += 1
    }
    var suffix = 0
    while suffix < before.count - prefix,
      suffix < after.count - prefix,
      before[before.count - 1 - suffix] == after[after.count - 1 - suffix]
    {
      suffix += 1
    }
    return Edit(
      location: (String(before[0..<prefix]) as NSString).length,
      deletionLength: (String(before[prefix..<(before.count - suffix)]) as NSString).length,
      insertion: String(after[prefix..<(after.count - suffix)])
    )
  }

  /// The text a field may keep when it ended up past `limit` without the delegate's cut: the
  /// commit of a composition, or an `insertText` straight into the control.
  ///
  /// The answer is `incoming` with the *edit* trimmed to what `fitting` allows, so text outside
  /// the edit keeps its place. An edit that cannot fit at all is refused, which is also what
  /// keeps text a JS write put past the limit from being trimmed down to it - the write is not
  /// the user's edit, and never gets trimmed here.
  static func clamped(displayed: String, incoming: String, limit: Int) -> String {
    guard (incoming as NSString).length > limit else {
      return incoming
    }
    guard let change = edit(displayed: displayed, incoming: incoming) else {
      return displayed
    }
    // A deletion, or a replacement with nothing typed: nothing new is being added, so there is
    // nothing to cap. Text past the limit that the user shrank stays as they left it, exactly
    // as the delegate leaves it.
    if change.insertion.isEmpty {
      return incoming
    }
    guard change.apply(to: displayed) == incoming else {
      // No single edit describes the change, so there is nothing more specific to cut than the
      // end of the text - the answer that is right for text appended at the end.
      return NitroUiTextLimit.truncate(incoming, to: limit)
    }
    // Nothing of the edit fits: refuse it whole, its deletion included, the way the keyboard
    // path (`shouldChangeCharactersIn`) does.
    guard let allowed = NitroUiTextLimit.fitting(
      current: displayed,
      range: NSRange(location: change.location, length: change.deletionLength),
      replacement: change.insertion,
      limit: limit
    ) else {
      return displayed
    }
    if allowed == change.insertion {
      return incoming
    }
    return Edit(
      location: change.location,
      deletionLength: change.deletionLength,
      insertion: allowed
    ).apply(to: displayed)
  }
}
