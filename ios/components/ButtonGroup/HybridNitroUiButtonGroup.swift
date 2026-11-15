// The ButtonGroup component: a row of commands, optionally with independent toggles, that moves the
// items it cannot fit into an overflow menu.

import NitroModules
import SwiftUI
import UIKit

enum ButtonGroupAppearance: String {
  /// 8 pt of space; each item keeps its own capsule.
  case standard
  /// `ControlGroup`'s connected track, or the standard row when a toggle is in it.
  case connected
}

/// Which half of an item's label the group draws.
enum ButtonGroupLabelStyle: String {
  /// In a connected group: icons only when the item has an icon. Elsewhere: icon and title.
  case automatic
  case titleOnly
  case iconOnly
  case titleAndIcon
}

/// One item, as the content draws it. Parsed once per props batch: the wire struct is a C++-backed
/// type whose accessors convert on every read, so the content must not walk it per render.
struct ButtonGroupItemState: Equatable {
  let id: String
  let title: String
  /// A symbol name that resolved to a real SF Symbol, or `nil`.
  let systemImage: String?
  let disabled: Bool
  let toggle: Bool
}

func parseButtonGroupItems(_ items: [NitroUiButtonGroupItem]) -> [ButtonGroupItemState] {
  items.map { item in
    ButtonGroupItemState(
      id: item.id,
      title: item.title,
      // A name that does not resolve would draw the missing-symbol placeholder and say nothing
      // useful to VoiceOver.
      systemImage: item.systemImage?
        .asType(String.self)
        .flatMap { UIImage(systemName: $0) == nil ? nil : $0 },
      disabled: item.disabled,
      toggle: item.toggle
    )
  }
}

/// The event-count handshake for a set of toggles. `js` is the whole checked set React sent, but a
/// write only moves the ids in `controlled`, so controlled and uncontrolled items can share a
/// group. A write is stale while `jsEvents < nativeEvents`. One counter for the whole group:
/// per-item counts would let one item's stale write be accepted on the strength of another item's
/// event.
struct ButtonGroupCheckedSet {
  /// What the row shows. A set of item ids.
  var displayed: Set<String> = []
  /// The last checked set React sent, or `nil` while nothing in the group is controlled.
  var js: Set<String>?
  /// The ids a write to ``js`` may move.
  var controlled: Set<String> = []
  /// How many flips native emitted.
  var nativeEvents: Int = 0
  /// How many of those JS confirmed it processed.
  var jsEvents: Int = 0

  /// The user flipped `id`. Returns the new set and the event count to emit.
  mutating func user(_ id: String) -> (Set<String>, Int) {
    let next = displayed.contains(id) ? displayed.subtracting([id]) : displayed.union([id])
    displayed = next
    nativeEvents += 1
    return (next, nativeEvents)
  }

  /// Apply a pending React write. Returns whether `displayed` changed. Only the `controlled` ids
  /// move: an uncontrolled item the user has flipped keeps its state.
  mutating func reconcile() -> Bool {
    guard let pending = js, jsEvents >= nativeEvents else { return false }
    let next = displayed.subtracting(controlled).union(pending.intersection(controlled))
    guard next != displayed else { return false }
    displayed = next
    return true
  }
}

final class ButtonGroupModel: NitroUiModel {
  /// The items, in render order. Republishes the checked report, which lists the checked ids in
  /// this order.
  var items: [ButtonGroupItemState] = [] {
    didSet { publishChecked() }
  }
  var appearance: ButtonGroupAppearance = .standard
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var labelStyle: ButtonGroupLabelStyle = .automatic
  var disabled = false
  var tint: UIColor?
  var accessibilityLabel: String?
  /// The accessibility name of the "More" control. iOS only: Android uses Material's own localised
  /// label.
  var overflowAccessibilityLabel: String?
  var testID: String?

  /// The checked set on display. Every write republishes the checked report, which is why this is a
  /// `didSet`.
  var displayed: Set<String> = [] {
    didSet { publishChecked() }
  }
  var state = ButtonGroupCheckedSet()
  /// The ids whose `defaultChecked` has already been applied, so it is applied once.
  private var seeded: Set<String> = []

  /// Seed the uncontrolled toggles, once per id: re-applying the seed on every batch would let any
  /// re-render undo a tap.
  func applyDefaults(_ ids: [String]) {
    for id in ids where !seeded.contains(id) {
      seeded.insert(id)
      displayed.insert(id)
      state.displayed = displayed
    }
  }

  /// Forget items that are gone: an id that is no longer a toggle item cannot be
  /// shown, and a checked id with no item behind it would be reported as a state the
  /// row is not drawing.
  func pruneChecked() {
    let toggles = Set(items.filter(\.toggle).map(\.id))
    let kept = displayed.intersection(toggles)
    if kept != displayed {
      displayed = kept
      state.displayed = kept
    }
  }

  /// The size configuration React sent. The sizing engine reads the key out of Fabric
  /// state itself; the host only needs to hear that it changed.
  var sizingKey = ""
  var onPress: ((_ id: String) -> Void)?
  var onCheckedChange: ((_ id: String, _ checked: Bool, _ eventCount: Double) -> Void)?

  // MARK: - The one press path

  /// One press of item `id`. The content's `Button` action, its `Toggle` binding and the test hook
  /// all call this, from the row or from the overflow menu. Refused while the group or the item is
  /// disabled.
  func press(_ id: String) {
    guard !disabled, let item = items.first(where: { $0.id == id }), !item.disabled else {
      return
    }
    if item.toggle {
      toggle(id)
    } else {
      onPress?(id)
    }
  }

  /// The user's flip of one toggle: paint the new state before React has seen the event, and emit
  /// the count that lets a refused change be snapped back.
  func toggle(_ id: String) {
    guard !disabled else { return }
    let next = state.user(id)
    displayed = next.0
    objectWillChange.send()
    onCheckedChange?(id, next.0.contains(id), Double(next.1))
  }

  // MARK: - Test witnesses

  private let reportLock = NSLock()
  /// The last row probe's answer:
  /// `visible=<n>;overflow=<0|1>;row=<controlGroup|standard|none>;shown=<ids|none>`.
  private var rowReport = "visible=none;overflow=none;row=none;shown=none"
  /// The checked half of `stateReport()`, published on every write. `stateReport()` is called
  /// synchronously from the JS thread, while `displayed` and `items` are main-thread state, so the
  /// report reads only strings published under the lock.
  private var checkedReport = "none"
  private var accessibilityReport = "none"
  /// How many probes have answered, so a test can tell its own from the previous one's.
  private var probes = 0
  /// Whether the row composed an overflow control, and how many items it drew; `-1` before the
  /// first layout. Written by the placement witness, the only place that knows which `ViewThatFits`
  /// candidate was laid out: `ViewThatFits` measures every candidate but places only the winner.
  /// Never `@Published`: publishing from the body would ask for the update that has just happened.
  private var placedVisible = -1
  private var placedOverflow = false
  /// Which row the placed candidate drew: `controlGroup` or `standard`.
  private var placedRow = "none"

  /// Record what the row laid out. Safe from any thread.
  func recordPlacement(visible: Int, overflow: Bool, controlGroup: Bool) {
    reportLock.lock()
    placedVisible = visible
    placedOverflow = overflow
    placedRow = controlGroup ? "controlGroup" : "standard"
    reportLock.unlock()
  }

  /// Answer a row probe from the last placement. Safe from any thread.
  func publishRowReport(order: [String]) {
    reportLock.lock()
    probes += 1
    if placedVisible < 0 {
      rowReport = "visible=none;overflow=none;row=none;shown=none"
    } else {
      let shown = Array(order.prefix(placedVisible))
      rowReport =
        "visible=\(placedVisible);overflow=\(placedOverflow ? 1 : 0);"
        + "row=\(placedRow);"
        + "shown=\(shown.isEmpty ? "none" : shown.joined(separator: ","))"
    }
    reportLock.unlock()
  }

  /// Publish the checked half of `stateReport()`. Called on the main thread, where `displayed` and
  /// `items` are written.
  private func publishChecked() {
    let shown =
      displayed.isEmpty
      ? ""
      : items.filter { displayed.contains($0.id) }.map(\.id).joined(separator: ",")
    reportLock.lock()
    checkedReport = shown.isEmpty ? "none" : shown
    reportLock.unlock()
  }

  /// Store what an accessibility probe found. Safe from any thread.
  func publishAccessibilityReport(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// What the control is showing, as one line. Safe from any thread. `menu` says whether the row
  /// composes the overflow control: a presented SwiftUI `Menu` cannot be read before iOS 18's
  /// `isExpanded`.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return
      "checked=\(checkedReport);\(rowReport);menu=\(placedOverflow ? "composed" : "none");"
      + "probes=\(probes);a11y=\(accessibilityReport)"
  }

  func resetAll() {
    items = []
    appearance = .standard
    variant = .filled
    scale = .medium
    labelStyle = .automatic
    disabled = false
    tint = nil
    accessibilityLabel = nil
    overflowAccessibilityLabel = nil
    testID = nil
    displayed = []
    state = ButtonGroupCheckedSet()
    seeded.removeAll()
    sizingKey = ""
    onPress = nil
    onCheckedChange = nil
    reportLock.lock()
    rowReport = "visible=none;overflow=none;row=none;shown=none"
    accessibilityReport = "none"
    probes = 0
    placedVisible = -1
    placedOverflow = false
    placedRow = "none"
    checkedReport = "none"
    reportLock.unlock()
  }
}

/// Reports which `ViewThatFits` candidate was laid out: `onPlace` runs for the placed candidate and
/// for none of the ones measured and dropped. Otherwise transparent: it forwards the proposal to
/// its one subview and places it at the bounds given, so it does not affect measurement.
@available(iOS 16.0, *)
private struct PlacementWitness: Layout {
  let onPlace: () -> Void

  func sizeThatFits(
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout Void
  ) -> CGSize {
    subviews.first?.sizeThatFits(proposal) ?? .zero
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout Void
  ) {
    onPlace()
    subviews.first?.place(at: bounds.origin, proposal: proposal)
  }
}

struct ButtonGroupContent: NitroUIContent {
  @ObservedObject private var model: ButtonGroupModel

  init(model: ButtonGroupModel) {
    self.model = model
  }

  /// `HStack`'s own default at this control size.
  private static let spacing: CGFloat = 8

  var body: some View {
    let items = model.items
    if items.isEmpty {
      // An empty group is an empty row: nothing to draw, nothing to name.
      return AnyView(EmptyView())
    }
    // Decided once for the whole group, from every item, never per candidate: `ControlGroup` and
    // the standard row are different heights, and one sizing key cannot carry two, so the choice
    // must not depend on the width.
    let useControlGroup =
      model.appearance == .connected && !items.contains(where: \.toggle)
    if #available(iOS 16.0, *) {
      return AnyView(overflowingRow(items, useControlGroup: useControlGroup))
    }
    return AnyView(clippedRow(items, useControlGroup: useControlGroup))
  }

  // MARK: - The row, iOS 16+ (with overflow)

  /// `ViewThatFits` over "all items", then "k items + a `Menu` with the rest" for k = n-1 … 1.
  /// Widest first, so `ViewThatFits` picks the most items that fit. `ControlGroup` has no overflow
  /// of its own.
  @available(iOS 16.0, *)
  private func overflowingRow(
    _ items: [ButtonGroupItemState],
    useControlGroup: Bool
  ) -> some View {
    Group {
      if items.count == 1 {
        candidate(items: items, overflow: [], useControlGroup: useControlGroup)
      } else {
        ViewThatFits(in: .horizontal) {
          candidate(items: items, overflow: [], useControlGroup: useControlGroup)
          ForEach(Array(stride(from: items.count - 1, through: 1, by: -1)), id: \.self) {
            visible in
            candidate(
              items: Array(items[0..<visible]),
              overflow: Array(items[visible...]),
              useControlGroup: useControlGroup
            )
          }
        }
      }
    }
    .modifier(OptionalGroupAccessibility(label: model.accessibilityLabel))
  }

  @available(iOS 16.0, *)
  private func candidate(
    items: [ButtonGroupItemState],
    overflow: [ButtonGroupItemState],
    useControlGroup: Bool
  ) -> some View {
    PlacementWitness(
      // What the row composed: a disabled group composes no overflow control.
      onPlace: {
        model.recordPlacement(
          visible: items.count,
          overflow: !overflow.isEmpty && !model.disabled,
          controlGroup: useControlGroup
        )
      }
    ) {
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items, useControlGroup: useControlGroup)
        // A disabled group must not own a live popup, so the overflow control is left out of the
        // row.
        if !overflow.isEmpty, !model.disabled {
          overflowMenu(overflow)
        }
      }
    }
  }

  // MARK: - The row, iOS 15 (no `ViewThatFits`, so no overflow)

  /// Every item, clipped to the box: iOS 15 has no `ViewThatFits`, and clipping beats drawing
  /// outside the box.
  private func clippedRow(
    _ items: [ButtonGroupItemState],
    useControlGroup: Bool
  ) -> some View {
    model.recordPlacement(
      visible: items.count,
      overflow: false,
      controlGroup: useControlGroup
    )
    return AnyView(
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items, useControlGroup: useControlGroup)
      }
      .clipped()
      .modifier(OptionalGroupAccessibility(label: model.accessibilityLabel))
    )
  }

  /// The group itself: `ControlGroup` or the plain row. A `Toggle(.button)` inside a `ControlGroup`
  /// draws no on state (on and off are the same pixels), so a group that contains a toggle draws
  /// the standard row.
  @ViewBuilder
  private func row(
    _ items: [ButtonGroupItemState],
    useControlGroup: Bool
  ) -> some View {
    if useControlGroup {
      ControlGroup {
        ForEach(items, id: \.id) { item in
          itemControl(item, inControlGroup: true)
        }
      }
    } else {
      ForEach(items, id: \.id) { item in
        itemControl(item, inControlGroup: false)
      }
    }
  }

  // MARK: - One item

  @ViewBuilder private func itemControl(
    _ item: ButtonGroupItemState,
    inControlGroup: Bool
  ) -> some View {
    if item.toggle {
      Toggle(isOn: toggleBinding(item)) {
        itemLabel(item, inControlGroup: inControlGroup)
      }
      .toggleStyle(.button)
      .controlSize(model.scale.controlSize)
      .modifier(OptionalItemTint(color: inControlGroup ? nil : model.tint))
      .disabled(model.disabled || item.disabled)
    } else {
      Button(action: { model.press(item.id) }) {
        itemLabel(item, inControlGroup: inControlGroup)
      }
      .modifier(ItemButtonStyle(variant: model.variant))
      .controlSize(model.scale.controlSize)
      .modifier(OptionalItemTint(color: inControlGroup ? nil : model.tint))
      .disabled(model.disabled || item.disabled)
    }
  }

  /// The item's label. `automatic` means `.iconOnly` inside a `ControlGroup` when the item has a
  /// glyph (a connected group drops titles anyway) and `.titleAndIcon` everywhere else. An item
  /// with no glyph always draws its title.
  @ViewBuilder private func itemLabel(
    _ item: ButtonGroupItemState,
    inControlGroup: Bool
  ) -> some View {
    if let systemImage = item.systemImage, model.labelStyle != .titleOnly {
      Label {
        Text(item.title).lineLimit(1)
      } icon: {
        Image(systemName: systemImage)
      }
      .labelStyle(resolvedLabelStyle(inControlGroup: inControlGroup))
    } else {
      Text(item.title)
        .lineLimit(1)
    }
  }

  private func resolvedLabelStyle(inControlGroup: Bool) -> some LabelStyle {
    switch model.labelStyle {
    case .titleOnly:
      return AnyLabelStyle(.titleOnly)
    case .iconOnly:
      return AnyLabelStyle(.iconOnly)
    case .titleAndIcon:
      return AnyLabelStyle(.titleAndIcon)
    case .automatic:
      // The branches are different `LabelStyle` types, hence the erased style.
      return inControlGroup ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon)
    }
  }

  // MARK: - The overflow control

  /// The "More" `Menu`, composed beside the group, never inside it: as a segment inside a
  /// `ControlGroup` it draws disabled and a tap does nothing. The host's `needsContainment` is what
  /// lets it present.
  private func overflowMenu(_ items: [ButtonGroupItemState]) -> some View {
    Menu {
      ForEach(items, id: \.id) { item in
        if item.toggle {
          // A `Toggle` inside a `Menu` is SwiftUI's checkable row, so a toggle item stays a toggle
          // when it overflows.
          Toggle(isOn: toggleBinding(item)) {
            Text(item.title)
          }
          .disabled(model.disabled || item.disabled)
        } else {
          Button(action: { model.press(item.id) }) {
            Text(item.title)
          }
          .disabled(model.disabled || item.disabled)
        }
      }
    } label: {
      Label(model.overflowAccessibilityLabel ?? "More", systemImage: "ellipsis")
    }
    .disabled(model.disabled)
  }

  /// The binding a toggle reads and writes. The setter ignores the value SwiftUI asked for: the
  /// model owns the new state and the event that reports it.
  private func toggleBinding(_ item: ButtonGroupItemState) -> Binding<Bool> {
    Binding(
      get: { model.displayed.contains(item.id) },
      set: { _ in model.toggle(item.id) }
    )
  }
}

/// `labelStyle(_:)` takes a concrete `LabelStyle`; this erases it so one label can take any of the
/// four.
private struct AnyLabelStyle: LabelStyle {
  private let apply: @MainActor (LabelStyleConfiguration) -> AnyView

  init<S: LabelStyle>(_ style: S) {
    apply = { config in AnyView(style.makeBody(configuration: config)) }
  }

  func makeBody(configuration: LabelStyleConfiguration) -> some View {
    apply(configuration)
  }
}

/// The variant's button style, one branch per variant.
private struct ItemButtonStyle: ViewModifier {
  let variant: ButtonVariant

  func body(content: Content) -> some View {
    switch variant {
    case .filled, .elevated:
      // iOS has no elevated style; the prominent one is the nearest.
      content.buttonStyle(.borderedProminent)
    case .tonal, .outlined:
      // No outlined style either: `.bordered` is the nearest. No hairline stroke is added: a row of
      // stroked capsules reads as several borders.
      content.buttonStyle(.bordered)
    case .text:
      content.buttonStyle(.borderless)
    }
  }
}

/// `.tint()` has no "unset" form, so it is applied only when set. A `ControlGroup` gets `nil`: a
/// connected row ignores `.tint` entirely.
private struct OptionalItemTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// The group's name goes on the row with `.contain`, so a reader can step over the group while the
/// items stay reachable inside it. An empty `accessibilityLabel(_:)` would silence the items' own
/// names, so it is applied only when set.
private struct OptionalGroupAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityElement(children: .contain).accessibilityLabel(label)
    } else {
      content
    }
  }
}

final class HybridNitroUiButtonGroup: HybridNitroUiButtonGroupSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ButtonGroupContent>

  /// The seed waiting for the batch it belongs to.
  private var pendingDefaults: [String]?

  /// This component's name in the sizing engine. Must match `HybridNitroUiButtonGroupComponentName`
  /// in the generated C++ and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiButtonGroup"

  /// The size to lay a ButtonGroup out with before anything has been measured, in points: the
  /// `medium` standard row (34.33 pt, rounded up). Only the height matters for a `fillWidth`
  /// control. The connected track is 31 pt and is corrected on its first measure.
  private static let fallbackSize = (width: 300.0, height: 34.4)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process. Called at startup,
  /// because Fabric measures a shadow node before it creates the view; `init` calls it again as a
  /// backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: ButtonGroupModel())
    super.init()
    // The width is the box's, because overflow can only be decided at the width the row is given:
    // measured unbounded, the row would never overflow and would draw outside its box.
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    // The overflow `Menu` presents a view controller, and a hosted control has no parent to present
    // from without containment.
    host.needsContainment = true
    // Backstop: startup normally registers this before one can be measured.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<ButtonGroupContent> {
    return host
  }

  private var model: ButtonGroupModel { host.model }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var items: [NitroUiButtonGroupItem] {
    get {
      // Rebuilt as wire structs. The wire type has no `==` visible to Swift; unchanged props are
      // filtered out earlier, in the generated C++ (`hasSameValue`).
      model.items.map { item in
        NitroUiButtonGroupItem(
          id: item.id,
          title: item.title,
          systemImage: item.systemImage.map { Variant_NullType_String.second($0) }
            ?? .first(NullType.null),
          // Android-only; iOS never reads or returns it.
          androidIcon: .first(NullType.null),
          disabled: item.disabled,
          toggle: item.toggle
        )
      }
    }
    set {
      let parsed = parseButtonGroupItems(newValue)
      if parsed == model.items {
        return
      }
      model.items = parsed
      host.markDirty()
      // A different item list can be a different height, and no bounds or trait change will say so.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var appearance: String {
    get { model.appearance.rawValue }
    set {
      guard let next = ButtonGroupAppearance(rawValue: newValue), next != model.appearance else {
        return
      }
      model.appearance = next
      // The connected track and the bordered row are different heights (31 pt and 34.33 pt), so
      // this changes the size, not just the pixels.
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      guard let next = ButtonVariant(rawValue: newValue), next != model.variant else { return }
      model.variant = next
      // `.borderless` is shorter than the bordered styles, so a variant change can change the row's
      // height.
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var size: String {
    get { model.scale.rawValue }
    set {
      guard let next = ButtonScale(rawValue: newValue), next != model.scale else { return }
      model.scale = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var labelStyle: String {
    get { model.labelStyle.rawValue }
    set {
      guard let next = ButtonGroupLabelStyle(rawValue: newValue), next != model.labelStyle else {
        return
      }
      model.labelStyle = next
      // Whether a title is drawn changes the row's width, and at some sizes its height.
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled row is the same size. It also drops the overflow control.
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

  var checkedIds: [String] {
    get { model.state.js.map { Array($0) } ?? [] }
    set {
      // Not visual on its own: `displayed` follows in `afterUpdate()`, once the event count says JS
      // has caught up.
      model.state.js = Set(newValue)
    }
  }

  var controlledIds: [String] {
    get { Array(model.state.controlled) }
    set { model.state.controlled = Set(newValue) }
  }

  var defaultCheckedIds: [String] {
    get { [] }
    set {
      // Stored raw and applied in `afterUpdate()`, where the items it names exist: props in a batch
      // arrive in no particular order.
      pendingDefaults = newValue
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var overflowAccessibilityLabel: Variant_NullType_String {
    get { model.overflowAccessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.overflowAccessibilityLabel else { return }
      // Rendered: it is the "More" button's name.
      model.overflowAccessibilityLabel = next
      host.markDirty()
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.accessibilityLabel else { return }
      model.accessibilityLabel = next
      host.markDirty()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `RCTViewComponentView` already puts `testID` on the component view. It is
      // in the spec because Android needs it.
      model.testID = newValue.asType(String.self)
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
      // that report away.
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onPress: ((_ id: String) -> Void)? {
    get { model.onPress }
    set { model.onPress = newValue }
  }

  var onCheckedChange: ((_ id: String, _ checked: Bool, _ eventCount: Double) -> Void)? {
    get { model.onCheckedChange }
    set { model.onCheckedChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // An item that left the list must not stay checked, and the seed needs the items it names, so
    // neither is interpreted in a setter.
    model.pruneChecked()
    if let defaults = pendingDefaults {
      model.applyDefaults(defaults)
      pendingDefaults = nil
    }
    // The handshake: whether React's set wins over what the user just did, a refused flip included.
    if model.state.reconcile() {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    // A full reset, including the `seeded` set: a surviving entry would make the next owner's
    // `defaultCheckedIds` a no-op.
    model.resetAll()
    pendingDefaults = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onPress = nil
    model.onCheckedChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI measured, from the host's cache. Safe on the JS thread.
  func measureContent() throws -> NitroUiButtonGroupSize {
    guard let size = host.contentSize else {
      return NitroUiButtonGroupSize(width: 0, height: 0)
    }
    return NitroUiButtonGroupSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press one item through the tap's path, on the main thread. Returns at once,
  /// because a Nitro method may not block for the main thread.
  func nuiTestPressItem(id: String) throws {
    let model = self.model
    if Thread.isMainThread {
      model.press(id)
    } else {
      DispatchQueue.main.async { model.press(id) }
    }
  }

  /// Does nothing on iOS: a SwiftUI `Menu` opens from a gesture, and the programmatic `isExpanded`
  /// needs iOS 18.
  func nuiTestOpenOverflow() throws {
  }

  /// Read what the row laid out, on the main thread. Returns at once.
  func nuiTestProbeRow() throws {
    let host = self.host
    let model = self.model
    let report = {
      // Lay the row out before answering: the placement record is written during layout, and a
      // recycled host may not have laid out its new mount yet.
      host.setNeedsLayout()
      host.layoutIfNeeded()
      model.publishRowReport(order: model.items.map(\.id))
    }
    if Thread.isMainThread {
      report()
    } else {
      DispatchQueue.main.async(execute: report)
    }
  }

  /// Records `unavailable`: a SwiftUI hosting view answers `accessibilityElements == []` to
  /// anything that is not an accessibility client, so there is nothing to read in-process.
  func nuiTestProbeAccessibility() throws {
    model.publishAccessibilityReport("unavailable")
  }

  func nuiTestStateReport() throws -> String {
    return model.stateReport()
  }
}
