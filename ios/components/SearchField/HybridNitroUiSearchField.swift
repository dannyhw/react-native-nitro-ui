//
//  HybridNitroUiSearchField.swift
//  react-native-nitro-ui
//
//  The SearchField component (G17): UIKit's `UISearchTextField` - the field
//  `UISearchBar` itself vends - hosted through a `UIViewRepresentable` in the core
//  SwiftUI host, exactly like TextField's single-line control (DECISIONS D34/D38).
//
//  A `UISearchTextField` *is* a `UITextField`, so everything the controlled value
//  needs is already there: `markedTextRange` for the composition guard, the
//  delegate's `shouldChangeCharactersIn` for `maxLength`, `editingChanged` for the
//  report, and a clear button of UIKit's own. `NitroUiTextEditing.swift` holds the
//  bodies both controls run, and `TextFieldModel` is the same model, so the only
//  thing this file decides is what a *search* field looks like: one line, the Search
//  key, no auto-capitalisation, a clear button while editing, and the platform's own
//  localized "Search" as the placeholder nobody asked for.
//
//  It is its own Hybrid View rather than `variant="search"` on TextField because a
//  declared fallback is keyed by component (docs/architecture/sizing.md §5): as a
//  variant, every cold SearchField would lay out at TextField's line height for one
//  frame and then correct - a jump at the top of a search screen, the one place
//  users look first.
//
//  Why not `UISearchBar`: it is the *delegate* of its own text field and reports
//  through `UISearchBarDelegate`, so the delegate path above would be rewritten
//  rather than reused, and its extras are a bar's chrome (Cancel, scope buttons, bar
//  padding). Its `searchTextField` is this same class, so the field is identical.
//  Why not SwiftUI: it has no standalone search field - `searchable` is a modifier
//  that needs a navigation container.
//

import NitroModules
import SwiftUI
import UIKit

// MARK: - The control

/// The control: a `UISearchTextField`, configured as a search field and driven by the
/// same model as TextField.
final class NitroUiSearchTextField: UISearchTextField, UITextFieldDelegate, NitroUiTextControl {
  /// Strong: the model never holds the control strongly (`TextFieldModel.control` is
  /// weak), so there is no cycle, and a callback during teardown still has one.
  private let model: TextFieldModel
  /// Keeps our own writes from re-entering `editingChanged` as user edits.
  private var applying = false
  /// UIKit's own placeholder for this class, read once at init: a `null` placeholder
  /// means "yours", and a recycled field must not keep the previous row's prompt.
  /// Declared with a value because Swift's phase 1 wants every stored property set
  /// before `super.init`, and UIKit's own prompt only exists once the control does.
  private var defaultPlaceholder: String?

  init(model: TextFieldModel) {
    self.model = model
    self.defaultPlaceholder = nil
    super.init(frame: .zero)
    defaultPlaceholder = placeholder
    delegate = self
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
    fatalError("nitro-ui: NitroUiSearchTextField cannot be built from a nib")
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
    // See `NitroUiSingleLineField.nuiApply()` for why a change to a focused field has
    // to reload its input views: a `UITextInputTraits` setter does not reach a keyboard
    // that is already up.
    let traits = NitroUiTextTraits.Resolved(model)
    var traitsChanged = false
    if keyboardType != traits.keyboard { keyboardType = traits.keyboard; traitsChanged = true }
    if autocapitalizationType != traits.capitalization {
      autocapitalizationType = traits.capitalization
      traitsChanged = true
    }
    if autocorrectionType != traits.correction { autocorrectionType = traits.correction; traitsChanged = true }
    if spellCheckingType != traits.spelling { spellCheckingType = traits.spelling; traitsChanged = true }
    // Always the Search key, and never on an empty field: `enablesReturnKeyAutomatically`
    // is what makes "an empty query cannot submit" true on iOS, so that Android's
    // empty-text guard is a rule and not a coincidence of two platform defaults.
    let returnKey = NitroUiTextTraits.returnKey(model.returnKeyType)
    if returnKeyType != returnKey { returnKeyType = returnKey; traitsChanged = true }
    if !enablesReturnKeyAutomatically { enablesReturnKeyAutomatically = true; traitsChanged = true }
    if traitsChanged, isFirstResponder { reloadInputViews() }
    // The clear button, stated rather than inherited: it is the component's one
    // affordance, and a default that changes with the OS would change the component.
    if clearButtonMode != .whileEditing { clearButtonMode = .whileEditing }
    let shown = model.placeholder ?? defaultPlaceholder
    if placeholder != shown { placeholder = shown }
    if isEnabled != model.editable { isEnabled = model.editable }
    if accessibilityLabel != model.accessibilityLabel { accessibilityLabel = model.accessibilityLabel }
    // UIKit gives this trait to the field inside a `UISearchBar`; standing alone it does
    // not, and a screen reader should still be told what the control is.
    if !accessibilityTraits.contains(.searchField) {
      accessibilityTraits = accessibilityTraits.union(.searchField)
    }
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
  /// `isEnabled` alone is not enough (measured with TextField's synthesized tap).
  override var canBecomeFirstResponder: Bool {
    model.editable && super.canBecomeFirstResponder
  }

  /// Whether the keyboard's Search key would do anything: with
  /// `enablesReturnKeyAutomatically` on, UIKit disables the key on an empty field, so
  /// the key's own guard is "not empty". `nuiTestSubmit` runs this guard, which is what
  /// makes the rule assertable on iOS instead of invisible inside UIKit.
  var nuiAcceptsReturnKey: Bool {
    !(enablesReturnKeyAutomatically && nuiText.isEmpty)
  }

  /// The clear button's route, run by hand: UIKit asks the delegate, empties the field,
  /// and sends `editingChanged` - which is what makes a clear an edit like any other.
  /// `clearButton?.sendActions(for:)` is the other way to say it, and does not reach a
  /// button that is hidden because the field is not editing.
  func nuiRunClear() {
    guard nuiAllowsClear, !nuiText.isEmpty else { return }
    if !textFieldShouldClear(self) { return }
    nuiSetText("")
    sendActions(for: .editingChanged)
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

// MARK: - SwiftUI

/// One representable per shape - and there is one shape: a search field is always one
/// line. Building it is `makeUIView`; every later SwiftUI update only re-applies
/// configuration (`nuiApply`), never the text.
private struct SearchBox: UIViewRepresentable {
  @ObservedObject var model: TextFieldModel

  func makeUIView(context: Context) -> NitroUiSearchTextField {
    let field = NitroUiSearchTextField(model: model)
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    model.control = field
    model.owner?.publishState()
    return field
  }

  func updateUIView(_ uiView: NitroUiSearchTextField, context: Context) {
    uiView.nuiApply()
  }

  /// The box's width, and the field's own height: a search field's height does not
  /// depend on its text, its width or its placeholder (`fillWidth`), which is why its
  /// sizing key is a constant and its declared fallback can be one number per OS.
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiSearchTextField, context: Context) -> CGSize? {
    let height = ceil(uiView.intrinsicContentSize.height)
    return CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width, height: height)
  }

  static func dismantleUIView(_ uiView: NitroUiSearchTextField, coordinator: ()) {
    if uiView.isFirstResponder { _ = uiView.resignFirstResponder() }
  }
}

/// The SwiftUI half.
struct SearchFieldContent: NitroUIContent {
  @ObservedObject private var model: TextFieldModel

  init(model: TextFieldModel) {
    self.model = model
  }

  var body: some View {
    SearchBox(model: model)
  }
}

// MARK: - Hybrid View

/// The Hybrid View React renders as `NitroUiSearchField`.
final class HybridNitroUiSearchField: HybridNitroUiSearchFieldSpec, RecyclableView, NitroUiTextOwner {
  private let host: NitroSwiftUIHost<SearchFieldContent>

  /// This component's name in the sizing engine.
  private static let sizingComponentName = "NitroUiSearchField"

  /// The declared fallback: the height `UISearchTextField` measures at the body font
  /// (37 pt on iOS 27, measured on the iPhone Air simulator this repo runs its gates
  /// on), and the width a field gets under a parent that does not give it one (a row
  /// with no `flex`), where `fillWidth` draws the declared width.
  ///
  /// TextField's one line is 22 pt, so the two differ by design: a SearchField that
  /// reused TextField's declaration would be a SearchField that composed TextField's
  /// control, and `SearchField.harness.tsx` has an assertion against exactly that.
  private static let fallbackSize = (width: 200.0, height: 37.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process.
  /// ``NitroUiDeclaredFallbacks`` calls this at startup; `init` is the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The snapshot `nuiTestState()` answers from. Written on main, read on JS.
  private let stateLock = NSLock()
  private var stateSnapshot = NitroUiSearchFieldTestState(
    text: "", focused: false, composing: false, nativeEvents: 0, jsEvents: 0, lastWrite: "none",
    editable: true, maxLength: -1, placeholder: "", accessibilityLabel: "", returnKeyType: "search",
    expanded: false, canClear: false)

  override init() {
    host = NitroSwiftUIHost(model: TextFieldModel())
    super.init()
    // A field presents nothing of its own.
    host.needsContainment = false
    host.wantsContentSize = true
    // Height is the field's; width is the box.
    host.sizingPolicy = .fillWidth
    Self.declareFallback()
    model.owner = self
    applySearchPresets()
  }

  var view: NitroSwiftUIHost<SearchFieldContent> {
    return host
  }

  private var model: TextFieldModel {
    return host.model
  }

  /// The four traits a search field fixes, as the model's own values - so the shared
  /// trait resolver (`NitroUiTextTraits.Resolved`) is still the one thing that decides
  /// what the control is configured with, and no prop can move them (D38 item 2).
  private func applySearchPresets() {
    model.returnKeyType = "search"
    model.keyboardType = "default"
    model.autoCapitalize = "none"
    model.autoCorrect = true
    model.multiline = false
    model.secureTextEntry = false
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

  var maxLength: Variant_NullType_Double {
    get { model.maxLength.map { .second(Double($0)) } ?? .first(.null) }
    set {
      // Read only by the control's edit callbacks; nothing to render.
      model.maxLength = newValue.asType(Double.self).flatMap { $0.isFinite ? Int($0) : nil }
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
      // Nothing to apply, like TextField: RN already puts `testID` on the component
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
      // There is one configuration, so this only ever arms the reporting.
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
  // The host plumbing the shared text logic needs (`NitroUiTextEditing.swift`). A
  // search field never grows with its text, so neither hook is a remeasure.

  var nuiTextModel: TextFieldModel { model }

  func nuiMarkTextDirty(sizeMayChange: Bool) {
    host.markDirty()
  }

  func nuiInvalidateTextSize() {
    // Unreachable: `model.multiline` is fixed to `false` by `applySearchPresets()`.
  }

  /// The field gained or lost focus. `model.focused` is the guard against a second
  /// `onFocusChange` for one edge: UIKit can report `editingDidEnd` for a field that
  /// never began (a resign on a field that was not first responder), and a wrapper that
  /// saw two begins and one end counts a blur that never happened.
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

  // MARK: - Lifecycle

  func afterUpdate() {
    applyWrite()
    syncText()
    host.commit()
    publishState()
  }

  func prepareForRecycle() {
    // TextField's rule: a pooled field must not keep the keyboard, or report a blur to
    // its next owner. Every callback goes first, because resigning commits open marked
    // text as an edit and that edit belongs to nobody now.
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
    model.maxLength = nil
    model.editable = true
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.lastWrite = "none"
    model.focused = false
    model.focusWhenReady = false
    model.wasComposing = false
    // Back to a search field's own traits: the model is shared with TextField, and its
    // defaults are a text field's.
    applySearchPresets()
    // The control outlives the mount (the hosting controller is the expensive part the
    // pool keeps), so its text and its placeholder go with the model's - the
    // placeholder returns to UIKit's own, whatever the previous row asked for.
    syncText()
    (model.control as? NitroUiSearchTextField)?.nuiApply()
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

  /// Snapshot what the harness reads. Main thread; the read is lock-guarded.
  func publishState() {
    nitroUiAssertMainThread()
    let control = model.control as? NitroUiSearchTextField
    let snapshot = NitroUiSearchFieldTestState(
      text: control?.nuiText ?? model.state.displayed.string,
      focused: control?.isFirstResponder ?? false,
      composing: control?.nuiComposing ?? false,
      nativeEvents: Double(model.state.nativeEvents),
      jsEvents: Double(model.state.jsEvents),
      lastWrite: model.lastWrite,
      editable: model.editable,
      maxLength: Double(model.maxLength ?? -1),
      // What the control shows, so a recycle that forgot UIKit's own prompt is visible:
      // `nil` in the model means "the platform's", and that is what the control reports.
      placeholder: control?.placeholder ?? "",
      accessibilityLabel: control?.accessibilityLabel ?? "",
      returnKeyType: model.returnKeyType,
      // iOS has no expanded state; the field is always the collapsed field.
      expanded: false,
      canClear: (control?.nuiAllowsClear ?? false) && !(control?.nuiText.isEmpty ?? true))
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

  func nuiTestState() throws -> NitroUiSearchFieldTestState {
    stateLock.lock()
    defer { stateLock.unlock() }
    return stateSnapshot
  }

  func nuiTestClear() throws {
    DispatchQueue.main.async { [weak self] in
      guard let field = self?.model.control as? NitroUiSearchTextField else { return }
      field.nuiRunClear()
      self?.publishState()
    }
  }

  func nuiTestSubmit() throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, let field = self.model.control as? NitroUiSearchTextField else { return }
      // The key's own guard, so an empty field reports nothing here either.
      guard field.nuiAcceptsReturnKey else { return }
      field.nuiSubmitFromReturn()
      self.publishState()
    }
  }

  func nuiTestLifetimeReport() throws -> String {
    return host.lifetimeReport()
  }
}
