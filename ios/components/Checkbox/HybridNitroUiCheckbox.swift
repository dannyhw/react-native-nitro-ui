//
//  HybridNitroUiCheckbox.swift
//  react-native-nitro-ui
//
//  The Checkbox component. iOS has no checkbox - `CheckboxToggleStyle` is
//  `@available(iOS, unavailable)` in the SDK - so, exactly as Expo's universal
//  `Checkbox` does, this renders SwiftUI's `Toggle` with the switch style and calls
//  it a Checkbox. The control is real; only the glyph is another platform's.
//  `docs/components/checkbox.md` says so where a reader would look.
//
//  The structure is Switch's for the value (`HybridNitroUiSwitch.swift`: the
//  event-count handshake) and Chip's for the label (`HybridNitroUiChip.swift`: a
//  label is content, so it is in the sizing key and a new one asks for a new
//  measure). What is its own is the name: with no label the switch has nothing to
//  read, so `accessibilityLabel` is applied with a label-less `Toggle`'s own
//  `.accessibilityAddTraits(.isToggle)` already in place.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Checkbox. See ``NitroUiModel`` for why this is not `@Published`.
final class CheckboxModel: NitroUiModel {
  /// The checkbox's value, behind the event-count handshake (§4).
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultChecked: Bool?
  var didApplyDefault = false
  /// Three-state display. Read by Android's `TriStateCheckbox`; stored here because
  /// the prop is sent on both platforms and recycle has to clear it. Nothing on this
  /// platform draws it - a switch has two positions.
  var indeterminate = false
  /// Text beside the switch, or `nil`. Content: it is width, and it is the name.
  var label: String?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  /// `accessibilityLabel`, or `nil` to fall back to ``label``.
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state.
  var sizingKey = ""
  /// `onCheckedChange`, wired through a stable JS callback.
  var onChange: ((_ checked: Bool, _ eventCount: Double) -> Void)?

  /// Test-only read-outs (`nuiTestStateReport`). Plain storage behind a lock,
  /// never `@Published`: the body writes `drawn`, and publishing from the body
  /// would ask for the update that has just happened.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"

  override init() {
    super.init()
  }

  /// The user tapped - from the Toggle's binding, or from ``press()``. Native is
  /// optimistic: show the new value now, before React has seen the event, so there
  /// is no visual latency (§4).
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes: the opposite of what the switch shows.
  /// Refused while disabled, as `.disabled(true)` refuses a tap.
  ///
  /// It has to be a toggle and not "ask for checked": this platform's `Toggle` is a
  /// two-position control whose real taps go through the binding below with the value
  /// SwiftUI computed, so a hook that always asked for `true` would differ from the
  /// tap it stands in for, and a switch that cannot be turned off by being pressed
  /// would read as a control the harness - and only the harness - can turn off.
  /// `Checkbox.harness.tsx`'s second toggle measures this.
  func press() {
    guard !disabled else { return }
    userToggle(to: !state.displayed)
  }

  /// Record what the drawing code was handed: `1`/`0`. This platform has no third
  /// glyph, so it never answers `mixed` - which is the point the harness pins.
  func recordDrawn(_ value: String) {
    reportLock.lock()
    drawn = value
    reportLock.unlock()
  }

  /// Record how many nodes a reader is offered. iOS answers `unavailable` for the
  /// probe, and `merged` with it, rather than inventing a count it cannot read.
  func recordMerged(_ value: String) {
    reportLock.lock()
    merged = value
    reportLock.unlock()
  }

  /// Store a probe's answer and count it, so a test can tell it from the last one.
  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// `displayed=…;probes=…;merged=…;a11y=…`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);merged=\(merged);a11y=\(accessibilityReport)"
  }

  /// Back to "nothing yet", for recycling: a reused view whose report still
  /// described the previous owner's checkbox would let a test read that owner's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    probes = 0
    merged = "none"
    accessibilityReport = "none"
    reportLock.unlock()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct CheckboxContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: CheckboxModel

  init(model: CheckboxModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-out below can be a statement: without it a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the Toggle is handed rather than what React sent.
    let drawn = model.state.displayed ? "1" : "0"
    let _ = model.recordDrawn(drawn)
    let name = model.accessibilityLabel ?? model.label
    Toggle(isOn: Binding(
      get: { model.state.displayed },
      set: { requested in model.userToggle(to: requested) }
    )) {
      // With no label the Toggle still needs an empty one: `Toggle("", isOn:)` and
      // `labelsHidden()` is what Switch does for the same reason, so a checkbox
      // without text is a switch and nothing else.
      if let label = model.label {
        Text(label).lineLimit(1)
      } else {
        Text("")
      }
    }
    // A `Toggle` with a label keeps the label visible and the whole row tappable,
    // which is the row behaviour the component promises; a label-less one hides the
    // empty text so the box is the switch alone.
    .modifier(OptionalHideLabels(hidden: model.label == nil))
    .toggleStyle(.switch)
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    // A checkbox with no text has no name, and the one thing that gives it one is
    // this: `accessibilityLabel(_:)` on the Toggle, which an empty label does not
    // (an empty `accessibilityLabel("")` would silence the text it does have, so it
    // is applied only when there is a name - Switch's and Chip's rule).
    .modifier(OptionalAccessibility(label: name))
  }
}

/// `.labelsHidden()` has no "keep the label" form, so it is applied only when there
/// is nothing to show.
private struct OptionalHideLabels: ViewModifier {
  let hidden: Bool

  func body(content: Content) -> some View {
    if hidden {
      content.labelsHidden()
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

/// An empty `accessibilityLabel(_:)` would silence the Toggle's own label, so it is
/// applied only when set. `testID` deliberately does *not* go in here: RN already
/// puts it on the component view, and putting it on the SwiftUI element too would
/// make the view match a testID query twice.
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

/// The Hybrid View React renders as `NitroUiCheckbox`.
final class HybridNitroUiCheckbox: HybridNitroUiCheckboxSpec, RecyclableView {
  private let host: NitroSwiftUIHost<CheckboxContent>

  /// This component's name in the sizing engine: `HybridNitroUiCheckboxComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiCheckbox"

  /// The size to lay a Checkbox out with before anything has been measured, in
  /// points.
  ///
  /// One number for every configuration, for the reason Button's is (the engine keys
  /// fallbacks by component alone). A bare `.switch` Toggle is the Switch's own box -
  /// 61x28 pt from iOS 26 and 51x31 pt before it, the same OS check
  /// `HybridNitroUiSwitch.swift` makes - and a label only adds width, which the
  /// measurement is for. The height is therefore the part that is right for every
  /// configuration, and the width is a bare box's: inside the measured table in
  /// `docs/components/checkbox.md` rather than any one checkbox.
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
  /// matters: Fabric measures a Checkbox's shadow node before it creates any
  /// Checkbox view, so a fallback declared from `init` is one measure too late for
  /// the first instance (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: CheckboxModel())
    super.init()
    // A checkbox presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<CheckboxContent> {
    return host
  }

  private var model: CheckboxModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var checked: Variant_Bool_NullType {
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

  var defaultChecked: Variant_Bool_NullType {
    get {
      guard let value = model.defaultChecked else { return .second(.null) }
      return .first(value)
    }
    set {
      model.defaultChecked = newValue.asType(Bool.self)
      guard model.state.js == nil, !model.didApplyDefault, let seed = model.defaultChecked else {
        return
      }
      model.didApplyDefault = true
      guard seed != model.state.displayed else { return }
      model.state.displayed = seed
      host.markDirty()
    }
  }

  /// Stored, never rendered: iOS has no third glyph. No `markDirty()` - nothing
  /// observes it. Android's setter does render it (`HybridNitroUiCheckbox.kt`).
  var indeterminate: Variant_Bool_NullType {
    get { .first(model.indeterminate) }
    set { model.indeterminate = newValue.asType(Bool.self) ?? false }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var label: Variant_NullType_String {
    get { model.label.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.label else { return }
      model.label = next
      host.markDirty()
      // A different string is a different width, and no bounds or trait change is
      // coming to say so (Chip's `label` setter).
      host.noteContentSizeMayHaveChanged()
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
      // `accessibilityIdentifier`. It stays in the spec because Android needs it as
      // a `tag`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      // Rendered, not bookkeeping: the name is on the SwiftUI element, so it needs a
      // commit or a late-set name never reaches VoiceOver.
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

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onCheckedChange: ((Bool, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The event-count handshake decides whether React's `checked` wins over what
    // the user just did - including a change JS rejected (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultChecked = nil
    model.didApplyDefault = false
    model.indeterminate = false
    model.label = nil
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    model.clearReports()
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
  func measureContent() throws -> NitroUiCheckboxSize {
    guard let size = host.contentSize else {
      return NitroUiCheckboxSize(width: 0, height: 0)
    }
    return NitroUiCheckboxSize(width: Double(size.width), height: Double(size.height))
  }

  /// Toggle through the tap's path, on the UI thread (see the spec). Returns at once.
  func nuiTestToggle() {
    DispatchQueue.main.async { [host] in
      host.model.press()
    }
  }

  /// Records `unavailable` - see the spec, and `HybridNitroUiSlider.swift` and
  /// `HybridNitroUiChip.swift` for the measurement this rests on: a SwiftUI hosting
  /// view answers `accessibilityElements == []` to anything that is not an
  /// accessibility client, so there is nothing to read in-process. The role and the
  /// checked value are XCUITest's to assert, in `real-input:ios`.
  func nuiTestProbeAccessibility() {
    DispatchQueue.main.async { [host] in
      host.model.recordMerged("unavailable")
      host.model.recordAccessibility("unavailable")
    }
  }

  func nuiTestStateReport() throws -> String {
    return model.stateReport()
  }
}
