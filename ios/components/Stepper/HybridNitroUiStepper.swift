//
//  HybridNitroUiStepper.swift
//  react-native-nitro-ui
//
//  The Stepper component: SwiftUI `Stepper` on the core runtime.
//
//  The value rules are Slider's, imported rather than copied: clamping, step
//  snapping and the digits a binary fraction leaves behind live in
//  `NitroUiSliderValue.swift`, and a second implementation of them is how two
//  controls in one library start disagreeing about what `0.1` means. Everything
//  here is about *when* a step is reported rather than what its value is.
//
//  Two things SwiftUI's control is relied on for, both of which this file would
//  otherwise have to build: hold-to-repeat (a held half keeps stepping, and each
//  repeat is one write to the Binding, so one step and one event) and the half
//  that goes inert at a bound. Handing the control `in:` and `step:` is what buys
//  both, and the range is only handed over as `step:` when the top of it is one
//  of the control's own stops (`NitroUiSliderValue.Division.endsOnStep`).
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Stepper. See ``NitroUiModel`` for why this is not `@Published`.
final class StepperModel: NitroUiModel {
  /// The stepped value, behind the event-count handshake (core.md §4).
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
  /// The size configuration React sent; the engine reads it out of Fabric state.
  var sizingKey = ""
  /// `onValueChange`, wired through a stable JS callback.
  var onChange: ((_ value: Double, _ eventCount: Double) -> Void)?

  /// The element UIKit vends to a screen reader for this control.
  ///
  /// Weak, for Slider's reason: the view owns both, and a strong reference here
  /// would be a cycle that outlives the recycle.
  weak var a11yElement: NitroUiStepperAccessibilityElement?

  /// Re-copy what a reader announces into that element. `UIAccessibilityElement`
  /// *stores* label, value and traits, so each has to be pushed when it changes.
  func refreshAccessibility() {
    a11yElement?.refresh()
  }

  // MARK: - The value rules, which are Slider's

  /// The value rule of `NitroUiSliderValue`, applied to this control's range.
  func quantize(_ raw: Double) -> Double {
    return NitroUiSliderValue.quantize(
      raw: raw,
      minimum: minimumValue,
      maximum: maximumValue,
      step: step
    )
  }

  /// The range to hand SwiftUI.
  ///
  /// Always a valid `ClosedRange`: `ClosedRange(a...b)` with `a > b` traps at
  /// runtime, and a `maximumValue` below `minimumValue` is app data, not a crash.
  var trackBounds: ClosedRange<Double> {
    guard minimumValue.isFinite, maximumValue.isFinite else {
      return 0...1
    }
    if maximumValue > minimumValue {
      return minimumValue...maximumValue
    }
    return Swift.min(minimumValue, maximumValue)...Swift.max(minimumValue, maximumValue)
  }

  /// Whether SwiftUI's own `step:` can draw this range.
  ///
  /// True only when the range ends on a step, for Slider's reason
  /// (`NitroUiSliderValue.Division.endsOnStep`): SwiftUI's stepped control stops at
  /// `minimum + n * step`, so on a range that does not end on one its `maximumValue`
  /// is not a value it can ever reach - and `maximumValue` has to be reachable.
  /// Those ranges are drawn without a step and snapped here instead, which keeps one
  /// rule for every range rather than two.
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

  /// The value the control now displays, asked for by a tap, a repeat, an
  /// accessibility increment or the harness.
  ///
  /// Native is optimistic: show the new value now, before React has seen the
  /// event, so there is no visual latency (§4).
  ///
  /// Asking for the value the control already shows reports **nothing**. That is not
  /// an optimisation: it is what makes "a tap at a bound does nothing" true on both
  /// platforms, where iOS's half is disabled by SwiftUI before any write and
  /// Android's button is disabled before any click - so neither the harness seam nor
  /// a real touch may invent an event the control could not have produced.
  func userStep(to raw: Double) {
    let next = quantize(raw)
    guard next != state.displayed else { return }
    let eventCount = state.user(next)
    objectWillChange.send()
    refreshAccessibility()
    onChange?(next, Double(eventCount))
  }

  /// One step, in the direction asked for, through ``userStep(to:)``.
  ///
  /// Refused while `disabled`, as `.disabled(true)` refuses a tap, and a no-op at
  /// either bound because ``stepped(from:up:)`` answers the bound itself.
  func step(up: Bool) {
    guard !disabled else { return }
    userStep(to: stepped(from: state.displayed, up: up))
  }

  /// What the SwiftUI control's `Binding` was just written with - one tap, or one
  /// repeat of a hold.
  ///
  /// The write contributes a direction and nothing else: the destination is this
  /// control's own step, from the value it displays. `NitroUiStepperBinding` carries
  /// the argument (in short: on a range that does not end on a step the control is
  /// drawn without one, so its write is SwiftUI's default stride of 1, and `quantize`
  /// would accept `0` -> `1` on `0...1.05 step 0.1` as if ten steps had been asked
  /// for), and it is the rule the host test runs, one case per range shape.
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

  /// Test-only read-outs (`nuiTestStateReport`), behind one lock: the probes arrive
  /// on main and a test may read the report from JS.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var up = "none"
  private var down = "none"
  /// What SwiftUI's own environment said about `isEnabled` the last time the control drew
  /// (iOS only — see ``recordEnvironment(enabled:)``).
  private var environmentEnabled = "none"
  private var probes = 0
  private var merged = "unavailable"
  private var accessibilityReport = "none"
  private var stepCount = 0
  private var stepReport = "none"

  /// Whether a step in one direction would change anything - the same answer that
  /// decides which of SwiftUI's two halves it disables, spelled here so the harness can
  /// assert the bound rather than infer it from a missing event.
  func canStep(up: Bool) -> Bool {
    !disabled && stepped(from: state.displayed, up: up) != state.displayed
  }

  /// Record what the drawing code was handed: the number the control is showing, and
  /// which half a tap could still move it.
  ///
  /// Android records the same two fields from the same rule
  /// (`HybridNitroUiStepper.kt`), which is what lets one assertion cover both
  /// platforms' bound behaviour.
  ///
  func recordDrawn(_ value: String, canStepUp: Bool, canStepDown: Bool) {
    reportLock.lock()
    drawn = value
    up = canStepUp ? "1" : "0"
    down = canStepDown ? "1" : "0"
    reportLock.unlock()
  }

  /// Record what the control that is actually on screen believes about its own enabled
  /// state.
  ///
  /// `model.disabled` cannot answer the question this is for. It is the number React sent,
  /// and the accessibility traits are set from it directly, so a `.disabled(...)` modifier
  /// that never reached the SwiftUI control would leave every other reading of this control
  /// green while the screen drew a live-looking control nobody can operate — which is what
  /// the disabled row of `stepper-ios.png` looked like. This is read from
  /// `\.isEnabled` *below* the modifier, by ``StepperEnvironmentProbe``, so it is SwiftUI's
  /// answer about the control rather than ours about the prop.
  func recordEnvironment(enabled: Bool) {
    reportLock.lock()
    environmentEnabled = enabled ? "1" : "0"
    reportLock.unlock()
  }

  /// Store an accessibility probe's answer and count it.
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
    return "displayed=\(drawn);up=\(up);down=\(down);enabled=\(environmentEnabled);probes=\(probes);merged=\(merged);a11y=\(accessibilityReport)"
  }

  /// Store an adjust-action report and count it, so two reports that do the same
  /// thing - the no-op at a bound - are still two different strings for a test
  /// waiting on "the report changed".
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

  /// Back to "nothing yet", for recycling.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    up = "none"
    down = "none"
    environmentEnabled = "none"
    probes = 0
    merged = "unavailable"
    accessibilityReport = "none"
    stepCount = 0
    stepReport = "none"
    reportLock.unlock()
  }

  /// What a reader hears as this control's value: an integral value without a
  /// fraction, so `0.1` steps do not read "zero point one zero zero zero…".
  var accessibilityValueText: String {
    let value = state.displayed
    if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
      return String(Int(value))
    }
    return String(value)
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct StepperContent: NitroUIContent {
  @ObservedObject private var model: StepperModel
  init(model: StepperModel) {
    self.model = model
  }

  @ViewBuilder var body: some View {
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the control is handed rather than what React sent.
    let canStepUp = model.canStep(up: true)
    let canStepDown = model.canStep(up: false)
    let _ = model.recordDrawn(
      model.accessibilityValueText,
      canStepUp: canStepUp,
      canStepDown: canStepDown
    )
    let value = Binding<Double>(
      get: { model.state.displayed },
      set: { requested in model.bindingWrite(requested) }
    )
    let bounds = model.trackBounds

    // Two different controls, chosen by the range rather than by the caller -
    // Slider's `isStepped` branch, for Slider's reason: the shape of this branch is
    // SwiftUI's structural identity, so it may flip only when a range changes and
    // nothing else moves it. Both halves share one `Binding`, so ``userStep(to:)``
    // does not care which one drew a frame.
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
    // The label is the caller's `accessibilityLabel`, and `.labelsHidden()` hides the
    // text while the stepper keeps it as the element's name. A `Stepper` with no
    // label at all is a control with a name nobody can see, which is the reading
    // `docs/components/stepper.md` gives `accessibilityLabel` for.
    .labelsHidden()
    .disabled(model.disabled)
    // Read back the disabled state this chain produced. `.background` content is placed by
    // the view it is attached to, in that view's environment — so this one is downstream of
    // the `.disabled` above, where reading `\.isEnabled` in this body would not be: an
    // environment read in `body` answers the environment *into which* `body` is laid out,
    // and would report `true` forever.
    .background(StepperEnvironmentProbe(model: model))
    // SwiftUI's half of the accessibility, kept beside the UIKit element the view
    // vends (see ``NitroUiStepperAccessibilityElement`` for why that element is the
    // authoritative one): the same statement in SwiftUI's language, free, and the
    // cover for a runtime that builds its reader tree past `accessibilityElements`.
    // `children: .ignore` keeps that built element a single stop that steps by
    // ``StepperModel/step(up:)`` rather than by whatever stride the platform picked.
    .accessibilityElement(children: .ignore)
    .accessibilityValue(Text(model.accessibilityValueText))
    .accessibilityAdjustableAction { direction in
      model.step(up: direction == .increment)
    }
    .modifier(OptionalStepperAccessibility(label: model.accessibilityLabel))
  }
}

/// Reads the `\.isEnabled` on the far side of the control's `.disabled` modifier and hands
/// it to the model. Attaching it with `.background` is what puts it on that far side; the
/// drawing code in this file records the value at the point the control is drawn, and this
/// has to be read at the same point or it answers a question nobody asked.
private struct StepperEnvironmentProbe: View {
  let model: StepperModel
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let _ = model.recordEnvironment(enabled: isEnabled)
    return Color.clear
  }
}

/// An empty `accessibilityLabel(_:)` would silence the stepper's own label, so it is
/// applied only when set - the Switch's, Checkbox's and Slider's rule, and `testID`
/// deliberately not here for the same reason (RN puts it on the component view).
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

/// The accessibility element this control answers a screen reader with.
///
/// Vended by the component view, for the reason
/// `HybridNitroUiSlider.swift` measured rather than assumed: on iOS 27 a SwiftUI
/// hosting view answers `accessibilityElements == []` to anything that is not an
/// accessibility client, so an element built out of `.accessibility*` modifiers
/// cannot be found, performed or tested from outside VoiceOver. Vending the element
/// makes it a fact about the view at all times, and UIKit calls
/// `accessibilityIncrement` / `accessibilityDecrement` on it - the same two calls
/// VoiceOver's swipe makes.
///
/// Being the element also means **one focus stop** (UIKit does not descend into a
/// view that answers with its own elements) and **our steps, not the platform's**:
/// the increment moves by ``StepperModel/stepped(from:up:)``, which is the grid
/// `NitroUiSliderValue.quantize` recognises, so a range that does not end on a step
/// still steps rather than moving by a fraction of the range that quantises back to
/// where it started.
final class NitroUiStepperAccessibilityElement: UIAccessibilityElement {
  private weak var model: StepperModel?
  private weak var anchor: UIView?

  init(model: StepperModel, anchor: UIView) {
    self.model = model
    super.init(accessibilityContainer: anchor)
    self.anchor = anchor
    refresh()
  }

  /// The control's box, in screen coordinates - computed rather than stored so the
  /// element follows the control when the layout moves it.
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

/// The hosted element a screen reader would adjust, or nil.
///
/// Breadth-first over both kinds of node, and gated on `.adjustable` rather than on
/// `responds(to:)` - Slider's helper, for its reasons: SwiftUI vends elements rather
/// than subviews, and `accessibilityIncrement` is an `NSObject` category method that
/// every node answers.
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

/// Both kinds of node spell their traits `accessibilityTraits`, declared separately,
/// so this is the one place that knows both.
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

/// The number a report names, without a float's noise: `4.0` reads as `4` and `0.1`
/// stays `0.1`. The Android twin is `nitroUiStepperValueText`, and one harness
/// assertion reads both platforms' reader-action reports, so the spellings agree.
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

/// The Hybrid View React renders as `NitroUiStepper`.
final class HybridNitroUiStepper: HybridNitroUiStepperSpec, RecyclableView {
  private let host: NitroSwiftUIHost<StepperContent>

  /// The element a screen reader focuses, vended by the component view.
  ///
  /// Created once per instance and never replaced: it reads through to the model,
  /// which is the same object for the life of this view including across a recycle,
  /// and ``prepareForRecycle`` leaves the array alone for that reason.
  private lazy var a11yElement = NitroUiStepperAccessibilityElement(
    model: host.model,
    anchor: host
  )

  /// Guards `pixelProbes`, which a probe writes on main and a report reads from JS.
  private let pixelProbesLock = NSLock()
  private var pixelProbes = 0

  private static let sizingComponentName = "NitroUiStepper"

  /// The size to lay a Stepper out with before anything has been measured, in points.
  ///
  /// Measured on this machine (D14): SwiftUI's `Stepper` with its label hidden lays out
  /// at 94x32 pt on iOS 26 and 27, at every range and step - the control is two
  /// fixed-width halves, so nothing the caller sends moves the box. There is no runtime
  /// below 26 on this machine to measure, so the same box is declared for those rather
  /// than this file claiming a number no device has read: an older OS pays at most the
  /// one cold correction the sizing engine exists for. The number is what
  /// `Stepper.harness.tsx`'s sizing cases and `DECLARED_FALLBACKS.NitroUiStepper.ios`
  /// compare against, and a change to either is a change to what the first cold frame
  /// shows (D17).
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 94.0, 32.0, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process.
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a Stepper's shadow node before it creates any Stepper
  /// view, so a fallback declared from `init` is one measure too late (T14).
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
    // One focus stop for the control, and it is ours.
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
      // Stored raw: the range it has to be quantised against may arrive in the same
      // batch, and Nitro does not order props inside one.
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
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      // Rendered, not bookkeeping: the name is on the element and on the SwiftUI
      // control, so it needs a commit or a late-set name never reaches VoiceOver.
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
    // `value`, `defaultValue`, `minimumValue`, `maximumValue` and `step` can all land
    // in one batch in any order, so none of them is interpreted until the batch is
    // complete (Slider's rule, and the same reason): a `value` of 0.3 is only a legal
    // number once the range it belongs to is known.
    if let js = model.state.js {
      let quantised = model.quantize(js)
      if quantised != js { model.state.js = quantised }
    }
    if model.state.js == nil, !model.didApplyDefault, let `default` = model.defaultValue {
      model.didApplyDefault = true
      model.state.displayed = model.quantize(`default`)
      host.markDirty()
    }
    // The handshake decides whether React's write wins over what the user just
    // stepped to (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    // A range or step that moved under an existing value can leave the shown value
    // outside it. Idempotent, so a value that is already legal comes back unchanged.
    let shown = model.quantize(model.state.displayed)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // The label, the enabled state and the value are what a reader announces, and
    // this is the one turn per commit where all three are known.
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
    // The reset above changes the value, the name and the enabled state, and the
    // element stores all three - so it is re-read here rather than left describing
    // the previous owner's stepper.
    model.refreshAccessibility()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this stepper, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may only
  /// be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiStepperSize {
    guard let size = host.contentSize else {
      return NitroUiStepperSize(width: 0, height: 0)
    }
    return NitroUiStepperSize(width: Double(size.width), height: Double(size.height))
  }

  /// One step through the tap's path, on the UI thread. Returns at once.
  func nuiTestStep(direction: Double) {
    let up = direction >= 0
    let run = { [host] in host.model.step(up: up) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Perform the platform's own adjust action on the hosted element.
  ///
  /// There is deliberately **no fallback**: with no adjustable element the probe does
  /// nothing and says so. Falling back to ``StepperModel/step(up:)`` would move the
  /// value either way and prove nothing about the path a screen reader takes, which
  /// is the whole thing under test (Slider's rule).
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
  ///
  /// Comma-separated, because `;` is what splits this line's own fields apart inside
  /// `nuiTestStateReport()` - a report that used it internally arrived as its first
  /// word. `adjustable` is UIKit's own answer to `traits.contains(.adjustable)` rather
  /// than a bit a test has to know: the raw mask is reported beside it as the evidence,
  /// but the bit an adjustable element answers is UIKit's business, and on the OS this
  /// was measured on it is not the one the pre-26 headers list.
  ///
  /// The element is the one this view hands UIKit, so it can be read in-process here
  /// in a way a SwiftUI-modifier-built element cannot (`HybridNitroUiSlider.swift`
  /// measured that), and the four fields are the four a harness asserts. `merged`
  /// stays `unavailable`: what this can enumerate is the array this view vends, not
  /// the tree a reader walks, and a count of the first would be an echo rather than
  /// a measurement.
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

  /// Counts the probe and answers `no pixels`, the way IconButton's iOS half does:
  /// the glyph this control samples is a Material Symbols drawable, and there is no
  /// Android artwork on this platform to sample.
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
