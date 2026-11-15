// The Picker component: SwiftUI's `Picker` with `.pickerStyle(.menu)` or `.wheel`. A menu is
// as wide as its title and a wheel as wide as its box, so the variant picks the sizing policy.

import NitroModules
import SwiftUI
import UIKit

final class PickerModel: NitroUiModel {
  /// The choices, in order.
  var options: [String] = []
  /// The selected index. A raw `Double` rather than an `Int` because it cannot be normalised
  /// until `options` is known, and that may arrive later in the same batch; `afterUpdate()`
  /// normalises it.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed. Applied once, in `afterUpdate()`.
  var defaultSelectedIndex: Double = 0
  var didApplyDefault = false
  /// `'menu'` or `'wheel'`. Never `'radio'`: iOS has no radio-group picker style, so that
  /// name resolves to the menu.
  var variant = "menu"
  /// The picker's label. Drawn where the platform draws one, and used as the
  /// accessibility label when the caller did not give a better one.
  var label: String?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The sizing engine reads the key from Fabric state; the host only needs to hear that it
  /// changed.
  var sizingKey = ""
  var onChange: ((_ index: Double, _ eventCount: Double) -> Void)?
  override init() {
    super.init()
  }

  /// Whether this instance lays out as a wheel (`fillWidth`) or a menu (`intrinsic`).
  static func isWheel(_ variant: String) -> Bool {
    return NitroUiPickerVariant.isWheel(variant)
  }

  /// The control a variant name means on this platform. The wrapper resolves the variant
  /// before sending it, so this is a guard.
  static func resolvedVariant(_ variant: String) -> String {
    return NitroUiPickerVariant.resolved(variant)
  }

  /// A choice index that exists in `options`, as a whole number in range. Runs in
  /// `afterUpdate()`, never in a setter: `options` and the selection arrive in one batch in
  /// no particular order. A non-number goes to the first choice, and a number past the end
  /// to the last.
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

  /// The user chose `requested`: show it and emit it. The one place a pick is applied.
  ///
  /// A pick that changes nothing reports nothing, so both platforms report the same events.
  /// The index is clamped and a disabled control is inert, because a menu that stays open
  /// while `disabled` flips or `options` shrinks can still write the binding.
  func applyUserSelection(_ requested: Double) {
    guard !disabled else { return }
    let index = Self.clamp(requested, to: options.count)
    guard index != state.displayed else { return }
    let eventCount = state.user(index)
    objectWillChange.send()
    onChange?(index, Double(eventCount))
    // No size report here, although the width follows the title: the engine would file it
    // under the key of the last shadow measure, which still names the previous title. The
    // props batch that re-keys the instance measures instead.
  }
}

struct PickerContent: NitroUIContent {
  @ObservedObject private var model: PickerModel

  init(model: PickerModel) {
    self.model = model
  }

  var body: some View {
    // Two branches, because the two styles are different concrete types and SwiftUI has no
    // type-erased picker style.
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

  @ViewBuilder private var optionsPicker: some View {
    Picker(selection: selection) {
      // `id: \.offset` and an index `tag`, not the text: two choices may carry the same label.
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

  /// Optimistic: the setter shows the new choice before JS has seen the event.
  private var selection: Binding<Int> {
    Binding(
      get: { Int(model.state.displayed) },
      set: { requested in model.applyUserSelection(Double(requested)) }
    )
  }
}

/// `.tint()` has no "unset" form, so it is applied only when a colour is set. The menu style
/// paints its title and chevron with it; the wheel ignores it.
private struct OptionalPickerTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the control's own label, so it is applied
/// only when there is one. `testID` is not applied here: React Native already puts it on the
/// component view, and a second copy would match a testID query twice.
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

final class HybridNitroUiPicker: HybridNitroUiPickerSpec, RecyclableView {
  private let host: NitroSwiftUIHost<PickerContent>

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiPicker"

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// shadow node before it creates any view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// In points. The menu variant's size for short titles, with the height rounded up: a
  /// fallback smaller than the control makes SwiftUI paint outside its box. A wheel takes
  /// its width from its box.
  private static let fallbackSize = (width: 72.0, height: 35.0)

  override init() {
    host = NitroSwiftUIHost(model: PickerModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A `.menu` Picker shows a popup, and a hosting controller that is nobody's child has no
    // view controller to present it from.
    host.needsContainment = true
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
      // The titles decide the menu's width, and no bounds or trait change follows to trigger
      // a new measure.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var selectedIndex: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      // The normalised index, not the number React sent.
      return .second(PickerModel.clamp(js, to: model.options.count))
    }
    set {
      // Not visual on its own: `afterUpdate()` normalises it against `options`, which can be
      // in this same batch, and shows it once the event count says JS has caught up.
      model.state.js = newValue.asType(Double.self)
    }
  }

  var defaultSelectedIndex: Double {
    get { model.defaultSelectedIndex }
    set {
      // Stored raw: `options`, which it is normalised against, may arrive after it.
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
      let next = PickerModel.resolvedVariant(newValue)
      guard next != model.variant else { return }
      model.variant = next
      // The variant changes the sizing policy as well as the size.
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
      // A label may change the control's width.
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
      // The label is on the hosted element, so it needs a commit to reach VoiceOver.
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
      // A new key may measure exactly what the old one did, and the host would drop that
      // report as a duplicate. Guarded, because React re-sends an unchanged key every render.
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
    // The index as the previous batch left it, to tell at the end whether the shown title
    // moved.
    let beforeShown = model.state.displayed
    // `options`, `selectedIndex` and `defaultSelectedIndex` can land in one batch in any
    // order, so nothing is interpreted until the batch is complete.
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
    // The event counts decide whether React's index wins over what the user just chose.
    if model.state.reconcile() {
      host.markDirty()
    }
    // A choice list that shrank can leave the shown index past the end.
    let shown = PickerModel.clamp(model.state.displayed, to: optionCount)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // A menu shows one title, so any move of the shown index can change the width. Flagged
    // before `commit()`, the only place the measure may run: measuring here would answer for
    // content that has not been drawn yet.
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

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiPickerSize {
    guard let size = host.contentSize else {
      return NitroUiPickerSize(width: 0, height: 0)
    }
    return NitroUiPickerSize(width: Double(size.width), height: Double(size.height))
  }

  /// Test-only: picks the row for `index` through the same path as a real pick, on main.
  func nuiTestSelect(index: Double) throws {
    let model = host.model
    let run = { model.applyUserSelection(index) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Test-only. A SwiftUI `Picker` hands its menu to the system's presentation, so there is
  /// no popup to measure: every field answers `-1` ("not measurable here").
  func nuiTestMenuReport() throws -> String {
    return "expanded=-1;live=-1;anchor=-1,-1,-1,-1;menu=-1,-1,-1,-1;rows=-1;drawn=-1"
  }

  private var model: PickerModel {
    return host.model
  }
}
