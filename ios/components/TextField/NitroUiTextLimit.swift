// The TextField's text rules that need no UIKit: how two strings compare, how `maxLength` cuts an
// edit, and which part of a field's text the user just typed. Foundation only, so host-side tests
// can compile it.

import Foundation

/// A string compared the way JavaScript and Kotlin compare one: UTF-16 code unit by code unit.
/// Swift's `String ==` is canonical equivalence, so precomposed `é` equals `e` + U+0301 there, and
/// the two platforms would disagree about whether React's text matches the field's.
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

  /// `text` cut to `limit` code units at a composed-character boundary, for a composition that was
  /// committed past the limit.
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

/// The edit a text field received, recovered from the text before and after it. UIKit does not
/// always say what the user typed (a marked-text commit reports the whole field, `insertText`
/// nothing), so the edit is what sits between the shared prefix and suffix. `maxLength` trims only
/// that part, never text the user did not touch. Walks grapheme clusters, so an emoji sequence
/// stays whole.
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
  /// Text that differs in two separate places has no single such edit; `clamped` handles that.
  ///
  /// `anchoredAt` is where UIKit says the edit began. The longest stretch of text the two share
  /// from the start is only a bound: committing `aa` at offset 1 of `aaaa` also shares four
  /// characters, and an edit found there is a different edit with the same result. The anchor is
  /// taken back to a grapheme boundary, the finest place an edit can start.
  static func edit(displayed: String, incoming: String, anchoredAt: Int? = nil) -> Edit? {
    if displayed == incoming {
      return nil
    }
    let before = Array(displayed)
    let after = Array(incoming)
    var prefix = 0
    var prefixUnits = 0
    while prefix < before.count, prefix < after.count, before[prefix] == after[prefix] {
      prefixUnits += (String(before[prefix]) as NSString).length
      prefix += 1
    }
    if let anchoredAt, anchoredAt >= 0, anchoredAt < prefixUnits {
      while prefix > 0, prefixUnits > anchoredAt {
        prefix -= 1
        prefixUnits -= (String(before[prefix]) as NSString).length
      }
    }
    var suffix = 0
    while suffix < before.count - prefix,
      suffix < after.count - prefix,
      before[before.count - 1 - suffix] == after[after.count - 1 - suffix]
    {
      suffix += 1
    }
    return Edit(
      location: prefixUnits,
      deletionLength: (String(before[prefix..<(before.count - suffix)]) as NSString).length,
      insertion: String(after[prefix..<(after.count - suffix)])
    )
  }

  /// The text a field may keep when it ended up past `limit` without the delegate's cut, and the
  /// caret that goes with it.
  struct Clamp: Equatable {
    let text: String
    /// The UTF-16 offset just after the part of the edit that was kept, or `nil` when the field
    /// already holds `text` and UIKit's own caret is the right one. Writing `text` into a control
    /// moves its caret to the end, so a cut made in the middle has to put the caret back.
    let caret: Int?
  }

  /// `clamped`, and where the caret belongs once the text has been written back.
  /// `editLocation` is where UIKit says the edit that passed the limit began, when it says.
  static func clamp(
    displayed: String,
    incoming: String,
    limit: Int,
    editLocation: Int? = nil
  ) -> Clamp {
    guard (incoming as NSString).length > limit else {
      return Clamp(text: incoming, caret: nil)
    }
    guard
      let change = edit(displayed: displayed, incoming: incoming, anchoredAt: editLocation)
    else {
      return Clamp(text: displayed, caret: nil)
    }
    // A deletion adds nothing, so there is nothing to cap: text already past the limit stays as the
    // user left it.
    if change.insertion.isEmpty {
      return Clamp(text: incoming, caret: nil)
    }
    guard change.apply(to: displayed) == incoming else {
      // No single edit describes the change, so there is nothing more specific to cut than the
      // end of the text - the answer that is right for text appended at the end, where the caret
      // belongs as well.
      return Clamp(text: NitroUiTextLimit.truncate(incoming, to: limit), caret: nil)
    }
    // Nothing of the edit fits: refuse it whole, its deletion included, the way the keyboard
    // path (`shouldChangeCharactersIn`) does, and leave the caret where the edit was asked for.
    guard let allowed = NitroUiTextLimit.fitting(
      current: displayed,
      range: NSRange(location: change.location, length: change.deletionLength),
      replacement: change.insertion,
      limit: limit
    ) else {
      return Clamp(text: displayed, caret: change.location)
    }
    if allowed == change.insertion {
      return Clamp(text: incoming, caret: nil)
    }
    let kept = Edit(
      location: change.location,
      deletionLength: change.deletionLength,
      insertion: allowed
    )
    return Clamp(
      text: kept.apply(to: displayed),
      caret: kept.location + (allowed as NSString).length
    )
  }

  /// The text a field may keep when it ended up past `limit` without the delegate's cut. It is
  /// `incoming` with the edit trimmed to what `fitting` allows, so text outside the edit keeps its
  /// place. An edit that cannot fit at all is refused.
  static func clamped(displayed: String, incoming: String, limit: Int) -> String {
    clamp(displayed: displayed, incoming: incoming, limit: limit).text
  }
}
