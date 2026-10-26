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
  /// The size configuration React sent (empty for a Switch today). Stored for
  /// symmetry with the other props; the sizing engine reads the key out of Fabric
  /// state itself, so nothing native looks at this.
  var sizingKey = ""
  /// Test-only control width, in points: see `nuiTestWidth`.
  var testWidth: Double?
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

    // Test-only: fix the control's *fitting* width, so a test can watch a
    // sizing-key change re-measure (see `nuiTestWidth`). Nothing in a real app
    // sets it, and `nil` - the default - adds no modifier at all.
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

  /// This component's name in the sizing engine: `HybridNitroUiSwitchComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiSwitch"

  /// The size to lay a Switch out with before anything has been measured, in
  /// points - the first Switch of an app's first launch. A measurement replaces
  /// it on the first report, and a Switch has one configuration, so this is a
  /// one-frame thing; it still has to be close, because SwiftUI paints outside a
  /// box that is too small and leaves dead touch zones (docs/components/switch.md).
  /// A `.switch` Toggle is 61x28 pt from iOS 26 and 51x31 pt before it - the same
  /// OS check the JS wrapper carried until sizing became native.
  private static let declaresFallback: Bool = {
    let modern = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
    let size = modern ? (width: 61.0, height: 28.0) : (width: 51.0, height: 31.0)
    NitroUiSizing.setFallback(sizingComponentName, size.width, size.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process
  /// (the static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a Switch's shadow node before it creates any Switch
  /// view, so a fallback declared from `init` is one measure too late for the
  /// first instance (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

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
    host.sizingPolicy = .intrinsic
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before a Switch can be measured, and a
    // host built without that table still gets its fallback here.
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
      // This is the one prop a Switch has that changes its *size*, so the fitting
      // size has to be taken again after the commit - with a new width the
      // reported size is what corrects the box. A text-sized component's real
      // props do the same thing (a shorter label, a new selection).
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

  /// Always empty on iOS, honestly: there is nothing here to arm.
  ///
  /// The Android host registers two things for a composition of its own - a
  /// `ViewCompositionStrategy` (an observer on the activity's `LifecycleRegistry`) and a
  /// first-frame pre-draw listener - and a control inside a `<Host>` must not register
  /// either, which is what the probe lets a test see (H1 follow-up N4). iOS has neither
  /// mechanism: a `UIHostingController` is torn down with its host and there is no
  /// pre-draw registrar to leak through. The answer keeps Android's shape - nothing ever
  /// armed, nothing installed - rather than inventing a third one. The test that reads
  /// this is gated to Android, so it states a fact rather than a measurement.
  func nuiTestArmedGuards() throws -> String {
    return "|live:"
  }

  private var model: SwitchModel {
    return host.model
  }
}
