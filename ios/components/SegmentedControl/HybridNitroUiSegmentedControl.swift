//
//  HybridNitroUiSegmentedControl.swift
//  react-native-nitro-ui
//
//  The SegmentedControl component: SwiftUI `Picker` with `.pickerStyle(.segmented)`,
//  on the core runtime. The structure is Switch's (`HybridNitroUiSwitch.swift`)
//  because it is the same kind of control - a user-editable value behind the
//  event-count handshake - plus Button's sizing story
//  (`HybridNitroUiButton.swift`) because the control's width comes from its
//  props: the labels *are* the width.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one SegmentedControl. See ``NitroUiModel`` for why this is not `@Published`.
final class SegmentedControlModel: NitroUiModel {
  /// The segment labels, in order. Rendered, so it has to be read by the content.
  var options: [String] = []
  /// The selected index, behind the handshake (core.md §4).
  ///
  /// A `Double`, not an `Int`, for the same reason Slider's `value` is one: the
  /// handshake stores what React sent *raw*, and a raw number cannot be an `Int`
  /// index before it has been normalised against `options` (which may arrive in
  /// this same batch, after it). `afterUpdate()` normalises both `js` and
  /// `displayed`, so everything the content reads is already a whole number in
  /// range.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed, in points of `options`. Applied once, in `afterUpdate()`.
  var defaultSelectedIndex: Double = 0
  var didApplyDefault = false
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent. The sizing engine reads the key out of
  /// Fabric state itself; the host only needs to hear that it changed (see
  /// ``NitroSwiftUIHost/noteSizingKeyChanged()``).
  var sizingKey = ""
  /// `onValueChange`, wired through a stable JS callback.
  var onChange: ((_ index: Double, _ eventCount: Double) -> Void)?

  override init() {
    super.init()
  }

  // MARK: - Pixel probe (test-only)

  /// What the last pixel probe saw, as one line. Written on main, read from JS.
  ///
  /// A separate lock-guarded field rather than a published one for the same reason
  /// Slider's `a11yStepReport` is: the probe runs on main and a Nitro method may not
  /// block for it, so nothing may recompose because this moved.
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

  /// What the row of segments last drew as its selection, as one line.
  ///
  /// Written by ``recordDrawnIndex(_:)`` in the body, so it is a reading of the hosted
  /// control rather than an echo of the `selectedIndex` prop: the handle's
  /// `selectedIndex` answers `state.js`, which is what React sent, so a recycled control
  /// that re-painted at index 0 and one that merely stopped being told otherwise looked
  /// the same to every read-out this file had (F6, closing X4's blind spot). Answers
  /// `displayed=<index>`, or `displayed=none` before the body has run.
  private var drawnIndexReport = "displayed=none"

  /// Record what the drawing code was handed. Plain storage plus the lock, never
  /// `@Published`: publishing from the body would ask for the recomposition that has
  /// just happened.
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

  /// Forget the last probe, for recycling.
  ///
  /// Android's model `reset()` does this, and the reason is worth the symmetry rather
  /// than the asymmetry: a recycled view whose report still described another owner's
  /// pixels would let a test read a hit that is not its control's. The `n=` counter
  /// keeps that from being silent, but "empty until the next probe" is the state a
  /// fresh mount should start in on both platforms.
  func clearPixelReport() {
    pixelReportLock.lock()
    pixelReport = ""
    pixelReportLock.unlock()
  }

  /// Forget the last drawn index, for recycling (see ``clearPixelReport()`` for why
  /// test state goes back to "nothing yet" rather than to a plausible-looking 0).
  func clearDrawnIndex() {
    pixelReportLock.lock()
    drawnIndexReport = "displayed=none"
    pixelReportLock.unlock()
  }

  /// A segment index that exists in `options`, as a whole number in range.
  ///
  /// The one rule of this component: `options` and the selection arrive in one
  /// batch, in no particular order (core.md §3), so neither can be checked
  /// against the other in a setter - this runs in `afterUpdate()`, where the
  /// batch is finished. Anything that is not a usable number goes to the first
  /// segment; a number past the end goes to the last one. Empty `options` has no
  /// valid index at all, and the answer there is only ever read by content that
  /// draws no segments.
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

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct SegmentedControlContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: SegmentedControlModel

  init(model: SegmentedControlModel) {
    self.model = model
  }

  var body: some View {
    // The reading of the hosted row that `nuiTestDisplayedIndex()` answers with, taken
    // here where the selection is read in order to paint. It is the *same expression*
    // the `selection` binding below hands the `Picker`, and that is the whole point:
    // recording a re-clamped or derived number would let this read-out report a
    // different segment than the one that was drawn. A commit that stored the index
    // without the body ever being handed it fails the test that reads this, which is
    // what makes it a reading of the control rather than an echo of the prop (Progress
    // does the same with its value). The explicit `return` below is what lets this
    // statement sit in a `ViewBuilder`: without one, a `Void` statement is the body's
    // value and the compiler refuses it (`type '()' cannot conform to 'View'`).
    let drawn = Int(model.state.displayed)
    model.recordDrawnIndex(drawn)

    // A SwiftUI segmented `Picker` is the control iOS users know: one capsule,
    // one segment per option, the selected one filled. It presents nothing, so
    // this host needs no view-controller containment (`needsContainment` stays
    // false, unlike a `.menu` Picker - which is the 0.2 `Picker` component).
    return Picker(selection: selection) {
      // `id: \.offset`, not the label: two options may carry the same text, and
      // a duplicate identity in a `ForEach` is a broken list, not a duplicate
      // segment. The `tag` is the index for the same reason.
      ForEach(Array(model.options.enumerated()), id: \.offset) { index, label in
        Text(label)
          .tag(index)
      }
    } label: {
      // The style draws no label, and `labelsHidden()` makes sure none is
      // reserved for it either. A `Picker` always *has* a label argument.
      EmptyView()
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .disabled(model.disabled)
    .modifier(OptionalSegmentedTint(color: model.tint))
    .modifier(OptionalSegmentedAccessibility(label: model.accessibilityLabel))
  }

  /// The selection, native-owned and optimistic (core.md §4).
  ///
  /// The setter paints the new segment *before* JS has seen the event, so there
  /// is no visual latency, and emits `(index, eventCount)` - the same shape the
  /// Switch uses, so the same `useControlled` in JS. A `selectedIndex` React
  /// sends later either lands on the next `afterUpdate()` (accepted) or the
  /// handshake reverts `displayed`, which is the snap-back.
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

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
///
/// On a segmented `Picker` a per-instance `.tint(_:)` has **no visible effect** (G4 F1,
/// and measured again for F3), and `tintColor` is therefore an Android-only prop - see
/// `docs/components/segmented-control.md`, Limits. This is what F3 measured, on iOS 27
/// on the leased simulator and nowhere else: the brief's bar was "no per-instance
/// approach on iOS 15.1+" and the pre-liquid-glass releases were not tested, so treat
/// everything below as one OS's observation rather than UIKit's contract.
///
/// The row is reachable. The pixel probe walks this control's own hosted subtree and
/// finds a real `UISegmentedControl` inside it (`UIKitPlatformViewHost<
/// PlatformViewRepresentableAdaptor<SystemSegmentedControl>>`), and writing its
/// `selectedSegmentTintColor` paints the segment: 9253 pixels of the requested magenta
/// in a 102x31 pt control, against zero for the untinted look. That is the opposite of
/// what the previous round's docs said, which claimed the knob was unreachable.
///
/// It does not stay painted. After the first change of selection the probe reads
/// `hits=0` on that same control - the colour is off the screen - while the property
/// itself still reports the colour that was written (seen through a temporary
/// diagnostic since removed from this file; re-run the probe with a
/// `selectedSegmentTintColor` read added to say it again). Re-writing the value did not
/// put it back at either of the two points that were tried: inline on the control's own
/// `.valueChanged`, and in a `CATransaction` completion block, which is the first moment
/// after the selection animation is genuinely over. Those two pushes were in the build
/// that produced `hits=0`, so this is not "re-writing was not attempted".
///
/// Which is why the workaround is not taken. A tint bought this way shows on the first
/// frame and vanishes on the first tap, and whether it survives depends on which OS
/// release is doing the compositing. That is worse for an app than a prop that has never
/// done anything.
///
/// Two claims this deliberately does not make, because they came from the throwaway
/// version that tried the push and are not facts about iOS. One: that iOS cannot *undo* a
/// tint. It can - that version kept the colour only because the view doing the pushing
/// existed solely while a tint was asked for, and it is not in this repo (`git log
/// --all -S "selectedSegmentTintColor ="` finds no such code). Two: that a recycled host
/// would hand one app's colour to the next. Both were prototype defects and saying them
/// here would put a reason in print that no one can reproduce.
///
/// The `.tint(_:)` call stays: it is the honest declarative statement, it costs nothing,
/// and the probe is the instrument that says the day either SwiftUI or UIKit makes a
/// per-instance tint real - which is the day the prop, the docs and the harness's iOS
/// half change together.
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

/// An empty `accessibilityLabel(_:)` would silence the segments' own labels, so it
/// is applied only when set. `testID` deliberately does *not* go in here: RN
/// already puts it on the component view, and putting it on the SwiftUI element
/// too would make the view match a testID query twice.
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

/// The Hybrid View React renders as `NitroUiSegmentedControl`.
final class HybridNitroUiSegmentedControl: HybridNitroUiSegmentedControlSpec, RecyclableView {
  private let host: NitroSwiftUIHost<SegmentedControlContent>

  /// This component's name in the sizing engine: `HybridNitroUiSegmentedControlComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiSegmentedControl"

  /// The size to lay a SegmentedControl out with before anything has been
  /// measured, in points.
  ///
  /// Like a Button, this component has many configurations (one per option list)
  /// while the engine's fallback is keyed by component alone, so this is one
  /// number: three short segments at this OS's regular control size. Every other
  /// option list is a first instance of *its own* configuration and gets corrected
  /// the turn it measures (`docs/architecture/sizing.md` §9).
  ///
  /// Measured on iOS 27 (iPhone Air simulator, regular text size) with
  /// `options = ["One", "Two", "Three"]`: 165.0 x 31.0 pt. That is the real
  /// measurement, not a round number: a segmented `Picker` is 31 pt tall for any
  /// option list at this OS's regular size (measured 31 pt for one option and for
  /// four long ones alike), so the height is the half of this pair that belongs
  /// here at all. The width moves with the labels - 44 pt for one segment,
  /// 296 pt for four long ones - and a wrong width only costs a cold
  /// configuration one frame's horizontal gap.
  /// `docs/components/segmented-control.md` has the measured table.
  ///
  /// A fallback smaller than the control is the dead-touch story in `core.md` §7,
  /// which is why a configuration whose labels are wider than these is corrected
  /// rather than clipped: it is laid out at 165 for one frame and told its real
  /// width in the same turn it measures.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process
  /// (the static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a shadow node before it creates any view, so a
  /// fallback declared from `init` is one measure too late for the first instance
  /// (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The declared fallback - see ``declaresFallback``.
  private static let fallbackSize = (width: 165.0, height: 31.0)

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: SegmentedControlModel())
    super.init()
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A segmented control presents nothing; only a `.menu` Picker would need a
    // view-controller parent for its popup.
    host.needsContainment = false
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before one can be measured, and a host
    // built without that table still gets its fallback here.
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
      // The labels are the control's width, and nothing else will notice: no
      // bounds change and no trait change is coming. `markDirty` alone would
      // repaint at the old size and leave Yoga told the old width.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var selectedIndex: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      // The *normalised* index, not the number React sent - same as Slider's
      // `value` getter, and what makes a clamped selection visible to a test.
      return .second(SegmentedControlModel.clamp(js, to: model.options.count))
    }
    set {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up, and the number only means something once `options` is
      // known. Both happen in `afterUpdate()`.
      model.state.js = newValue.asType(Double.self)
    }
  }

  var defaultSelectedIndex: Double {
    get { model.defaultSelectedIndex }
    set {
      // Stored raw. A Switch applies its `defaultValue` in the setter because a
      // Bool has nothing to normalise against; an index has `options`, which may
      // arrive in this same batch after it (core.md §3).
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
      // Rendered, not bookkeeping: the label goes on the hosted element, so it
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
      // the declared fallback; the new configuration may measure exactly what the
      // old one did, and that is the size the host's dedupe would swallow the
      // correcting report against (review F1). Guarded, because React re-sends an
      // unchanged key on every render and the reset costs a measure.
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
    // `options`, `selectedIndex` and `defaultSelectedIndex` can all land in one
    // batch in any order, so none of them is interpreted until the batch is
    // complete - an index of 4 only means something once the option list it
    // belongs to is known (core.md §3, and Slider's `value` does the same thing
    // against its range).
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
    // The event-count handshake decides whether React's index wins over what the
    // user just tapped - including a change JS rejected (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    // An option list that shrank under an existing selection can leave the shown
    // index past the end. The same rule, and idempotent, so an index that is
    // already legal comes back unchanged.
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

  /// The size SwiftUI wants for this segmented control, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
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
  /// Count the pixels this control draws that are `color`, and store the answer.
  ///
  /// Posted to main rather than run inline: reading pixels needs the layer rendered,
  /// and a Nitro method may not block for main (`NitroUiMainThread.swift`'s rule), so
  /// this writes what it found for ``nuiTestPixelReport()`` to read back — the same
  /// two-method shape Slider's `nuiTestAccessibilityStep` pair uses.
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

  /// What the row displays - see `NitroUiSegmentedControlMethods.nuiTestDisplayedIndex`.
  func nuiTestDisplayedIndex() throws -> String {
    return model.readDrawnIndex()
  }
}

/// Per-channel-sum budget for "this pixel is the colour". The selected capsule is
/// composited over the material behind it, so what reaches a sampled pixel is the
/// tint plus what the glass lets through — close to the requested colour, rarely
/// exactly it. The budget is deliberately small: the colours a test probes for are
/// chosen to be nothing the control draws on its own, and a false "hit" would make
/// the whole instrument meaningless.
private let nitroUiPixelTolerance = 30

/// The red/green/blue of an ARGB `processColor` int, 0…255, or nil for "no colour".
///
/// Decoded from the number rather than through a `UIColor`, for the same reason
/// `UIColor.init(nitroUiARGB:)` exists: iOS and Android hand over the same colour as
/// two different `Double`s, and only the low 32 bits matter.
private func nitroUiARGBChannels(_ value: Double) -> (red: Int, green: Int, blue: Int)? {
  guard value.isFinite, value >= -2_147_483_648, value <= 4_294_967_295 else {
    return nil
  }
  let argb = UInt32(truncatingIfNeeded: Int64(value))
  return (
    Int((argb >> 16) & 0xff), Int((argb >> 8) & 0xff), Int(argb & 0xff)
  )
}

/// What the pixels `view` is drawing say about `color`, as one line for a test's
/// failure message. See ``HybridNitroUiSegmentedControl/nuiTestPixelProbe(color:)``.
///
/// `afterScreenUpdates: true` is the half that matters: it asks for what is on screen
/// rather than what the layer tree said at the start of the transaction, so a colour
/// applied one runloop turn earlier is what gets read. The full subtree is sampled,
/// because which segment is selected — and therefore where the colour is — is the
/// thing under test.
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
  // The backdrop is the part that makes this measurement mean anything on iOS 26+.
  // The selected segment is a liquid-glass lens, and captured on its own it comes back
  // *translucent*: over a control 102x31 points, only 566 pixels arrived opaque, and
  // they were the labels and the track - the fill itself was filtered out, so the probe
  // reported "no such colour" for a colour the control was demonstrably asked to draw.
  // Compositing over a neutral mid grey first makes every pixel comparable, and keeps
  // the comparison fair in both directions: a light tint and a dark one both move the
  // mean away from the middle.
  context.setFillColor(UIColor(white: 0.5, alpha: 1).cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
  var hits = 0
  var redSum = 0, greenSum = 0, blueSum = 0
  var closest = (distance: Int.max, red: 0, green: 0, blue: 0)
  for row in 0..<height {
    for column in 0..<width {
      let offset = row * bytesPerRow + column * 4
      // Premultiplied, and composited over the backdrop above, so every pixel here is
      // opaque and its channels are already final - sum them as they are. (The first
      // version of this multiplied each channel by the pixel's alpha and then divided by
      // the pixel count, which left every channel 255x too large and let the sum spill
      // out of the six hex digits it prints into: `mean=#8FAFB6EB`. The backdrop is what
      // makes the alpha term unnecessary, which is the point of putting it there.)
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
  // One division per channel, then the three together as hex. Same arithmetic as
  // Android's `nitroUiSamplePixels`, so a `mean` read off either platform is the same
  // number for the same drawing.
  let mean = (redSum / area) << 16 | (greenSum / area) << 8 | blueSum / area
  return String(
    format: "size=%dx%d want=#%02X%02X%02X hits=%d mean=#%06X closest=#%02X%02X%02X",
    Int(bounds.width), Int(bounds.height), target.red, target.green, target.blue,
    hits, mean, closest.red, closest.green, closest.blue
  )
}
