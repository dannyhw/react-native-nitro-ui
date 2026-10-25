//
//  HybridNitroUiPicker.swift
//  react-native-nitro-ui
//
//  The Picker component: SwiftUI `Picker` with `.pickerStyle(.menu)` or `.wheel`,
//  on the core runtime. The data model and the sizing story are
//  SegmentedControl's (`HybridNitroUiSegmentedControl.swift`) — same controlled
//  index, same clamps, same escaped key — plus Progress's two-policy switch
//  (`HybridNitroUiProgress.swift`) because the variant changes what the control's
//  width *means*: a menu is as wide as its title, a wheel is as wide as its box.
//
//  This is also the library's first control that *presents* UI, so it is the first
//  one that needs view-controller containment (`needsContainment`).
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Picker. See ``NitroUiModel`` for why this is not `@Published`.
final class PickerModel: NitroUiModel {
  /// The choices, in order. Rendered, so it has to be read by the content.
  var options: [String] = []
  /// The selected index, behind the handshake (core.md §4).
  ///
  /// A `Double`, not an `Int`, for the same reason SegmentedControl's is one: the
  /// handshake stores what React sent *raw*, and a raw number cannot be an `Int`
  /// index before it has been normalised against `options` (which may arrive in
  /// this same batch, after it). `afterUpdate()` normalises both `js` and
  /// `displayed`, so everything the content reads is already a whole number in
  /// range.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed, in points of `options`. Applied once, in `afterUpdate()`.
  var defaultSelectedIndex: Double = 0
  var didApplyDefault = false
  /// `'menu'` or `'wheel'`; the wrapper normalises, and the setter guards again.
  var variant = "menu"
  /// The picker's label. Drawn where the platform draws one, and used as the
  /// accessibility label when the caller did not give a better one.
  var label: String?
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

  /// Whether this instance lays out as a wheel (`fillWidth`) or a menu
  /// (`intrinsic`). One string in, one bool out, so the setter and the content
  /// cannot disagree about what the variant meant.
  static func isWheel(_ variant: String) -> Bool {
    return variant == "wheel"
  }

  /// A choice index that exists in `options`, as a whole number in range.
  ///
  /// Identical to ``SegmentedControlModel/clamp:to:`` for the same reason:
  /// `options` and the selection arrive in one batch, in no particular order
  /// (core.md §3), so neither can be checked against the other in a setter - this
  /// runs in `afterUpdate()`, where the batch is finished. Anything that is not a
  /// usable number goes to the first choice; a number past the end goes to the
  /// last one. Empty `options` has no valid index at all, and the answer there is
  /// only ever read by content that draws nothing.
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

  /// The user chose `requested` - paint it and emit it.
  ///
  /// The one place a pick is applied, so the SwiftUI binding and the
  /// `nuiTestSelect` harness hook cannot disagree about what a choice means.
  ///
  /// A pick that changes nothing is not a change. Measured on iPhone 17 in G6, a
  /// `.menu` Picker writes its binding even when the row the user tapped is the
  /// one already on show - so the guard has to live here, or iOS reports a choice
  /// Android refuses to report and the two platforms disagree about what
  /// `onChange` means (`HybridNitroUiPicker.kt`). It is also what makes a refused
  /// choice observable: only a rolled-back selection makes the *next* tap on that
  /// row a fresh choice.
  ///
  /// The index is clamped first and a disabled control is inert: the binding
  /// cannot normally emit either (SwiftUI's `.disabled` stops it, and a row that
  /// is not in `options` has no tag), but a menu that stays open while `disabled`
  /// flips or `options` shrinks can, and an emitted index has to exist in the list
  /// the wrapper reads the label out of.
  func applyUserSelection(_ requested: Double) {
    guard !disabled else { return }
    let index = Self.clamp(requested, to: options.count)
    guard index != state.displayed else { return }
    let eventCount = state.user(index)
    objectWillChange.send()
    onChange?(index, Double(eventCount))
    // And nothing about sizing. The width follows the title, so a choice looks like
    // a size change that no props batch has named yet - and answering it here is
    // what poisoned the cache (G6 review M1): the engine files a report under the
    // key of the last shadow measure, which still names the title this choice
    // replaced. Measured on iPhone 17, the deferred measure this used to schedule
    // could not even answer the new title - `sizeThatFits` on the next turn still
    // saw the layout of the previous one - so it cost a measure and reported the
    // *old* width under the old key. The batch that re-keys the instance measures
    // instead: `noteSizingKeyChanged()` plus the box the engine then gives it. A
    // rejected choice needs nothing either - the rollback re-measures through
    // `shown != beforeShown` under the key that still names the right title.
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct PickerContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: PickerModel

  init(model: PickerModel) {
    self.model = model
  }

  var body: some View {
    // The style is chosen per variant, in two branches, because the two styles
    // are two different concrete types and SwiftUI has no type-erased picker
    // style to fold them into. A branch keeps each one's structural identity,
    // which is also what `NitroUIContent` is for (`ios/core/NitroUIContent.swift`).
    Group {
      if PickerModel.isWheel(model.variant) {
        optionsPicker.pickerStyle(.wheel)
      } else {
        optionsPicker.pickerStyle(.menu)
      }
    }
    .disabled(model.disabled)
    .modifier(OptionalPickerTint(color: model.tint))
    .modifier(OptionalPickerAccessibility(label: model.accessibilityLabel ?? model.label))
  }

  /// The `Picker` itself: the options, the selection binding and the label.
  ///
  /// A `Picker` always *has* a label argument; what a style does with it is the
  /// style's business, which is why the label is passed through rather than drawn
  /// by hand next to the control.
  @ViewBuilder private var optionsPicker: some View {
    Picker(selection: selection) {
      // `id: \.offset`, not the text: two choices may carry the same label, and a
      // duplicate identity in a `ForEach` is a broken list, not a duplicate row.
      // The `tag` is the index for the same reason.
      ForEach(Array(model.options.enumerated()), id: \.offset) { index, label in
        Text(label)
          .tag(index)
      }
    } label: {
      if let label = model.label {
        Text(label)
      } else {
        EmptyView()
      }
    }
  }

  /// The selection, native-owned and optimistic (core.md §4).
  ///
  /// The setter paints the new choice *before* JS has seen the event, so there is
  /// no visual latency, and emits `(index, eventCount)` - the same shape the
  /// Switch and SegmentedControl use, so the same `useControlled` in JS. A
  /// `selectedIndex` React sends later either lands on the next `afterUpdate()`
  /// (accepted) or the handshake reverts `displayed`, which is the snap-back.
  ///
  /// Choosing the row that is already selected does not write the binding at all -
  /// a SwiftUI `Picker` binding only writes when the selection moves - so it
  /// reports nothing, and Android suppresses its no-op to match.
  private var selection: Binding<Int> {
    Binding(
      get: { Int(model.state.displayed) },
      set: { requested in model.applyUserSelection(Double(requested)) }
    )
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
///
/// Unlike a segmented `Picker`, which ignores a per-instance tint (G4 F1), the
/// **menu** style takes it and paints the title and the chevron. The **wheel**
/// does not: measured on iOS 27 its rows keep the scheme's label colours and its
/// selection band stays grey, so a tinted wheel looks untinted. The modifier is
/// applied to both anyway - it is harmless, and correct if Apple changes this.
/// `docs/components/picker.md` records what each variant shows, and
/// `docs/tasks/G6-picker/ios-light-lower-tint-wheel.png` is the evidence.
private struct OptionalPickerTint: ViewModifier {
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

/// An empty `accessibilityLabel(_:)` would silence the control's own label, so it
/// is applied only when there is one. `testID` deliberately does *not* go in here:
/// RN already puts it on the component view, and putting it on the SwiftUI element
/// too would make the view match a testID query twice.
private struct OptionalPickerAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiPicker`.
final class HybridNitroUiPicker: HybridNitroUiPickerSpec, RecyclableView {
  private let host: NitroSwiftUIHost<PickerContent>

  /// This component's name in the sizing engine: `HybridNitroUiPickerComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiPicker"

  /// The size to lay a Picker out with before anything has been measured, in
  /// points.
  ///
  /// One pair for the component, which is what the engine can hold: the menu
  /// variant is the default, so these are the menu's numbers (a wheel's box is
  /// the caller's width anyway, and a `fillWidth` shadow node replaces the width
  /// with the box's, so the width half of a fallback never reaches it - see
  /// Progress, which likewise declares its linear shape).
  ///
  /// Measured on iOS 27 (iPhone 17 simulator, regular text size) with
  /// `options = ["One", "Two", "Three"]`, `selectedIndex = 0`, no label: the
  /// control measures **72.00 x 34.67** pt, and ``fallbackSize`` is that with the
  /// height rounded up - a fallback smaller than the control is the dead-touch
  /// story in `core.md` §7, so the rule in this library is to round up.
  /// `docs/components/picker.md` has the whole measured table (a menu is 62.67 pt
  /// wide for the title `Go` and 360.33 pt for a 40-character one, so this pair is
  /// a middle of the road guess at a button, not a boundary).
  ///
  /// A menu whose title is longer than 72 pt is laid out at the fallback for one
  /// frame and told its real width in the turn it measures.
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
  private static let fallbackSize = (width: 72.0, height: 35.0)

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: PickerModel())
    super.init()
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // The library's first presenting control: a `.menu` Picker shows a popup, and
    // a `UIHostingController` that is nobody's child has no view controller to
    // present it from (`core.md` §2).
    host.needsContainment = true
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before one can be measured, and a host
    // built without that table still gets its fallback here.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<PickerContent> {
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
      // The titles decide the button's width on both platforms, and nothing else
      // will notice: no bounds change and no trait change is coming.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var selectedIndex: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      // The *normalised* index, not the number React sent - same as Slider's
      // `value` getter, and what makes a clamped selection visible to a test.
      return .second(PickerModel.clamp(js, to: model.options.count))
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
      // Stored raw. An index has `options` to normalise against, and that may
      // arrive in this same batch after it (core.md §3).
      model.defaultSelectedIndex = newValue
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var variant: String {
    get { model.variant }
    set {
      // The wrapper is the only writer and sends one of two names; anything else
      // behaves as `'menu'`, which is what the spec documents.
      let next = PickerModel.isWheel(newValue) ? "wheel" : "menu"
      guard next != model.variant else { return }
      model.variant = next
      // The one prop that changes the control's *size policy*: a menu button is as
      // wide as its title, a wheel is as wide as its box and measures its own
      // height - so the policy moves with it and the fitting size is taken again
      // (`docs/architecture/sizing.md` §5 point 5), exactly as Progress does
      // between its linear and circular shapes.
      host.sizingPolicy = PickerModel.isWheel(next) ? .fillWidth : .intrinsic
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var label: Variant_NullType_String {
    get { model.label.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.label else { return }
      model.label = next
      host.markDirty()
      // Rendered on Android's field and used as this control's fallback
      // accessibility label here; on iOS a menu draws no separate label, so
      // whether the width moves is a measured question, not an assumed one - and
      // paying one extra measure on a label change is cheap either way.
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
    // The index as the *previous* batch left it, so the end of this one can tell
    // whether the shown title moved.
    let beforeShown = model.state.displayed
    // `options`, `selectedIndex` and `defaultSelectedIndex` can all land in one
    // batch in any order, so none of them is interpreted until the batch is
    // complete - an index of 4 only means something once the choice list it
    // belongs to is known (core.md §3).
    if let js = model.state.js {
      let clamped = PickerModel.clamp(js, to: optionCount)
      if clamped != js { model.state.js = clamped }
    }
    if model.state.js == nil, !model.didApplyDefault, optionCount > 0 {
      model.didApplyDefault = true
      let seeded = PickerModel.clamp(model.defaultSelectedIndex, to: optionCount)
      if seeded != model.state.displayed {
        model.state.displayed = seeded
        host.markDirty()
      }
    }
    // The event-count handshake decides whether React's index wins over what the
    // user just chose - including a change JS rejected (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    // A choice list that shrank under an existing selection can leave the shown
    // index past the end. The same rule, and idempotent, so an index that is
    // already legal comes back unchanged.
    let shown = PickerModel.clamp(model.state.displayed, to: optionCount)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // A menu button shows one title, so *any* move of the shown index in this
    // batch - seeded, reconciled in, or clamped by a shrinking list - can move the
    // width, and no bounds or trait change is coming to notice it
    // (`docs/architecture/sizing.md` §5 point 5). Flagged before `commit()`, which
    // is the one place the measure is allowed to run (measuring here would answer
    // for content that has not been painted yet).
    if shown != beforeShown {
      host.noteContentSizeMayHaveChanged()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.options = []
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.defaultSelectedIndex = 0
    model.didApplyDefault = false
    model.variant = "menu"
    model.label = nil
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    // The policy is per-host state, not model state: a recycled host that stayed
    // `fillWidth` would answer a menu's next measure with the box's width.
    host.sizingPolicy = .intrinsic
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this picker, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiPickerSize {
    guard let size = host.contentSize else {
      return NitroUiPickerSize(width: 0, height: 0)
    }
    return NitroUiPickerSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press the row for `index`, through the same path a real row press takes.
  ///
  /// Test-only; see the spec for why it exists. Hops to the main thread because
  /// JS calls it and a real press runs on the UI thread (core.md §5), and the hop
  /// is what keeps the timing of a real pick rather than flattening it.
  func nuiTestSelect(index: Double) throws {
    let model = host.model
    let run = { model.applyUserSelection(index) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  private var model: PickerModel {
    return host.model
  }
}
