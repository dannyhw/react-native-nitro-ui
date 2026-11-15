// The IconButton component: one glyph as a control. The press form is a `Button` with an
// `.iconOnly` label; the toggle form is a `Toggle` with `.toggleStyle(.button)`.

import NitroModules
import SwiftUI
import UIKit

/// Anything unrecognised is `standard`.
enum IconButtonVariant: String {
  case standard
  case filled
  case tonal
  case outlined
}

/// `.controlSize` for the five sizes. `.extraLarge` is iOS 17+, so before it the top two
/// share `.large`.
///
/// `.controlSize` barely moves a symbol-only label's size, only the style's padding, corner
/// and press feedback, so each size also sets the symbol's point size.
enum IconButtonScale: String {
  case small
  case medium
  case large
  case xlarge
  case xxlarge

  var controlSize: ControlSize {
    switch self {
    case .small: return .mini
    case .medium: return .small
    case .large: return .regular
    case .xlarge: return .large
    case .xxlarge:
      if #available(iOS 17.0, *) {
        return .extraLarge
      }
      return .large
    }
  }

  /// Material's icon-button glyph sizes, the same numbers Android draws at. `medium` and
  /// `large` share 24: on Android they differ by container, which iOS does not have.
  var symbolPointSize: CGFloat {
    switch self {
    case .small: return 20
    case .medium, .large: return 24
    case .xlarge: return 32
    case .xxlarge: return 40
    }
  }
}

/// `square` is the nearest corner iOS has.
enum IconButtonShapeKind: String {
  case round
  case square

  /// The same radius as Button's `square`.
  static let squareCornerRadius: CGFloat = 8
}

final class IconButtonModel: NitroUiModel {
  /// The control's only name, and the Label's title.
  var accessibilityLabel: String = ""
  /// Only ever a name that resolves to an SF Symbol; the setter drops the rest.
  var systemImage: String?
  /// Stored, never drawn: iOS has no drawable to paint, and the prop is Android's.
  var androidIcon: String?
  var variant: IconButtonVariant = .standard
  var scale: IconButtonScale = .medium
  /// Stored, never applied: Material's width options have no iOS counterpart.
  var width: String = "uniform"
  var shape: IconButtonShapeKind = .round
  var disabled = false
  var tint: UIColor?
  var testID: String?
  /// The size configuration React sent; the engine reads it out of Fabric state,
  /// and the host only needs to hear that it changed.
  var sizingKey = ""

  /// Whether the control is a toggle. Derived in `afterUpdate()` from `defaultChecked`, which
  /// the wrapper sends as non-null exactly when the caller uses the toggle form.
  var isToggle = false
  /// Whether the 44 pt target is built by widening the label rather than by a hit layer
  /// behind the control. Only the press form's `standard` variant draws no container, so
  /// only there does widening the label not widen the artwork.
  var floorsLabel: Bool {
    return !isToggle && variant == .standard
  }

  /// The toggle's selection. The press form never reads it.
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultChecked: Bool?
  var didApplyDefault = false

  var onCheckedChange: ((_ checked: Bool, _ eventCount: Double) -> Void)?
  var onPress: (() -> Void)?

  /// Test-only read-outs. Plain storage behind a lock rather than published: the body writes
  /// `drawn`, and publishing from the body would request another update.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"
  /// What the glyph measures before the 44 pt target floor is applied, as `WxH`. Test-only:
  /// with the floor, several sizes lay out at the same box.
  private var artworkSize = "none"

  override init() {
    super.init()
  }

  /// Optimistic: the new value shows now, before React has seen the event.
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onCheckedChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes. Refused while disabled, as a tap is.
  func press() {
    guard !disabled else { return }
    if isToggle {
      userToggle(to: !state.displayed)
    } else {
      onPress?()
    }
  }

  /// Record what the drawing code was handed: `1`/`0` for a toggle, `none` for the
  /// press form, which has no selection.
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

  func recordArtworkSize(_ size: CGSize) {
    reportLock.lock()
    artworkSize = String(format: "%.2fx%.2f", size.width, size.height)
    reportLock.unlock()
  }

  /// `displayed=<0|1|none>;probes=<n>;a11y=<...>;control=<WxH>`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);a11y=\(accessibilityReport);"
      + "control=\(artworkSize)"
  }

  /// For recycling, so a reused view does not report the previous control's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    probes = 0
    accessibilityReport = "none"
    artworkSize = "none"
    reportLock.unlock()
  }
}

struct IconButtonContent: NitroUIContent {
  @ObservedObject private var model: IconButtonModel

  /// Apple's minimum tappable size, in points. A smaller glyph is drawn at its own size and
  /// centred inside the target.
  ///
  /// A frame alone does not grow the target: a SwiftUI `Button` hit-tests its own label and
  /// style, not the frame around it. Hence the two constructions below.
  private static let minimumTouchTarget: CGFloat = 44

  init(model: IconButtonModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-out below can be a statement: without it a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // Recorded where the control is drawn, so it is what the Toggle is handed rather than
    // what React sent.
    let drawn = model.isToggle ? (model.state.displayed ? "1" : "0") : "none"
    let _ = model.recordDrawn(drawn)
    if model.floorsLabel {
      // The label is already framed to the target, so the Button's hit area and its
      // accessibility element are the whole 44 pt box.
      styledControl
        .controlSize(model.scale.controlSize)
        .disabled(model.disabled)
        .modifier(OptionalIconButtonTint(color: model.tint))
    } else {
      // A drawn container keeps its own size, and the target is added behind it.
      targetLayered
    }
  }

  /// The control over a clear 44 pt hit layer, for the configurations that draw a bezel.
  ///
  /// The layer goes behind the control: in front it would swallow the taps the style answers,
  /// and the control would stop looking pressed. `contentShape` makes the clear view
  /// hit-testable, and its tap runs the same `press()` as the control's own gesture.
  ///
  /// The layer is hidden from accessibility and the control keeps its own element. Combining
  /// the two into one 44 pt element leaves the name on both the box and the `Button`.
  private var targetLayered: some View {
    ZStack {
      Color.clear
        .frame(
          width: Self.minimumTouchTarget,
          height: Self.minimumTouchTarget
        )
        .contentShape(Rectangle())
        .onTapGesture { model.press() }
        .accessibilityHidden(true)
      styledControl
        .controlSize(model.scale.controlSize)
        .disabled(model.disabled)
        .modifier(OptionalIconButtonTint(color: model.tint))
    }
  }

  /// A `Button` answers `buttonStyle`, so `variant` maps onto four iOS button styles. A
  /// `Toggle` with `.toggleStyle(.button)` ignores `buttonStyle`: iOS gives it one look, a
  /// bordered box that fills with the tint while on.
  @ViewBuilder private var styledControl: some View {
    if model.isToggle {
      Toggle(
        isOn: Binding(
          get: { model.state.displayed },
          set: { requested in model.userToggle(to: requested) }
        )
      ) {
        label
      }
      .toggleStyle(.button)
    } else {
      switch model.variant {
      case .standard:
        // `.borderless` is the only iOS style that draws nothing behind the label.
        buttonControl.buttonStyle(.borderless)
      case .filled:
        buttonControl.buttonStyle(.borderedProminent).buttonBorderShape(borderShape)
      case .tonal:
        buttonControl.buttonStyle(.bordered).buttonBorderShape(borderShape)
      case .outlined:
        // iOS has no outlined button style: `.bordered` plus a hairline stroke.
        buttonControl
          .buttonStyle(.bordered)
          .buttonBorderShape(borderShape)
          .overlay(outline)
      }
    }
  }

  /// `.circle` is iOS 17+; before it the roundest shape is `.capsule`.
  private var borderShape: ButtonBorderShape {
    switch model.shape {
    case .round:
      if #available(iOS 17.0, *) {
        return .circle
      }
      return .capsule
    case .square:
      return .roundedRectangle(radius: IconButtonShapeKind.squareCornerRadius)
    }
  }

  /// The stroke follows `shape`, or a square control would show a capsule's corners.
  @ViewBuilder private var outline: some View {
    let stroke = AnyShapeStyle(Color(UIColor.separator))
    if model.shape == .square {
      RoundedRectangle(cornerRadius: IconButtonShapeKind.squareCornerRadius)
        .strokeBorder(stroke, lineWidth: 1)
    } else {
      Capsule().strokeBorder(stroke, lineWidth: 1)
    }
  }

  private var buttonControl: some View {
    Button(action: press) { label }
  }

  /// `.iconOnly` draws the icon and keeps the title as the element's accessibility name.
  @ViewBuilder private var label: some View {
    let glyph = Label {
      Text(model.accessibilityLabel)
    } icon: {
      if let systemImage = model.systemImage {
        // A symbol-only label does not follow `.controlSize`, so the glyph is sized by its
        // font. A `scaleEffect` would not change what is measured.
        Image(systemName: systemImage)
          .font(.system(size: model.scale.symbolPointSize))
      }
    }
    .labelStyle(.iconOnly)
    .background(IconButtonArtworkReader { size in model.recordArtworkSize(size) })

    // `minWidth`/`minHeight`, not a fixed frame: a glyph larger than the target must not be
    // clipped. `contentShape` makes the space around the artwork tappable.
    if model.floorsLabel {
      glyph
        .frame(
          minWidth: Self.minimumTouchTarget,
          minHeight: Self.minimumTouchTarget
        )
        .contentShape(Rectangle())
    } else {
      glyph
    }
  }

  private func press() {
    model.press()
  }
}

/// Reports the size of the view it is a `background` of. A `GeometryReader` in a background
/// is laid out at the primary view's size and proposes nothing back, so it cannot change
/// what it measures. The callback must store, never publish.
private struct IconButtonArtworkReader: View {
  let onMeasure: (CGSize) -> Void

  var body: some View {
    GeometryReader { proxy in
      // Stored during body evaluation rather than from `onAppear`/`onChange`, whose current
      // signatures are unavailable at the iOS 15.1 deployment target.
      let _ = onMeasure(proxy.size)
      Color.clear
    }
  }
}

/// `.tint()` has no "unset" form, so it is applied only when a colour is set.
private struct OptionalIconButtonTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

final class HybridNitroUiIconButton: HybridNitroUiIconButtonSpec, RecyclableView {
  private let host: NitroSwiftUIHost<IconButtonContent>

  /// Guards `pixelProbes`, which a probe writes on main and a report reads from
  /// whichever thread Nitro called.
  private let pixelProbesLock = NSLock()

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiIconButton"

  /// In points. The 44 pt touch-target floor is larger than every glyph, so this holds for
  /// every size.
  private static let fallbackSize = (width: 44.0, height: 44.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// shadow node before it creates any view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: IconButtonModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // An IconButton presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<IconButtonContent> {
    return host
  }

  private var model: IconButtonModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var accessibilityLabel: String {
    get { model.accessibilityLabel }
    set {
      guard newValue != model.accessibilityLabel else { return }
      model.accessibilityLabel = newValue
      // The title is the element's name and `.iconOnly` shows none of it: a repaint only.
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
      // A different symbol is a different box.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var androidIcon: Variant_NullType_String {
    get { model.androidIcon.map { .second($0) } ?? .first(.null) }
    set {
      // Stored, never drawn, so no `markDirty()`.
      model.androidIcon = newValue.asType(String.self)
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      let next = IconButtonVariant(rawValue: newValue) ?? .standard
      guard next != model.variant else { return }
      model.variant = next
      host.markDirty()
      // `.borderless` and `.bordered` pad differently, so the box moves with it.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var size: String {
    get { model.scale.rawValue }
    set {
      let next = IconButtonScale(rawValue: newValue) ?? .medium
      guard next != model.scale else { return }
      model.scale = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var width: String {
    get { model.width }
    set {
      // Stored only: no iOS control gets wider from this.
      model.width = newValue
    }
  }

  var shape: String {
    get { model.shape.rawValue }
    set {
      let next = IconButtonShapeKind(rawValue: newValue) ?? .round
      guard next != model.shape else { return }
      model.shape = next
      // The corner is drawn, not measured: a circle and a rounded square at one
      // rung are the same box.
      host.markDirty()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled control is the same size.
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

  var checked: Variant_Bool_NullType {
    get {
      guard let js = model.state.js else { return .second(.null) }
      return .first(js)
    }
    set {
      let next = newValue.asType(Bool.self)
      // Not visual on its own: `displayed` follows in `afterUpdate()`, once the event count
      // says JS has caught up.
      model.state.js = next
    }
  }

  var defaultChecked: Variant_Bool_NullType {
    get {
      guard let value = model.defaultChecked else { return .second(.null) }
      return .first(value)
    }
    set {
      let next = newValue.asType(Bool.self)
      model.defaultChecked = next
      // Whether this is a toggle is decided in `afterUpdate()`, from this value.
      guard model.state.js == nil, !model.didApplyDefault, let seed = next else {
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

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: React Native already puts `testID` on the component view as
      // `accessibilityIdentifier`.
      model.testID = newValue.asType(String.self)
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

  var onPress: (() -> Void)? {
    get { model.onPress }
    set { model.onPress = newValue }
  }

  var onCheckedChange: ((Bool, Double) -> Void)? {
    get { model.onCheckedChange }
    set { model.onCheckedChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // Re-read every batch rather than latched in a setter, so a control that stops using the
    // toggle form becomes a `Button` again. The two forms differ in size as well as looks.
    let isToggle = model.defaultChecked != nil
    if isToggle != model.isToggle {
      model.isToggle = isToggle
      if !isToggle {
        // Otherwise a control that returns to the toggle form would show its previous
        // selection.
        model.state = NitroUiControlledValue<Bool>(displayed: false)
        model.didApplyDefault = false
      }
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
    // The event counts decide whether React's `checked` wins over what the user just did.
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.accessibilityLabel = ""
    model.systemImage = nil
    model.androidIcon = nil
    model.variant = .standard
    model.scale = .medium
    model.width = "uniform"
    model.shape = .round
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.sizingKey = ""
    model.isToggle = false
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultChecked = nil
    model.didApplyDefault = false
    model.onCheckedChange = nil
    model.onPress = nil
    model.clearReports()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onCheckedChange = nil
    model.onPress = nil
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiIconButtonSize {
    guard let size = host.contentSize else {
      return NitroUiIconButtonSize(width: 0, height: 0)
    }
    return NitroUiIconButtonSize(width: Double(size.width), height: Double(size.height))
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
