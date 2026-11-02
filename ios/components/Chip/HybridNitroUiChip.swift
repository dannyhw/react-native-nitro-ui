//
//  HybridNitroUiChip.swift
//  react-native-nitro-ui
//
//  The Chip component. iOS has no chip, so the two jobs go to the two real
//  controls that do them: a filter chip is `Toggle(isOn:) { Label }` with
//  `.toggleStyle(.button)`, and an assist chip is a `Button`. Both are bordered,
//  capsule-shaped and `.small`, which is what makes them read as chips.
//
//  The structure is Switch's for the value (`HybridNitroUiSwitch.swift`: the
//  event-count handshake) and Button's for the size (`HybridNitroUiButton.swift`:
//  a label-sized control whose size-affecting setters ask for a new measure).
//

import NitroModules
import SwiftUI
import UIKit

/// What the chip is for. Anything unrecognised is `filter` (Button's rule).
enum ChipVariant: String {
  case filter
  case assist
}

/// State of one Chip. See ``NitroUiModel`` for why this is not `@Published`.
final class ChipModel: NitroUiModel {
  var label: String = ""
  var variant: ChipVariant = .filter
  /// A filter chip's selection, behind the event-count handshake (§4). An assist
  /// chip never reads it.
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultSelected: Bool?
  var didApplyDefault = false
  var disabled = false
  /// A symbol name that resolved to an actual SF Symbol (see Button's model: the
  /// content never renders the "missing symbol" placeholder).
  var systemImage: String?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state,
  /// and the host only needs to hear that it changed.
  var sizingKey = ""
  var onSelectedChange: ((_ selected: Bool, _ eventCount: Double) -> Void)?
  var onPress: (() -> Void)?

  /// Test-only read-outs (`nuiTestStateReport`). Plain storage behind a lock,
  /// never `@Published`: the body writes `drawn`, and publishing from the body
  /// would ask for the update that has just happened.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"

  override init() {
    super.init()
  }

  /// The user toggled a filter chip - from the Toggle's binding, or from
  /// ``press()``. Native is optimistic: show the new value now, before React has
  /// seen the event, so there is no visual latency (§4).
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onSelectedChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes: the filter chip's toggle or the
  /// assist chip's action. Refused while disabled, as `.disabled(true)` refuses
  /// a tap.
  func press() {
    guard !disabled else { return }
    switch variant {
    case .filter:
      userToggle(to: !state.displayed)
    case .assist:
      onPress?()
    }
  }

  /// Record what the drawing code was handed: `1`/`0` for a filter chip, `none`
  /// for an assist chip, which has no selection.
  func recordDrawn(_ value: String) {
    reportLock.lock()
    drawn = value
    reportLock.unlock()
  }

  /// Store a probe's answer and count it, so a test can tell it from the last one.
  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// `displayed=<0|1|none>;probes=<n>;a11y=<...>`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);a11y=\(accessibilityReport)"
  }

  /// Back to "nothing yet", for recycling: a reused view whose report still
  /// described the previous owner's chip would let a test read that owner's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    probes = 0
    accessibilityReport = "none"
    reportLock.unlock()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct ChipContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: ChipModel

  init(model: ChipModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-out below can be a statement: without it a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the Toggle is handed rather than what React sent.
    let drawn = model.variant == .filter ? (model.state.displayed ? "1" : "0") : "none"
    let _ = model.recordDrawn(drawn)
    // Everything that applies to both variants stays outside the switch, so a
    // variant change swaps one control and not a set of modifiers.
    control
      .buttonStyle(.bordered)
      .buttonBorderShape(.capsule)
      .controlSize(.small)
      .disabled(model.disabled)
      .modifier(ChipOptionalAccessibility(label: model.accessibilityLabel))
  }

  @ViewBuilder private var control: some View {
    switch model.variant {
    case .filter:
      // `ButtonToggleStyle` (iOS 15): a button that is filled while on. It keeps the
      // capsule's size in both states - the harness measures that, and it is why the
      // selection is not in this platform's sizing key (`Chip.tsx`).
      Toggle(
        isOn: Binding(
          get: { model.state.displayed },
          set: { requested in model.userToggle(to: requested) }
        )
      ) {
        label
      }
      .toggleStyle(.button)
    case .assist:
      Button(action: { model.press() }) { label }
    }
  }

  /// The label. One line, tail-truncated: the control's intrinsic width is the
  /// label's, and a caller who wants a narrower box gives it a `width` - then the
  /// label truncates instead of painting outside its box.
  @ViewBuilder private var label: some View {
    if let systemImage = model.systemImage {
      Label {
        Text(model.label).lineLimit(1)
      } icon: {
        Image(systemName: systemImage)
      }
      .labelStyle(.titleAndIcon)
    } else {
      Text(model.label)
        .lineLimit(1)
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the control's own label - which
/// is its text - so it is applied only when set. `testID` deliberately does *not*
/// go in here: RN already puts it on the component view.
private struct ChipOptionalAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiChip`.
final class HybridNitroUiChip: HybridNitroUiChipSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ChipContent>

  /// This component's name in the sizing engine: `HybridNitroUiChipComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiChip"

  /// The size to lay a Chip out with before anything has been measured, in points.
  ///
  /// One number for every configuration, for the reason Button's is (the engine
  /// keys fallbacks by component alone): the middle of the measured table in
  /// `docs/components/chip.md` rather than any one chip, rounded *up*, because a
  /// fallback smaller than the control makes SwiftUI paint outside its box.
  /// Measured on iOS 27 (iPhone 17 simulator): a filter chip labelled "Vegan" is
  /// 62.7 x 28.0 pt and "Gluten-free" is 97.3 x 28.0; the height is the part that
  /// matters, and `.small` is 28 pt at every label.
  private static let fallbackSize = (width: 80.0, height: 28.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process.
  /// ``NitroUiDeclaredFallbacks`` calls this at startup; `init` is the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: ChipModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A chip presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<ChipContent> {
    return host
  }

  private var model: ChipModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var label: String {
    get { model.label }
    set {
      guard newValue != model.label else { return }
      model.label = newValue
      host.markDirty()
      // A different string is a different width, and no bounds or trait change is
      // coming to say so (Button's `title` setter).
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      let next = ChipVariant(rawValue: newValue) ?? .filter
      guard next != model.variant else { return }
      model.variant = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var selected: Variant_Bool_NullType {
    get {
      guard let js = model.state.js else { return .second(.null) }
      return .first(js)
    }
    set {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`.
      model.state.js = newValue.asType(Bool.self)
    }
  }

  var defaultSelected: Variant_Bool_NullType {
    get {
      guard let value = model.defaultSelected else { return .second(.null) }
      return .first(value)
    }
    set {
      model.defaultSelected = newValue.asType(Bool.self)
      guard model.state.js == nil, !model.didApplyDefault, let seed = model.defaultSelected else {
        return
      }
      model.didApplyDefault = true
      guard seed != model.state.displayed else { return }
      model.state.displayed = seed
      host.markDirty()
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled chip is the same size.
      host.markDirty()
    }
  }

  var systemImage: Variant_NullType_String {
    get { model.systemImage.map { .second($0) } ?? .first(.null) }
    set {
      // Only a name that resolves to a symbol reaches the content (Button's rule).
      let next = newValue.asType(String.self).flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      guard next != model.systemImage else { return }
      model.systemImage = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: RN's component view already carries `testID` as its
      // `accessibilityIdentifier`. It stays in the spec because Android needs it.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.accessibilityLabel else { return }
      model.accessibilityLabel = next
      // Rendered: the label is on the SwiftUI element.
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
      // A new configuration may measure what the old one did; the host must not
      // swallow that report against its dedupe (Button's `nuiSizingKey` setter).
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onSelectedChange: ((Bool, Double) -> Void)? {
    get { model.onSelectedChange }
    set { model.onSelectedChange = newValue }
  }

  var onPress: (() -> Void)? {
    get { model.onPress }
    set { model.onPress = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The handshake decides whether React's `selected` wins over what the user just
    // did - including a toggle JS refused (§4). An assist chip's state is never
    // touched by a user, so this is a no-op there.
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.label = ""
    model.variant = .filter
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultSelected = nil
    model.didApplyDefault = false
    model.disabled = false
    model.systemImage = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onSelectedChange = nil
    model.onPress = nil
    model.clearReports()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onSelectedChange = nil
    model.onPress = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this chip, from the host's cache. Never touches
  /// the main thread (core-architecture §1.4).
  func measureContent() throws -> NitroUiChipSize {
    guard let size = host.contentSize else {
      return NitroUiChipSize(width: 0, height: 0)
    }
    return NitroUiChipSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press through the tap's path, on main (see the spec). Returns at once.
  func nuiTestPress() throws {
    let model = host.model
    if Thread.isMainThread {
      model.press()
    } else {
      DispatchQueue.main.async { model.press() }
    }
  }

  /// iOS has no node to read in-process: the SwiftUI hosting view answers
  /// `accessibilityElements == []` to anything that is not an accessibility client
  /// (measured in `HybridNitroUiSlider.swift`). Saying so is the answer; the role
  /// and the selected state are XCUITest's to read, in `real-input:ios`. No UI is
  /// touched, so there is nothing to hop for.
  func nuiTestProbeAccessibility() throws {
    host.model.recordAccessibility("unavailable")
  }

  func nuiTestStateReport() throws -> String {
    return host.model.stateReport()
  }
}
