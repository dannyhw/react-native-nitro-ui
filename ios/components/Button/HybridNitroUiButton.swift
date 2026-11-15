// The Button component: a SwiftUI `Button` with a `.buttonStyle(...)` per variant.

import NitroModules
import SwiftUI
import UIKit

/// iOS has no outlined and no elevated button style, so two of these share a style with
/// another.
enum ButtonVariant: String {
  case filled
  case tonal
  case outlined
  case text
  case elevated
}

/// `.controlSize` for the five sizes. iOS has four usable values (`.extraLarge` is iOS 17+),
/// so `xlarge` and `xxlarge` share the largest.
enum ButtonScale: String {
  case small
  case medium
  case large
  case xlarge
  case xxlarge

  var controlSize: ControlSize {
    switch self {
    case .small: return .small
    case .medium: return .regular
    case .large: return .large
    case .xlarge, .xxlarge:
      if #available(iOS 17.0, *) {
        return .extraLarge
      }
      return .large
    }
  }
}

/// The button's corner. Every iOS button style draws a rounded corner, so `square` is the
/// nearest border shape iOS offers rather than a true square.
enum ButtonShape: String {
  case round
  case square

  /// iOS's own default corner for `.roundedRectangle`, in points.
  static let squareCornerRadius: CGFloat = 8
}

final class ButtonModel: NitroUiModel {
  var title: String = ""
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var shape: ButtonShape = .round
  var disabled = false
  var tint: UIColor?
  /// Only ever a name that resolves to an SF Symbol; the setter drops the rest.
  var systemImage: String?

  /// The Android drawable name. Stored so the getter answers; never drawn on iOS.
  var androidIcon: String?
  var testID: String?
  var accessibilityLabel: String?
  /// The sizing engine reads the key from Fabric state; the host only needs to hear that it
  /// changed.
  var sizingKey = ""
  var onPress: (() -> Void)?

  override init() {
    super.init()
  }
}

struct ButtonContent: NitroUIContent {
  @ObservedObject private var model: ButtonModel

  init(model: ButtonModel) {
    self.model = model
  }

  var body: some View {
    // `buttonStyle` takes a concrete style type, so the variant is a switch. Modifiers that
    // apply to every variant stay outside it.
    styledControl
      .controlSize(model.scale.controlSize)
      .disabled(model.disabled)
      .modifier(OptionalTint(color: model.tint))
      .modifier(OptionalAccessibility(label: model.accessibilityLabel))
  }

  @ViewBuilder private var styledControl: some View {
    switch model.variant {
    case .filled:
      control.buttonStyle(.borderedProminent).buttonBorderShape(borderShape)
    case .tonal:
      control.buttonStyle(.bordered).buttonBorderShape(borderShape)
    case .outlined:
      // iOS has no outlined button style: `.bordered` plus a hairline stroke in the separator
      // colour. The stroke follows `shape`, or a square button would show a capsule's corners.
      control
        .buttonStyle(.bordered)
        .buttonBorderShape(borderShape)
        .overlay(outline)
    case .text:
      // `.borderless` draws no border, so `shape` has nothing to act on.
      control.buttonStyle(.borderless)
    case .elevated:
      // iOS has no elevated button style; `.borderedProminent` reads as the primary action.
      control.buttonStyle(.borderedProminent).buttonBorderShape(borderShape)
    }
  }

  /// `.round` keeps each variant's own default corner.
  private var borderShape: ButtonBorderShape {
    switch (model.shape, model.variant) {
    case (.round, .outlined): return .capsule
    case (.round, _): return .automatic
    case (.square, _): return .roundedRectangle(radius: ButtonShape.squareCornerRadius)
    }
  }

  @ViewBuilder private var outline: some View {
    let stroke = AnyShapeStyle(Color(UIColor.separator))
    if model.shape == .square {
      RoundedRectangle(cornerRadius: ButtonShape.squareCornerRadius)
        .strokeBorder(stroke, lineWidth: 1)
    } else {
      Capsule().strokeBorder(stroke, lineWidth: 1)
    }
  }

  private var control: some View {
    Button(action: press) { label }
  }

  /// One line, tail-truncated: in a box narrower than the title, the label truncates instead
  /// of painting outside it.
  @ViewBuilder private var label: some View {
    if let systemImage = model.systemImage {
      Label {
        Text(model.title).lineLimit(1)
      } icon: {
        Image(systemName: systemImage)
      }
      .labelStyle(.titleAndIcon)
    } else {
      Text(model.title)
        .lineLimit(1)
    }
  }

  private func press() {
    model.onPress?()
  }
}

/// `.tint()` has no "unset" form, so it is applied only when a colour is set.
private struct OptionalTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the Button's own label (its title), so it
/// is applied only when set. `testID` is not applied here: React Native already puts it on
/// the component view, and a second copy would match a testID query twice.
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

final class HybridNitroUiButton: HybridNitroUiButtonSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ButtonContent>

  /// Guards `pixelProbes`, which a probe writes on main and a report reads from
  /// whichever thread Nitro called.
  private let pixelProbesLock = NSLock()

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiButton"

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// Button's shadow node before it creates any Button view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// In points. The engine keeps one fallback per component, so this is a medium filled
  /// button with a six-letter title, rounded up: a fallback smaller than the control makes
  /// SwiftUI paint outside its box.
  private static let fallbackSize = (width: 77.0, height: 35.0)

  override init() {
    host = NitroSwiftUIHost(model: ButtonModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A Button presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<ButtonContent> {
    return host
  }

  // MARK: - Props

  private var model: ButtonModel {
    return host.model
  }

  var title: String {
    get { model.title }
    set {
      guard newValue != model.title else { return }
      model.title = newValue
      host.markDirty()
      // A different string is a different width, and no bounds or trait change follows to
      // trigger a new measure.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      let next = ButtonVariant(rawValue: newValue) ?? .filled
      guard next != model.variant else { return }
      model.variant = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var size: String {
    get { model.scale.rawValue }
    set {
      let next = ButtonScale(rawValue: newValue) ?? .medium
      guard next != model.scale else { return }
      model.scale = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var shape: String {
    get { model.shape.rawValue }
    set {
      let next = ButtonShape(rawValue: newValue) ?? .round
      guard next != model.shape else { return }
      model.shape = next
      // Repaints only: a border shape is not a layout input.
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

  var systemImage: Variant_NullType_String {
    get { model.systemImage.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.systemImage else { return }
      // An unknown name would render a placeholder glyph, so only a name that resolves is kept.
      model.systemImage = next.flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
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
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // The label is on the SwiftUI element, so it needs a commit to reach VoiceOver.
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
      // A new key may measure exactly what the old one did, and the host would drop that
      // report as a duplicate. Guarded, because React re-sends an unchanged key every render.
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

  // MARK: - Lifecycle

  func afterUpdate() {
    host.commit()
  }

  func prepareForRecycle() {
    model.title = ""
    model.variant = .filled
    model.scale = .medium
    model.shape = .round
    model.disabled = false
    model.tint = nil
    model.systemImage = nil
    model.androidIcon = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onPress = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onPress = nil
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiButtonSize {
    guard let size = host.contentSize else {
      return NitroUiButtonSize(width: 0, height: 0)
    }
    return NitroUiButtonSize(width: Double(size.width), height: Double(size.height))
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
