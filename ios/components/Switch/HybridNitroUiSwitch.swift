// The Switch component: a SwiftUI `Toggle` with the `.switch` style.

import NitroModules
import SwiftUI
import UIKit

final class SwitchModel: NitroUiModel {
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultValue: Bool?
  var didApplyDefault = false
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent. Nothing native reads it: the sizing engine takes the key
  /// from Fabric state.
  var sizingKey = ""
  /// Test-only control width, in points: see `nuiTestWidth`.
  var testWidth: Double?
  var onChange: ((_ value: Bool, _ eventCount: Double) -> Void)?

  override init() {
    super.init()
  }
}

struct SwitchContent: NitroUIContent {
  @ObservedObject private var model: SwitchModel

  init(model: SwitchModel) {
    self.model = model
  }

  var body: some View {
    Toggle(
      "",
      isOn: Binding(
        get: { model.state.displayed },
        set: { requested in
          // Optimistic: show the new value now, before React has seen the event, so there is no
          // visual latency.
          let eventCount = model.state.user(requested)
          model.objectWillChange.send()
          model.onChange?(requested, Double(eventCount))
        }
      )
    )

    // Test-only: fixes the control's fitting width. `nil`, the default, adds no modifier.
    .modifier(OptionalTestWidth(points: model.testWidth))
    .labelsHidden()
    .toggleStyle(.switch)
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    .modifier(OptionalAccessibility(label: model.accessibilityLabel))
  }
}

/// The test-only width modifier, applied only when set: an unconditional `.frame`
/// would give every Switch in the app an explicit width.
private struct OptionalTestWidth: ViewModifier {
  let points: Double?

  func body(content: Content) -> some View {
    if let points {
      content.frame(width: CGFloat(points))
    } else {
      content
    }
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
private struct OptionalTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      // `tint(_:)` takes a `ShapeStyle`, and `UIColor` is not one.
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the Toggle's own label, so it is applied only
/// when set. `testID` is not applied here: RN already puts it on the component view, and a second
/// copy would match a testID query twice.
private struct OptionalAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

final class HybridNitroUiSwitch: HybridNitroUiSwitchSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SwitchContent>

  /// This component's name in the sizing engine. Must match `HybridNitroUiSwitchComponentName` in
  /// the generated C++ and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiSwitch"

  /// The size to lay a Switch out with before anything has been measured, in points. It has to be
  /// close: SwiftUI paints outside a box that is too small and leaves dead touch zones. A `.switch`
  /// Toggle is 61x28 pt from iOS 26 and 51x31 pt before it.
  private static let declaresFallback: Bool = {
    let modern = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
    let size = modern ? (width: 61.0, height: 28.0) : (width: 51.0, height: 31.0)
    NitroUiSizing.setFallback(sizingComponentName, size.width, size.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process. Called at startup,
  /// because Fabric measures a shadow node before it creates the view; `init` calls it again as a
  /// backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: SwitchModel())
    super.init()
    // Containment is only for controls that present UI.
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // Backstop: startup normally registers this before a Switch can be measured.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<SwitchContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var value: Variant_Bool_NullType {
    get {
      guard let js = model.state.js else { return .second(.null) }
      return .first(js)
    }
    set {
      // Not visual on its own: `displayed` follows only once the event count says JS has caught up
      // (see `afterUpdate()`).
      model.state.js = newValue.asType(Bool.self)
    }
  }

  var defaultValue: Variant_Bool_NullType {
    get {
      guard let value = model.defaultValue else { return .second(.null) }
      return .first(value)
    }
    set {
      model.defaultValue = newValue.asType(Bool.self)
      guard model.state.js == nil, !model.didApplyDefault, let `default` = model.defaultValue else {
        return
      }
      model.didApplyDefault = true
      guard `default` != model.state.displayed else { return }
      model.state.displayed = `default`
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
      host.markDirty()
    }
  }

  var tintColor: Variant_NullType_Double {
    get {
      guard let tint = model.tint else { return .first(.null) }
      return .second(tint.nitroUiARGBValue)
    }
    set {
      let next = newValue.asType(Double.self).flatMap(UIColor.init(nitroUiARGB:))
      guard next != model.tint else { return }
      model.tint = next
      host.markDirty()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `RCTViewComponentView` already sets `testID` as the component view's
      // `accessibilityIdentifier`. It is in the spec because Android needs it.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // Rendered, so it needs a commit: the label is on the SwiftUI element.
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
    set { model.sizingKey = newValue }
  }

  var nuiTestWidth: Variant_NullType_Double {
    get {
      guard let width = model.testWidth else { return .first(.null) }
      return .second(width)
    }
    set {
      let next = newValue.asType(Double.self)
      guard next != model.testWidth else {
        return
      }
      model.testWidth = next
      host.markDirty()
      // This prop changes the control's size, so the fitting size must be measured again after the
      // commit.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onValueChange: ((Bool, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The event-count handshake decides whether React's `value` wins over what the user just did,
    // including a change JS rejected.
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultValue = nil
    model.didApplyDefault = false
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.testWidth = nil
    model.onChange = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this Toggle, from the host's cache. Can be called from the JS
  /// thread, so it must not measure SwiftUI, which is main-thread only.
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  /// Always empty on iOS: the lifecycle observer and pre-draw listener this reports on exist only
  /// on Android.
  func nuiTestArmedGuards() throws -> String {
    return "|live:"
  }

  func nuiTestLifetimeReport() throws -> String {
    return host.lifetimeReport()
  }

  private var model: SwitchModel {
    return host.model
  }
}
