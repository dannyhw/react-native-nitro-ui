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
  /// What the last pixel probe saw, as one line. Written on main, read from the JS thread.
  private let pixelReportLock = NSLock()
  private var pixelReport = ""
  private var pixelProbes = 0

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

  /// Store one pixel probe's answer, numbered so a test can tell its own from the last one's.
  func publishPixelReport(_ report: String) {
    pixelReportLock.lock()
    pixelProbes += 1
    pixelReport = "n=\(pixelProbes) \(report)"
    pixelReportLock.unlock()
  }

  func readPixelReport() -> String {
    pixelReportLock.lock()
    defer { pixelReportLock.unlock() }
    return pixelReport
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
    pixelReportLock.lock()
    pixelReport = ""
    pixelProbes = 0
    pixelReportLock.unlock()
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
      .modifier(
        ChipDisabledFill(
          selected: model.state.displayed, disabled: model.disabled, label: label
        )
      )
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

/// How far a disabled selected chip fades, and how much of the tint survives the fade. More tint
/// than this paints the chip darker than the enabled one.
private let nitroUiChipDisabledFade = 0.55
private let nitroUiChipDisabledTint = 0.09

/// SwiftUI's disabled bordered style drops a toggle's selected fill, so a dimmed selected chip lays
/// one back: the bordered style's tint faded toward the system background colour, which is lighter
/// and paler than the enabled fill and never the grey of a disabled unselected chip.
private struct ChipDisabledFill<Label: View>: ViewModifier {
  let selected: Bool
  let disabled: Bool
  let label: Label

  func body(content: Content) -> some View {
    // The modifier's shape around the control is the same in every state, so a chip that becomes
    // disabled keeps one view and its VoiceOver focus with it.
    content.overlay {
      if selected && disabled {
        // The strength is on the shapes: `Color.opacity(_:)` reaches a UIKit host without its hue.
        ZStack {
          Capsule()
            .fill(Color(uiColor: .systemBackground))
            .opacity(nitroUiChipDisabledFade)
          Capsule()
            .fill(.tint)
            .opacity(nitroUiChipDisabledTint)
        }
        // The fade stops at the label, so a dimmed chip's text keeps the strength of an unselected
        // one's. The cut is the label's own shape at full strength, so the disabled style's faded
        // ink cannot cut a faded hole.
        .mask(alignment: .center) {
          Rectangle()
            .fill(.white)
            .overlay(alignment: .center) {
              label
                .foregroundStyle(.white)
                .environment(\.isEnabled, true)
                .blendMode(.destinationOut)
            }
            .compositingGroup()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
      }
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

  /// Sample what this chip is drawing, and keep the answer for `nuiTestPixelReport()`.
  /// Posted to main instead of blocking: reading pixels needs the layer rendered, and a Nitro
  /// method must not block on main.
  func nuiTestPixelProbe(color: Double) throws {
    let run = { [weak self] in
      guard let self else { return }
      self.model.publishPixelReport(nitroUiSampleChipDrawing(of: self.host, for: color))
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async(execute: run)
    }
  }

  func nuiTestPixelReport() throws -> String {
    return host.model.readPixelReport()
  }
}

/// How far a pixel may sit from the colour a probe asked for and still count as that colour.
/// A chip's fill is translucent and its label is anti-aliased, so a drawn pixel is close to a
/// colour, rarely exactly it.
private let nitroUiChipPixelBudget = 30

/// What the pixels `view` is drawing say about `color`, as one line: the share painted in it,
/// the mean colour of the box and the pixel nearest the asked-for one. `afterScreenUpdates:
/// true` reads what is on screen rather than the layer tree at the start of the transaction.
/// The capture is composited over the light page colour, which makes every pixel final: the
/// chip is translucent over that page in the app too, and two chips are only comparable if the
/// backdrop behind them is the same.
private func nitroUiSampleChipDrawing(of view: UIView, for color: Double) -> String {
  let bounds = view.bounds
  guard bounds.width >= 2, bounds.height >= 2 else {
    return "n=0 size=\(Int(bounds.width))x\(Int(bounds.height)) no pixels"
  }
  let image = UIGraphicsImageRenderer(bounds: bounds).image { _ in
    view.drawHierarchy(in: bounds, afterScreenUpdates: true)
  }
  guard let bitmap = image.cgImage else {
    return "n=0 size=\(Int(bounds.width))x\(Int(bounds.height)) no image"
  }
  let width = bitmap.width, height = bitmap.height
  let bytesPerRow = 4 * width
  var data = [UInt8](repeating: 0, count: bytesPerRow * height)
  guard
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: &data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else {
    return "n=0 size=\(Int(bounds.width))x\(Int(bounds.height)) no context"
  }
  context.setFillColor(UIColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
  // The red/green/blue of an ARGB `processColor` int. Only the low 32 bits matter.
  guard color.isFinite, color >= -2_147_483_648, color <= 4_294_967_295 else {
    return "n=0 size=\(Int(bounds.width))x\(Int(bounds.height)) no colour"
  }
  let argb = UInt32(truncatingIfNeeded: Int64(color))
  let wanted = (
    red: Int((argb >> 16) & 0xff), green: Int((argb >> 8) & 0xff), blue: Int(argb & 0xff)
  )
  var hits = 0
  var redSum = 0, greenSum = 0, blueSum = 0
  var closest = (distance: Int.max, red: 0, green: 0, blue: 0)
  for row in 0..<height {
    for column in 0..<width {
      let offset = row * bytesPerRow + column * 4
      // Every pixel is opaque after the backdrop, so the channels are final.
      let red = Int(data[offset]), green = Int(data[offset + 1]), blue = Int(data[offset + 2])
      redSum += red
      greenSum += green
      blueSum += blue
      let distance = abs(red - wanted.red) + abs(green - wanted.green) + abs(blue - wanted.blue)
      if distance <= nitroUiChipPixelBudget {
        hits += 1
      }
      if distance < closest.distance {
        closest = (distance, red, green, blue)
      }
    }
  }
  let area = width * height
  // Same arithmetic as Android's pixel probe, so `mean` is comparable across platforms.
  let mean = (redSum / area) << 16 | (greenSum / area) << 8 | blueSum / area
  return String(
    format: "size=\(Int(bounds.width))x\(Int(bounds.height)) want=#%02X%02X%02X hits=\(hits) "
      + "mean=#%06X closest=#%02X%02X%02X",
    wanted.red, wanted.green, wanted.blue, mean, closest.red, closest.green, closest.blue
  )
}
