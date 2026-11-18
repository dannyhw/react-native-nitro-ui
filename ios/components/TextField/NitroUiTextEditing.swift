// The text handling shared by `TextField` and `SearchField`: trait mapping, the delegate
// logic both controls forward here, and the controlled-value write and report rules.

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

  /// The React Native name of a keyboard type, the reverse of `keyboardType(_:)`. A
  /// keyboard no prop asks for reads back as `"default"`.
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

  /// The reverse of `autocapitalization(_:)`.
  static func name(of capitalization: UITextAutocapitalizationType) -> String {
    switch capitalization {
    case .words: return "words"
    case .allCharacters: return "characters"
    case .sentences: return "sentences"
    default: return "none"
    }
  }

  /// Only `.no` turns autocorrect off; `.default` is what `true` asks for.
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

  /// The platform body font, following Dynamic Type.
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

  /// Whether an IME composition is open (marked text exists).
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
  /// Test hook: open, update or (`''`) commit a composition.
  func nuiSetMarkedText(_ text: String)
  /// The model being driven - the limit, the editability and the callbacks live there.
  var nuiModel: TextFieldModel { get }
  /// Put the caret at a UTF-16 offset, after a partial insertion was applied here.
  func nuiSetCaret(at utf16Offset: Int)
  /// The caret's UTF-16 offset in the text; the start of a selection. `-1` when the control has
  /// no selection to read.
  var nuiCaret: Int { get }
  /// Whether the keyboard attached here is told that suggestions and autocorrections are
  /// available. iOS hands a keyboard its `autocorrectionType` trait, so the trait is the answer.
  var nuiSuggestionsOffered: Bool { get }
  /// Report that the user changed the text (each control's own edit signal).
  func nuiReportEdit()
}

extension NitroUiTextControl {
  /// Both controls are `UITextInput`s, and both keep their caret in the selection.
  var nuiCaret: Int {
    guard let input = self as? UITextInput, let selection = input.selectedTextRange else {
      return -1
    }
    return input.offset(from: input.beginningOfDocument, to: selection.start)
  }

  var nuiSuggestionsOffered: Bool {
    (self as? UITextInputTraits)?.autocorrectionType != .no
  }

  /// The body of both controls' "should change characters" delegate methods. Applies
  /// `maxLength` as React Native does: the inserted text is cut to what still fits, never
  /// the end of the field, and never inside a composed character.
  ///
  /// Returns whether UIKit may apply the edit itself. When only part of it fits, that part
  /// is applied here and reported as an edit.
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

  /// The Return key on a single-line field: report the submit, then give up focus, as
  /// React Native does by default.
  func nuiSubmitFromReturn() {
    nuiModel.owner?.submitted(nuiText)
    _ = resignFirstResponder()
  }

  /// A field that is not editable takes no clear either.
  var nuiAllowsClear: Bool {
    nuiModel.editable
  }

  /// Test hook for marked text.
  func nuiSetMarkedText(_ marked: String) {
    guard let input = self as? UITextInput else { return }
    if marked == "\u{18}" {
      // CANCEL: what backspacing through a whole composition does. No marked text, then
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

/// What the field reports to. Both text Hybrid Views conform and share the implementations
/// below.
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
  /// Republish the test snapshot.
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
      // A write under an open composition would destroy it. Held back, not queued:
      // `userEdited` decides it again when the composition ends.
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

  /// The user changed the text. Emitted once a composition has committed, not at each of
  /// its steps: marked text belongs to the IME until then.
  ///
  /// The edit that ends a composition also settles a `value` write the composition held
  /// back, even if the text is unchanged: otherwise nothing would decide that write again.
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
      // A backstop for text that got past the delegate's cut (a composition's commit, or
      // `insertText`). It cuts the edit, not the tail of the field, so the text around a
      // mid-field insertion keeps its place.
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
        // The text can now be another number of lines, and nothing else will re-measure.
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
