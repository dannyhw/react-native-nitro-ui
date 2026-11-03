//
//  HybridNitroUiTextField.swift
//  react-native-nitro-ui
//
//  The TextField component (G13): a UIKit `UITextField` - a `UITextView` when
//  `multiline` - hosted through a `UIViewRepresentable` in the core SwiftUI host
//  (DECISIONS D34). SwiftUI's own `TextField` cannot tell anybody that a
//  composition is open, and the controlled-value guard below has to know.
//
//  The host is the shipped `NitroSwiftUIHost` because everything around the field
//  is the shipped machinery: one hosting controller per view, never re-rooted;
//  the sizing reports; perf marks; the recycle counters. What the representable
//  adds is a UIKit control whose text is *not* SwiftUI state: SwiftUI builds it
//  once per shape (`makeUIView`), and `updateUIView` only re-applies the
//  configuration. The text moves through two explicit paths instead - the
//  user's edits up (`userEdited`), React's writes down (`syncText`) - so no
//  SwiftUI update can ever write over what a person is typing.
//

import NitroModules
import SwiftUI
import UIKit

// `NitroUiText` and `NitroUiTextLimit` live in `NitroUiTextLimit.swift`: Foundation
// only, so `scripts/native-tests/text-limit.test.swift` compiles them on the host.
//
// The `NitroUiTextControl` protocol, `NitroUiTextTraits` and the shared half of the
// Hybrid View (``NitroUiTextOwner``) live in `NitroUiTextEditing.swift`, because
// `SearchField` drives the same rules with a different control and the two must not be
// able to drift (DECISIONS D38 item 2).

// MARK: - Model

/// State of one TextField. See ``NitroUiModel`` for why this is not `@Published`.
final class TextFieldModel: NitroUiModel {
  /// The text, on the shipped handshake.
  ///
  /// `unreported` is never set: it exists for values sampled faster than frames (a
  /// drag), and a field's edits are discrete. Setting it per keystroke would make a
  /// fast typist's writes permanently stale (Q2 §2.4).
  var state = NitroUiControlledValue<NitroUiText>(displayed: NitroUiText(""))
  var defaultValue: String?
  var didApplyDefault = false
  var placeholder: String?
  var multiline = false
  var keyboardType = "default"
  var autoCapitalize = "sentences"
  var autoCorrect = true
  var secureTextEntry = false
  var maxLength: Int?
  var returnKeyType = "default"
  var editable = true
  var accessibilityLabel: String?
  var sizingKey = ""
  /// What the last `value` write that differed from the text came to.
  var lastWrite = "none"
  /// Whether the field is first responder, as its own begin/end callbacks said.
  var focused = false
  /// A `focus()` that arrived before the control had a window to focus in.
  var focusWhenReady = false
  /// Whether the control held marked text the last time it reported an edit, so the
  /// edit that ends a composition is known as one (see `userEdited`).
  var wasComposing = false

  var onChange: ((_ value: String, _ eventCount: Double) -> Void)?
  var onFocusChange: ((_ focused: Bool) -> Void)?
  var onSubmit: ((_ text: String) -> Void)?

  /// The live UIKit control. Weak: the SwiftUI representable owns it.
  weak var control: NitroUiTextControl?
  /// Where the control reports to. Weak: the Hybrid View owns the host, which owns
  /// this model. The protocol so that a SearchField can drive the same model
  /// (`NitroUiTextEditing.swift`).
  weak var owner: (any NitroUiTextOwner)?

  override init() {
    super.init()
  }

  /// `secureTextEntry` as the control applies it: single-line only, as in RN.
  var secureApplied: Bool { secureTextEntry && !multiline }
}

// MARK: - The two UIKit controls

/// The single-line control: a `UITextField`, undecorated like RN's `TextInput`.
final class NitroUiSingleLineField: UITextField, UITextFieldDelegate, NitroUiTextControl {
  /// Strong: the model never holds the control strongly (`TextFieldModel.control`
  /// is weak), so there is no cycle, and a callback during teardown still has one.
  private let model: TextFieldModel
  /// Keeps our own writes from re-entering `editingChanged` as user edits.
  private var applying = false

  init(model: TextFieldModel) {
    self.model = model
    super.init(frame: .zero)
    delegate = self
    borderStyle = .none
    font = NitroUiTextTraits.font
    adjustsFontForContentSizeCategory = true
    textColor = .label
    addTarget(self, action: #selector(editingChanged), for: .editingChanged)
    addTarget(self, action: #selector(didBegin), for: .editingDidBegin)
    addTarget(self, action: #selector(didEnd), for: .editingDidEnd)
    text = model.state.displayed.string
    nuiApply()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: NitroUiSingleLineField cannot be built from a nib")
  }

  var nuiText: String { text ?? "" }
  var nuiComposing: Bool { NitroUiTextTraits.composing(self) }
  var nuiModel: TextFieldModel { model }

  func nuiSetText(_ next: String) {
    applying = true
    text = next
    applying = false
  }

  func nuiSetCaret(at utf16Offset: Int) {
    guard let caret = position(from: beginningOfDocument, offset: utf16Offset) else {
      return
    }
    selectedTextRange = textRange(from: caret, to: caret)
  }

  func nuiReportEdit() {
    guard !applying else { return }
    model.owner?.userEdited(self)
  }

  func nuiApply() {
    // A `UITextInputTraits` setter does not reach a keyboard that is already up: the
    // keyboard reads the traits when it attaches. So only what changed is written, and
    // a change to a focused field reloads its input views, as RN does
    // (`RCTTextInputComponentView.mm`, `updateProps`).
    let traits = NitroUiTextTraits.Resolved(model)
    var traitsChanged = false
    if keyboardType != traits.keyboard { keyboardType = traits.keyboard; traitsChanged = true }
    if autocapitalizationType != traits.capitalization {
      autocapitalizationType = traits.capitalization
      traitsChanged = true
    }
    if autocorrectionType != traits.correction { autocorrectionType = traits.correction; traitsChanged = true }
    if spellCheckingType != traits.spelling { spellCheckingType = traits.spelling; traitsChanged = true }
    let returnKey = NitroUiTextTraits.returnKey(model.returnKeyType)
    if returnKeyType != returnKey { returnKeyType = returnKey; traitsChanged = true }
    if isSecureTextEntry != model.secureApplied {
      isSecureTextEntry = model.secureApplied
      traitsChanged = true
      // Toggling secure entry on a field that has text leaves it drawn with the
      // previous mode's glyph metrics and caret; writing the text again redraws it, as
      // RN does (`RCTUITextField.mm`, `setSecureTextEntry:`).
      let original = attributedText
      applying = true
      attributedText = NSAttributedString()
      attributedText = original
      applying = false
    }
    if traitsChanged, isFirstResponder { reloadInputViews() }
    if placeholder != model.placeholder { placeholder = model.placeholder }
    if isEnabled != model.editable { isEnabled = model.editable }
    if accessibilityLabel != model.accessibilityLabel { accessibilityLabel = model.accessibilityLabel }
    if !model.editable, isFirstResponder { _ = resignFirstResponder() }
    model.owner?.publishState()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, model.focusWhenReady {
      model.focusWhenReady = false
      _ = becomeFirstResponder()
    }
  }

  /// `editable == false` takes no focus from any route - a tap, `focus()`, VoiceOver.
  /// `isEnabled` alone is not enough: a touch delivered straight to a disabled field
  /// still makes it first responder (measured with the harness's synthesized tap).
  override var canBecomeFirstResponder: Bool {
    model.editable && super.canBecomeFirstResponder
  }

  // MARK: Editing

  func textFieldShouldBeginEditing(_ textField: UITextField) -> Bool {
    model.editable
  }

  func textField(
    _ textField: UITextField,
    shouldChangeCharactersIn range: NSRange,
    replacementString string: String
  ) -> Bool {
    nuiShouldChangeCharacters(in: range, replacement: string)
  }

  /// UIKit's own clear button: refuse it on a field that is not editable, and let the
  /// `editingChanged` it causes report the empty text as the edit it is.
  func textFieldShouldClear(_ textField: UITextField) -> Bool {
    nuiAllowsClear
  }

  @objc private func editingChanged() {
    nuiReportEdit()
  }

  @objc private func didBegin() {
    model.owner?.focusMoved(true)
  }

  @objc private func didEnd() {
    model.owner?.focusMoved(false)
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    nuiSubmitFromReturn()
    return false
  }

  func textFieldDidChangeSelection(_ textField: UITextField) {
    model.owner?.publishState()
  }
}

/// The multi-line control: a `UITextView`, made to look like the single-line one
/// (no insets, no padding) and given the placeholder `UITextView` does not have.
final class NitroUiMultiLineField: UITextView, UITextViewDelegate, NitroUiTextControl {
  private let model: TextFieldModel
  private var applying = false
  private let placeholderLabel = UILabel()

  init(model: TextFieldModel) {
    self.model = model
    super.init(frame: .zero, textContainer: nil)
    delegate = self
    backgroundColor = .clear
    font = NitroUiTextTraits.font
    adjustsFontForContentSizeCategory = true
    textColor = .label
    textContainerInset = .zero
    textContainer.lineFragmentPadding = 0
    placeholderLabel.font = NitroUiTextTraits.font
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.textColor = .placeholderText
    placeholderLabel.numberOfLines = 0
    placeholderLabel.isAccessibilityElement = false
    addSubview(placeholderLabel)
    text = model.state.displayed.string
    nuiApply()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: NitroUiMultiLineField cannot be built from a nib")
  }

  var nuiText: String { text ?? "" }
  var nuiComposing: Bool { NitroUiTextTraits.composing(self) }
  var nuiModel: TextFieldModel { model }

  func nuiSetText(_ next: String) {
    applying = true
    text = next
    applying = false
    updatePlaceholder()
  }

  func nuiSetCaret(at utf16Offset: Int) {
    selectedRange = NSRange(location: utf16Offset, length: 0)
  }

  /// The text changed by hand: the placeholder goes away with it, the height follows
  /// the line count, and only then is the edit reported.
  func nuiReportEdit() {
    guard !applying else { return }
    updatePlaceholder()
    invalidateIntrinsicContentSize()
    model.owner?.userEdited(self)
  }

  func nuiApply() {
    // See ``NitroUiSingleLineField/nuiApply()`` for why a change reloads the keyboard.
    let traits = NitroUiTextTraits.Resolved(model)
    var traitsChanged = false
    if keyboardType != traits.keyboard { keyboardType = traits.keyboard; traitsChanged = true }
    if autocapitalizationType != traits.capitalization {
      autocapitalizationType = traits.capitalization
      traitsChanged = true
    }
    if autocorrectionType != traits.correction { autocorrectionType = traits.correction; traitsChanged = true }
    if spellCheckingType != traits.spelling { spellCheckingType = traits.spelling; traitsChanged = true }
    if traitsChanged, isFirstResponder { reloadInputViews() }
    if placeholderLabel.text != model.placeholder {
      placeholderLabel.text = model.placeholder
      setNeedsLayout()
    }
    if isEditable != model.editable { isEditable = model.editable }
    if accessibilityLabel != model.accessibilityLabel { accessibilityLabel = model.accessibilityLabel }
    if !model.editable, isFirstResponder { _ = resignFirstResponder() }
    updatePlaceholder()
    model.owner?.publishState()
  }

  private func updatePlaceholder() {
    placeholderLabel.isHidden = !(text ?? "").isEmpty
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = max(0, bounds.width)
    let size = placeholderLabel.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    placeholderLabel.frame = CGRect(x: 0, y: 0, width: width, height: size.height)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, model.focusWhenReady {
      model.focusWhenReady = false
      _ = becomeFirstResponder()
    }
  }

  /// See ``NitroUiSingleLineField/canBecomeFirstResponder``.
  override var canBecomeFirstResponder: Bool {
    model.editable && super.canBecomeFirstResponder
  }

  /// What iOS 15 lays the representable out with (it has no `sizeThatFits`): the
  /// height of the text at the current width.
  override var intrinsicContentSize: CGSize {
    let width = bounds.width > 0 ? bounds.width : UIView.layoutFittingExpandedSize.width
    let size = sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    return CGSize(width: UIView.noIntrinsicMetric, height: size.height)
  }

  // MARK: Editing

  func textViewShouldBeginEditing(_ textView: UITextView) -> Bool {
    model.editable
  }

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText string: String) -> Bool {
    nuiShouldChangeCharacters(in: range, replacement: string)
  }

  func textViewDidChange(_ textView: UITextView) {
    nuiReportEdit()
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    model.owner?.focusMoved(true)
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    model.owner?.focusMoved(false)
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    model.owner?.publishState()
  }
}

// MARK: - SwiftUI

/// One representable per shape. Building one is `makeUIView`; every later SwiftUI
/// update only re-applies configuration (`nuiApply`), never the text.
private struct SingleLineBox: UIViewRepresentable {
  @ObservedObject var model: TextFieldModel

  func makeUIView(context: Context) -> NitroUiSingleLineField {
    let field = NitroUiSingleLineField(model: model)
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    model.control = field
    model.owner?.publishState()
    return field
  }

  func updateUIView(_ uiView: NitroUiSingleLineField, context: Context) {
    uiView.nuiApply()
  }

  /// The box's width, and the field's own line height: a single-line field's
  /// height does not depend on its text or its width (`fillWidth`).
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiSingleLineField, context: Context) -> CGSize? {
    let height = ceil(uiView.intrinsicContentSize.height)
    return CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width, height: height)
  }

  static func dismantleUIView(_ uiView: NitroUiSingleLineField, coordinator: ()) {
    if uiView.isFirstResponder { _ = uiView.resignFirstResponder() }
  }
}

private struct MultiLineBox: UIViewRepresentable {
  @ObservedObject var model: TextFieldModel

  func makeUIView(context: Context) -> NitroUiMultiLineField {
    let field = NitroUiMultiLineField(model: model)
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    model.control = field
    model.owner?.publishState()
    return field
  }

  func updateUIView(_ uiView: NitroUiMultiLineField, context: Context) {
    uiView.nuiApply()
  }

  /// The height of the text at the box's width: the auto-grow.
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiMultiLineField, context: Context) -> CGSize? {
    let width = proposal.width ?? max(uiView.bounds.width, 1)
    let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    return CGSize(width: width, height: ceil(fitted.height))
  }

  static func dismantleUIView(_ uiView: NitroUiMultiLineField, coordinator: ()) {
    if uiView.isFirstResponder { _ = uiView.resignFirstResponder() }
  }
}

/// The SwiftUI half: one branch per shape. A `multiline` change swaps the control
/// (and so its focus), as it does in RN, where a multi-line field is another view.
struct TextFieldContent: NitroUIContent {
  @ObservedObject private var model: TextFieldModel

  init(model: TextFieldModel) {
    self.model = model
  }

  var body: some View {
    if model.multiline {
      MultiLineBox(model: model)
    } else {
      SingleLineBox(model: model)
    }
  }
}

// MARK: - Hybrid View

/// The Hybrid View React renders as `NitroUiTextField`.
final class HybridNitroUiTextField: HybridNitroUiTextFieldSpec, RecyclableView, NitroUiTextOwner {
  private let host: NitroSwiftUIHost<TextFieldContent>

  /// This component's name in the sizing engine.
  private static let sizingComponentName = "NitroUiTextField"

  /// The declared fallback: one line of the body font, the height a single-line
  /// field always measures at the default text size (22 pt on iOS 15 through 27),
  /// and the width a field gets under a parent that does not give it one (a row
  /// with no `flex`), where `fillWidth` draws the declared width.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 200.0, 22.0, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The snapshot `nuiTestState()` answers from. Written on main, read on JS.
  private let stateLock = NSLock()
  private var stateSnapshot = NitroUiTextFieldTestState(
    text: "", focused: false, composing: false, nativeEvents: 0, jsEvents: 0, lastWrite: "none",
    editable: true, multiline: false, secure: false, keyboardType: "default", returnKeyType: "default",
    autoCapitalize: "sentences", autoCorrect: true, maxLength: -1, placeholder: "", accessibilityLabel: "")

  override init() {
    host = NitroSwiftUIHost(model: TextFieldModel())
    super.init()
    // A field presents nothing of its own.
    host.needsContainment = false
    host.wantsContentSize = true
    // Height is the field's (one line, or its text at its width); width is the box.
    host.sizingPolicy = .fillWidth
    Self.declareFallback()
    model.owner = self
  }

  var view: NitroSwiftUIHost<TextFieldContent> {
    return host
  }

  private var model: TextFieldModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var value: Variant_NullType_String {
    get {
      guard let js = model.state.js else { return .first(.null) }
      return .second(js.string)
    }
    set { model.state.js = newValue.asType(String.self).map(NitroUiText.init) }
  }

  var defaultValue: Variant_NullType_String {
    get { model.defaultValue.map { .second($0) } ?? .first(.null) }
    set {
      model.defaultValue = newValue.asType(String.self)
      guard model.state.js == nil, !model.didApplyDefault, let initial = model.defaultValue else {
        return
      }
      model.didApplyDefault = true
      let text = NitroUiText(initial)
      guard text != model.state.displayed else { return }
      model.state.displayed = text
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var placeholder: Variant_NullType_String {
    get { model.placeholder.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.placeholder else { return }
      model.placeholder = next
      host.markDirty()
    }
  }

  var multiline: Bool {
    get { model.multiline }
    set {
      guard newValue != model.multiline else { return }
      model.multiline = newValue
      host.markDirty()
      // Another control, so another size.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var keyboardType: String {
    get { model.keyboardType }
    set {
      guard newValue != model.keyboardType else { return }
      model.keyboardType = newValue
      host.markDirty()
    }
  }

  var autoCapitalize: String {
    get { model.autoCapitalize }
    set {
      guard newValue != model.autoCapitalize else { return }
      model.autoCapitalize = newValue
      host.markDirty()
    }
  }

  var autoCorrect: Bool {
    get { model.autoCorrect }
    set {
      guard newValue != model.autoCorrect else { return }
      model.autoCorrect = newValue
      host.markDirty()
    }
  }

  var secureTextEntry: Bool {
    get { model.secureTextEntry }
    set {
      guard newValue != model.secureTextEntry else { return }
      model.secureTextEntry = newValue
      host.markDirty()
    }
  }

  var maxLength: Variant_NullType_Double {
    get { model.maxLength.map { .second(Double($0)) } ?? .first(.null) }
    set {
      // Read only by the control's edit callbacks; nothing to render.
      model.maxLength = newValue.asType(Double.self).flatMap { $0.isFinite ? Int($0) : nil }
    }
  }

  var returnKeyType: String {
    get { model.returnKeyType }
    set {
      guard newValue != model.returnKeyType else { return }
      model.returnKeyType = newValue
      host.markDirty()
    }
  }

  var editable: Bool {
    get { model.editable }
    set {
      guard newValue != model.editable else { return }
      model.editable = newValue
      host.markDirty()
    }
  }

  var testID: Variant_NullType_String {
    get { .first(.null) }
    set {
      // Nothing to apply, like Switch: RN already puts `testID` on the component
      // view as `accessibilityIdentifier`, and a second copy on the control would
      // make a testID query match twice.
      _ = newValue
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.accessibilityLabel else { return }
      model.accessibilityLabel = next
      host.markDirty()
    }
  }

  var nuiPerfId: Variant_NullType_Double {
    get {
      guard host.perfInstanceId >= 0 else { return .first(.null) }
      return .second(Double(host.perfInstanceId))
    }
    set { host.perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var nuiSizingKey: String {
    get { model.sizingKey }
    set {
      guard newValue != model.sizingKey else { return }
      model.sizingKey = newValue
      // Single-line and multi-line are two configurations. A mount's first key
      // costs nothing here: the host only arms this once it has measured.
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onValueChange: ((String, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  var onFocusChange: ((Bool) -> Void)? {
    get { model.onFocusChange }
    set { model.onFocusChange = newValue }
  }

  var onSubmitEditing: ((String) -> Void)? {
    get { model.onSubmit }
    set { model.onSubmit = newValue }
  }

  // MARK: - NitroUiTextOwner
  // The half of the shared text logic (`NitroUiTextEditing.swift`) that is this
  // view's own: which model it drives, and how a text change reaches its host.

  var nuiTextModel: TextFieldModel { model }

  func nuiMarkTextDirty(sizeMayChange: Bool) {
    host.markDirty()
    if sizeMayChange { host.noteContentSizeMayHaveChanged() }
  }

  /// Auto-grow: the text is another number of lines, so the cached content size is
  /// wrong and nothing else will notice.
  func nuiInvalidateTextSize() {
    host.invalidateContentSize()
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    applyWrite()
    syncText()
    host.commit()
    publishState()
  }

  func prepareForRecycle() {
    // RN resigns first responder on recycle too (`RCTTextInputComponentView.mm:386-399`):
    // a pooled field must not keep the keyboard, or report a blur to its next owner.
    // Every callback goes first: resigning commits open marked text as an edit, and
    // that edit belongs to nobody now. (`onDropView` clears them before this runs
    // today; the order here does not depend on it.)
    model.onFocusChange = nil
    model.onChange = nil
    model.onSubmit = nil
    if let control = model.control, control.isFirstResponder {
      _ = control.resignFirstResponder()
    }
    model.state = NitroUiControlledValue<NitroUiText>(displayed: NitroUiText(""))
    model.defaultValue = nil
    model.didApplyDefault = false
    model.placeholder = nil
    model.multiline = false
    model.keyboardType = "default"
    model.autoCapitalize = "sentences"
    model.autoCorrect = true
    model.secureTextEntry = false
    model.maxLength = nil
    model.returnKeyType = "default"
    model.editable = true
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.lastWrite = "none"
    model.focused = false
    model.focusWhenReady = false
    model.wasComposing = false
    // The control outlives the mount (the hosting controller is the expensive part
    // the pool keeps), so its text goes with the model's.
    syncText()
    host.prepareForRecycle()
    publishState()
  }

  func onDropView() {
    model.onChange = nil
    model.onFocusChange = nil
    model.onSubmit = nil
    model.focusWhenReady = false
    host.drop()
  }

  // MARK: - From the control

  func focusMoved(_ focused: Bool) {
    nitroUiAssertMainThread()
    guard model.focused != focused else { return }
    model.focused = focused
    publishState()
    model.onFocusChange?(focused)
  }

  func submitted(_ text: String) {
    model.onSubmit?(text)
  }

  /// Snapshot what the harness reads. Main thread; the read is lock-guarded.
  func publishState() {
    nitroUiAssertMainThread()
    let control = model.control
    let snapshot = NitroUiTextFieldTestState(
      text: control?.nuiText ?? model.state.displayed.string,
      focused: control?.isFirstResponder ?? false,
      composing: control?.nuiComposing ?? false,
      nativeEvents: Double(model.state.nativeEvents),
      jsEvents: Double(model.state.jsEvents),
      lastWrite: model.lastWrite,
      editable: model.editable,
      multiline: control is NitroUiMultiLineField,
      secure: (control as? UITextField)?.isSecureTextEntry ?? false,
      keyboardType: model.keyboardType,
      returnKeyType: model.returnKeyType,
      autoCapitalize: model.autoCapitalize,
      autoCorrect: model.autoCorrect,
      maxLength: Double(model.maxLength ?? -1),
      placeholder: model.placeholder ?? "",
      accessibilityLabel: control?.accessibilityLabel ?? "")
    stateLock.lock()
    stateSnapshot = snapshot
    stateLock.unlock()
  }

  // MARK: - Methods

  /// Never touches the main thread: a cached size, like every other control's.
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  func focus() throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.model.editable else { return }
      guard let control = self.model.control, control.window != nil else {
        // Not built or not on screen yet: the control takes focus when it gets a
        // window (`didMoveToWindow`).
        self.model.focusWhenReady = true
        return
      }
      _ = control.becomeFirstResponder()
    }
  }

  func blur() throws {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.model.focusWhenReady = false
      if let control = self.model.control, control.isFirstResponder {
        _ = control.resignFirstResponder()
      }
    }
  }

  func nuiTestState() throws -> NitroUiTextFieldTestState {
    stateLock.lock()
    defer { stateLock.unlock() }
    return stateSnapshot
  }

  func nuiTestCancelMarkedText() throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, let control = self.model.control, control.isFirstResponder else { return }
      control.nuiSetMarkedText("\u{18}")
      self.publishState()
    }
  }

  func nuiTestPaste(text: String, at: Double) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, let field = self.model.control as? NitroUiSingleLineField, field.isFirstResponder
      else { return }
      UIPasteboard.general.string = text
      if let caret = field.position(from: field.beginningOfDocument, offset: Int(at)) {
        field.selectedTextRange = field.textRange(from: caret, to: caret)
      }
      field.paste(nil)
      self.publishState()
    }
  }

  func nuiTestSetMarkedText(text: String) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, let control = self.model.control, control.isFirstResponder else { return }
      control.nuiSetMarkedText(text)
      self.publishState()
    }
  }

  func nuiTestLifetimeReport() throws -> String {
    return host.lifetimeReport()
  }
}
