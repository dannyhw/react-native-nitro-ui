// The SearchField component: UIKit's `UISearchTextField` hosted through a `UIViewRepresentable`. It
// shares TextField's model and editing logic, and is a separate Hybrid View because a declared
// sizing fallback is keyed by component.

import NitroModules
import SwiftUI
import UIKit

// MARK: - The control

final class NitroUiSearchTextField: UISearchTextField, UITextFieldDelegate, NitroUiTextControl {
  /// Strong: `TextFieldModel.control` is weak, so there is no cycle.
  private let model: TextFieldModel
  /// Keeps our own writes from re-entering `editingChanged` as user edits.
  private var applying = false
  /// UIKit's own placeholder for this class, read once at init: a `null` placeholder prop restores
  /// it, so a recycled field does not keep the previous row's prompt.
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

  /// UIKit's own end of a composition, and the insertion point it settles after reporting the edit
  /// (see `NitroUiSingleLineField`).
  override func unmarkText() {
    super.unmarkText()
    nuiSettleCaret()
  }

  func nuiApply() {
    // A `UITextInputTraits` setter does not reach a keyboard that is already up, so a change on a
    // focused field reloads its input views.
    let traits = NitroUiTextTraits.Resolved(model)
    var traitsChanged = false
    if keyboardType != traits.keyboard { keyboardType = traits.keyboard; traitsChanged = true }
    if autocapitalizationType != traits.capitalization {
      autocapitalizationType = traits.capitalization
      traitsChanged = true
    }
    if autocorrectionType != traits.correction { autocorrectionType = traits.correction; traitsChanged = true }
    if spellCheckingType != traits.spelling { spellCheckingType = traits.spelling; traitsChanged = true }
    // `enablesReturnKeyAutomatically` disables the Search key on an empty field, so an empty query
    // cannot be submitted from the keyboard.
    let returnKey = NitroUiTextTraits.returnKey(model.returnKeyType)
    if returnKeyType != returnKey { returnKeyType = returnKey; traitsChanged = true }
    if !enablesReturnKeyAutomatically { enablesReturnKeyAutomatically = true; traitsChanged = true }
    if traitsChanged, isFirstResponder { reloadInputViews() }
    // Set explicitly, so the clear button does not depend on an OS default.
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

  /// `editable == false` takes no focus from any route: a tap, `focus()`, VoiceOver. `isEnabled`
  /// alone is not enough.
  override var canBecomeFirstResponder: Bool {
    model.editable && super.canBecomeFirstResponder
  }

  /// Runs the Return key's route by hand: `textFieldShouldReturn`, which both the keyboard's Search
  /// key and a hardware Return reach.
  func nuiRunReturnKey() {
    _ = textFieldShouldReturn(self)
  }

  /// Runs the clear button's route by hand: ask the delegate, empty the field, send
  /// `editingChanged`, so a clear is an edit like any other.
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
    // `enablesReturnKeyAutomatically` disables the key on an empty field, but a hardware Return
    // reaches this delegate anyway. An empty query never submits.
    guard !nuiText.isEmpty else { return false }
    nuiSubmitFromReturn()
    return false
  }

  func textFieldDidChangeSelection(_ textField: UITextField) {
    nuiSelectionChanged()
  }
}

// MARK: - SwiftUI

/// Built once in `makeUIView`; every later SwiftUI update only re-applies configuration
/// (`nuiApply`), never the text.
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

  /// The box's width and the field's own height, which does not depend on its text, width or
  /// placeholder.
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiSearchTextField, context: Context) -> CGSize? {
    let height = ceil(uiView.intrinsicContentSize.height)
    return CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width, height: height)
  }

  static func dismantleUIView(_ uiView: NitroUiSearchTextField, coordinator: ()) {
    if uiView.isFirstResponder { _ = uiView.resignFirstResponder() }
  }
}

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

final class HybridNitroUiSearchField: HybridNitroUiSearchFieldSpec, RecyclableView, NitroUiTextOwner {
  private let host: NitroSwiftUIHost<SearchFieldContent>

  private static let sizingComponentName = "NitroUiSearchField"

  /// The declared fallback: the height `UISearchTextField` measures at the body font (28 pt on iOS
  /// 27), and the width a field gets under a parent that does not give it one.
  private static let fallbackSize = (width: 200.0, height: 28.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process. Called at startup;
  /// `init` is the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The snapshot `nuiTestState()` answers from. Written on main, read on JS.
  private let stateLock = NSLock()
  private var stateSnapshot = NitroUiSearchFieldTestState(
    text: "", focused: false, composing: false, nativeEvents: 0, jsEvents: 0, lastWrite: "none",
    editable: true, maxLength: -1, placeholder: "", accessibilityLabel: "", returnKeyType: "search",
    keyboardType: "default", autoCapitalize: "none", autoCorrect: true,
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

  /// The traits a search field fixes (`returnKeyType`, `multiline`, `secureTextEntry`) or defaults,
  /// written into the model that is shared with TextField. Also what a recycled field comes back
  /// with.
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
      // Nothing to apply: RN already puts `testID` on the component view as
      // `accessibilityIdentifier`, and a second copy on the control would make a testID query match
      // twice.
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
  // A search field never grows with its text, so neither hook remeasures.

  var nuiTextModel: TextFieldModel { model }

  func nuiMarkTextDirty(sizeMayChange: Bool) {
    host.markDirty()
  }

  func nuiInvalidateTextSize() {
    // Unreachable: `model.multiline` is fixed to `false` by `applySearchPresets()`.
  }

  /// The field gained or lost focus. The `model.focused` guard stops a second `onFocusChange` for
  /// one edge: UIKit can report `editingDidEnd` for a field that never began editing.
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
    // A pooled field must not keep the keyboard or report a blur to its next owner. Callbacks go
    // first, because resigning commits open marked text as an edit.
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
    model.owedCaret = nil
    // Back to a search field's own traits: the model is shared with TextField, and its
    // defaults are a text field's.
    applySearchPresets()
    // Test read-out of the keyboard the reset left, taken here because the next owner's props
    // overwrite it.
    resetKeyboard = "\(model.keyboardType)/\(model.autoCapitalize)/\(model.autoCorrect)"
    // The control outlives the mount, so its text and placeholder are reset with the model's.
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
      // Read from the control, so a recycle that kept the previous placeholder is visible.
      placeholder: control?.placeholder ?? "",
      accessibilityLabel: control?.accessibilityLabel ?? "",
      returnKeyType: model.returnKeyType,
      // Read back from the control, not the model, so this is what UIKit was told. Before the
      // control exists, the model's value is what will be applied.
      keyboardType: control.map { NitroUiTextTraits.name(of: $0.keyboardType) }
        ?? model.keyboardType,
      autoCapitalize: control.map { NitroUiTextTraits.name(of: $0.autocapitalizationType) }
        ?? model.autoCapitalize,
      autoCorrect: NitroUiTextTraits.autoCorrect(
        control?.autocorrectionType ?? (model.autoCorrect ? .default : .no)
      ),
      // iOS has no expanded state; the field is always the collapsed field.
      expanded: false,
      canClear: (control?.nuiAllowsClear ?? false) && !(control?.nuiText.isEmpty ?? true))
    stateLock.lock()
    stateSnapshot = snapshot
    stateLock.unlock()
  }

  // MARK: - Methods

  /// A cached size: this can be called from the JS thread and must not touch SwiftUI.
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
      // The delegate method itself, guard included, so an empty field submits nothing.
      field.nuiRunReturnKey()
      self.publishState()
    }
  }

  /// The keyboard `prepareForRecycle` last reset to, for `nuiTestLifetimeReport`.
  private var resetKeyboard = "never"

  func nuiTestLifetimeReport() throws -> String {
    return "\(host.lifetimeReport()) resetKeyboard=\(resetKeyboard)"
  }
}
