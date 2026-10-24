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
    // A SwiftUI segmented `Picker` is the control iOS users know: one capsule,
    // one segment per option, the selected one filled. It presents nothing, so
    // this host needs no view-controller containment (`needsContainment` stays
    // false, unlike a `.menu` Picker - which is the 0.2 `Picker` component).
    Picker(selection: selection) {
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
/// On a segmented `Picker` a per-instance `.tint(_:)` has **no visible effect**: the
/// selected segment keeps the scheme's accent fill (measured on iOS 27, reviewed as G4
/// F1). `tintColor` is therefore an Android-only prop — see
/// `docs/components/segmented-control.md`. A per-instance iOS tint would mean drawing
/// the row instead of hosting `Picker`; `UIAppearance` on `UISegmentedControl` is not a
/// substitute, because it would restyle every segmented `Picker` in the app. The
/// modifier stays so the prop has one honest code path on both platforms and a
/// per-instance tint can be added here without changing the spec.
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
