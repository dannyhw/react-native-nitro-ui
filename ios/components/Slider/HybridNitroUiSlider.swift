//
//  HybridNitroUiSlider.swift
//  react-native-nitro-ui
//
//  The Slider component: SwiftUI `Slider` on the core runtime, with the drag
//  owned natively. The rules the value follows live in
//  `NitroUiSliderValue.swift` so they can be tested on the host; everything
//  here is about *when* a value is reported rather than what it is.
//

import NitroModules
import SwiftUI
import UIKit

/// `CADisplayLink` retains its target, so the target cannot be the model: a link
/// that outlived its control (a view pulled out of a window mid-drag) would keep
/// the model, the hosted view and everything it holds alive forever. The proxy is
/// what the link retains, and it holds back weakly.
private final class NitroUiFrameProxy: NSObject {
  private weak var pump: NitroUiFramePump?

  init(_ pump: NitroUiFramePump) {
    self.pump = pump
  }

  @objc func tick() {
    pump?.deliverFrame()
  }
}

/// At most one emitted `onValueChange` per display frame
/// (`docs/architecture/core.md` §11).
///
/// A touch stream samples faster than the display draws, and every emitted event
/// is a JS entry, the app's handler, a React render and a props commit back. The
/// link exists only while a drag is in flight: started by ``SliderModel/beginDrag()``,
/// stopped by `endDrag()`/`cancelDrag()`, so an idle Slider has no ticker at all.
///
/// It is scheduled for `.common` run loop modes, which is not a detail: during a
/// drag the touch is being tracked, and the loop runs in `UITrackingRunLoopMode`
/// while it does. A link scheduled for `.default` - the default - does not fire
/// there, so the coalescer would never tick and the entire drag would arrive as
/// one event at release.
private final class NitroUiFramePump {
  var onFrame: (() -> Void)?

  private var link: CADisplayLink?
  private var proxy: NitroUiFrameProxy?
  /// Mirror of ``isArmed``'s answer, so it may be read off the main thread.
  ///
  /// `link` itself is main-thread-only and a probe arriving on JS cannot read it;
  /// `NitroSwiftUIHost.contentSize`'s reasoning and its lock are the pattern this
  /// copies. The lock is only ever taken by ``start()`` and ``stop()``, which is
  /// twice per drag - never per touch sample.
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

  /// Whether a display link is scheduled for this control.
  ///
  /// A pump that outlived its drag emits nothing (`deliverUnreported` is a no-op
  /// with nothing pending), so nothing in the event stream can show the leak -
  /// only this can, and the harness asserts it goes false when the drag ends.
  ///
  /// The link is kept for the whole drag rather than armed per sample: the last
  /// sample of a drag is emitted by `endDrag()` itself, so an arm that stopped
  /// with the last sample would be unarmed for the one thing it would be armed
  /// for - and `docs/components/slider.md` used to claim exactly that.
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
    // The link retains the proxy, not the pump, so this really does run while a
    // link is still ticking - which is the whole point of the proxy.
    link?.invalidate()
  }
}

/// State of one Slider. See ``NitroUiModel`` for why this is not `@Published`.
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
  /// What VoiceOver reads as this control's value.
  ///
  /// The number itself, not a percentage: `minimumValue`/`maximumValue` are the
  /// app's units (volume, opacity, a year), and a screen-reader user who is told
  /// "72 percent" of a year has learned nothing. An integer loses its decimal
  /// point so "0" is announced rather than "0 point 0".
  var accessibilityValueText: String {
    let value = state.displayed
    if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
      return String(Int(value))
    }
    return String(value)
  }
  /// The element UIKit vends to a screen reader for this control.
  ///
  /// Weak: the element is owned by the view's `accessibilityElements` array and
  /// the model is owned by that same view, so a strong reference here would be a
  /// cycle that outlives the recycle. See ``NitroUiSliderAccessibilityElement``.
  weak var a11yElement: NitroUiSliderAccessibilityElement?

  /// Re-copy what a reader announces into that element.
  ///
  /// `UIAccessibilityElement` *stores* its label, value and traits instead of
  /// asking for them, so each of the three has to be pushed when it changes. The
  /// call sites below are exactly the moments at which it can: a value that moved
  /// (an emitted sample, a cancelled drag), or a prop batch that moved the label,
  /// the enabled state or the value.
  func refreshAccessibility() {
    a11yElement?.refresh()
  }
  /// The size configuration React sent. Nothing native reads it; see
  /// `HybridNitroUiSwitch`'s copy of this field.
  var sizingKey = ""
  var onChange: ((Double, Double) -> Void)?
  var onSlidingStart: ((Double, Double) -> Void)?
  var onSlidingComplete: ((Double, Double) -> Void)?

  // A drag's samples live in `state`, not in Slider fields: the un-emitted one is
  // `state.unreported`, which is part of the handshake itself, so "a React write
  // may not overtake a sample JS has not been told about" is one rule for every
  // control (§4, §11). What the `Binding` reads is `state.displayed`, which an
  // interaction also writes at sample time, so a re-render mid-drag cannot show
  // an older value.

  /// Whether a drag is in flight.
  var dragging = false

  /// Bumped whenever an in-flight drag is abandoned, so work that was queued for
  /// that drag can recognise itself and stop. A real touch stream cannot outlive
  /// its view; `nuiTestDrag` queues its moves on the run loop and
  /// `prepareForRecycle`/`onDropView` may run before every one of them lands,
  /// which would otherwise hand the next owner of this instance somebody else's
  /// drag - the exact bug `prepareForRecycle` exists to prevent.
  private(set) var dragGeneration = 0

  private let pump = NitroUiFramePump()
  /// What the last `nuiTestAccessibilityStep` did, as one line.
  ///
  /// The probe cannot answer synchronously: it must run on main, and a Nitro
  /// method may not block for main (`NitroUiMainThread`'s rule). So it writes
  /// what happened here and the harness reads it back from JS, which needs the
  /// same lock as ``NitroUiFramePump/isArmed``.
  private var a11yStepReport = ""
  /// How many reports have been made, used to number them. Same lock.
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
  /// The value rule of `NitroUiSliderValue`, applied to this Slider's range.
  func quantize(_ raw: Double) -> Double {
    return NitroUiSliderValue.quantize(raw: raw, minimum: minimumValue, maximum: maximumValue, step: step)
  }

  /// The range to hand the platform control.
  ///
  /// Always a valid `ClosedRange`: `ClosedRange(a...b)` with `a > b` traps at
  /// runtime, and a `maximumValue` below `minimumValue` is app data, not a crash.
  /// Such a range has one value - the minimum, which is inside this span either
  /// way - so the thumb sits at an end and every interaction lands back on it.
  var trackBounds: ClosedRange<Double> {
    guard minimumValue.isFinite, maximumValue.isFinite else {
      return 0...1
    }
    if maximumValue > minimumValue {
      return minimumValue...maximumValue
    }
    return Swift.min(minimumValue, maximumValue)...Swift.max(minimumValue, maximumValue)
  }

  /// Whether the platform control can draw this range's steps itself.
  ///
  /// True only when the range ends on a step: SwiftUI's `step:` stops at
  /// `minimum + n * step` and treats the bound as a stop, so if the range does
  /// *not* end on one, its top is not a value it can reach - and `maximumValue`
  /// has to be reachable. Those ranges stay continuous and are quantised here,
  /// which keeps one rule for every range instead of two.
  var isStepped: Bool {
    guard let division = NitroUiSliderValue.division(minimum: minimumValue, maximum: maximumValue, step: step) else {
      return false
    }
    return division.endsOnStep && division.wholeSteps >= 1
  }

  /// A drag began. Reports the value it began from.
  ///
  /// Idempotent: SwiftUI's `onEditingChanged(true)` and the first `Binding` write
  /// have no defined order, and a tap that jumps the thumb can write before it
  /// says editing started. Whoever gets there first wins, once.
  func beginDrag() {
    guard !dragging else { return }
    dragging = true
    pump.start()
    onSlidingStart?(state.displayed, Double(state.nativeEvents))
  }

  /// The finger moved. Displays at once, emits on the next frame.
  ///
  /// `displayed` is written here rather than at delivery so the thumb is under
  /// the finger with no frame of latency, and so the quantised value - not the
  /// raw touch position the control passed in - is what any re-render reads back.
  func drag(to raw: Double) {
    if !dragging {
      beginDrag()
    }
    state.displayed = quantize(raw)
    state.unreported = state.displayed
    refreshAccessibility()
    pump.start()
  }

  /// The finger lifted. The final value always reaches JS, even when the frame
  /// that carried it was the last thing emitted.
  ///
  /// Idempotent, and the guard is the event contract: only a drag that started
  /// may end. SwiftUI's `onEditingChanged(false)` has no defined order with the
  /// `Binding` writes of the same gesture and neither platform promises one end
  /// per start, so without it a second end reports a completion nobody performed
  /// and - after ``cancelDrag()`` - delivers one to whoever owns this instance
  /// next.
  func endDrag() {
    guard dragging else {
      return
    }
    deliverUnreported()
    dragging = false
    pump.stop()
    onSlidingComplete?(state.displayed, Double(state.nativeEvents))
  }

  /// Abandon an in-flight drag without reporting it: the view is being recycled
  /// or dropped, and a callback delivered to whoever owned this instance before
  /// is a callback delivered to the wrong app.
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

  /// A screen reader asked for the next value up (or below).
  ///
  /// One gesture's worth of callbacks - start, one change, complete - because an
  /// app cannot tell an increment from a thumb release and must not have to. The
  /// drag is opened and closed *here* rather than left to SwiftUI: the platform
  /// has no idea that a value it was handed came from a screen reader, and the
  /// `Binding` write of such a change is not required to arrive with an
  /// `onEditingChanged(true)`/`(false)` pair around it.
  ///
  /// Only the direction is the platform's. At a bound there is no next value, and
  /// emitting a triple for a value that did not change is a gesture that never
  /// happened - so nothing is emitted. (Android has the same rule, in
  /// `SliderModel.accessibilityStepToward`.)
  func accessibilityStep(up: Bool) {
    guard !disabled else { return }
    let from = state.displayed
    let to = stepped(from: from, up: up)
    guard to != from else { return }
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

  /// Record what an a11y step probe did. Main thread, next to the probe.
  func noteAccessibilityStepReport(_ report: String) {
    nitroUiAssertMainThread()
    a11yStepReportLock.lock()
    defer { a11yStepReportLock.unlock() }
    a11yStepCount += 1
    // The number makes every report a new string. Without it, two steps that do
    // the same thing - the no-op at a bound, or a step on a one-value range - are
    // byte-identical, and a harness waiting for "the report changed" cannot tell
    // "the probe ran and nothing moved" from "the probe has not run yet".
    a11yStepReport = "#\(a11yStepCount) \(report)"
  }

  /// The frame tick: one event for everything the finger did since the last one.
  private func deliverUnreported() {
    guard let value = state.unreported else { return }
    state.unreported = nil
    refreshAccessibility()
    // The invalidation is on the same frame budget as the emit. `displayed` was
    // written when the finger moved, and SwiftUI's own control renders that
    // write; this is the rest of the hosted body, and at touch-sample rate it
    // would be the thing §11 warns about - a whole-body invalidation per sample.
    objectWillChange.send()
    // Exactly once per emitted event: this is what increments `nativeEvents`,
    // and JS echoes the count back, so an increment nobody emitted would leave
    // the handshake permanently behind and freeze every later `value` write.
    let eventCount = state.user(value)
    onChange?(value, Double(eventCount))
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
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

    // Two different controls, chosen by the range rather than by the caller.
    // SwiftUI's structural identity is the *shape* of this branch, so switching
    // between them rebuilds the slider - which is why the condition reads only
    // min/max/step: it can flip when a range changes, and nothing else moves it.
    // Both halves get the same `Binding` and the same end-of-drag hook, so the
    // value rules above do not care which one drew a frame.
    Group {
      if model.isStepped {
        Slider(value: value, in: bounds, step: model.step, onEditingChanged: editing)
      } else {
        Slider(value: value, in: bounds, onEditingChanged: editing)
      }
    }
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    // The SwiftUI half of the control's accessibility. The authoritative element is
    // ``NitroUiSliderAccessibilityElement``, vended by the view; these modifiers are
    // the same statement made in SwiftUI's language, and they are kept because they
    // cost nothing and because they cover the case UIKit's array does not: if a
    // runtime ever builds its reader tree past `accessibilityElements`, the element
    // it builds is still one element (`children: .ignore` hides the wrapped
    // Slider's own) and still steps by ``SliderModel/stepped(from:up:)`` rather than
    // by the platform's stride.
    //
    // Both halves matter for the same two reasons:
    //
    // - SwiftUI's `Slider` is an adjustable element whose increment is a fraction of
    //   its range, and on a range that does not end on a step - `0...10 step 3`, the
    //   docs' own example - native quantises that fraction back to the value it
    //   started from: the gesture reports success and the thumb stays put.
    // - It closes the hole where VoiceOver adjusted the `Binding` directly: such a
    //   write opens a drag (`drag(to:)` starts one) with no
    //   `onEditingChanged(false)` guaranteed to follow, which would leave the
    //   display link ticking until recycle, no `onSlidingComplete`, and the next
    //   real drag's `onSlidingStart` suppressed. With the children hidden there is
    //   no element left that can write the Binding; the reader's gesture arrives at
    //   `accessibilityStep`, which opens and closes the drag in the same turn.
    .accessibilityElement(children: .ignore)
    .accessibilityValue(Text(model.accessibilityValueText))
    .accessibilityAdjustableAction { direction in
      model.accessibilityStep(up: direction == .increment)
    }
    .modifier(OptionalAccessibility(label: model.accessibilityLabel))
  }
}

/// `.tint()` has no "unset" form, so the default keeps the platform colour.
///
/// A copy of the Switch's private modifier of the same name rather than a shared
/// one: promoting them to `ios/core/` is worth doing when a third component needs
/// them, and until then this file stays as alone as the Switch's.
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

/// An empty `accessibilityLabel(_:)` would silence the Slider's own label, so it
/// is applied only when set. `testID` is deliberately not here, for the Switch's
/// reason: RN already puts it on the component view, and twice means twice.
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

/// The hosted element a screen reader would adjust, or nil.
///
/// Breadth-first, and over *both* kinds of node: SwiftUI vends its accessibility
/// elements as `UIAccessibilityElement`s in a view's `accessibilityElements`
/// rather than as subviews, so a walk of `subviews` alone finds nothing.
///
/// `.adjustable` is the gate, not `responds(to:)`: `accessibilityIncrement` is an
/// `NSObject` category method, so *every* node responds to it and a probe gated
/// on that would "find" the root view and pass for the wrong reason.
///
/// `dump` collects what was walked so the caller can report why it failed; the
/// probe is fire-and-forget on main and cannot answer synchronously, so this
/// subtree listing is the only thing a red test can show.
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

/// Both kinds of node spell their traits `accessibilityTraits` - `UIView` and
/// `UIAccessibilityElement` declare the property separately, so this is the one
/// place that knows both. Anything else in the tree has no traits to read.
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

/// The accessibility element this control answers a screen reader with.
///
/// Vended by the component view (`accessibilityElements`), and the reason is
/// measured rather than stylistic. On iOS 27 the SwiftUI hosting view answers
/// `accessibilityElements == []` to anything that is not an accessibility client -
/// SwiftUI materialises its a11y tree when a reader asks for it - so an element
/// built out of `.accessibility*` modifiers cannot be found, performed or tested
/// from outside VoiceOver. `nuiTestAccessibilityStep` walks the real view tree
/// looking for it and gets `_UIHostingView[0]` with nothing in it, which is a
/// control whose accessibility is only real while a reader happens to be running.
/// Vending the element here makes it a fact about the view at all times, and it is
/// the same object VoiceOver's up/down gesture reaches: UIKit calls
/// `accessibilityIncrement` / `accessibilityDecrement` on the focused element.
///
/// Two things follow from being the element rather than decorating one:
///
/// - **One focus stop.** UIKit does not descend into a view that answers with its
///   own elements, so the wrapped control's element is not a second stop.
/// - **Our steps, not the platform's.** The increment moves by
///   ``SliderModel/accessibilityStep(up:)`` - this Slider's own grid - instead of
///   the platform's stride, which is a fraction of the range and on a range that
///   does not end on a step (`0...10 step 3`, the docs' example) quantises back to
///   where it started. That is what this class is for.
///
/// What this does *not* prove is what a reader says out loud: the label wording,
/// whether the value is re-read after an increment, and the rotor. Those need
/// VoiceOver running and are recorded as a follow-up.
final class NitroUiSliderAccessibilityElement: UIAccessibilityElement {
  private weak var model: SliderModel?
  private weak var anchor: UIView?

  init(model: SliderModel, anchor: UIView) {
    self.model = model
    super.init(accessibilityContainer: anchor)
    // In the anchor's space, so UIKit converts it through the container and the
    // element follows the control when it moves or resizes.
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

  /// Copy the three things a reader announces out of the model.
  ///
  /// Pushed rather than overridden because `UIAccessibilityElement` *stores* these
  /// (`null_resettable` properties, awkward to override) - so the model calls this
  /// at the moments they change instead.
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

/// The Hybrid View React renders as `NitroUiSlider`.
final class HybridNitroUiSlider: HybridNitroUiSliderSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SliderContent>

  /// The element a screen reader focuses, vended by the component view.
  ///
  /// Created once per instance and never replaced: it reads through to the model,
  /// which is the same object for the life of this view including across a
  /// recycle, and ``prepareForRecycle`` leaves the array alone for that reason.
  private lazy var a11yElement = NitroUiSliderAccessibilityElement(
    model: host.model,
    anchor: host
  )

  /// The width half of the fallback, for the unbounded-parent case.
  ///
  /// The three constants below sit *above* `declaresFallback` because a static
  /// stored property's initializer may not spell `Self` ("covariant 'Self' type
  /// cannot be referenced from a stored property initializer"), so what it reads
  /// has to be reachable by plain static lookup - which is also how
  /// `HybridNitroUiSwitch` reads its own.
  private static let fallbackWidth: Double = 351

  /// The measured height of SwiftUI's `Slider` on the operating systems this
  /// component can be verified on.
  ///
  /// D14 asks for a per-OS number, and the honest answer here is *one* number:
  /// an iPhone 17 simulator on iOS 26.4 and on iOS 27.0 both lay the hosted
  /// Slider out at 31 pt at three widths (300, 480, and full-bleed), and no
  /// older runtime exists on the machine this was measured on (D8). Older
  /// systems therefore start from the same guess, which a `fillWidth` control
  /// corrects from its own measure on the first layout either way (D17); the
  /// one number is a measured value that may be one frame stale on an OS nobody
  /// could measure, not a guess dressed up as a per-OS table.
  private static let fallbackHeight: Double = 31

  private static let sizingComponentName = "NitroUiSlider"

  /// See `HybridNitroUiSwitch.declaresFallback`.
  ///
  /// A Slider is the repo's first `fillWidth` control, so only the height is
  /// really ours: the shadow node replaces the width with the Yoga box's whenever
  /// that box is finite (`cpp/NitroUiIntrinsic.hpp:208`). The width still has to
  /// be a plausible number, because an unbounded parent is the one case where it
  /// survives - a Slider in a horizontal scroller lays out at this width until
  /// its own measurement arrives.
  ///
  /// Heights are measured, not guessed (DECISIONS D14), and a `fillWidth` control
  /// that declares too small a height is worse than an `intrinsic` one that does:
  /// its width is never corrected by the control, so the height is the only half
  /// that can be wrong - wrong by however much the track and thumb need, on every
  /// frame before the first measurement.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(
      sizingComponentName,
      fallbackWidth,
      fallbackHeight,
      NitroUiSizingPolicy.fillWidth.rawValue
    )
    return true
  }()

  override init() {
    host = NitroSwiftUIHost(model: SliderModel())
    super.init()
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    // One focus stop for the control, and it is ours. See the element's own
    // comment for why this is not left to SwiftUI's modifiers.
    host.accessibilityElements = [a11yElement]
    host.model.a11yElement = a11yElement
    _ = Self.declaresFallback
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
      // Stored raw. `afterUpdate()` is where it becomes a value, because the
      // range it has to be quantised against may arrive in the same batch, and
      // Nitro does not order props inside one.
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
      // Can also switch which of the two sliders in `SliderContent` draws; the
      // height is the same either way, so no `noteContentSizeMayHaveChanged()`.
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
      // The Switch's reasoning, unchanged: RN's component view already carries
      // it, and Android needs it as a tag.
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

  // The three callbacks are one contract, so they are wired the same way: store,
  // never mark dirty, and never read back - a callback is not state.
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
    // `value`, `defaultValue`, `minimumValue`, `maximumValue` and `step` can all
    // land in one batch, in any order, so none of them is interpreted until the
    // batch is complete. A `value` of 0.3 is only a legal number once the range
    // it belongs to is known - reading it in the `value` setter would mean
    // quantising against last batch's range, which for a Slider whose range is
    // also changing is a value from neither.
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
    // dragged to - which mid-drag it legitimately does not (§11).
    if model.state.reconcile() {
      host.markDirty()
    }
    // A range or step that moved under an existing value can leave the shown
    // value outside it. The same rule, and idempotent, so a value that is
    // already legal - including one a drag is holding - comes back unchanged.
    let shown = model.quantize(model.state.displayed)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // The label, the enabled state and the value are props, and this is the one
    // place a batch of them is finished - so it is the one place the element a
    // reader is looking at has to be told what they now say.
    model.refreshAccessibility()
    host.commit()
  }

  func prepareForRecycle() {
    // Before anything else: a recycled control that resumes somebody else's drag
    // is a real bug, and the frame pump would still be ticking to emit it.
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

  /// The size SwiftUI wants at the width Yoga gave this control.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main.
  func measureContent() throws -> NitroUiSliderSize {
    guard let size = host.contentSize else {
      return NitroUiSliderSize(width: 0, height: 0)
    }
    return NitroUiSliderSize(width: Double(size.width), height: Double(size.height))
  }

  /// Drive one drag through the real interaction pipeline. Test-only; see the
  /// spec's doc comment for why it exists.
  ///
  /// `msPerStep` 0 runs every move in **one** main-thread turn, so the frame pump
  /// never gets a tick between them: a pipeline that emitted per move would
  /// report `steps` events here and reports one. With a positive `msPerStep` each
  /// move waits its turn on the run loop, frames pass between them, and the same
  /// pipeline reports several - which is what stops the first case from passing
  /// for the wrong reason.
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
    // A disabled control is inert: neither platform's control writes its binding,
    // so a simulated drag must not either. Skipping here is what lets the harness
    // assert "disabled emits nothing" at all, since the harness has no drag
    // synthesiser to make the control itself move.
    guard !model.disabled else { return }
    // Every queued step checks this: a test that unmounts mid-drag must not leave
    // the drag running into whatever instance is mounted next.
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

  /// Perform the platform's own adjust action - the selector VoiceOver performs
  /// on an adjustable element - on the hosted element. Test-only; see the spec.
  ///
  /// There is deliberately **no fallback**: if no adjustable element is found the
  /// probe does nothing and says so in the report. Falling back to
  /// ``SliderModel/accessibilityStep(up:)`` would move the value either way and
  /// prove nothing about the path a screen reader actually takes, which is the
  /// whole thing under test.
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
    // Whether the element the reader is handed carries `.notEnabled`. The Slider
    // vends that trait on the same adjustable element (`refresh()`), so this is the
    // iOS side of the flag Android reads off the merged semantics node's `Disabled`
    // property: without it a disabled Slider is a live, adjustable control that does
    // nothing, and the harness has no way to see the reader is being told otherwise.
    // Reported in Android's `disabled=` format so the same assertion is real on both.
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
    // The report answers both halves of "did the platform move my value": that an
    // adjustable element was found, and what the value did when it was acted on.
    model.noteAccessibilityStepReport(
      nitroUiReport("performed \(action) on \(nitroUiDescribeAccessibilityNode(element)) \(from)->\(to) disabled=\(elementDisabled)")
    )
  }

  private var model: SliderModel {
    return host.model
  }
}
