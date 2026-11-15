// The Stepper component: SwiftUI's `Stepper`, which provides hold-to-repeat and disables the
// half at a bound. The value rules are Slider's (`NitroUiSliderValue.swift`).

import NitroModules
import SwiftUI
import UIKit

/// The opacity a disabled Stepper draws at. `.disabled(_)` does not change how SwiftUI's
/// `Stepper` is drawn, so it is dimmed explicitly.
private let nitroUiStepperDisabledOpacity = 0.5

final class StepperModel: NitroUiModel {
  var state = NitroUiControlledValue<Double>(displayed: 0)
  var minimumValue = 0.0
  var maximumValue = 100.0
  var step = 1.0
  var defaultValue: Double?
  var didApplyDefault = false
  var disabled = false
  var testID: String?
  /// Names the control. The *value* is announced by ``accessibilityValueText``.
  var accessibilityLabel: String?
  /// The sizing engine reads the key from Fabric state itself.
  var sizingKey = ""
  var onChange: ((_ value: Double, _ eventCount: Double) -> Void)?

  /// The element UIKit vends to a screen reader for this control. Weak: the view owns both
  /// the element and this model.
  weak var a11yElement: NitroUiStepperAccessibilityElement?

  /// `UIAccessibilityElement` stores its label, value and traits, so they are pushed
  /// whenever one changes.
  func refreshAccessibility() {
    a11yElement?.refresh()
  }

  // MARK: - The value rules, which are Slider's

  func quantize(_ raw: Double) -> Double {
    return NitroUiSliderValue.quantize(
      raw: raw,
      minimum: minimumValue,
      maximum: maximumValue,
      step: step
    )
  }

  /// The range to hand SwiftUI.
  var trackBounds: ClosedRange<Double> {
    return NitroUiStepperBinding.trackBounds(minimum: minimumValue, maximum: maximumValue)
  }

  /// Whether SwiftUI's own `step:` can draw this range. Only when the range ends on a step:
  /// SwiftUI stops at `minimum + n * step`, so otherwise the maximum would be unreachable.
  /// Other ranges are drawn without a step and snapped here.
  var isStepped: Bool {
    guard let division = NitroUiSliderValue.division(minimum: minimumValue, maximum: maximumValue, step: step) else {
      return false
    }
    return division.endsOnStep && division.wholeSteps >= 1
  }

  /// The next legal value in one direction, or the bound when there is none.
  func stepped(from: Double, up: Bool) -> Double {
    return NitroUiSliderValue.stepped(
      from: from,
      up: up,
      minimum: minimumValue,
      maximum: maximumValue,
      step: step
    )
  }

  // MARK: - What the user does

  /// Moves to `raw`, from a tap, a repeat, an accessibility increment or a test. Optimistic:
  /// the new value shows now, before React has seen the event. Asking for the value already
  /// shown reports nothing, so a step at a bound emits no event on either platform.
  func userStep(to raw: Double) {
    let next = quantize(raw)
    guard next != state.displayed else { return }
    let eventCount = state.user(next)
    objectWillChange.send()
    refreshAccessibility()
    onChange?(next, Double(eventCount))
  }

  /// One step in the given direction. Refused while disabled, and a no-op at either bound.
  func step(up: Bool) {
    guard !disabled else { return }
    userStep(to: stepped(from: state.displayed, up: up))
  }

  /// The SwiftUI control's `Binding` was written, by a tap or one repeat of a hold. The
  /// write gives only a direction; the destination is this control's own step.
  func bindingWrite(_ requested: Double) {
    guard
      let next = NitroUiStepperBinding.value(
        afterWrite: requested,
        displayed: state.displayed,
        minimum: minimumValue,
        maximum: maximumValue,
        step: step,
        disabled: disabled
      )
    else { return }
    userStep(to: next)
  }

  // MARK: - Test read-outs

  /// Test-only read-outs behind one lock: the probes write on main and a test may read
  /// from JS.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var up = "none"
  private var down = "none"
  /// The opacity the drawing code was handed: half for a disabled control, 1 otherwise.
  private var opacity = "none"
  private var probes = 0
  private var merged = "unavailable"
  private var accessibilityReport = "none"
  private var stepCount = 0
  private var stepReport = "none"

  /// Whether a step in one direction would change anything.
  func canStep(up: Bool) -> Bool {
    !disabled && stepped(from: state.displayed, up: up) != state.displayed
  }

  /// Records what the drawing code was handed: the number shown, which halves can still
  /// move it, and the opacity.
  func recordDrawn(
    _ value: String,
    canStepUp: Bool,
    canStepDown: Bool,
    opacity: Double
  ) {
    reportLock.lock()
    drawn = value
    up = canStepUp ? "1" : "0"
    down = canStepDown ? "1" : "0"
    self.opacity = String(format: "%.2f", opacity)
    reportLock.unlock()
  }

  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// `displayed=…;up=…;down=…;opacity=…;probes=…;merged=…;a11y=…`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);up=\(up);down=\(down);opacity=\(opacity);probes=\(probes);merged=\(merged);a11y=\(accessibilityReport)"
  }

  /// Numbered, so two identical reports are still different strings for a test waiting on
  /// a change.
  func noteStepReport(_ report: String) {
    reportLock.lock()
    stepCount += 1
    stepReport = "#\(stepCount) \(report)"
    reportLock.unlock()
  }

  func currentStepReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return stepReport
  }

  func clearReports() {
    reportLock.lock()
    drawn = "none"
    up = "none"
    down = "none"
    opacity = "none"
    probes = 0
    merged = "unavailable"
    accessibilityReport = "none"
    stepCount = 0
    stepReport = "none"
    reportLock.unlock()
  }

  /// What a reader hears as this control's value. An integer drops its decimal point.
  var accessibilityValueText: String {
    let value = state.displayed
    if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
      return String(Int(value))
    }
    return String(value)
  }
}

struct StepperContent: NitroUIContent {
  @ObservedObject private var model: StepperModel
  init(model: StepperModel) {
    self.model = model
  }

  @ViewBuilder var body: some View {
    // Recorded where the control is drawn, so it is what the control is handed rather than
    // what React sent.
    let canStepUp = model.canStep(up: true)
    let canStepDown = model.canStep(up: false)
    let _ = model.recordDrawn(
      model.accessibilityValueText,
      canStepUp: canStepUp,
      canStepDown: canStepDown,
      opacity: model.disabled ? nitroUiStepperDisabledOpacity : 1
    )
    let value = Binding<Double>(
      get: { model.state.displayed },
      set: { requested in model.bindingWrite(requested) }
    )
    let bounds = model.trackBounds

    // Two different view types, so switching between them rebuilds the stepper. The
    // condition reads only the range and step, so nothing else can flip it.
    Group {
      if model.isStepped {
        Stepper(value: value, in: bounds, step: model.step) {
          Text(model.accessibilityLabel ?? "")
        }
      } else {
        Stepper(value: value, in: bounds) {
          Text(model.accessibilityLabel ?? "")
        }
      }
    }
    // `.labelsHidden()` hides the text while the stepper keeps it as the element's name.
    .labelsHidden()
    .disabled(model.disabled)
    .opacity(model.disabled ? nitroUiStepperDisabledOpacity : 1)
    // The authoritative accessibility element is `NitroUiStepperAccessibilityElement`,
    // vended by the view; these modifiers say the same thing to SwiftUI. `children: .ignore`
    // keeps it one element that steps by `step(up:)` rather than by the platform's stride.
    .accessibilityElement(children: .ignore)
    .accessibilityValue(Text(model.accessibilityValueText))
    .accessibilityAdjustableAction { direction in
      model.step(up: direction == .increment)
    }
    .modifier(OptionalStepperAccessibility(label: model.accessibilityLabel))
  }
}

/// An empty `accessibilityLabel(_:)` would silence the stepper's own label, so it is applied
/// only when set. `testID` is not applied here: React Native already puts it on the
/// component view.
private struct OptionalStepperAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// The accessibility element this control answers a screen reader with, vended through the
/// component view's `accessibilityElements`.
///
/// A SwiftUI hosting view reports no accessibility elements unless an accessibility client
/// is attached, so an element built from `.accessibility*` modifiers cannot be found or
/// tested in-process. Vending it here also makes it the only focus stop (UIKit does not
/// descend into a view that vends its own elements) and makes increments step on this
/// control's own grid rather than by a fraction of the range.
final class NitroUiStepperAccessibilityElement: UIAccessibilityElement {
  private weak var model: StepperModel?
  private weak var anchor: UIView?

  init(model: StepperModel, anchor: UIView) {
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

  func refresh() {
    guard let model else { return }
    accessibilityLabel = model.accessibilityLabel
    accessibilityValue = model.accessibilityValueText
    accessibilityTraits = model.disabled ? [.adjustable, .notEnabled] : .adjustable
  }

  /// VoiceOver's swipe-up on the focused control.
  override func accessibilityIncrement() {
    model?.step(up: true)
  }

  /// VoiceOver's swipe-down on the focused control.
  override func accessibilityDecrement() {
    model?.step(up: false)
  }
}

/// The hosted element a screen reader would adjust, or nil. Breadth-first over subviews and
/// `accessibilityElements`, matched by the `.adjustable` trait: every node responds to
/// `accessibilityIncrement`, which is an `NSObject` category method.
private func nitroUiFindStepperAdjustableElement(in root: UIView, dump: inout [String]) -> AnyObject? {
  var queue: [AnyObject] = [root]
  while !queue.isEmpty, dump.count < 64 {
    let node = queue.removeFirst()
    dump.append(nitroUiDescribeStepperNode(node))
    if nitroUiStepperTraits(of: node)?.contains(.adjustable) == true {
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
private func nitroUiStepperTraits(of node: AnyObject) -> UIAccessibilityTraits? {
  if let view = node as? UIView {
    return view.accessibilityTraits
  }
  if let element = node as? UIAccessibilityElement {
    return element.accessibilityTraits
  }
  return nil
}

private func nitroUiDescribeStepperNode(_ node: AnyObject) -> String {
  let name = String(describing: Swift.type(of: node))
  guard let traits = nitroUiStepperTraits(of: node) else {
    return "\(name)[no traits]"
  }
  return "\(name)[\(traits.rawValue)]"
}

/// A value without floating-point noise: `4.0` reads as `4`. Must match the Android twin's
/// format, because one test assertion reads both platforms' reports.
private func nitroUiStepperValueText(_ value: Double) -> String {
  if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
    return String(Int(value))
  }
  return String(value)
}

/// Reports go to a test's failure line, so they stay one line.
private func nitroUiStepperReport(_ text: String) -> String {
  guard text.count > 320 else { return text }
  return String(text.prefix(320)) + "…"
}

final class HybridNitroUiStepper: HybridNitroUiStepperSpec, RecyclableView {
  private let host: NitroSwiftUIHost<StepperContent>

  /// Created once per instance and never replaced; it reads through to the model, which
  /// survives a recycle.
  private lazy var a11yElement = NitroUiStepperAccessibilityElement(
    model: host.model,
    anchor: host
  )

  /// Guards `pixelProbes`, which a probe writes on main and a report reads from JS.
  private let pixelProbesLock = NSLock()
  private var pixelProbes = 0

  private static let sizingComponentName = "NitroUiStepper"

  /// The fallback, in points: SwiftUI's `Stepper` with its label hidden is 94x32 at every
  /// range and step.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 94.0, 32.0, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// Stepper's shadow node before it creates any Stepper view.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: StepperModel())
    super.init()
    // A stepper presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // One focus stop for the control: the element this view vends.
    host.accessibilityElements = [a11yElement]
    host.model.a11yElement = a11yElement
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<StepperContent> {
    return host
  }

  private var model: StepperModel {
    return host.model
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
      // The name is on the element and on the SwiftUI control, so it needs a commit to
      // reach VoiceOver.
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

  var onValueChange: ((Double, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
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
    // The event counts decide whether React's write wins over what the user just stepped to.
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
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.minimumValue = 0
    model.maximumValue = 100
    model.step = 1
    model.defaultValue = nil
    model.didApplyDefault = false
    model.disabled = false
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    model.clearReports()
    host.prepareForRecycle()
    // The element stores the value, name and enabled state, so it is refreshed after the
    // reset.
    model.refreshAccessibility()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiStepperSize {
    guard let size = host.contentSize else {
      return NitroUiStepperSize(width: 0, height: 0)
    }
    return NitroUiStepperSize(width: Double(size.width), height: Double(size.height))
  }

  /// One step through the tap's path, on main. Returns at once.
  func nuiTestStep(direction: Double) {
    let up = direction >= 0
    let run = { [host] in host.model.step(up: up) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Test-only: performs the selector VoiceOver performs on an adjustable element, on the
  /// hosted element. No fallback: if no adjustable element is found the probe does nothing
  /// and says so in the report.
  func nuiTestAccessibilityStep(direction: Double) {
    let up = direction >= 0
    let run = { [weak self] in self?.runTestAccessibilityStep(up: up) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  func nuiTestAccessibilityStepReport() throws -> String {
    return model.currentStepReport()
  }

  /// What the element this view vends tells a reader, as one line:
  /// `traits=<raw>,adjustable=<bool>,label=<text>,value=<text>,disabled=<bool>`.
  /// Comma-separated, because `;` separates the fields of `nuiTestStateReport()`, which
  /// embeds this line.
  func nuiTestProbeAccessibility() {
    let run = { [weak self] in
      guard let self else { return }
      let element = self.a11yElement
      element.refresh()
      let traits = element.accessibilityTraits
      let label = element.accessibilityLabel ?? ""
      let value = element.accessibilityValue ?? ""
      self.model.recordAccessibility(
        nitroUiStepperReport(
          "traits=\(traits.rawValue),adjustable=\(traits.contains(.adjustable))," +
            "label=\(label),value=\(value),disabled=\(traits.contains(.notEnabled))"
        )
      )
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// iOS has no Android icon glyph to sample, and SwiftUI's `Stepper` is drawn where a view
  /// capture does not reach, so the report says `no pixels`.
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

  func nuiTestStateReport() throws -> String {
    return model.stateReport()
  }

  private func runTestAccessibilityStep(up: Bool) {
    nitroUiAssertMainThread()
    let action = up ? "accessibilityIncrement" : "accessibilityDecrement"
    var dump: [String] = []
    guard let element = nitroUiFindStepperAdjustableElement(in: host, dump: &dump) else {
      model.noteStepReport(nitroUiStepperReport("no adjustable element; walked \(dump.joined(separator: " "))"))
      return
    }
    let elementDisabled = nitroUiStepperTraits(of: element)?.contains(.notEnabled) == true
    let selector = NSSelectorFromString(action)
    guard element.responds(to: selector) else {
      model.noteStepReport(
        nitroUiStepperReport("\(nitroUiDescribeStepperNode(element)) does not respond to \(action); disabled=\(elementDisabled)")
      )
      return
    }
    let from = model.state.displayed
    element.perform(selector)
    let to = model.state.displayed
    model.noteStepReport(
      nitroUiStepperReport(
        "performed \(action) on \(nitroUiDescribeStepperNode(element)) " +
          "\(nitroUiStepperValueText(from))->\(nitroUiStepperValueText(to)) " +
          "disabled=\(elementDisabled)"
      )
    )
  }
}
