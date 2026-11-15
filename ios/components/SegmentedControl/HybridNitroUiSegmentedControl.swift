// The SegmentedControl component: a SwiftUI `Picker` with `.pickerStyle(.segmented)`.

import NitroModules
import SwiftUI
import UIKit

final class SegmentedControlModel: NitroUiModel {
  var options: [String] = []
  /// The selected index, behind the event-count handshake. A `Double` because it is stored raw as
  /// React sent it: `options` may arrive later in the same batch, so `afterUpdate()` normalises it
  /// against them.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed. Applied once, in `afterUpdate()`.
  var defaultSelectedIndex: Double = 0
  var didApplyDefault = false
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent. The sizing engine takes the key from Fabric state; the host
  /// only needs to hear that it changed.
  var sizingKey = ""
  var onChange: ((_ index: Double, _ eventCount: Double) -> Void)?

  override init() {
    super.init()
  }

  // MARK: - Pixel probe (test-only)

  /// What the last pixel probe saw, as one line. Written on main, read from the JS thread, so it is
  /// lock-guarded and never published.
  private var pixelReport = ""
  /// How many reports have been made, so a test can tell a fresh one from a repeat.
  private var pixelProbes = 0
  private let pixelReportLock = NSLock()

  /// Store what a probe found. Safe from any thread.
  func publishPixelReport(_ report: String) {
    pixelReportLock.lock()
    pixelProbes += 1
    pixelReport = "n=\(pixelProbes) \(report)"
    pixelReportLock.unlock()
  }

  /// The last probe's report. Safe from any thread.
  func readPixelReport() -> String {
    pixelReportLock.lock()
    defer { pixelReportLock.unlock() }
    return pixelReport
  }

  /// What the row of segments last drew as its selection: `displayed=<index>`, or `displayed=none`
  /// before the body has run. Written from the body, so it reports the hosted control and not the
  /// `selectedIndex` prop.
  private var drawnIndexReport = "displayed=none"

  /// Record what the drawing code was handed. Never `@Published`: publishing from the body would
  /// ask for the update that has just happened.
  func recordDrawnIndex(_ index: Int) {
    pixelReportLock.lock()
    drawnIndexReport = "displayed=\(index)"
    pixelReportLock.unlock()
  }

  /// What the row displays, as one line. Safe from any thread.
  func readDrawnIndex() -> String {
    pixelReportLock.lock()
    defer { pixelReportLock.unlock() }
    return drawnIndexReport
  }

  /// Forget the last probe, so a recycled view does not report another owner's pixels.
  func clearPixelReport() {
    pixelReportLock.lock()
    pixelReport = ""
    pixelReportLock.unlock()
  }

  /// Forget the last drawn index, for recycling.
  func clearDrawnIndex() {
    pixelReportLock.lock()
    drawnIndexReport = "displayed=none"
    pixelReportLock.unlock()
  }

  /// A segment index that exists in `options`, as a whole number in range. `options` and the
  /// selection arrive in one batch in no particular order, so this runs in `afterUpdate()`. A
  /// non-number goes to the first segment, a number past the end to the last.
  static func clamp(_ index: Double, to optionCount: Int) -> Double {
    guard optionCount > 0, index.isFinite else {
      return 0
    }
    let rounded = index.rounded(.down)
    if rounded < 0 {
      return 0
    }
    return rounded > Double(optionCount - 1) ? Double(optionCount - 1) : rounded
  }
}

struct SegmentedControlContent: NitroUIContent {
  @ObservedObject private var model: SegmentedControlModel

  init(model: SegmentedControlModel) {
    self.model = model
  }

  var body: some View {
    // Test read-out of the selection handed to the `Picker` (the same expression as the binding
    // below). The explicit `return` is what lets these statements sit in the body.
    let drawn = Int(model.state.displayed)
    model.recordDrawnIndex(drawn)

    return Picker(selection: selection) {
      // `id: \.offset` and the index as `tag`, not the label: two options may carry the same text.
      ForEach(Array(model.options.enumerated()), id: \.offset) { index, label in
        Text(label)
          .tag(index)
      }
    } label: {
      // A `Picker` always takes a label argument; this style draws none.
      EmptyView()
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .disabled(model.disabled)
    .modifier(OptionalSegmentedTint(color: model.tint))
    .modifier(OptionalSegmentedAccessibility(label: model.accessibilityLabel))
  }

  /// The selection, native-owned and optimistic: the setter paints the new segment before JS has
  /// seen the event, then emits `(index, eventCount)`. If React disagrees, the handshake reverts
  /// `displayed`.
  private var selection: Binding<Int> {
    Binding(
      get: { Int(model.state.displayed) },
      set: { requested in
        let eventCount = model.state.user(Double(requested))
        model.objectWillChange.send()
        model.onChange?(Double(requested), Double(eventCount))
      }
    )
  }
}

/// `.tint()` has no "unset" form, so it is applied only when set. On a segmented `Picker` a
/// per-instance `.tint(_:)` has no visible effect on iOS 27. Writing `selectedSegmentTintColor` on
/// the underlying `UISegmentedControl` paints the segment, but the colour is lost on the first
/// change of selection, so that workaround is not used.
private struct OptionalSegmentedTint: ViewModifier {
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

/// An empty `accessibilityLabel(_:)` would silence the segments' own labels, so it is applied only
/// when set. `testID` is not applied here: RN already puts it on the component view, and a second
/// copy would match a testID query twice.
private struct OptionalSegmentedAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

final class HybridNitroUiSegmentedControl: HybridNitroUiSegmentedControlSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SegmentedControlContent>

  /// This component's name in the sizing engine. Must match
  /// `HybridNitroUiSegmentedControlComponentName` in the generated C++ and `getName()` in the
  /// generated Kotlin.
  private static let sizingComponentName = "NitroUiSegmentedControl"

  /// The size to lay a SegmentedControl out with before anything has been measured, in points:
  /// three short segments at the regular control size. One number for every option list, because
  /// the engine keys fallbacks by component alone. The height (31 pt) holds for any option list; a
  /// wrong width costs a cold configuration one frame.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process. Called at startup,
  /// because Fabric measures a shadow node before it creates the view; `init` calls it again as a
  /// backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  private static let fallbackSize = (width: 165.0, height: 31.0)

  override init() {
    host = NitroSwiftUIHost(model: SegmentedControlModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A segmented control presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    // Backstop: startup normally registers this before one can be measured.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<SegmentedControlContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var options: [String] {
    get { model.options }
    set {
      guard newValue != model.options else { return }
      model.options = newValue
      host.markDirty()
      // The labels are the control's width, and no bounds or trait change will say so.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var selectedIndex: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      // The normalised index, not the number React sent.
      return .second(SegmentedControlModel.clamp(js, to: model.options.count))
    }
    set {
      // Not visual on its own: `displayed` follows only once the event count says JS has caught up,
      // and the index only means something once `options` is known. Both happen in `afterUpdate()`.
      model.state.js = newValue.asType(Double.self)
    }
  }

  var defaultSelectedIndex: Double {
    get { model.defaultSelectedIndex }
    set {
      // Stored raw: `options` may arrive after it in the same batch.
      model.defaultSelectedIndex = newValue
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
      // Rendered, so it needs a commit: the label is on the hosted element.
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
      // that report away. Guarded, because React re-sends an unchanged key on every render and the
      // reset costs a measure.
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onValueChange: ((_ index: Double, _ eventCount: Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    let optionCount = model.options.count
    // `options`, `selectedIndex` and `defaultSelectedIndex` can land in one batch in any order, so
    // none is interpreted until the batch is complete.
    if let js = model.state.js {
      let clamped = SegmentedControlModel.clamp(js, to: optionCount)
      if clamped != js { model.state.js = clamped }
    }
    if model.state.js == nil, !model.didApplyDefault, optionCount > 0 {
      model.didApplyDefault = true
      let seeded = SegmentedControlModel.clamp(model.defaultSelectedIndex, to: optionCount)
      if seeded != model.state.displayed {
        model.state.displayed = seeded
        host.markDirty()
      }
    }
    // The event-count handshake decides whether React's index wins over what the user just tapped,
    // including a change JS rejected.
    if model.state.reconcile() {
      host.markDirty()
    }
    // An option list that shrank can leave the shown index past the end.
    let shown = SegmentedControlModel.clamp(model.state.displayed, to: optionCount)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.options = []
    model.clearPixelReport()
    model.clearDrawnIndex()
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.defaultSelectedIndex = 0
    model.didApplyDefault = false
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this control, from the host's cache. Can be called from the JS
  /// thread, so it must not measure SwiftUI, which is main-thread only.
  func measureContent() throws -> NitroUiSegmentedControlSize {
    guard let size = host.contentSize else {
      return NitroUiSegmentedControlSize(width: 0, height: 0)
    }
    return NitroUiSegmentedControlSize(width: Double(size.width), height: Double(size.height))
  }

  private var model: SegmentedControlModel {
    return host.model
  }
}

// MARK: - Pixel probe (test-only)

extension HybridNitroUiSegmentedControl {
  /// Count the pixels this control draws that are `color`, and store the answer for
  /// `nuiTestPixelReport()`. Posted to main instead of blocking: reading pixels needs the layer
  /// rendered, and a Nitro method must not block on main.
  func nuiTestPixelProbe(color: Double) throws {
    let run = { [weak self] in
      guard let self else { return }
      self.model.publishPixelReport(nitroUiSamplePixels(of: self.host, for: color))
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async(execute: run)
    }
  }

  func nuiTestPixelReport() throws -> String {
    return model.readPixelReport()
  }

  func nuiTestDisplayedIndex() throws -> String {
    return model.readDrawnIndex()
  }
}

/// Per-channel-sum budget for "this pixel is the colour". The selected capsule is composited over
/// the material behind it, so a sampled pixel is close to the requested colour, rarely exactly it.
private let nitroUiPixelTolerance = 30

/// The red/green/blue of an ARGB `processColor` int, 0…255, or nil for "no colour". Only the low 32
/// bits matter (see `UIColor.init(nitroUiARGB:)`).
private func nitroUiARGBChannels(_ value: Double) -> (red: Int, green: Int, blue: Int)? {
  guard value.isFinite, value >= -2_147_483_648, value <= 4_294_967_295 else {
    return nil
  }
  let argb = UInt32(truncatingIfNeeded: Int64(value))
  return (
    Int((argb >> 16) & 0xff), Int((argb >> 8) & 0xff), Int(argb & 0xff)
  )
}

/// What the pixels `view` is drawing say about `color`, as one line. `afterScreenUpdates: true`
/// reads what is on screen rather than the layer tree at the start of the transaction.
private func nitroUiSamplePixels(of view: UIView, for color: Double) -> String {
  let bounds = view.bounds
  guard let target = nitroUiARGBChannels(color) else {
    return "n=0 no colour"
  }
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
  // On iOS 26+ the selected segment is translucent glass and its fill is lost when captured alone,
  // so composite over a neutral mid grey first to make every pixel opaque and comparable.
  context.setFillColor(UIColor(white: 0.5, alpha: 1).cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
  var hits = 0
  var redSum = 0, greenSum = 0, blueSum = 0
  var closest = (distance: Int.max, red: 0, green: 0, blue: 0)
  for row in 0..<height {
    for column in 0..<width {
      let offset = row * bytesPerRow + column * 4
      // Every pixel is opaque after the backdrop, so the channels are final: sum them as they are.
      let red = Int(data[offset]), green = Int(data[offset + 1]), blue = Int(data[offset + 2])
      redSum += red
      greenSum += green
      blueSum += blue
      let distance =
        abs(red - target.red) + abs(green - target.green) + abs(blue - target.blue)
      if distance <= nitroUiPixelTolerance {
        hits += 1
      }
      if distance < closest.distance {
        closest = (distance, red, green, blue)
      }
    }
  }
  let area = width * height
  // Same arithmetic as Android's `nitroUiSamplePixels`, so `mean` is comparable across platforms.
  let mean = (redSum / area) << 16 | (greenSum / area) << 8 | blueSum / area
  return String(
    format: "size=%dx%d want=#%02X%02X%02X hits=%d mean=#%06X closest=#%02X%02X%02X",
    Int(bounds.width), Int(bounds.height), target.red, target.green, target.blue,
    hits, mean, closest.red, closest.green, closest.blue
  )
}
