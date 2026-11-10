//
//  NitroUiTextEditing.swift
//  react-native-nitro-ui
//
//  The text machinery that is not a control and not a Hybrid View, shared by
//  `TextField` and `SearchField` so the two cannot drift (DECISIONS D38 item 2).
//
//  Three things live here, because each is a rule that belongs to "a UIKit field
//  driven by the controlled-value handshake" rather than to one component:
//
//  - ``NitroUiTextTraits``: how RN's names become UIKit's, and the one font every
//    field uses.
//  - ``NitroUiTextControl``: what a field must be for the handshake to drive it, plus
//    the bodies of the delegate methods both controls forward here - `maxLength`,
//    the Return key and the clear button.
//  - ``NitroUiTextOwner``: the three rules of `docs/architecture/core.md` §4 as UIKit
//    applies them - decide a pending `value` write, write it into the control, and
//    report a user edit. One implementation, which both Hybrid Views get by
//    conforming; each supplies only its own host plumbing.
//
//  `NitroUiTextLimit` itself stays in `NitroUiTextLimit.swift`, where the
//  Foundation-only rule it implements can be compiled and tested on the host.
//

import UIKit

// MARK: - Traits

/// Shared configuration, so the two controls cannot drift apart.
enum NitroUiTextTraits {
  static func keyboardType(_ name: String) -> UIKeyboardType {
    switch name {
    case "number-pad": return .numberPad
    case "decimal-pad": return .decimalPad
    case "numeric": return .numbersAndPunctuation
    case "email-address": return .emailAddress
    case "phone-pad": return .phonePad
    case "url": return .URL
    default: return .default
    }
  }

  static func autocapitalization(_ name: String) -> UITextAutocapitalizationType {
    switch name {
    case "none": return .none
    case "words": return .words
    case "characters": return .allCharacters
    default: return .sentences
    }
  }

  /// The RN spelling of a keyboard a control is *configured with* — the read-back
  /// side of ``keyboardType(_:)``, for a test that has to prove the prop reached the
  /// field rather than only reached the model. `.numbersAndPunctuation` is how
  /// `"numeric"` arrives, so it goes back out under that name; a keyboard UIKit
  /// offers that no prop asks for (`.asciiCapable`, say) reads back as
  /// `"default"`, which is what the mapping would have chosen for it.
  static func name(of keyboard: UIKeyboardType) -> String {
    switch keyboard {
    case .numberPad, .asciiCapableNumberPad: return "number-pad"
    case .decimalPad: return "decimal-pad"
    case .numbersAndPunctuation: return "numeric"
    case .emailAddress: return "email-address"
    case .phonePad: return "phone-pad"
    case .URL: return "url"
    default: return "default"
    }
  }

  /// The read-back side of ``autocapitalization(_:)``.
  static func name(of capitalization: UITextAutocapitalizationType) -> String {
    switch capitalization {
    case .words: return "words"
    case .allCharacters: return "characters"
    case .sentences: return "sentences"
    default: return "none"
    }
  }

  /// The read-back side of `autoCorrect`: only `.no` refuses it — `.default` is the
  /// system's own answer, which is what `true` asks for.
  static func autoCorrect(_ correction: UITextAutocorrectionType) -> Bool {
    correction != .no
  }

  static func returnKey(_ name: String) -> UIReturnKeyType {
    switch name {
    case "done": return .done
    case "go": return .go
    case "next": return .next
    case "search": return .search
    case "send": return .send
    default: return .default
    }
  }

  /// The platform body font, following Dynamic Type - the size every other
  /// control's label follows, which is what the environment epoch re-measures for.
  static var font: UIFont { UIFont.preferredFont(forTextStyle: .body) }

  /// The input traits both controls take from the model, resolved once.
  struct Resolved {
    let keyboard: UIKeyboardType
    let capitalization: UITextAutocapitalizationType
    let correction: UITextAutocorrectionType
    let spelling: UITextSpellCheckingType

    init(_ model: TextFieldModel) {
      keyboard = NitroUiTextTraits.keyboardType(model.keyboardType)
      capitalization = NitroUiTextTraits.autocapitalization(model.autoCapitalize)
      correction = model.autoCorrect ? .default : .no
      // Spell checking follows autocorrect, as RN's `autoCorrect={false}` does.
      spelling = model.autoCorrect ? .default : .no
    }
  }

  /// Whether a composition is open: the `markedTextRange` check RN makes before it
  /// compares or replaces text (`RCTTextInputComponentView.mm:873-905`).
  static func composing(_ input: UITextInput) -> Bool {
    input.markedTextRange != nil
  }
}

// MARK: - The control

/// What the Hybrid View needs from either control.
protocol NitroUiTextControl: UIView {
  /// The text the control holds, marked text included.
  var nuiText: String { get }
  /// Whether an IME composition (marked text) is open.
  var nuiComposing: Bool { get }
  /// Replace the text without reporting it as an edit.
  func nuiSetText(_ text: String)
  /// Re-apply the model's configuration (never its text).
  func nuiApply()
  /// What `nuiTestSetMarkedText` does: open, update or (`''`) commit a composition.
  func nuiSetMarkedText(_ text: String)
  /// The model being driven - the limit, the editability and the callbacks live there.
  var nuiModel: TextFieldModel { get }
  /// Put the caret at a UTF-16 offset, after a partial insertion was applied here.
  func nuiSetCaret(at utf16Offset: Int)
  /// Report that the user changed the text (each control's own edit signal).
  func nuiReportEdit()
}

extension NitroUiTextControl {
  /// The body of `textField(_:shouldChangeCharactersIn:replacementString:)` and
  /// `textView(_:shouldChangeTextIn:replacementText:)` - `maxLength`, applied as React
  /// Native applies it: the *inserted* text is cut to what still fits, never the end
  /// of the field, and never inside a composed character.
  ///
  /// Returns whether UIKit may apply the edit itself. When only part of it fits the
  /// part that fits is applied here, at the caret UIKit asked for, and reported as the
  /// edit it is.
  func nuiShouldChangeCharacters(in range: NSRange, replacement: String) -> Bool {
    let model = nuiModel
    // While a composition is open the IME owns the text: refusing or trimming a
    // marked-text step destroys it. The limit is applied when it commits.
    guard let limit = model.maxLength, !nuiComposing else { return true }
    guard let fitting = NitroUiTextLimit.fitting(
      current: nuiText,
      range: range,
      replacement: replacement,
      limit: limit
    ) else {
      return false
    }
    if fitting == replacement { return true }
    // Part of it fits: insert that part ourselves, then report it as the edit it is.
    let next = (nuiText as NSString).replacingCharacters(in: range, with: fitting)
    nuiSetText(next)
    nuiSetCaret(at: range.location + (fitting as NSString).length)
    nuiReportEdit()
    return false
  }

  /// The body of the Return key: React Native's default for a single-line field
  /// (`submitBehavior` 'blurAndSubmit') - report the submit, then give focus up.
  func nuiSubmitFromReturn() {
    nuiModel.owner?.submitted(nuiText)
    _ = resignFirstResponder()
  }

  /// The clear button, which both controls have: a field that is not editable takes
  /// no edits, so it takes no clear either. Each platform's own control then reports
  /// the cleared text through its normal edit path, which is what makes the clear an
  /// edit like any other.
  var nuiAllowsClear: Bool {
    nuiModel.editable
  }

  /// The `markedText` test seam, identical on both controls.
  func nuiSetMarkedText(_ marked: String) {
    guard let input = self as? UITextInput else { return }
    if marked == "\u{18}" {
      // CANCEL: what Backspace through a whole composition does - no marked text, then
      // the session ends with nothing to commit.
      input.setMarkedText("", selectedRange: NSRange(location: 0, length: 0))
      input.unmarkText()
    } else if marked.isEmpty {
      input.unmarkText()
    } else {
      input.setMarkedText(
        marked,
        selectedRange: NSRange(location: (marked as NSString).length, length: 0)
      )
    }
  }
}

// MARK: - The Hybrid View's half

/// What the field reports to. Both text Hybrid Views conform, and the shared
/// implementations below are the whole of the write/report logic.
protocol NitroUiTextOwner: AnyObject {
  /// The model this view drives.
  var nuiTextModel: TextFieldModel { get }
  /// The text may have to be drawn again, and at another size when the field grows
  /// with its text (`multiline`).
  func nuiMarkTextDirty(sizeMayChange: Bool)
  /// The text is another number of lines: nothing else will re-measure, so ask now.
  func nuiInvalidateTextSize()
  /// The field gained (`true`) or lost (`false`) focus.
  func focusMoved(_ focused: Bool)
  /// The Return key was pressed, with the text the field holds.
  func submitted(_ text: String)
  /// Republish the harness snapshot.
  func publishState()
}

extension NitroUiTextOwner {
  private var model: TextFieldModel { nuiTextModel }

  /// Decide a pending `value` write: applied, stale, or held back by an open
  /// composition. Called from a commit, and when a composition that held one back ends.
  func applyWrite() {
    let composing = model.control?.nuiComposing ?? false
    guard let js = model.state.js, js != model.state.displayed else { return }
    if composing {
      // Q2 §2.2: a write under an open composition would destroy it. Held back, not
      // queued: `userEdited` decides it again when the composition ends.
      model.lastWrite = "composing"
    } else if model.state.reconcile() {
      model.lastWrite = "applied"
      nuiMarkTextDirty(sizeMayChange: model.multiline)
    } else {
      model.lastWrite = "stale"
    }
  }

  /// Write the model's text into the control when the two differ - a React write, a
  /// default, a reset - and never into an open composition.
  func syncText() {
    guard let control = model.control, !control.nuiComposing else { return }
    if NitroUiText(control.nuiText) != model.state.displayed {
      control.nuiSetText(model.state.displayed.string)
    }
  }

  /// The user changed the text. Native owns it, counts it and emits it - once a
  /// composition has committed, not at each of its steps (marked text belongs to the
  /// IME until then; Android differs, see `docs/components/text-field.md`).
  ///
  /// The edit that ends a composition also settles a `value` write the composition held
  /// back, whatever the text it leaves: a composition the user deleted puts back text
  /// native already counted, so no edit and no commit would ever decide it again.
  func userEdited(_ control: NitroUiTextControl) {
    nitroUiAssertMainThread()
    let composing = control.nuiComposing
    let compositionEnded = model.wasComposing && !composing
    model.wasComposing = composing
    guard !composing else {
      publishState()
      return
    }
    var text = control.nuiText
    if let limit = model.maxLength, (text as NSString).length > limit {
      // A backstop for text that got past the delegate's cut - a composition's commit, or
      // `insertText`. It cuts the *edit*, not the field: what the user typed takes the room
      // the cap still has wherever they put it, and the text around it keeps its place.
      // Cutting the tail instead lost the words on either side of a mid-field commit.
      let kept = NitroUiCommitDelta.clamped(
        displayed: model.state.displayed.string,
        incoming: text,
        limit: limit
      )
      if kept != text {
        text = kept
        control.nuiSetText(text)
      }
    }
    let next = NitroUiText(text)
    if next != model.state.displayed {
      let eventCount = model.state.user(next)
      if model.multiline {
        // Auto-grow: the text can now be another number of lines, and nothing else
        // will re-measure - no bounds change, no prop. Measures now and reports.
        nuiInvalidateTextSize()
      }
      publishState()
      model.onChange?(text, Double(eventCount))
    }
    if compositionEnded, model.lastWrite == "composing" {
      applyWrite()
      syncText()
      if model.multiline { nuiInvalidateTextSize() }
    }
    publishState()
  }
}
