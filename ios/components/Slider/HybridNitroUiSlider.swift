// The Slider component: SwiftUI's `Slider`, with the drag owned natively. The value rules
// live in `NitroUiSliderValue.swift`; this file decides when a value is reported.

import NitroModules
import SwiftUI
import UIKit

/// `CADisplayLink` retains its target, so the target is this proxy, which holds the pump
/// weakly: a link that outlived its control must not keep the model and the view alive.
private final class NitroUiFrameProxy: NSObject {
  private weak var pump: NitroUiFramePump?

  init(_ pump: NitroUiFramePump) {
    self.pump = pump
  }

  @objc func tick() {
    pump?.deliverFrame()
  }
}

/// Emits at most one `onValueChange` per display frame: touches sample faster than the
/// display draws, and every event is a JS call, a render and a props commit. The link exists
/// only while a drag is in flight.
///
/// It is scheduled for `.common` run loop modes: during a drag the run loop is in
/// `UITrackingRunLoopMode`, where a `.default` link does not fire.
private final class NitroUiFramePump {
  var onFrame: (() -> Void)?

  private var link: CADisplayLink?
  private var proxy: NitroUiFrameProxy?
  /// Whether the link is scheduled, copied behind a lock so it can be read off the main
  /// thread; `link` itself is main-thread-only.
  private var armed = false
  private let armedLock = NSLock()

  func start() {
    guard link == nil else { return }
    let proxy = NitroUiFrameProxy(self)
    let link = CADisplayLink(target: proxy, selector: #selector(NitroUiFrameProxy.tick))
    link.add(to: .main, forMode: .common)
    self.proxy = proxy
    self.link = link
    setArmed(true)
  }

  /// Whether a display link is scheduled for this control. The link is kept for the whole
  /// drag rather than armed per sample.
  var isArmed: Bool {
    armedLock.lock()
    defer { armedLock.unlock() }
    return armed
  }

  func stop() {
    link?.invalidate()
    link = nil
    proxy = nil
    setArmed(false)
  }

  fileprivate func deliverFrame() {
    onFrame?()
  }

  private func setArmed(_ value: Bool) {
    armedLock.lock()
    defer { armedLock.unlock() }
    armed = value
  }

  deinit {
    // The link retains the proxy, not the pump, so this can run while a link is still
    // ticking.
    link?.invalidate()
  }
}

final class SliderModel: NitroUiModel {
  var state = NitroUiControlledValue<Double>(displayed: 0)
  var minimumValue = 0.0
  var maximumValue = 1.0
  var step = 0.0
  var defaultValue: Double?
  var didApplyDefault = false
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// What VoiceOver reads as this control's value: the number itself, not a percentage,
  /// because the range is in the app's units. An integer drops its decimal point.
  var accessibilityValueText: String {
    let value = state.displayed
    if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
      return String(Int(value))
    }
    return String(value)
  }
  /// The element UIKit vends to a screen reader for this control. Weak: the view owns both
  /// the element and this model.
  weak var a11yElement: NitroUiSliderAccessibilityElement?

  /// `UIAccessibilityElement` stores its label, value and traits rather than asking for
  /// them, so they are pushed whenever one changes.
  func refreshAccessibility() {
    a11yElement?.refresh()
  }
  /// The size configuration React sent. Nothing native reads it.
  var sizingKey = ""
  var onChange: ((Double, Double) -> Void)?
  var onSlidingStart: ((Double, Double) -> Void)?
  var onSlidingComplete: ((Double, Double) -> Void)?

  // The un-emitted drag sample is `state.unreported`, so a React write cannot overtake a
  // value JS has not been told about. The `Binding` reads `state.displayed`, which a drag
  // writes at sample time, so a re-render mid-drag cannot show an older value.

  var dragging = false

  /// Bumped whenever an in-flight drag is abandoned, so work queued for that drag (a test
  /// drag's delayed moves) can recognise itself and stop.
  private(set) var dragGeneration = 0

  private let pump = NitroUiFramePump()
  /// What the last accessibility step probe did, as one line. The probe runs on main and a
  /// Nitro method may not block for main, so the result is stored here for JS to read.
  private var a11yStepReport = ""
  /// Numbers the reports. Same lock.
  private var a11yStepCount = 0
  private let a11yStepReportLock = NSLock()

  override init() {
    super.init()
    pump.onFrame = { [weak self] in
      self?.deliverUnreported()
    }
  }
}

// MARK: - Drag

extension SliderModel {
  func quantize(_ raw: Double) -> Double {
    return NitroUiSliderValue.quantize(raw: raw, minimum: minimumValue, maximum: maximumValue, step: step)
  }

  /// The range to hand the platform control. Always valid: a `ClosedRange` with inverted
  /// bounds traps at runtime, and a `maximumValue` below `minimumValue` is app data.
  var trackBounds: ClosedRange<Double> {
    guard minimumValue.isFinite, maximumValue.isFinite else {
      return 0...1
    }
    if maximumValue > minimumValue {
      return minimumValue...maximumValue
    }
    return Swift.min(minimumValue, maximumValue)...Swift.max(minimumValue, maximumValue)
  }

  /// Whether the platform control can draw this range's steps itself. Only when the range
  /// ends on a step: SwiftUI's `step:` stops at `minimum + n * step`, so otherwise the
  /// maximum would be unreachable. Other ranges stay continuous and are quantised here.
  var isStepped: Bool {
    guard let division = NitroUiSliderValue.division(minimum: minimumValue, maximum: maximumValue, step: step) else {
      return false
    }
    return division.endsOnStep && division.wholeSteps >= 1
  }

  /// A drag began. Idempotent: SwiftUI's `onEditingChanged(true)` and the first `Binding`
  /// write have no defined order.
  func beginDrag() {
    guard !dragging else { return }
    dragging = true
    pump.start()
    onSlidingStart?(state.displayed, Double(state.nativeEvents))
  }

  /// The finger moved: display at once, emit on the next frame. The quantised value is
  /// written now, so the thumb has no latency and a re-render reads the same value back.
  func drag(to raw: Double) {
    if !dragging {
      beginDrag()
    }
    state.displayed = quantize(raw)
    state.unreported = state.displayed
    refreshAccessibility()
    pump.start()
  }

  /// The finger lifted; the final value always reaches JS. Idempotent: only a drag that
  /// started may end, because SwiftUI's `onEditingChanged(false)` has no defined order with
  /// the `Binding` writes and may arrive more than once.
  func endDrag() {
    guard dragging else {
      return
    }
    deliverUnreported()
    dragging = false
    pump.stop()
    onSlidingComplete?(state.displayed, Double(state.nativeEvents))
  }

  /// Abandons an in-flight drag without reporting it: the view is being recycled or dropped,
  /// and its callbacks belong to the previous owner.
  func cancelDrag() {
    state.unreported = nil
    dragging = false
    pump.stop()
    dragGeneration += 1
    refreshAccessibility()
  }

  /// The next legal value above (or below) the one on screen.
  func stepped(from value: Double, up: Bool) -> Double {
    return NitroUiSliderValue.stepped(
      from: value,
      up: up,
      minimum: minimumValue,
      maximum: maximumValue,
      step: step
    )
  }

  /// A screen reader asked for the next value up or down. Emits one gesture's worth of
  /// callbacks (start, one change, complete), opened and closed here because SwiftUI does
  /// not wrap such a `Binding` write in an `onEditingChanged` pair.
  ///
  /// At a bound nothing is emitted. While a finger is on the track this is a sample of that
  /// drag, so the drag is not ended here.
  func accessibilityStep(up: Bool) {
    guard !disabled else { return }
    let from = state.displayed
    let to = stepped(from: from, up: up)
    guard to != from else { return }
    if dragging {
      drag(to: to)
      return
    }
    beginDrag()
    drag(to: to)
    endDrag()
  }

  /// Whether the frame pump is alive. Readable from any thread.
  var isFramePumpArmed: Bool {
    return pump.isArmed
  }

  /// What the last a11y step probe did. Readable from any thread.
  var accessibilityStepReport: String {
    a11yStepReportLock.lock()
    defer { a11yStepReportLock.unlock() }
    return a11yStepReport
  }

  func noteAccessibilityStepReport(_ report: String) {
    nitroUiAssertMainThread()
    a11yStepReportLock.lock()
    defer { a11yStepReportLock.unlock() }
    a11yStepCount += 1
    // The number makes every report a new string, so a test can tell a step that changed
    // nothing from a probe that has not run yet.
    a11yStepReport = "#\(a11yStepCount) \(report)"
  }

  /// The frame tick: one event for everything the finger did since the last one.
  private func deliverUnreported() {
    guard let value = state.unreported else { return }
    state.unreported = nil
    refreshAccessibility()
    // Invalidate once per frame, with the emit, not once per touch sample.
    objectWillChange.send()
    // Exactly once per emitted event: JS echoes the count back, and an increment nobody
    // emitted would leave the handshake permanently behind.
    let eventCount = state.user(value)
    onChange?(value, Double(eventCount))
  }
}

struct SliderContent: NitroUIContent {
  @ObservedObject private var model: SliderModel

  init(model: SliderModel) {
    self.model = model
  }

  var body: some View {
    let value = Binding<Double>(
      get: { model.state.displayed },
      set: { requested in model.drag(to: requested) }
    )
    let bounds = model.trackBounds
    let editing: (Bool) -> Void = { editing in
      if editing {
        model.beginDrag()
      } else {
        model.endDrag()
      }
    }

    // Two different view types, so switching between them rebuilds the slider. The condition
    // reads only min/max/step, so nothing else can flip it.
    Group {
      if model.isStepped {
        Slider(value: value, in: bounds, step: model.step, onEditingChanged: editing)
      } else {
        Slider(value: value, in: bounds, onEditingChanged: editing)
      }
    }
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    // The authoritative accessibility element is `NitroUiSliderAccessibilityElement`, vended
    // by the view; these modifiers say the same thing to SwiftUI. Hiding the children leaves
    // no element that can write the `Binding` directly, which would open a drag with no end.
    // The adjust action steps on this Slider's own grid: SwiftUI's increment is a fraction
    // of the range, which on a range that does not end on a step quantises back to where it
    // started.
    .accessibilityElement(children: .ignore)
    .accessibilityValue(Text(model.accessibilityValueText))
    .accessibilityAdjustableAction { direction in
      model.accessibilityStep(up: direction == .increment)
    }
    .modifier(OptionalAccessibility(label: model.accessibilityLabel))
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

/// An empty `accessibilityLabel(_:)` would silence the Slider's own label, so it is applied
/// only when set. VoiceOver reads the label from `NitroUiSliderAccessibilityElement`; this
/// one is what SwiftUI's own traversal would use.
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

/// The hosted element a screen reader would adjust, or nil. Breadth-first over subviews and
/// `accessibilityElements`: SwiftUI vends its elements there, not as subviews.
///
/// Matched by the `.adjustable` trait, not `responds(to:)`: `accessibilityIncrement` is an
/// `NSObject` category method, so every node responds to it. `dump` collects what was
/// walked, for the failure report.
private func nitroUiFindAdjustableElement(in root: UIView, dump: inout [String]) -> AnyObject? {
  var queue: [AnyObject] = [root]
  while !queue.isEmpty, dump.count < 64 {
    let node = queue.removeFirst()
    dump.append(nitroUiDescribeAccessibilityNode(node))
    if nitroUiAccessibilityTraits(of: node)?.contains(.adjustable) == true {
      return node
    }
    if let view = node as? UIView {
      queue.append(contentsOf: view.subviews)
      if let elements = view.accessibilityElements {
        queue.append(contentsOf: elements.compactMap { $0 as AnyObject? })
      }
    }
  }
  return nil
}

/// `UIView` and `UIAccessibilityElement` declare `accessibilityTraits` separately.
private func nitroUiAccessibilityTraits(of node: AnyObject) -> UIAccessibilityTraits? {
  if let view = node as? UIView {
    return view.accessibilityTraits
  }
  if let element = node as? UIAccessibilityElement {
    return element.accessibilityTraits
  }
  return nil
}

private func nitroUiDescribeAccessibilityNode(_ node: AnyObject) -> String {
  let name = String(describing: Swift.type(of: node))
  guard let traits = nitroUiAccessibilityTraits(of: node) else {
    return "\(name)[no traits]"
  }
  return "\(name)[\(traits.rawValue)]"
}

/// Reports go to a test's failure line, so they stay one line.
private func nitroUiReport(_ text: String) -> String {
  guard text.count > 320 else { return text }
  return String(text.prefix(320)) + "…"
}

/// The accessibility element this control answers a screen reader with, vended through the
/// component view's `accessibilityElements`.
///
/// A SwiftUI hosting view reports no accessibility elements unless an accessibility client
/// is attached, so an element built from `.accessibility*` modifiers cannot be found or
/// tested in-process. Vending it here also makes it the only focus stop (UIKit does not
/// descend into a view that vends its own elements) and makes increments step on this
/// Slider's own grid rather than by a fraction of the range.
final class NitroUiSliderAccessibilityElement: UIAccessibilityElement {
  private weak var model: SliderModel?
  private weak var anchor: UIView?

  init(model: SliderModel, anchor: UIView) {
    self.model = model
    super.init(accessibilityContainer: anchor)
    self.anchor = anchor
    refresh()
  }

  /// In screen coordinates, computed rather than stored so the element follows the control.
  override var accessibilityFrame: CGRect {
    get {
      guard let anchor, let window = anchor.window else { return .zero }
      return anchor.convert(anchor.bounds, to: window)
    }
    set {}
  }

  /// `UIAccessibilityElement` stores these three, so the model calls this when they change.
  func refresh() {
    guard let model else { return }
    accessibilityLabel = model.accessibilityLabel
    accessibilityValue = model.accessibilityValueText
    accessibilityTraits = model.disabled ? [.adjustable, .notEnabled] : .adjustable
  }

  /// VoiceOver's swipe-up on the focused control.
  override func accessibilityIncrement() {
    model?.accessibilityStep(up: true)
  }

  /// VoiceOver's swipe-down on the focused control.
  override func accessibilityDecrement() {
    model?.accessibilityStep(up: false)
  }
}

final class HybridNitroUiSlider: HybridNitroUiSliderSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SliderContent>

  /// Created once per instance and never replaced; it reads through to the model, which
  /// survives a recycle.
  private lazy var a11yElement = NitroUiSliderAccessibilityElement(
    model: host.model,
    anchor: host
  )

  /// The width a Slider draws at under a parent that gives it no finite width.
  private static let fallbackWidth: Double = 351

  /// The measured height of SwiftUI's `Slider`, in points.
  private static let fallbackHeight: Double = 31

  private static let sizingComponentName = "NitroUiSlider"

  /// Under a finite parent the shadow node replaces the width with the box's, so only the
  /// height matters there, and it must not be too small: nothing corrects it before the
  /// first measurement.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(
      sizingComponentName,
      fallbackWidth,
      fallbackHeight,
      NitroUiSizingPolicy.fillWidth.rawValue
    )
    return true
  }()

  /// Registers the fallback once per process, at startup: a cold first Slider measured with
  /// no fallback is laid out 0 tall.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: SliderModel())
    super.init()
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    // One focus stop for the control: the element this view vends.
    host.accessibilityElements = [a11yElement]
    host.model.a11yElement = a11yElement
    // A backstop; the fallback is normally registered at startup.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<SliderContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var value: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      return .second(js)
    }
    set {
      model.state.js = newValue.asType(Double.self)
    }
  }

  var defaultValue: Variant_NullType_Double {
    get {
      guard let value = model.defaultValue else { return .first(.null) }
      return .second(value)
    }
    set {
      // Stored raw: the range it is quantised against may arrive later in the same batch.
      model.defaultValue = newValue.asType(Double.self)
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var minimumValue: Double {
    get { model.minimumValue }
    set {
      guard newValue != model.minimumValue else { return }
      model.minimumValue = newValue
      host.markDirty()
    }
  }

  var maximumValue: Double {
    get { model.maximumValue }
    set {
      guard newValue != model.maximumValue else { return }
      model.maximumValue = newValue
      host.markDirty()
    }
  }

  var step: Double {
    get { model.step }
    set {
      guard newValue != model.step else { return }
      model.step = newValue
      // Can switch which of the two sliders draws; the height is the same either way.
      host.markDirty()
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

  // Callbacks are stored and never mark the host dirty.
  var onValueChange: ((Double, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  var onSlidingStart: ((Double, Double) -> Void)? {
    get { model.onSlidingStart }
    set { model.onSlidingStart = newValue }
  }

  var onSlidingComplete: ((Double, Double) -> Void)? {
    get { model.onSlidingComplete }
    set { model.onSlidingComplete = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // `value`, `defaultValue`, the range and `step` can land in one batch in any order, so
    // nothing is interpreted until the batch is complete.
    if let js = model.state.js {
      let quantised = model.quantize(js)
      if quantised != js { model.state.js = quantised }
    }
    if model.state.js == nil, !model.didApplyDefault, let `default` = model.defaultValue {
      model.didApplyDefault = true
      model.state.displayed = model.quantize(`default`)
      host.markDirty()
    }
    // The event counts decide whether React's write wins over what the user just dragged
    // to; mid-drag it does not.
    if model.state.reconcile() {
      host.markDirty()
    }
    // A range or step that changed can leave the shown value outside it.
    let shown = model.quantize(model.state.displayed)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // The accessibility element stores its label, state and value, so it is updated once the
    // batch is complete.
    model.refreshAccessibility()
    host.commit()
  }

  func prepareForRecycle() {
    // Before anything else: the frame pump would otherwise keep ticking and emit the
    // previous owner's drag.
    model.cancelDrag()
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.minimumValue = 0
    model.maximumValue = 1
    model.step = 0
    model.defaultValue = nil
    model.didApplyDefault = false
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    model.onSlidingStart = nil
    model.onSlidingComplete = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.cancelDrag()
    model.onChange = nil
    model.onSlidingStart = nil
    model.onSlidingComplete = nil
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiSliderSize {
    guard let size = host.contentSize else {
      return NitroUiSliderSize(width: 0, height: 0)
    }
    return NitroUiSliderSize(width: Double(size.width), height: Double(size.height))
  }

  /// Test-only: drives one drag through the same path as a touch. With `msPerStep` 0 every
  /// move runs in one main-thread turn, so no frame passes between them and one event is
  /// reported; with a positive value frames pass between moves and several are.
  func nuiTestDrag(to: Double, steps: Double, msPerStep: Double) throws {
    let run = { [weak self] in
      self?.runTestDrag(to: to, steps: max(1, Int(steps)), msPerStep: max(0, msPerStep))
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  private func runTestDrag(to: Double, steps: Int, msPerStep: Double) {
    nitroUiAssertMainThread()
    // A disabled control is inert: the platform control would not write its binding.
    guard !model.disabled else { return }
    // Every queued step checks this, so a drag abandoned mid-way does not run into the next
    // owner of this instance.
    let generation = model.dragGeneration
    let current = { [weak self] in self?.model.dragGeneration == generation }
    let from = model.state.displayed
    model.beginDrag()
    for index in 1...steps {
      let move = { [weak self] in
        guard current() else { return }
        let fraction = Double(index) / Double(steps)
        self?.model.drag(to: from + (to - from) * fraction)
      }
      if msPerStep > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + msPerStep / 1000 * Double(index), execute: move)
      } else {
        move()
      }
    }
    if msPerStep > 0 {
      // One more frame after the last move, so the drag ends after the frames it
      // generated rather than inside one of them.
      DispatchQueue.main.asyncAfter(deadline: .now() + msPerStep / 1000 * Double(steps) + 0.05) { [weak self] in
        guard current() else { return }
        self?.model.endDrag()
      }
    } else {
      model.endDrag()
    }
  }

  /// Test-only: performs the selector VoiceOver performs on an adjustable element, on the
  /// hosted element. No fallback: if no adjustable element is found the probe does nothing
  /// and says so in the report.
  func nuiTestAccessibilityStep(direction: Double) throws {
    let up = direction >= 0
    let run = { [weak self] in self?.runTestAccessibilityStep(up: up) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  func nuiTestAccessibilityStepReport() throws -> String {
    return model.accessibilityStepReport
  }

  func nuiTestFramePumpArmed() throws -> Bool {
    return model.isFramePumpArmed
  }

  /// An Android-only probe. UIKit touches come from the window's real input and cannot be
  /// injected in-process, so this only reports that it is unsupported.
  func nuiTestPointerStream(mode: Double) throws {
    let run = { [weak self] in
      self?.notePointerStreamReport("mode=\(Int(mode)): not supported on ios")
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  func nuiTestPointerStreamReport() throws -> String {
    return pointerStreamReport
  }

  /// Written on the main thread and read by a synchronous Nitro call on any thread.
  private let pointerStreamReportLock = NSLock()
  private var pointerStreamReportValue = "no pointer stream injected yet"
  private var pointerStreamCount = 0

  private var pointerStreamReport: String {
    pointerStreamReportLock.lock()
    defer { pointerStreamReportLock.unlock() }
    return pointerStreamReportValue
  }

  private func notePointerStreamReport(_ report: String) {
    nitroUiAssertMainThread()
    pointerStreamReportLock.lock()
    pointerStreamCount += 1
    pointerStreamReportValue = "#\(pointerStreamCount) \(report)"
    pointerStreamReportLock.unlock()
  }

  private func runTestAccessibilityStep(up: Bool) {
    nitroUiAssertMainThread()
    let action = up ? "accessibilityIncrement" : "accessibilityDecrement"
    var dump: [String] = []
    guard let element = nitroUiFindAdjustableElement(in: host, dump: &dump) else {
      model.noteAccessibilityStepReport(
        nitroUiReport("no adjustable element; walked \(dump.joined(separator: " "))")
      )
      return
    }
    // Whether the element carries `.notEnabled`, reported in the same `disabled=` format as
    // Android.
    let elementDisabled = nitroUiAccessibilityTraits(of: element)?.contains(.notEnabled) == true
    let selector = NSSelectorFromString(action)
    guard element.responds(to: selector) else {
      model.noteAccessibilityStepReport(
        nitroUiReport("\(nitroUiDescribeAccessibilityNode(element)) does not respond to \(action); disabled=\(elementDisabled)")
      )
      return
    }
    let from = model.state.displayed
    element.perform(selector)
    let to = model.state.displayed
    model.noteAccessibilityStepReport(
      nitroUiReport("performed \(action) on \(nitroUiDescribeAccessibilityNode(element)) \(from)->\(to) disabled=\(elementDisabled)")
    )
  }

  private var model: SliderModel {
    return host.model
  }
}
