//
//  NitroSpikeTextMirror.swift
//  react-native-nitro-ui
//
//  T18 spike only (`src/spike/TextField`): the one place a hosted text field's
//  private state is turned into a string JS can read.
//
//  Why it exists at all: the spike has to assert things a React Native app
//  cannot see — whether a composition is open, whether the handshake holds an
//  `unreported` value, what native's own string comparison says about two
//  strings JS believes are different, where the caret is. The alternative was
//  reading those out of a UI dump, which cannot see a composition range or an
//  event count at all. So the field writes one snapshot, and JS reads the
//  snapshot — never the control.
//
//  That distinction is the whole reason this is a type rather than a dict
//  inside the component: `core.md` §5 forbids a Hybrid View method that touches
//  SwiftUI/Compose from JS, and it is easy to write that by accident when the
//  read looks harmless (`textField.markedTextRange` from JS is exactly such an
//  accident). Everything here is *produced* on the UI thread by the host and
//  *consumed* on the JS thread as an immutable `String` behind a lock, the same
//  shape `NitroSwiftUIHost.contentSize` uses.
//

import Foundation

/// A text field's non-public state, as one line of `key=value` pairs.
///
/// Rendered on the UI thread (`render()`), stored atomically, and answered
/// verbatim by `nuiTestState()`. The keys and their meaning are documented once,
/// on `NitroUiSpikeTextFieldMethods.nuiTestState()` in `src/spike/`.
struct NitroSpikeTextMirror: @unchecked Sendable {
  /// The last value JS sent, which is not necessarily what is displayed.
  var displayed: String = ""
  var nativeEvents: Int = 0
  var jsEvents: Int = 0
  var unreported: Bool = false
  /// A composition is open (iOS: the text storage has a `markedTextRange`).
  var composing: Bool = false
  /// The field is editable right now (mounted, enabled, not recycled).
  var editable: Bool = false
  /// The field holds first responder / Compose focus.
  var focused: Bool = false
  /// Caret or selection, in UTF-16 code units — the unit both platforms' text
  /// APIs agree on, which is what makes the number comparable.
  var selectionStart: Int = 0
  var selectionLength: Int = 0
  /// Which shape this instance hosts: `swiftui`, `textfield`, or `compose`.
  var implementation: String = ""
  /// Lines the control measured itself at (P4's auto-grow curve).
  var lines: Int = 0
  /// Native's own `==` on the two strings it holds (`displayed` vs `js`).
  var equal: Bool = false
  /// Codepoints JS counts in the string it last sent.
  var jsCodePoints: Int = 0
  /// Outcome of the last `nuiTestApplyWrite`: `none`, `applied`, `stale`,
  /// `composing` or `same`.
  var lastWrite: String = "none"
  /// The branch the frozen arm chose, reported by both publish paths.
  ///
  /// `impl=` used to be written by whoever published last, and arm A's publish path is the only one that can
  /// run before a `UITextField` exists — so on the first iOS run an instance asked for `textfield` reported
  /// `impl=swiftui`, and nothing could tell "the prop never arrived" from "the representable is not attached
  /// yet" from "the branch never got built". `frozen=` is the branch, `live=` is the attachment; `impl=` stays
  /// the shape of the numbers in the rest of the line.
  var frozenImplementation: String = ""
  /// A live `UITextField` is attached to this instance (arm B only, and only after `makeUIView`).
  var liveField: Bool = false

  /// Snapshot of `displayed`, cached for the JS thread.
  private(set) var rendered: String = ""

  /// Recompute the line, on the UI thread.
  mutating func refresh() {
    rendered =
      "displayed=\(displayed) nativeEvents=\(nativeEvents) jsEvents=\(jsEvents)"
      + " unreported=\(unreported ? 1 : 0) composing=\(composing ? 1 : 0)"
      + " editable=\(editable ? 1 : 0) focused=\(focused ? 1 : 0)"
      + " selection=\(selectionStart)-\(selectionLength)"
      + " impl=\(implementation) lines=\(lines)"
      + " equal=\(equal ? 1 : 0) cps=\(jsCodePoints) lastWrite=\(lastWrite)"
      + " frozen=\(frozenImplementation) live=\(liveField ? 1 : 0)"
  }
}

/// Codepoint count of a string, i.e. what JS's `[...str].length` answers.
///
/// The spike needs this because the two halves of a controlled field compare
/// text differently: Swift's `==` on `String` is *canonical* equivalence
/// (é == e + combining accent), JS's `===` is a UTF-16 sequence comparison, and
/// RN's own composition-safe comparison (`RCTTextInputComponentView.mm:898`)
/// compares plain strings only when a composition is open. A field whose two
/// halves disagree about equality drops the user's edit silently, so P3 asserts
/// the two answers agree on the vectors Q2 §2.2 names — and this is the half
/// that makes the assertion mean codepoints rather than UTF-16 units.
@inline(__always)
func nitroSpikeCodePoints(_ text: String) -> Int {
  text.unicodeScalars.count
}
