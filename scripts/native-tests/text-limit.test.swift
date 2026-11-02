//
//  text-limit.test.swift
//
//  Host-side vectors for the TextField's `maxLength` cut, its committed-composition
//  backstop and its text equality
//  (ios/components/TextField/NitroUiTextLimit.swift).
//
//  `fitting` is what `shouldChangeCharactersIn` / `shouldChangeTextIn` run for a
//  keyboard's or a paste's edit: it keeps the part of the *inserted* text that fits,
//  wherever the insertion is. `truncate` is the post-edit backstop, which only ever
//  cuts the end. For typing at the end of the text the two give the same answer, so
//  an on-device typing test cannot tell a broken `fitting` from a working one; the
//  mid-text vectors here are the ones that can.
//
import Foundation

@main
struct TextLimitTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  /// `NitroUiCommitDelta.clamped` - what the iOS backstop runs when a field ends up past
  /// the limit without the delegate's cut. Compared as UTF-16, like `checkFitting`.
  private static func checkClamped(
    _ displayed: String, _ incoming: String, _ limit: Int, _ expected: String, _ what: String
  ) {
    let got = NitroUiCommitDelta.clamped(displayed: displayed, incoming: incoming, limit: limit)
    check((got as NSString) == (expected as NSString), what + " -> \"" + got + "\"")
  }

  /// `fitting`, compared as UTF-16 (JavaScript's view of the string) so a lone
  /// surrogate can never compare equal to anything a test expects.
  private static func checkFitting(
    _ current: String, _ location: Int, _ length: Int, _ replacement: String, _ limit: Int,
    _ expected: String?, _ what: String
  ) {
    let got = NitroUiTextLimit.fitting(
      current: current, range: NSRange(location: location, length: length),
      replacement: replacement, limit: limit)
    let same: Bool
    switch (got, expected) {
    case (nil, nil): same = true
    case let (got?, want?): same = got.utf16.elementsEqual(want.utf16)
    default: same = false
    }
    check(same, "\(what) (got \(got.map { "\"\($0)\"" } ?? "nil"), want \(expected.map { "\"\($0)\"" } ?? "nil"))")
  }

  /// The edit `fitting` allows, applied to `current` - what the field ends up showing.
  private static func applied(_ current: String, _ location: Int, _ length: Int, _ replacement: String, _ limit: Int) -> String? {
    guard let fit = NitroUiTextLimit.fitting(
      current: current, range: NSRange(location: location, length: length),
      replacement: replacement, limit: limit)
    else { return nil }
    return (current as NSString).replacingCharacters(in: NSRange(location: location, length: length), with: fit)
  }

  private static func checkTruncate(_ text: String, _ limit: Int, _ expected: String, _ what: String) {
    let got = NitroUiTextLimit.truncate(text, to: limit)
    check(got.utf16.elementsEqual(expected.utf16), "\(what) (got \"\(got)\", want \"\(expected)\")")
  }

  static func main() {
    print("NitroUiTextLimit.fitting")
    checkFitting("ab", 2, 0, "cd", 5, "cd", "an insertion that fits is kept whole")
    checkFitting("abcd", 4, 0, "efg", 5, "e", "at the end, the part that fits")
    checkFitting("abcd", 2, 0, "xyz", 6, "xy", "mid-text, the part of the insertion that fits")
    check(
      applied("abcd", 2, 0, "xyz", 6) == "abxycd",
      "mid-text, the text after the caret is kept (the backstop would give \"abxyzc\")")
    checkFitting("abcdef", 1, 3, "WXYZ", 6, "WXY", "a replaced selection frees its own length")
    checkFitting("abcd", 4, 0, "😀", 5, nil, "an emoji with one unit free is refused whole")
    checkFitting("ab", 2, 0, "😀x", 4, "😀", "an emoji that ends inside the limit is kept")
    checkFitting("ab", 2, 0, "👨‍👩‍👧", 6, nil, "a ZWJ family is never cut inside")
    checkFitting("a", 1, 0, "x👨‍👩‍👧", 6, "x", "the cut falls before a family that does not fit")
    checkFitting("ab", 2, 0, "🇯🇵🇫🇷", 6, "🇯🇵", "a flag is two regional indicators and is kept whole")
    checkFitting("abc", 3, 0, "🇯🇵", 6, nil, "half a flag is never inserted")
    checkFitting("ab", 2, 0, "e\u{0301}x", 3, nil, "a base and its combining mark go together")
    checkFitting("", 0, 0, "a", 0, nil, "limit 0 takes nothing")
    checkFitting("", 0, 0, "", 0, "", "limit 0 still allows an empty edit")
    checkFitting("abcdefgh", 7, 1, "", 5, "", "a deletion from a field over its limit is allowed")
    checkFitting("abcdefgh", 8, 0, "x", 5, nil, "an insertion into a field over its limit is not")

    print("NitroUiTextLimit.truncate")
    checkTruncate("abc", 5, "abc", "under the limit, unchanged")
    checkTruncate("abcdef", 5, "abcde", "cut to the limit")
    checkTruncate("abcd😀", 5, "abcd", "never through a surrogate pair")
    checkTruncate("a👨‍👩‍👧", 5, "a", "never through a ZWJ family")
    checkTruncate("x", 0, "", "limit 0 is empty")

    print("NitroUiCommitDelta.clamped")
    // The field held `abcd`, the caret sat after the `a`, and the IME committed `かき`:
    // the text the field shows is `aかきbcd`, and only the `かき` is the user's edit.
    // Cutting the *field* here answers `aか` - the user's `bcd` is gone either way.
    checkClamped("abcd", "a\u{304B}\u{304D}bcd", 5, "a\u{304B}bcd",
      "a commit in the middle takes the room the cap has, and the text past it stays")
    checkClamped("abcd", "ab\u{304B}\u{304D}cd", 6, "ab\u{304B}\u{304D}cd",
      "a commit in the middle that fits is taken whole")
    checkClamped("abcd", "ab\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}cd", 6, "abcd",
      "a ZWJ family that cannot fit is refused whole - never cut in half, never at the cost of the `cd`")
    checkClamped("abcd", "a\u{1F600}bcd", 5, "abcd",
      "an emoji that does not fit is refused, and nothing past it moves")
    // A JS write put the field past the cap; the user's commit must not cut it down.
    checkClamped("abcdefgh", "abcdefgh\u{304B}", 5, "abcdefgh",
      "a field already past the cap refuses new text and keeps what JS wrote")
    checkClamped("abcdefgh", "abcdefg", 5, "abcdefg",
      "a deletion from text past the cap is left alone")
    checkClamped("abcd", "aXd", 3, "aXd",
      "a selection replaced with text that fits is taken")

    print("NitroUiText ==")
    check(NitroUiText("abc") == NitroUiText("abc"), "the same code units are equal")
    check(
      NitroUiText("\u{00E9}") != NitroUiText("e\u{0301}"),
      "precomposed and decomposed é differ, as they do in JavaScript")
    check("\u{00E9}" == "e\u{0301}", "Swift's own == says they are equal (fixture sanity)")

    if failures > 0 {
      print("text-limit.test: \(failures) failure(s)")
      exit(1)
    }
    print("text-limit.test: all passed")
  }
}
