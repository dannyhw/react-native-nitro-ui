//
//  HybridNitroUiSwitch.swift
//  react-native-nitro-ui
//
//  The Switch component: SwiftUI `Toggle` with `.switch` style, on the core
//  runtime. It is the reference for every later component, so it stays short.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Switch. See ``NitroUiModel`` for why this is not `@Published`.
final class SwitchModel: NitroUiModel {
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultValue: Bool?
  var didApplyDefault = false
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// `onValueChange`, wired through a stable JS callback.
  var onChange: ((_ value: Bool, _ eventCount: Double) -> Void)?

  override init() {
    super.init()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct SwitchContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
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
          // Native is optimistic: show the new value now, before React has seen
          // the event, so there is no visual latency (§4).
          let eventCount = model.state.user(requested)
          model.objectWillChange.send()
          model.onChange?(requested, Double(eventCount))
        }
      )
    )
    .labelsHidden()
    .toggleStyle(.switch)
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    .modifier(OptionalAccessibility(label: model.accessibilityLabel))
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

/// An empty `accessibilityLabel(_:)` would silence the Toggle's own label, so it
/// is applied only when set. `testID` deliberately does *not* go in here: RN
/// already puts it on the component view, and putting it on the SwiftUI element
/// too would make the view match a testID query twice.
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

/// The Hybrid View React renders as `NitroUiSwitch`.
final class HybridNitroUiSwitch: HybridNitroUiSwitchSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SwitchContent>

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: SwitchModel())
    super.init()
    // Containment is for controls that present UI (menus, pickers); a Toggle
    // never does, so it stays a plain view (core-architecture §2).
    host.needsContainment = false
    // T11 and `measureContent()` want the fitting size. Cost is one
    // `sizeThatFits` per bounds or trait change, not per commit, and nothing for
    // components that opt out.
    host.wantsContentSize = true
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
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`.
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
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. Setting it again here would make the Switch
      // match a testID query twice and need clearing on recycle. It stays in the
      // spec because Android needs it as a `tag`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // Rendered, not bookkeeping: the label is on the SwiftUI element, so it
      // needs a commit or a late-set label never reaches VoiceOver. Same rule as
      // `disabled` above - only the handshake props may skip `markDirty()`.
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

  var onValueChange: ((Bool, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The event-count handshake decides whether React's `value` wins over what
    // the user just did - including a change JS rejected (§4).
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
    model.onChange = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this Toggle, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  private var model: SwitchModel {
    return host.model
  }
}
