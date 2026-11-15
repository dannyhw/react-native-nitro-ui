// The Chip component. iOS has no chip: a filter chip is a `Toggle` with `.toggleStyle(.button)`
// and an assist chip is a `Button`, both bordered, capsule-shaped and `.small`.

import NitroModules
import SwiftUI
import UIKit

/// Anything unrecognised is `filter`.
enum ChipVariant: String {
  case filter
  case assist
}

final class ChipModel: NitroUiModel {
  var label: String = ""
  var variant: ChipVariant = .filter
  /// A filter chip's selection. An assist chip never reads it.
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultSelected: Bool?
  var didApplyDefault = false
  var disabled = false
  /// Only ever a name that resolves to an SF Symbol; the setter drops the rest.
  var systemImage: String?
  /// The Android glyph name. Stored so the getter answers; never drawn on iOS.
  var androidIcon: String?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state,
  /// and the host only needs to hear that it changed.
  var sizingKey = ""
  var onSelectedChange: ((_ selected: Bool, _ eventCount: Double) -> Void)?
  var onPress: (() -> Void)?

  /// Test-only read-outs. Plain storage behind a lock rather than published: the body writes
  /// `drawn`, and publishing from the body would request another update.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"

  override init() {
    super.init()
  }

  /// Optimistic: the new value shows now, before React has seen the event.
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onSelectedChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes. Refused while disabled, as a tap is.
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

  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// `displayed=<0|1|none>;probes=<n>;a11y=<...>;iconTint=-`. Safe from any thread.
  /// `iconTint` is Android's field; iOS always answers `-`, so both platforms return one shape.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);a11y=\(accessibilityReport);iconTint=-"
  }

  /// For recycling, so a reused view does not report the previous chip's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    probes = 0
    accessibilityReport = "none"
    reportLock.unlock()
  }
}

struct ChipContent: NitroUIContent {
  @ObservedObject private var model: ChipModel

  init(model: ChipModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-out below can be a statement: without it a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // Recorded where the control is drawn, so it is what the Toggle is handed rather than
    // what React sent.
    let drawn = model.variant == .filter ? (model.state.displayed ? "1" : "0") : "none"
    let _ = model.recordDrawn(drawn)
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
      // A button that is filled while on, and the same size in both states.
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

  /// One line, tail-truncated: in a box narrower than the label, the text truncates instead
  /// of painting outside it.
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

/// An empty `accessibilityLabel(_:)` would silence the control's own label (its text), so it
/// is applied only when set. `testID` is not applied here: React Native already puts it on
/// the component view.
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

final class HybridNitroUiChip: HybridNitroUiChipSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ChipContent>

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiChip"

  /// In points. One fallback for every configuration; `.small` is 28 pt tall at any label.
  private static let fallbackSize = (width: 80.0, height: 28.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process: at startup, with `init` as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

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
      // A different string is a different width, and no bounds or trait change follows to
      // trigger a new measure.
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
      // Not visual on its own: `displayed` follows in `afterUpdate()`, once the event count
      // says JS has caught up.
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
      // Only a name that resolves to a symbol reaches the content.
      let next = newValue.asType(String.self).flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      guard next != model.systemImage else { return }
      model.systemImage = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  /// Android only. Stored so the getter answers, without `markDirty()`: nothing draws it.
  var androidIcon: Variant_NullType_String {
    get { model.androidIcon.map { .second($0) } ?? .first(.null) }
    set { model.androidIcon = newValue.asType(String.self) }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: React Native already puts `testID` on the component view as
      // `accessibilityIdentifier`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.accessibilityLabel else { return }
      model.accessibilityLabel = next
      // The label is on the SwiftUI element, so it needs a commit to reach VoiceOver.
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
      // A new key may measure exactly what the old one did, and the host would drop that
      // report as a duplicate.
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
    // The event counts decide whether React's `selected` wins over what the user just did.
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
    model.androidIcon = nil
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

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiChipSize {
    guard let size = host.contentSize else {
      return NitroUiChipSize(width: 0, height: 0)
    }
    return NitroUiChipSize(width: Double(size.width), height: Double(size.height))
  }

  /// Presses through the tap's path, on main. Returns at once.
  func nuiTestPress() throws {
    let model = host.model
    if Thread.isMainThread {
      model.press()
    } else {
      DispatchQueue.main.async { model.press() }
    }
  }

  /// Not readable in-process: a SwiftUI hosting view reports no accessibility elements
  /// unless an accessibility client is attached.
  func nuiTestProbeAccessibility() throws {
    host.model.recordAccessibility("unavailable")
  }

  func nuiTestStateReport() throws -> String {
    return host.model.stateReport()
  }

  private let pixelProbesLock = NSLock()
  private var pixelProbes = 0

  /// iOS has no Android icon glyph to sample, so the report says `no pixels`, which the
  /// tests treat as a failure.
  func nuiTestPixelProbe(color: Double) throws {
    pixelProbesLock.lock()
    pixelProbes += 1
    pixelProbesLock.unlock()
  }

  func nuiTestPixelReport() throws -> String {
    pixelProbesLock.lock()
    let probes = pixelProbes
    pixelProbesLock.unlock()
    return "n=\(probes) no pixels platform=ios"
  }
}
