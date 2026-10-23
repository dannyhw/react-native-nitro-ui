//
//  HybridNitroUiButton.swift
//  react-native-nitro-ui
//
//  The Button component: SwiftUI `Button` with a `.buttonStyle(...)` per variant,
//  on the core runtime. Structure is Switch's (`HybridNitroUiSwitch.swift`); what
//  is new here is that the control's *size* comes from its props, which is the
//  one thing the core runtime has to be told about - see the setters'
//  `noteContentSizeMayHaveChanged()` calls and `docs/architecture/sizing.md` §7.
//

import NitroModules
import SwiftUI
import UIKit

/// The five roles, named after the Material 3 components the brief maps them to.
///
/// iOS has no outlined and no elevated button style, so two of these share a
/// style with another (`docs/components/button.md` has the table and the reason).
enum ButtonVariant: String {
  case filled
  case tonal
  case outlined
  case text
  case elevated
}

/// `.controlSize` for the `small` / `medium` / `large` JS values.
enum ButtonScale: String {
  case small
  case medium
  case large

  var controlSize: ControlSize {
    switch self {
    case .small: return .small
    case .medium: return .regular
    case .large: return .large
    }
  }
}

/// State of one Button. See ``NitroUiModel`` for why this is not `@Published`.
final class ButtonModel: NitroUiModel {
  var title: String = ""
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var disabled = false
  var tint: UIColor?
  /// A symbol name that resolved to an actual SF Symbol. `nuiSystemImage` may
  /// hold a name that does not; the setter decides, so the content never renders
  /// the "missing symbol" placeholder and never resizes after the fact.
  var systemImage: String?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent. The sizing engine reads the key out of
  /// Fabric state itself; the host only needs to hear that it changed (see
  /// ``NitroSwiftUIHost/noteSizingKeyChanged()``).
  var sizingKey = ""
  /// `onPress`, wired through a stable JS callback.
  var onPress: (() -> Void)?

  override init() {
    super.init()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct ButtonContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: ButtonModel

  init(model: ButtonModel) {
    self.model = model
  }

  var body: some View {
    // The style is the one thing that cannot be a runtime value: `buttonStyle`
    // takes a concrete `PrimitiveButtonStyle`, so the switch picks the branch.
    // Everything that applies to every variant stays *outside* it, so a variant
    // change costs one style and not a different set of modifiers.
    styledControl
      .controlSize(model.scale.controlSize)
      .disabled(model.disabled)
      .modifier(OptionalTint(color: model.tint))
      .modifier(OptionalAccessibility(label: model.accessibilityLabel))
  }

  @ViewBuilder private var styledControl: some View {
    switch model.variant {
    case .filled:
      control.buttonStyle(.borderedProminent)
    case .tonal:
      control.buttonStyle(.bordered)
    case .outlined:
      // iOS has no outlined button style. `.bordered` plus a hairline stroke is
      // the idiomatic shape (a 1 pt stroke around a capsule); the stroke uses the
      // system separator colour so it reads as an outline in both appearances,
      // and `.tint()` still colours the label - documented, not faked in.
      control
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .overlay(
          Capsule()
            .strokeBorder(Color(UIColor.separator), lineWidth: 1)
        )
    case .text:
      control.buttonStyle(.borderless)
    case .elevated:
      // iOS has no elevated button style either. `.borderedProminent` is what the
      // brief maps it to and what an iOS user reads as "the primary action",
      // which is what `elevated` means in Material. Same control as `filled`
      // here; the platforms differ, and that is the documented mapping.
      control.buttonStyle(.borderedProminent)
    }
  }

  private var control: some View {
    Button(action: press) { label }
  }

  /// The label. One line, tail-truncated: the control's intrinsic width is the
  /// title's width, and a caller who wants a narrower box gives it a `width` -
  /// then the label truncates instead of painting outside its box.
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

  /// A tap. Nothing to reconcile: a press is a gesture, not a value React owns.
  private func press() {
    model.onPress?()
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
/// For `.borderedProminent` that is the container colour; for the other styles it
/// colours the label (and `.bordered` tints its background too).
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

/// An empty `accessibilityLabel(_:)` would silence the Button's own label - which
/// is its title - so it is applied only when set. `testID` deliberately does *not*
/// go in here: RN already puts it on the component view, and putting it on the
/// SwiftUI element too would make the view match a testID query twice.
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

/// The Hybrid View React renders as `NitroUiButton`.
final class HybridNitroUiButton: HybridNitroUiButtonSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ButtonContent>

  /// This component's name in the sizing engine: `HybridNitroUiButtonComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiButton"

  /// The size to lay a Button out with before anything has been measured, in
  /// points.
  ///
  /// A Button has *many* configurations (title, variant, size, symbol), while the
  /// engine's fallback is keyed by component alone (`NitroUiSizing::setFallback`),
  /// so this can only be one number: this OS's medium filled button with a
  /// six-letter title. Every other configuration is a first instance of its own
  /// configuration and gets corrected the same turn it measures
  /// (`docs/architecture/sizing.md` §9 - "a text-sized control's first frame of a
  /// new string is its own problem").
  ///
  /// Measured on iOS 27 (iPhone Air simulator), rounded up to the point: medium +
  /// filled + "Cancel" is 76.7 x 34.3 pt. Rounded *up* rather than to nearest on
  /// purpose - a fallback smaller than the control makes SwiftUI paint outside its
  /// box (`core.md` §7), and a rounded-down height also shifts the row. The height
  /// is the part worth getting right: this OS's medium control is 34.3 pt tall at
  /// any title, while the width moves with the string (4-letter 61.0, 6-letter
  /// 76.7, 8-letter 92.7), so a wrong width costs a row's worth of horizontal
  /// gap and a wrong height costs every row. `docs/components/button.md` has the
  /// variant x size table this came from.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process
  /// (the static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a Button's shadow node before it creates any Button
  /// view, so a fallback declared from `init` is one measure too late for the
  /// first instance (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The declared fallback - see ``declaresFallback``.
  private static let fallbackSize = (width: 77.0, height: 35.0)

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: ButtonModel())
    super.init()
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A Button presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before a Button can be measured, and a
    // host built without that table still gets its fallback here.
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
      // A different string is a different width, and nothing else will notice:
      // no bounds change and no trait change is coming. `noteContentSizeMayHaveChanged`
      // is the half that asks for a new measure; `markDirty` alone would repaint
      // at the old size and leave Yoga told the old width.
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
      // Only a name that resolves to a symbol reaches the content: an unknown
      // name would render a placeholder glyph, resize on the next commit, and
      // announce itself as nonsense to VoiceOver.
      model.systemImage = next.flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. It stays in the spec because Android needs it
      // as a `tag`.
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
      // needs a commit or a late-set label never reaches VoiceOver.
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
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback; the new configuration may measure exactly what the old
      // one did, and that is the size the host's dedupe would swallow the correcting
      // report against (review F1). Guarded, because React re-sends an unchanged key
      // on every render and the reset costs a measure.
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
    // No controlled value, so nothing to reconcile: one commit per React commit
    // (`docs/architecture/core.md` §12).
    host.commit()
  }

  func prepareForRecycle() {
    model.title = ""
    model.variant = .filled
    model.scale = .medium
    model.disabled = false
    model.tint = nil
    model.systemImage = nil
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

  /// The size SwiftUI wants for this Button, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiButtonSize {
    guard let size = host.contentSize else {
      return NitroUiButtonSize(width: 0, height: 0)
    }
    return NitroUiButtonSize(width: Double(size.width), height: Double(size.height))
  }
}
