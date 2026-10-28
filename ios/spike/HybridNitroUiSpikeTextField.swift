//
//  HybridNitroUiSpikeTextField.swift
//  react-native-nitro-ui
//
//  T18 spike (`docs/tasks/T18-textfield-spike.md`): a text field on the real
//  hosting path, to answer Q2 §7's P1 / P3 / P4 lines on a device. Not a
//  component — nothing here is exported, has no `component.json`, and reaches no docs page. What
//  `package.json` does *not* do is exclude `ios/spike`: there is no `!**/spike/**` entry in its
//  `files`, so on this evidence branch the spike's native sources ride along in the packed
//  tarball (`etc/package-files.txt` lists them, and `manifest:check` holds that list). Merging
//  this branch would ship them, which T18's report states rather than quietly fixing — the
//  exclusion is a decision for whoever merges, not something to decide inside a spike.
//
//  ## Why it lives in the library
//
//  The questions are about *this* runtime: a `NitroSwiftUIHost` created once and
//  never re-rooted, the event-count handshake, the sizing engine's cache, and a
//  touch or a keystroke delivered by the operating system through RN's own event
//  path. A prototype in a scratch app would answer questions about a path nobody
//  ships.
//
//  ## The P1 A/B, and the coexistence question inside it
//
//  Q2 §3's deciding question is not only whether SwiftUI `TextField` or a hosted
//  `UITextField` is better, but whether the two hosting shapes can live in one
//  library. They do here: one Hybrid View, one `NitroSwiftUIHost`, one
//  `NitroUIContent` whose body picks one of two subtrees. See
//  `SpikeTextFieldContent` for the one rule that makes that legal — the branch
//  is frozen on the first commit, because a body that flipped mid-mount would
//  destroy the field a person is typing into.
//
//  ## Threading
//
//  Props arrive on the main thread. `nuiTestState()` is answered on the **JS**
//  thread from a lock-guarded `String` snapshot that main writes
//  (`NitroSpikeTextMirror`), and `focus()` / `blur()` / `nuiTestApplyWrite(_:)`
//  hop to main asynchronously and never wait (`core.md` §5).
//

import NitroModules
import SwiftUI
import UIKit

// MARK: - Shapes

/// The shapes `iosImplementation` accepts, plus Android's, so the string that
/// reaches `nuiTestState()`'s `impl=` has exactly three spellings repo-wide.
enum SpikeTextFieldShapes {
  static let swiftui = "swiftui"
  static let textfield = "textfield"
  static let compose = "compose"
}

// MARK: - Model

/// State of one spike field. See `NitroUiModel` for why this is not `@Published`.
final class SpikeTextFieldModel: NitroUiModel {
  /// Controlled text, on the shipped handshake.
  ///
  /// The one deliberate thing to notice: `unreported` is **never set**. It exists
  /// for values sampled faster than frames (a drag); a field's edits are
  /// discrete, and setting it per keystroke would make a fast typist's writes
  /// permanently stale (Q2 §2.4). P3 asserts that this holds.
  var state = NitroUiControlledValue<String>(displayed: "")
  var defaultValue: String?
  var didApplyDefault = false
  var placeholder: String?
  var disabled = false
  var maxLength: Int?
  var multiline = false
  var maxLines: Int?
  var keyboardHints: Double = 0
  var autoFocus = false
  var accessibilityLabel: String?

  /// The shape JS asked for, and the one the first commit built.
  var requestedImplementation: String = ""
  var frozenImplementation: String?

  var sizingKey = ""

  /// A composition is open. Only the `UITextField` arm can observe this
  /// (`markedTextRange`); the SwiftUI arm has no API for it and reports `0`.
  var composing = false
  var focused = false
  /// Caret offset/length in UTF-16 code units, or `-1` when the live shape
  /// cannot observe them.
  var selectionStart = -1
  var selectionLength = -1
  /// Lines the control measured itself at, or `-1` when it reports no line count.
  var lines = -1
  /// Outcome of the last `nuiTestApplyWrite`, for `nuiTestState()`.
  var lastWrite = "none"
  ///
  /// The text the last emit handed JS. `nil` until the field emits anything.
  ///
  /// This is what `equal=` / `cps=` compare against when the field is uncontrolled — Android keeps the same
  /// field (`SpikeTextFieldModel.lastEmitted`). Without it an uncontrolled field compares its text against
  /// `nil` and answers `equal=0`, which looks like a broken handshake and is nothing of the sort.
  var emitted: String?
  /// A programmatic write waiting for the main-thread hop that applies it.
  var pendingWrite: String?

  /// The live `UITextField`, when this instance hosts one. Weak: the SwiftUI
  /// representable owns it, and it is gone once the subtree goes.
  weak var hostedField: SpikeHostedUITextField?

  /*
   * Installs the Hybrid View's own mirror renderer so the commit helpers can republish from anywhere.
   *
   * The helpers are a plain enum and cannot reach the host, and on the SwiftUI arm there is no other path that
   * would publish: `@FocusState` is the representable's own view state, so a tap that only moves focus changes
   * no text, invalidates no SwiftUI body, and leaves the cached line saying `focused=0` while JS got `onFocus`.
   * Android's model carries the same closure for the same reason (`SpikeTextFieldModel.renderMirror`), and
   * both arms' harness checks are what caught the omission on each platform independently.
   */
  var renderMirror: (() -> Void)?

  var onChange: ((_ value: String, _ eventCount: Double) -> Void)?
  var onFocus: (() -> Void)?
  var onBlur: (() -> Void)?
  var onSubmit: (() -> Void)?

  private var mirrorLock = NSLock()
  private var mirrorSnapshot: String = ""

  /// Render `mirror` and store its line. Main thread, after anything it reads.
  func publishMirror(_ mirror: NitroSpikeTextMirror) {
    var updated = mirror
    updated.refresh()
    mirrorLock.lock()
    mirrorSnapshot = updated.rendered
    mirrorLock.unlock()
  }

  /// The last published line. Safe from any thread, including JS.
  func readMirror() -> String {
    mirrorLock.lock()
    defer { mirrorLock.unlock() }
    return mirrorSnapshot
  }
}

// MARK: - Content (the P1 A/B)

/// One hosted subtree per instance, chosen by `iosImplementation`.
///
/// The frozen branch is the load-bearing part. SwiftUI gives each branch a
/// different structural identity, so a body that changed branch on a later
/// commit would tear down the field the person is typing into and build another
/// one — losing first responder, any open composition, and the caret. That is
/// the perf contract's "never recreate the hosted view" rule in this shape, and
/// a shipped field would have the same rule: the shape is chosen at mount.
///
/// `nuiTestState()`'s `impl=` reports the shape that *won*, which is how the
/// harness proves a runtime change to `iosImplementation` did not quietly
/// rebuild the control underneath JS.
struct SpikeTextFieldContent: NitroUIContent {
  @ObservedObject private var model: SpikeTextFieldModel

  init(model: SpikeTextFieldModel) {
    self.model = model
  }

  var body: some View {
    Group {
      if model.frozenImplementation == SpikeTextFieldShapes.textfield {
        SpikeUITextFieldBox(model: model)
      } else {
        SpikeSwiftUITextField(model: model)
      }
    }
    .modifier(SpikeOptionalAccessibility(label: model.accessibilityLabel))
  }
}

/// An empty `accessibilityLabel(_:)` would silence the field's own label, so it
/// is applied only when set (Switch's `OptionalAccessibility`, same reason).
private struct SpikeOptionalAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

// MARK: - Arm A: SwiftUI TextField

/// Arm A: SwiftUI `TextField` / `SecureField`, with `@FocusState` for focus.
///
/// Q2 §3 predicted that every keyboard behaviour has to be an argument or a
/// modifier *at the point the field is built*, and that is what the bitfield prop
/// is for: `SpikeKeyboardModifiers` reads it once, here.
///
/// What this arm cannot do is tell anybody anything about the edit session:
/// SwiftUI has no API for "what marked text does this field hold", so
/// `composing`, `selection` and `lines` stay unobserved (`0` / `-1`). That is
/// P1's cost column, not a gap in this file — the composition-safe write guard
/// Q2 §2.2 asks for is *impossible* on this arm, and the spike says so with a
/// measurement instead of an argument.
struct SpikeSwiftUITextField: View {
  @ObservedObject private var model: SpikeTextFieldModel
  @FocusState private var focused: Bool

  init(model: SpikeTextFieldModel) {
    self.model = model
  }

  private var hints: SpikeKeyboardHints {
    SpikeKeyboardHints(model.keyboardHints)
  }

  /// The setter is the only channel SwiftUI gives for "the user changed the
  /// text", and it carries committed text — which is exactly what the handshake
  /// counts as a change (`state.user` + one emit).
  private var textBinding: Binding<String> {
    Binding(
      get: { model.state.displayed },
      set: { requested in
        SpikeTextFieldCommit.user(model, SpikeTextFieldCommit.clamp(requested, model))
      }
    )
  }

  var body: some View {
    Group {
      if hints.secure {
        SecureField(model.placeholder ?? "", text: textBinding)
      } else if model.multiline, #available(iOS 16.0, *) {
        // `axis: .vertical` is the auto-grow switch and `lineLimit` its cap
        // (`@expo/ui/ios/TextFieldView.swift:151-157`). Below 16 this shape has
        // no multiline field at all, so the request falls back to a single-line
        // one — and P1's table reports "SwiftUI multiline needs iOS 16" rather
        // than pretending the arm has an auto-grow to measure.
        TextField(model.placeholder ?? "", text: textBinding, axis: .vertical)
          .lineLimit(SpikeTextFieldCommit.lineLimit(model))
      } else {
        TextField(model.placeholder ?? "", text: textBinding)
      }
    }
    .modifier(SpikeKeyboardModifiers(hints: hints))
    .disabled(model.disabled)
    .focused($focused)
    .onChange(of: focused) { isNowFocused in
      SpikeTextFieldCommit.focus(model, isNowFocused)
    }
    .onSubmit {
      SpikeTextFieldCommit.submit(model)
    }
    .onAppear {
      // Nitro-input measured 580 ms of keyboard churn from a *deferred* autofocus
      // (Q2 §5), so this fires from `onAppear` with no hop. SwiftUI still
      // resolves `@FocusState` through its own update pass, which is the arm's
      // floor: it cannot promise the synchronous `becomeFirstResponder` arm B has.
      if model.autoFocus && !model.disabled {
        // `$focused` is the projected `FocusState.Binding`; setting its `wrappedValue` is SwiftUI's
        // imperative form. (`focused.wrappedValue` is a typo the compiler catches: the *property wrapper's*
        // `wrappedValue` is not addressable through the projected name.)
        $focused.wrappedValue = true
      }
    }
  }
}

/// Keyboard/IME modifiers for arm A.
///
/// Three separate `ViewModifier`s rather than a chain of conditional `.foo()`
/// calls: each `.foo()` returns a different opaque type, so a chain that is
/// conditional per bit does not type-check, and the alternative (one
/// `if`/`else` per bit nested in a builder) buries the mapping this file exists
/// to show. Each modifier applies its thing only when its bit is set, so an
/// unmodified field carries the platform default for every one of them.
///
/// All of these are iOS 15 APIs and the library's deployment target is 15.1
/// (`node_modules/react-native/scripts/cocoapods/helpers.rb:83`), so none of
/// them needs a gate — which was one of Q2 §3's open questions ("verify all six
/// compile on iOS 15.1") and the answer is yes.
private struct SpikeKeyboardModifiers: ViewModifier {
  let hints: SpikeKeyboardHints

  func body(content: Content) -> some View {
    content
      .keyboardType(hints.uiKeyboardType)
      .modifier(SpikeCapModifier(capitalization: hints.autocapitalization))
      .modifier(SpikeCorrectModifier(disabled: hints.noCorrect))
      .modifier(SpikeSubmitLabelModifier(label: hints.submitLabel))
  }
}

private struct SpikeCapModifier: ViewModifier {
  /// `nil` means "say nothing", i.e. keep the platform default, so arm A can
  /// skip the modifier entirely — the reason Switch skips `.tint()` when untinted.
  let capitalization: UITextAutocapitalizationType?

  func body(content: Content) -> some View {
    // The SwiftUI spelling is mapped with implicit members rather than by naming the type: the Swift name of
    // `UITextInputTextCapitalization`'s SwiftUI twin is not importable in this SDK (`cannot find type
    // 'AutocapitalizationType' in scope`), so a helper that returns it does not compile. The mapping is the
    // same three cases, spelled at the call site.
    if let capitalization {
      switch capitalization {
      case .allCharacters:
        content.textInputAutocapitalization(.characters)
      case .words:
        content.textInputAutocapitalization(.words)
      default:
        content.textInputAutocapitalization(.sentences)
      }
    } else {
      content
    }
  }
}

private struct SpikeCorrectModifier: ViewModifier {
  let disabled: Bool

  func body(content: Content) -> some View {
    if disabled {
      content.autocorrectionDisabled(true)
    } else {
      content
    }
  }
}

private struct SpikeSubmitLabelModifier: ViewModifier {
  let label: SubmitLabel?

  func body(content: Content) -> some View {
    if let label {
      content.submitLabel(label)
    } else {
      content
    }
  }
}

// MARK: - Arm B: hosted UITextField

/// Arm B: a `UITextField` in a `UIViewRepresentable`, in the same SwiftUI body
/// and the same host as arm A.
///
/// What this shape buys over arm A, all of it measurable: `markedTextRange` (so
/// a controlled write can be refused mid-composition), `selectedTextRange` (the
/// `selection` in/out RN has), the full keyboard-type set, and a first responder
/// a UIKit-level tool can drive directly.
///
/// `makeUIView` runs once per mount and `updateUIView` only ever *applies* —
/// never rebuilds — which is the perf contract's rule translated into this shape.
struct SpikeUITextFieldBox: UIViewRepresentable {
  @ObservedObject var model: SpikeTextFieldModel

  func makeUIView(context: Context) -> SpikeHostedUITextField {
    let field = SpikeHostedUITextField(model: model)
    model.hostedField = field
    return field
  }

  func updateUIView(_ uiView: SpikeHostedUITextField, context: Context) {
    uiView.applyModel()
  }
}

/// The `UITextField` itself: its configuration, its delegate, and the mirror
/// writes only this shape can make.
final class SpikeHostedUITextField: UITextField, UITextFieldDelegate {
  private let model: SpikeTextFieldModel
  /// Keeps our own write from re-entering `editingChanged` and emitting an event
  /// for text the model already had.
  private var applying = false

  init(model: SpikeTextFieldModel) {
    self.model = model
    super.init(frame: .zero)
    delegate = self
    borderStyle = .none
    translatesAutoresizingMaskIntoConstraints = false
    addTarget(self, action: #selector(editingChanged), for: .editingChanged)
    addTarget(self, action: #selector(didBegin), for: .editingDidBegin)
    addTarget(self, action: #selector(didEnd), for: .editingDidEnd)
    applyModel()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: the spike field cannot be built from a nib")
  }

  /// Apply the model. From `makeUIView`, from every commit, and from a write.
  func applyModel() {
    nitroUiAssertMainThread()
    let hints = SpikeKeyboardHints(model.keyboardHints)
    keyboardType = hints.secure ? .default : hints.uiKeyboardType
    returnKeyType = hints.uiReturnKey
    isSecureTextEntry = hints.secure
    if let capitalization = hints.autocapitalization {
      autocapitalizationType = capitalization
    }
    autocorrectionType = hints.noCorrect ? .no : .default
    isEnabled = !model.disabled
    isUserInteractionEnabled = !model.disabled
    placeholder = model.placeholder
    // `UITextField` has no multiline mode — which is why RN core reaches for a
    // `UITextView` when `multiline` is set. The spike keeps the text field on
    // purpose: one of this arm's measured costs is that it has no auto-grow.
    applyText(model.state.displayed, write: false)
    publishMirror()
  }

  /// Write text into the control, refusing while a composition is open.
  ///
  /// Q2 §2.2 in six lines: replacing text under an open `markedTextRange`
  /// destroys the IME session, so a write during composition is *dropped*.
  /// `lastWrite` is what makes the drop observable from JS rather than inferred
  /// from the absence of a change — the difference between a guard and a hope.
  func applyText(_ text: String, write: Bool) {
    nitroUiAssertMainThread()
    if markedTextRange != nil {
      if write { model.lastWrite = "composing" }
      return
    }
    if text == currentValue {
      if write { model.lastWrite = "same" }
      return
    }
    applying = true
    currentValue = text
    applying = false
    if write { model.lastWrite = "applied" }
  }

  /// The control's text.
  private var currentValue: String {
    get { text ?? "" }
    set { text = newValue }
  }

  // MARK: Editing

  @objc private func editingChanged() {
    guard !applying else { return }
    let requested = SpikeTextFieldCommit.clamp(currentValue, model)
    // `maxLength`, enforced natively and *not* while composing: truncating
    // inside a composed character is the bug RN avoids at
    // `RCTTextInputComponentView.mm:469-485`.
    if requested != currentValue {
      applying = true
      currentValue = requested
      applying = false
    }
    SpikeTextFieldCommit.user(model, requested)
    publishMirror()
  }

  @objc private func didBegin() {
    SpikeTextFieldCommit.focus(model, true)
    publishMirror()
  }

  @objc private func didEnd() {
    SpikeTextFieldCommit.focus(model, false)
    publishMirror()
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    if SpikeKeyboardHints(model.keyboardHints).submits {
      SpikeTextFieldCommit.submit(model)
      return false
    }
    // Not a submitting field: Return belongs to the control (RN's rule too).
    return true
  }

  func textFieldDidChangeSelection(_ textField: UITextField) {
    publishMirror()
  }

  // MARK: Mirror

  /// The caret, read through the `UITextInput` protocol rather than `selectedRange`.
  ///
  /// Two reasons, both learned from the compiler: a `UITextField` subclass that is its own
  /// `UITextInputDelegate` cannot see `selectedRange` at all (`value of type '…' has no member
  /// 'selectedRange'`), and the protocol's offsets are measured in UTF-16 code units — which is the unit the
  /// mirror documents for `selection=` and the one Android's `TextFieldState.selection` uses too. So the
  /// protocol route is both the one that compiles and the one that agrees with the other platform.
  var caretRange: NSRange {
    guard let range = selectedTextRange,
          let start = try? offset(from: beginningOfDocument, to: range.start),
          let end = try? offset(from: beginningOfDocument, to: range.end)
    else {
      return NSRange(location: 0, length: 0)
    }
    return NSRange(location: start, length: max(0, end - start))
  }

  /// Snapshot what only this shape can see.
  func publishMirror() {
    nitroUiAssertMainThread()
    let isComposing = markedTextRange != nil
    model.composing = isComposing
    model.focused = isFirstResponder
    let caret = caretRange
    model.selectionStart = caret.location
    model.selectionLength = caret.length
    model.lines = -1
    var mirror = NitroSpikeTextMirror()
    SpikeTextFieldCommit.fill(model, &mirror)
    mirror.implementation = SpikeTextFieldShapes.textfield
    mirror.composing = isComposing
    mirror.focused = isFirstResponder
    mirror.editable = isUserInteractionEnabled && isEnabled && !model.disabled
    mirror.selectionStart = caret.location
    mirror.selectionLength = caret.length
    mirror.liveField = true
    model.publishMirror(mirror)
  }

  override func becomeFirstResponder() -> Bool {
    let result = super.becomeFirstResponder()
    publishMirror()
    return result
  }

  override func resignFirstResponder() -> Bool {
    let result = super.resignFirstResponder()
    publishMirror()
    return result
  }
}

// MARK: - Commit helpers (both arms)

/// The events a field emits and the guards it shares, spelled once so the two
/// arms cannot drift apart in the one place the handshake lives.
enum SpikeTextFieldCommit {
  /// The user changed the text: native owns it, counts it, emits it.
  static func user(_ model: SpikeTextFieldModel, _ requested: String) {
    let eventCount = model.state.user(requested)
    model.emitted = requested
    model.objectWillChange.send()
    model.onChange?(requested, Double(eventCount))
  }

  /// Focus moved, on both edges. P5 measures focus latency from the event, so an
  /// edge that quietly went missing would read as "fast".
  ///
  /// And it republishes the mirror, because on the SwiftUI arm nothing else does: `@FocusState` lives in the
  /// representable's own view state, so a tap that only moves focus changes no text, invalidates no SwiftUI
  /// body, and leaves the cached line saying `focused=0` — measured on the iOS coexist check, where the tap
  /// fired `onFocus` (JS saw `focus=1`) while `nuiTestState()` still answered `focused=0`. Android needed the
  /// same rule for the same reason (`SpikeTextFieldModel.focused`, `focusMoved`).
  static func focus(_ model: SpikeTextFieldModel, _ isFocused: Bool) {
    guard model.focused != isFocused else { return }
    model.focused = isFocused
    model.renderMirror?()
    if isFocused {
      model.onFocus?()
    } else {
      model.onBlur?()
    }
  }

  static func submit(_ model: SpikeTextFieldModel) {
    model.onSubmit?()
  }

  /// `maxLength`, applied before the event is emitted so JS is never told a
  /// string the control is not showing.
  ///
  /// Skipped while a composition is open (`SpikeHostedUITextField` is the only
  /// arm that can answer the question, and it re-checks). Grapheme-safe: see
  /// `SpikeTextLimits`.
  static func clamp(_ text: String, _ model: SpikeTextFieldModel) -> String {
    guard let limit = model.maxLength else { return text }
    return SpikeTextLimits.truncate(text, to: limit)
  }

  static func lineLimit(_ model: SpikeTextFieldModel) -> Int? {
    guard let maxLines = model.maxLines, maxLines > 0 else { return nil }
    return maxLines
  }

  /// Copy the handshake's own fields into a mirror. Both arms and Android fill
  /// the same keys, so a cross-shape comparison is a string comparison.
  static func fill(_ model: SpikeTextFieldModel, _ mirror: inout NitroSpikeTextMirror) {
    mirror.displayed = model.state.displayed
    mirror.nativeEvents = model.state.nativeEvents
    mirror.jsEvents = model.state.jsEvents
    // Q2 §2.4: this must stay `0` for the whole life of a field.
    mirror.unreported = model.state.unreported != nil
    mirror.lastWrite = model.lastWrite
    mirror.lines = model.lines
    mirror.frozenImplementation = model.frozenImplementation ?? "none"
    // Same rule as Android's `mirrorLine` (`HybridNitroUiSpikeTextField.kt`): controlled compares against
    // React's `value`, uncontrolled against the last string the field handed JS.
    let js = model.state.js ?? model.emitted ?? ""
    mirror.equal = model.state.displayed == js
    mirror.jsCodePoints = nitroSpikeCodePoints(js)
  }
}

// MARK: - Keyboard hints

/// The decoded `keyboardHints` bitfield.
///
/// Mirrored in Kotlin (`NitroSpikeHints`, in `NitroSpikeTextFieldCompose.kt`) so the two platforms'
/// mapping tables can be read against each other;
/// `src/spike/TextField/keyboard.ts` owns the numbers, and
/// `src/spike/TextField/__tests__/keyboard.test.ts` pins them.
struct SpikeKeyboardHints {
  private let bits: Int

  init(_ raw: Double) {
    bits = Int(raw)
  }

  private func bit(_ mask: Int) -> Bool {
    (bits & mask) != 0
  }

  private static let typeNumber = 1 << 1
  private static let typePhone = 1 << 2
  private static let typeEmail = 1 << 3
  private static let typeUrl = 1 << 4
  private static let returnDone = 1 << 8
  private static let returnNext = 1 << 9
  private static let submits = 1 << 10
  private static let capWords = 1 << 12
  private static let capSentences = 1 << 13
  private static let capCharacters = 1 << 14
  private static let noCorrect = 1 << 16
  private static let secure = 1 << 17

  var uiKeyboardType: UIKeyboardType {
    if bit(Self.typeNumber) { return .numberPad }
    if bit(Self.typePhone) { return .phonePad }
    if bit(Self.typeEmail) { return .emailAddress }
    if bit(Self.typeUrl) { return .URL }
    return .default
  }

  var uiReturnKey: UIReturnKeyType {
    if bit(Self.returnDone) { return .done }
    if bit(Self.returnNext) { return .next }
    return .default
  }

  var secure: Bool { bit(Self.secure) }
  var submits: Bool { bit(Self.submits) }
  var noCorrect: Bool { bit(Self.noCorrect) }

  /// `nil` means "say nothing", i.e. the platform default, so arm A can skip the
  /// modifier entirely — the same reason Switch skips `.tint()` when untinted.
  var autocapitalization: UITextAutocapitalizationType? {
    if bit(Self.capCharacters) { return .allCharacters }
    if bit(Self.capWords) { return .words }
    if bit(Self.capSentences) { return .sentences }
    return nil
  }

  var submitLabel: SubmitLabel? {
    if bit(Self.returnDone) { return .done }
    if bit(Self.returnNext) { return .next }
    if bit(Self.submits) { return .go }
    return nil
  }

}

// MARK: - Text limits

/// `maxLength`, enforced the way RN enforces it.
enum SpikeTextLimits {
  /// Truncate to `limit` *characters*, cutting on grapheme-cluster boundaries.
  ///
  /// Swift's `count` is already graphemes, which is the point: slicing a UTF-16
  /// prefix off an emoji family leaves a lone surrogate behind, and RN hits that
  /// exact case at `RCTTextInputComponentView.mm:469-485`. Android's twin cuts on
  /// code points (`String.offsetByCodePoints`), because a UTF-16 cut is the bug.
  static func truncate(_ text: String, to limit: Int) -> String {
    guard limit > 0 else { return "" }
    if text.count <= limit { return text }
    return String(text.prefix(limit))
  }
}

// MARK: - Hybrid View

/// The Hybrid View React renders as `NitroUiSpikeTextField`.
final class HybridNitroUiSpikeTextField: HybridNitroUiSpikeTextFieldSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SpikeTextFieldContent>

  /// This component's name in the sizing engine.
  private static let sizingComponentName = "NitroUiSpikeTextField"

  /// A fallback deliberately unlike anything the field measures.
  ///
  /// X4's rule (and AGENTS.md's "test fixtures must not coincide with the right
  /// answer"): a fallback equal to the measured size makes a failed correction
  /// invisible. 44 pt is a height a one-line field never reports on iOS and a
  /// two-line field reports only by coincidence, so "the box stayed 44 tall" is
  /// itself the reading that says a correction did not happen.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(
      sizingComponentName,
      40.0,
      44.0,
      NitroUiSizingPolicy.fillWidth.rawValue
    )
    return true
  }()

  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: SpikeTextFieldModel())
    super.init()
    // A field presents no window of its own, so no containment (Switch's call,
    // for Switch's reason).
    host.needsContainment = false
    // P4 is a sizing spike: a field's height is its own, its width is Yoga's box,
    // and the key carries that width (Q2 §6, `docs/architecture/sizing.md`).
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    Self.declareFallback()
    // The commit helpers republish through this; see `SpikeTextFieldModel.renderMirror`. Weak, because the
    // model is owned by the host which is owned by this instance — a strong closure here would be a cycle.
    model.renderMirror = { [weak self] in
      self?.publishMirror()
    }
  }

  var view: NitroSwiftUIHost<SpikeTextFieldContent> {
    return host
  }

  private var model: SpikeTextFieldModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var iosImplementation: String {
    get { model.requestedImplementation }
    set {
      let next = newValue == SpikeTextFieldShapes.textfield
        ? SpikeTextFieldShapes.textfield
        : SpikeTextFieldShapes.swiftui
      guard next != model.requestedImplementation else { return }
      model.requestedImplementation = next
      freezeImplementation()
    }
  }

  /// The first non-empty shape wins, and nothing after it can change the subtree.
  private func freezeImplementation() {
    guard model.frozenImplementation == nil, !model.requestedImplementation.isEmpty else {
      return
    }
    model.frozenImplementation = model.requestedImplementation
    host.markDirty()
  }

  var value: Variant_NullType_String {
    get {
      guard let js = model.state.js else { return .first(.null) }
      return .second(js)
    }
    set { model.state.js = newValue.asType(String.self) }
  }

  var defaultValue: Variant_NullType_String {
    get {
      guard let value = model.defaultValue else { return .first(.null) }
      return .second(value)
    }
    set {
      model.defaultValue = newValue.asType(String.self)
      guard model.state.js == nil, !model.didApplyDefault, let `default` = model.defaultValue else {
        return
      }
      model.didApplyDefault = true
      guard `default` != model.state.displayed else { return }
      model.state.displayed = `default`
      /*
       * The default is the text JS built the field with, so it is what `equal=` / `cps=` compare an
       * uncontrolled field against — Android seeds `lastEmitted` here too (`defaultValue` setter) and iOS did
       * not, which is why the same uncontrolled field answered `equal=0` on iOS and `equal=1` on Android on the
       * first iOS run. Same finding as the write path above, one property earlier: the mirror's `equal=` is a
       * cross-platform invariant only if both platforms seed the JS side the same way.
       */
      model.emitted = `default`
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

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      host.markDirty()
    }
  }

  var maxLength: Variant_NullType_Double {
    get { model.maxLength.map { .second(Double($0)) } ?? .first(.null) }
    set {
      let next = newValue.asType(Double.self).map { Int($0) }
      guard next != model.maxLength else { return }
      model.maxLength = next
    }
  }

  var multiline: Bool {
    get { model.multiline }
    set {
      guard newValue != model.multiline else { return }
      model.multiline = newValue
      host.markDirty()
      // A field that can now be N lines tall has no cached height for this
      // configuration, so both halves of the sizing nudge — the same pair Picker
      // and Button use (`sizing.md`, review F1).
      host.noteContentSizeMayHaveChanged()
      host.noteSizingKeyChanged()
    }
  }

  var maxLines: Variant_NullType_Double {
    get { model.maxLines.map { .second(Double($0)) } ?? .first(.null) }
    set {
      let next = newValue.asType(Double.self).map { Int($0) }
      guard next != model.maxLines else { return }
      model.maxLines = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
      host.noteSizingKeyChanged()
    }
  }

  var keyboardHints: Double {
    get { model.keyboardHints }
    set {
      guard newValue != model.keyboardHints else { return }
      model.keyboardHints = newValue
      host.markDirty()
      host.noteSizingKeyChanged()
    }
  }

  var autoFocus: Bool {
    get { model.autoFocus }
    set { model.autoFocus = newValue }
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

  var testID: Variant_NullType_String {
    get { .first(.null) }
    set {
      // Nothing to apply, like Switch: RN already writes `testID` onto the
      // component view as `accessibilityIdentifier`, and writing it onto the
      // hosted control too would make a testID query match twice.
      _ = newValue.asType(String.self)
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

  var onFocus: (() -> Void)? {
    get { model.onFocus }
    set { model.onFocus = newValue }
  }

  var onBlur: (() -> Void)? {
    get { model.onBlur }
    set { model.onBlur = newValue }
  }

  var onSubmitEditing: (() -> Void)? {
    get { model.onSubmit }
    set { model.onSubmit = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    freezeImplementation()
    // The handshake decides whether React's `value` wins over what the user just
    // typed — including a change JS rejected (§4). For a field this is the path
    // a *rejected* edit takes; a programmatic write takes `nuiTestApplyWrite`.
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
    publishMirror()
  }

  func prepareForRecycle() {
    model.state = NitroUiControlledValue<String>(displayed: "")
    model.defaultValue = nil
    model.didApplyDefault = false
    model.placeholder = nil
    model.disabled = false
    model.maxLength = nil
    model.multiline = false
    model.maxLines = nil
    model.keyboardHints = 0
    model.autoFocus = false
    model.accessibilityLabel = nil
    model.sizingKey = ""
    /*
     * The branch resets too, or a recycled view serves the previous mount's shape forever.
     *
     * This is what the first iOS run of P5 and X4 caught: both ask for the `UITextField` arm, both got a view
     * previously mounted as the SwiftUI arm, and both timed out waiting for `focus()` to do anything — because
     * `frozenImplementation` still said `swiftui`, whose `focus()` is a no-op by design, and no `UITextField`
     * was ever built for the new mount. The mirror said `impl=swiftui frozen=swiftui live=0` while JS had sent
     * `iosImplementation=textfield`, which is the shape of the bug: the prop arrived, the control did not
     * change. A shipped field has the same rule and the same trap — the shape is chosen at mount, and a
     * recycled view is a new mount.
     */
    model.requestedImplementation = ""
    model.frozenImplementation = nil
    model.hostedField = nil
    model.composing = false
    model.focused = false
    model.selectionStart = -1
    model.selectionLength = -1
    model.lines = -1
    model.lastWrite = "none"
    model.emitted = nil
    model.pendingWrite = nil
    model.onChange = nil
    model.onFocus = nil
    model.onBlur = nil
    model.onSubmit = nil
    host.prepareForRecycle()
    publishMirror()
  }

  func onDropView() {
    model.onChange = nil
    model.onFocus = nil
    model.onBlur = nil
    model.onSubmit = nil
    host.drop()
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
      guard let self else { return }
      guard let field = self.model.hostedField else {
        // Arm A has nothing to call: `@FocusState` is private to the SwiftUI
        // subtree, so an imperative `focus()` on that arm is a no-op. P1 reports
        // that, and the harness asserts `focused` did not move. A *frozen*
        // textfield arm with no field is a different thing — recorded below.
        if self.model.frozenImplementation == SpikeTextFieldShapes.textfield {
          self.model.lastWrite = "focus:no-field"
          self.publishMirror()
        }
        return
      }
      if !field.becomeFirstResponder() {
        /*
         * A refused first-responder ask is otherwise invisible: `focused` stays `0`, no `onFocus` fires, and
         * the JS caller cannot tell "the control said no" from "the ask never arrived". `lastWrite` carries it
         * because it is the mirror's outcome slot and because a *successful* ask leaves it alone, so the
         * handshake assertions around it keep their meaning.
         */
        let frame = field.frame
        self.model.lastWrite =
          "focus:refused window=\(field.window == nil ? 0 : 1) "
          + "frame=\(Int(frame.width))x\(Int(frame.height)) "
          + "hidden=\(field.isHidden ? 1 : 0)"
        self.publishMirror()
      }
    }
  }

  func blur() throws {
    DispatchQueue.main.async { [weak self] in
      _ = self?.model.hostedField?.resignFirstResponder()
    }
  }

  /// The cached snapshot, answered on the JS thread. See the file header.
  func nuiTestState() throws -> String {
    return model.readMirror()
  }

  /// A programmatic write, applied on main. The outcome lands in
  /// `nuiTestState()`'s `lastWrite`, because waiting for it here would be a
  /// JS → main *sync* hop, which `core.md` §5 forbids.
  func nuiTestApplyWrite(text: String) throws {
    model.pendingWrite = text
    DispatchQueue.main.async { [weak self] in
      self?.applyPendingWrite()
    }
  }

  /// Main thread. The write path a shipped field would use: control rule first,
  /// handshake second, composition guard third, one commit, then the mirror.
  private func applyPendingWrite() {
    nitroUiAssertMainThread()
    guard let pending = model.pendingWrite else { return }
    model.pendingWrite = nil

    let field = model.hostedField
    if field?.markedTextRange != nil {
      model.lastWrite = "composing"
      publishMirror()
      return
    }

    /*
     * A controlled field's text belongs to React, so a write that contradicts `value` is refused — the same
     * rule Android applies (`HybridNitroUiSpikeTextField.nuiTestApplyWrite` compares against `state.js`
     * first). It is a finding rather than a detail that the two shapes disagreed until the P3 harness run:
     * the iOS arm reconciled the write and answered `applied`, so the same user action on the same spec gave
     * different answers per arm, and the arm that applied it was handing the caller a side channel around
     * React — which is exactly what `nuiTestApplyWrite` documents that it is not.
     */
    if let js = model.state.js, js != pending {
      model.lastWrite = "ignored"
      publishMirror()
      return
    }

    // Same handshake as a prop write: a value JS has not been told about is
    // stale. `js` is restored afterwards so the method does not also become a
    // prop write — the model's `js` belongs to React.
    let jsBefore = model.state.js
    model.state.js = pending
    let applied = model.state.reconcile()
    model.state.js = jsBefore

    /*
     * `emitted` moves with an accepted write, on every shape.
     *
     * The mirror's `equal=` / `cps=` compare the control's text with what JS believes the field says, and for
     * an uncontrolled field that is `emitted` / `lastEmitted`. Android's composable seeds its counter before
     * applying a write, so an uncontrolled field answers `equal=1` there; iOS's arm A left `emitted` at `nil`
     * and the same field answered `equal=0 cps=0` — measured on the first iOS run of P1 and P3, where the two
     * platforms disagreed about the same write. Strictly, JS was *not* told about a write (the commit callback
     * is the only emit path, and a write that never changed the host's text produces no callback), so
     * `equal=0` is the more literal answer. The spike keeps Android's rule because the mirror's job is the
     * invariant "both halves of an uncontrolled field hold the same string", and because a per-shape
     * difference in what the schema means makes the A/B unmeasurable. The literal answer is the finding, and
     * it belongs to a shipped field: choose one and write it down.
     */
    if applied {
      model.emitted = pending
    }

    if field != nil {
      // Arm B: the control is the text storage, and the guard is inside it.
      field?.applyText(pending, write: applied)
      if applied {
        host.markDirty()
      }
    } else if applied {
      /*
       * Arm A: the model *is* the text storage, so a reconcile is the whole write.
       *
       * It also has to record the outcome, which is what the first iOS run of X4 caught: the `if !applied`
       * branch below is the only place arm A ever wrote `lastWrite`, so every *successful* arm-A write left
       * `lastWrite=none` in the mirror while the text changed underneath it. An outcome that is only reported
       * for the failures is worse than no outcome — it reads as "nothing happened".
       */
      model.lastWrite = "applied"
      host.markDirty()
    }
    if !applied {
      model.lastWrite = model.state.displayed == pending ? "same" : "stale"
    }
    host.commit()
    publishMirror()
  }

  /// Re-render the mirror from the model plus whatever arm is live.
  private func publishMirror() {
    if let field = model.hostedField {
      field.publishMirror()
      return
    }
    var mirror = NitroSpikeTextMirror()
    SpikeTextFieldCommit.fill(model, &mirror)
    /*
     * The *frozen* arm, not "the field is absent so it must be arm A".
     *
     * `model.hostedField` is nil in two different situations: this instance really is arm A, and this instance
     * is arm B before SwiftUI has built the `UIViewRepresentable`. Reporting `swiftui` for the second one is
     * what made the first iOS run's P1 unreadable — an instance asked for `textfield` published
     * `impl=swiftui selection=-1--1`, so the A/B could not tell the two apart. `impl=` is the branch; `live=0`
     * is what says the numbers came from the model rather than from a `UITextField`.
     */
    mirror.implementation =
      model.frozenImplementation ?? SpikeTextFieldShapes.swiftui
    mirror.liveField = false
    // Unobservable on arm A, so unobserved rather than guessed: a `0` here would
    // read as "the composition closed", which is a different claim.
    mirror.composing = false
    mirror.editable = !model.disabled
    mirror.focused = model.focused
    mirror.selectionStart = -1
    mirror.selectionLength = -1
    mirror.lines = -1
    model.publishMirror(mirror)
  }

  /// iOS arms no composition guard of its own, so the report is the same
  /// always-empty line Switch answers with (`HybridNitroUiSwitch.swift`).
  func nuiTestArmedGuards() throws -> String {
    return "|live:"
  }
}
