// The Checkbox component. iOS has no checkbox (`CheckboxToggleStyle` is unavailable there), so this
// is SwiftUI's `Toggle` with a style that draws Apple's checklist glyph, or the system switch for
// `iosStyle='switch'`.

import NitroModules
import SwiftUI
import UIKit

final class CheckboxModel: NitroUiModel {
  /// The checkbox's value, behind the event-count handshake.
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultChecked: Bool?
  var didApplyDefault = false
  /// Three-state display. Only the glyph styles draw the dash; the switch style has two positions
  /// and reads it as off.
  var indeterminate = false
  var iosStyle: NitroUiCheckboxStyle = .circle
  /// Text beside the glyph or switch, or `nil`.
  var label: String?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  /// `accessibilityLabel`, or `nil` to fall back to ``label``.
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state.
  var sizingKey = ""
  var onChange: ((_ checked: Bool, _ eventCount: Double) -> Void)?

  /// Test-only read-outs. Plain storage behind a lock, never `@Published`: the body writes `drawn`,
  /// and publishing from the body would ask for the update that has just happened.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var symbol = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"

  override init() {
    super.init()
  }

  /// The user tapped. Optimistic: show the new value now, before React has seen the event.
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes: the opposite of what is showing. Refused while
  /// disabled.
  func press() {
    guard !disabled else { return }
    userToggle(to: !state.displayed)
  }

  /// Record what the drawing code was handed: `1`, `0`, or `mixed` for the dash.
  func recordDrawn(_ value: String) {
    reportLock.lock()
    drawn = value
    reportLock.unlock()
  }

  /// Record the symbol the drawing code was handed: the SF Symbol name, or `switch` for the style
  /// that draws none.
  func recordSymbol(_ value: String) {
    reportLock.lock()
    symbol = value
    reportLock.unlock()
  }

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

  /// `displayed=…;probes=…;merged=…;a11y=…;symbol=…`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);merged=\(merged);a11y=\(accessibilityReport);symbol=\(symbol)"
  }

  /// Back to "nothing yet", so a recycled view does not report its previous owner's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    symbol = "none"
    probes = 0
    merged = "none"
    accessibilityReport = "none"
    reportLock.unlock()
  }
}

struct CheckboxContent: NitroUIContent {
  @ObservedObject private var model: CheckboxModel

  init(model: CheckboxModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-outs below can be statements: without them a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // The switch style has two positions, so only the glyph styles show the dash. The drawing, the
    // read-out and the announced value all use this one flag.
    let showsThirdState = model.indeterminate && model.iosStyle.drawsGlyph
    // Test read-out, taken where the control is drawn.
    let drawn = model.state.displayed ? "1" : (showsThirdState ? "mixed" : "0")
    // `checked` outranks the dash in the glyph, so it must outrank it in the announced value too;
    // both come from the same rule.
    let announcedValue = NitroUiCheckboxGlyphs.accessibilityValue(
      checked: model.state.displayed,
      indeterminate: showsThirdState
    )
    let glyph = NitroUiCheckboxGlyphs.glyph(
      style: model.iosStyle,
      checked: model.state.displayed,
      indeterminate: showsThirdState
    )
    let _ = model.recordDrawn(drawn)
    let _ = model.recordSymbol(glyph?.symbol ?? "switch")
    let name = model.accessibilityLabel ?? model.label
    Toggle(isOn: Binding(
      get: { model.state.displayed },
      set: { requested in model.userToggle(to: requested) }
    )) {
      // A label-less Toggle still needs an empty label.
      if let label = model.label {
        Text(label).lineLimit(1)
      } else {
        Text("")
      }
    }
    .modifier(OptionalHideLabels(hidden: model.label == nil))
    .modifier(
      CheckboxToggleStyleModifier(
        style: model.iosStyle,
        showsThirdState: showsThirdState,
        showsLabel: model.label != nil
      )
    )
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    .modifier(OptionalAccessibility(label: name))
    // A `Toggle` can only announce checked or unchecked, so the dash gets a value of its own.
    .modifier(OptionalAccessibilityValue(value: announcedValue))
    // A custom `ToggleStyle`'s content becomes separate accessibility elements (the toggle, the
    // symbol image and the text). `accessibilityRepresentation` replaces them with one undrawn
    // `Toggle` on the row's box. It does not inherit `.disabled`, so that is restated inside it.
    .modifier(
      CheckboxGlyphAccessibility(
        glyph: model.iosStyle.drawsGlyph,
        name: name ?? "",
        isOn: model.state.displayed,
        setOn: { requested in model.userToggle(to: requested) },
        disabled: model.disabled,
        value: announcedValue
      )
    )
    // One tap target for the whole row, label included. It must be an overlay: a `Toggle` claims
    // the whole row for hit testing but acts only on its glyph, so a layer behind it is never
    // asked. Hidden from accessibility, so a reader still meets the toggle.
    .overlay {
      Color.clear
        .contentShape(Rectangle())
        .accessibilityHidden(true)
        .onTapGesture { model.press() }
    }
  }
}

/// The two glyph styles: the system's checklist symbol, then the label. It only draws; the row's
/// tap target and its accessibility element are applied in `CheckboxContent`. `DynamicProperty` is
/// what makes SwiftUI fill the `@Environment` below: a style is not a `View`.
private struct CheckboxGlyphToggleStyle: ToggleStyle, DynamicProperty {
  let style: NitroUiCheckboxStyle
  /// Whether the dash is the state on screen (`checked` outranks it).
  let showsThirdState: Bool
  /// Whether there is a label to show. `labelsHidden()` is honoured by SwiftUI's own styles, not
  /// this one, and an `HStack` charges spacing for an empty text.
  let showsLabel: Bool
  /// Read from the environment: `.disabled` is applied to the `Toggle` outside this style.
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    let glyph = NitroUiCheckboxGlyphs.glyph(
      style: style,
      checked: configuration.isOn,
      indeterminate: showsThirdState
    )
    // Default `HStack` spacing: what SwiftUI puts between an image and a text.
    return HStack {
      Image(systemName: glyph?.symbol ?? "circle")
        // The label's font, so Dynamic Type grows the glyph and its label together.
        .font(.body)
        .imageScale(.large)
        .symbolRenderingMode(.monochrome)
        // `.tint` is whatever the environment carries: `tintColor`, an app's own `.tint(_:)`, or
        // the accent colour. The empty box is not a state, so it is not tinted.
        .foregroundStyle(
          glyph?.filled == true
            ? AnyShapeStyle(.tint)
            : AnyShapeStyle(Color(uiColor: .secondaryLabel))
        )
      if showsLabel {
        configuration.label
      }
    }
    .opacity(isEnabled ? 1 : 0.5)
  }
}

/// Puts one of the three iOS looks on the `Toggle`. A modifier because `.toggleStyle` takes a
/// different concrete type per branch.
private struct CheckboxToggleStyleModifier: ViewModifier {
  let style: NitroUiCheckboxStyle
  let showsThirdState: Bool
  let showsLabel: Bool

  @ViewBuilder func body(content: Content) -> some View {
    switch style {
    case .toggle:
      content.toggleStyle(.switch)
    case .circle, .square:
      content.toggleStyle(
        CheckboxGlyphToggleStyle(
          style: style,
          showsThirdState: showsThirdState,
          showsLabel: showsLabel
        )
      )
    }
  }
}

/// The glyph styles' one accessibility element: a `Toggle` that is represented, not drawn.
/// `.accessibilityRepresentation` replaces the accessibility of everything it is applied to.
private struct CheckboxGlyphAccessibility: ViewModifier {
  /// Glyph styles only; `'switch'` keeps its own element.
  let glyph: Bool
  /// The control's name - `accessibilityLabel`, else `label` - or empty for no name.
  let name: String
  let isOn: Bool
  let setOn: (Bool) -> Void
  /// Restated inside the representation, which does not inherit it.
  let disabled: Bool
  /// The third state's word, or `nil` to keep the `Toggle`'s own checked/unchecked value.
  let value: String?

  @ViewBuilder func body(content: Content) -> some View {
    if glyph {
      content.accessibilityRepresentation {
        Toggle(name, isOn: Binding(get: { isOn }, set: { requested in setOn(requested) }))
          .modifier(OptionalAccessibilityValue(value: value))
          .disabled(disabled)
      }
    } else {
      content
    }
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

/// An empty `accessibilityValue(_:)` would silence the `Toggle`'s own value, so it is applied only
/// when set.
private struct OptionalAccessibilityValue: ViewModifier {
  let value: String?

  func body(content: Content) -> some View {
    if let value {
      content.accessibilityValue(Text(value))
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

final class HybridNitroUiCheckbox: HybridNitroUiCheckboxSpec, RecyclableView {
  private let host: NitroSwiftUIHost<CheckboxContent>

  /// This component's name in the sizing engine. Must match `HybridNitroUiCheckboxComponentName` in
  /// the generated C++ and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiCheckbox"

  /// The size to lay a Checkbox out with before anything has been measured, in points: the default
  /// configuration's box (no label, `'circle'` style). One number for every configuration, because
  /// the engine keys fallbacks by component alone.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 26.0, 26.0, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process. Called at startup,
  /// because Fabric measures a shadow node before it creates the view; `init` calls it again as a
  /// backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

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
      // Not visual on its own: `displayed` follows only once the event count says JS has caught up
      // (see `afterUpdate()`).
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

  /// Stored for every style but drawn only by the two glyph styles. It does not ask for a new
  /// measure: the dash, the check mark and the empty box share one symbol box.
  var indeterminate: Variant_Bool_NullType {
    get { .first(model.indeterminate) }
    set {
      let next = newValue.asType(Bool.self) ?? false
      guard next != model.indeterminate else { return }
      model.indeterminate = next
      host.markDirty()
    }
  }

  /// Each style is a different box, so this prop repaints and asks for a new measure.
  var iosStyle: String {
    get { model.iosStyle.rawValue }
    set {
      let next = NitroUiCheckboxStyle.resolve(newValue)
      guard next != model.iosStyle else { return }
      model.iosStyle = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
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
      // A different string is a different width, and no bounds or trait change will say so.
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
      // Nothing to apply: `RCTViewComponentView` already sets `testID` as the component view's
      // `accessibilityIdentifier`. It is in the spec because Android needs it.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      // Rendered, so it needs a commit: the name is on the SwiftUI element.
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
      // A new configuration may measure the same size as the old one, and the host must not dedupe
      // that report away.
      host.noteSizingKeyChanged()
    }
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
    // The event-count handshake decides whether React's `checked` wins over what the user just did,
    // including a change JS rejected.
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
    model.iosStyle = .circle
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

  /// The size SwiftUI wants for this Toggle, from the host's cache. Can be called from the JS
  /// thread, so it must not measure SwiftUI, which is main-thread only.
  func measureContent() throws -> NitroUiCheckboxSize {
    guard let size = host.contentSize else {
      return NitroUiCheckboxSize(width: 0, height: 0)
    }
    return NitroUiCheckboxSize(width: Double(size.width), height: Double(size.height))
  }

  /// Toggle through the tap's path, on the main thread. Returns at once.
  func nuiTestToggle() {
    DispatchQueue.main.async { [host] in
      host.model.press()
    }
  }

  /// Records `unavailable`: a SwiftUI hosting view answers `accessibilityElements == []` to
  /// anything that is not an accessibility client, so there is nothing to read in-process.
  func nuiTestProbeAccessibility() {
    DispatchQueue.main.async { [host] in
      host.model.recordMerged("unavailable")
      host.model.recordAccessibility("unavailable")
    }
  }

  func nuiTestStateReport() throws -> String {
    // The host's lifetime counters are appended: a mount that reports `recycles>=1` is a view the
    // recycle pool handed back.
    return model.stateReport()
      + ";drops=\(host.lifetimeDrops);recycles=\(host.lifetimeRecycles)"
  }
}
