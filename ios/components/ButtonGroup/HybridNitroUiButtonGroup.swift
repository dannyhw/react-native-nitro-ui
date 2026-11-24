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
  /// What the control's own box was drawing at the last row probe, or `none`.
  private var drawingReport = "none"
  /// Where inside that box something was drawn at the last row probe, as point ranges, or `none`.
  private var inkReport = "none"
  /// How many probes have answered, so a test can tell its own from the previous one's.
  private var probes = 0
  /// Whether the row composed an overflow control, and how many items it drew; `-1` before the
  /// first layout. Written by the placement witness, the only place that knows which `ViewThatFits`
  /// candidate was laid out: `ViewThatFits` measures every candidate but places only the winner.
  /// Never `@Published`: publishing from the body would ask for the update that has just happened.
  private var placedVisible = -1
  private var placedOverflow = false
  /// Whether that control can present its menu, which the group's `disabled` decides.
  private var placedOverflowPresents = false
  /// Which row the placed candidate drew: `controlGroup` or `standard`.
  private var placedRow = "none"

  /// Record what the row laid out. Safe from any thread.
  func recordPlacement(
    visible: Int,
    overflow: Bool,
    overflowPresents: Bool,
    controlGroup: Bool
  ) {
    reportLock.lock()
    placedVisible = visible
    placedOverflow = overflow
    placedOverflowPresents = overflowPresents
    placedRow = controlGroup ? "controlGroup" : "standard"
    reportLock.unlock()
  }

  /// Answer a row probe from the last placement, and from what the box was drawing. Safe from any
  /// thread. [drawing] and [ink] are read from the rendered layer, so they arrive from the probe
  /// itself.
  func publishRowReport(
    order: [String],
    drawing: String,
    ink: String
  ) {
    reportLock.lock()
    probes += 1
    drawingReport = drawing
    inkReport = ink
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
  /// composes an overflow control that can present its menu: a presented SwiftUI `Menu` cannot be
  /// read before iOS 18's `isExpanded`, and a disabled group draws a control that cannot present.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return
      "checked=\(checkedReport);\(rowReport);"
      + "menu=\(placedOverflow && placedOverflowPresents ? "composed" : "none");"
      + "drawing=\(drawingReport);ink=\(inkReport);probes=\(probes);"
      + "a11y=\(accessibilityReport)"
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
    drawingReport = "none"
    inkReport = "none"
    probes = 0
    placedVisible = -1
    placedOverflow = false
    placedOverflowPresents = false
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
    let overflowing = !overflow.isEmpty
    return PlacementWitness(
      // What the row composed, and whether that control can present its menu: a disabled group
      // draws the control and cannot open it.
      onPlace: {
        model.recordPlacement(
          visible: items.count,
          overflow: overflowing,
          overflowPresents: overflowing && !model.disabled,
          controlGroup: useControlGroup
        )
      }
    ) {
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items, useControlGroup: useControlGroup, reservesFootprint: reservesFootprint(items))
        // The control keeps its room in the row whatever the group's state: leaving it out while
        // the group is disabled measures that candidate narrower, and a disabled row then fits
        // items the enabled one cannot.
        if overflowing {
          overflowControl(overflow)
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
      overflowPresents: false,
      controlGroup: useControlGroup
    )
    return AnyView(
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items, useControlGroup: useControlGroup, reservesFootprint: reservesFootprint(items))
      }
      .clipped()
      .modifier(OptionalGroupAccessibility(label: model.accessibilityLabel))
    )
  }

  /// Whether these items must each reserve the footprint of a checked toggle: only a `text` group
  /// holds an item that draws less than that capsule, and only a group with a toggle is measured
  /// at the height of one.
  private func reservesFootprint(_ items: [ButtonGroupItemState]) -> Bool {
    model.variant == .text && items.contains(where: \.toggle)
  }

  /// The group itself: `ControlGroup` or the plain row. A `Toggle(.button)` inside a `ControlGroup`
  /// draws no on state (on and off are the same pixels), so a group that contains a toggle draws
  /// the standard row.
  @ViewBuilder
  private func row(
    _ items: [ButtonGroupItemState],
    useControlGroup: Bool,
    reservesFootprint: Bool
  ) -> some View {
    if useControlGroup {
      ControlGroup {
        ForEach(items, id: \.id) { item in
          itemControl(item, inControlGroup: true, reservesFootprint: reservesFootprint)
        }
      }
    } else {
      ForEach(items, id: \.id) { item in
        itemControl(item, inControlGroup: false, reservesFootprint: reservesFootprint)
      }
    }
  }

  // MARK: - One item

  @ViewBuilder private func itemControl(
    _ item: ButtonGroupItemState,
    inControlGroup: Bool,
    reservesFootprint: Bool
  ) -> some View {
    if item.toggle {
      Toggle(isOn: toggleBinding(item)) {
        itemLabel(item, inControlGroup: inControlGroup)
      }
      .toggleStyle(
        ItemToggleStyle(
          variant: model.variant,
          tint: inControlGroup ? nil : model.tint,
          reservesFootprint: reservesFootprint
        )
      )
      .controlSize(model.scale.controlSize)
      .disabled(model.disabled || item.disabled)
    } else {
      Button(action: { model.press(item.id) }) {
        itemLabel(item, inControlGroup: inControlGroup)
      }
      .modifier(ItemButtonStyle(style: ItemStyle(variant: model.variant)))
      .modifier(
        BorderedFootprint(
          reserves: reservesFootprint,
          label: itemLabel(item, inControlGroup: inControlGroup)
        )
      )
      // Outside the footprint: the hidden `.bordered` copy measures the group's `size`, and an
      // environment value reaches only the views it wraps.
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

  /// The row's overflow control. A disabled group draws the same label in a control with nothing
  /// to present: a `Menu` kept in the row would hold an open popup its group can no longer close,
  /// and no control at all would measure the row narrower than it is enabled.
  @ViewBuilder private func overflowControl(
    _ items: [ButtonGroupItemState]
  ) -> some View {
    if model.disabled {
      Button(action: {}) { overflowLabel() }
        .disabled(true)
    } else {
      overflowMenu(items)
    }
  }

  /// The control's label, shared by the `Menu` and by the control a disabled group draws, so that
  /// both take the same room in the row.
  private func overflowLabel() -> some View {
    Label(model.overflowAccessibilityLabel ?? "More", systemImage: "ellipsis")
  }

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
          .disabled(item.disabled)
        } else {
          Button(action: { model.press(item.id) }) {
            Text(item.title)
          }
          .disabled(item.disabled)
        }
      }
    } label: {
      overflowLabel()
    }
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

/// Which of iOS's three button-style families a control draws in. iOS has no elevated or outlined
/// style, so those variants share a family with the nearest one. No hairline stroke is added for
/// `outlined`: a row of stroked capsules reads as several borders.
enum ItemStyle: Equatable {
  case prominent
  case bordered
  case borderless

  init(variant: ButtonVariant) {
    switch variant {
    case .filled, .elevated: self = .prominent
    case .tonal, .outlined: self = .bordered
    case .text: self = .borderless
    }
  }

  /// What a toggle draws in one of its states.
  func state(_ isOn: Bool) -> ItemStyle {
    guard isOn else {
      // Unchecked keeps the family and drops the prominent fill, so it is the quiet item of the
      // row rather than the grey one.
      return self == .prominent ? .bordered : self
    }
    // Checked is one step up: the fill carries the group's tint, which is more than any unchecked
    // item in the same row shows of itself.
    return self == .borderless ? .bordered : .prominent
  }
}

/// The style family an item draws in.
private struct ItemButtonStyle: ViewModifier {
  let style: ItemStyle

  func body(content: Content) -> some View {
    switch style {
    case .prominent:
      content.buttonStyle(.borderedProminent)
    case .bordered:
      content.buttonStyle(.bordered)
    case .borderless:
      content.buttonStyle(.borderless)
    }
  }
}

/// A toggle item drawn in the group's `variant`, so it sits in the same style family as an action
/// item beside it: the variant's own style while unchecked and one step up from it while checked,
/// both in the group's tint. Grey belongs to disabled items, and an unchecked toggle is not one.
///
/// A `Toggle` with `.toggleStyle(.button)` ignores `buttonStyle` — iOS gives it one look — so this
/// draws a `Button` in the state's style. A custom `ToggleStyle` changes only the drawing: the
/// element stays the `Toggle`'s own, so it keeps the toggle's trait and its 0/1 value, and saying
/// the state again here would have a reader announce it twice.
private struct ItemToggleStyle: ToggleStyle {
  let variant: ButtonVariant
  let tint: UIColor?
  let reservesFootprint: Bool

  func makeBody(configuration: Configuration) -> some View {
    let style = ItemStyle(variant: variant).state(configuration.isOn)
    Button(action: { configuration.isOn.toggle() }) {
      configuration.label
    }
    .modifier(ItemButtonStyle(style: style))
    .modifier(OptionalItemTint(color: tint))
    .modifier(BorderedFootprint(reserves: reservesFootprint, label: configuration.label))
  }
}

/// A `text` item is a label and a checked toggle a capsule, and nothing re-measures the row when a
/// toggle is checked: `reserves` measures an item at its own label in `.bordered` - the style a
/// checked toggle takes - and draws what it draws centred inside it, so every state fits one box.
private struct BorderedFootprint<Label: View>: ViewModifier {
  let reserves: Bool
  let label: Label

  func body(content: Content) -> some View {
    if reserves {
      ZStack {
        Button(action: {}) { label }
          .buttonStyle(.bordered)
          .hidden()
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        content
      }
    } else {
      content
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
      // Repaints only: a disabled row keeps its size and the items it laid out.
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

  /// Read what the row laid out and what the box drew, on the main thread. Returns at once.
  func nuiTestProbeRow() throws {
    let host = self.host
    let model = self.model
    let report = {
      // Lay the row out before answering: the placement record is written during layout, and a
      // recycled host may not have laid out its new mount yet.
      host.setNeedsLayout()
      host.layoutIfNeeded()
      let sampled = nitroUiSampleDrawing(of: host, tint: model.tint)
      model.publishRowReport(
        order: model.items.map(\.id),
        drawing: sampled.aggregate,
        ink: sampled.ink
      )
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

  private let pixelProbesLock = NSLock()

  private var pixelProbes = 0

  /// iOS has no Android icon glyph to sample, so the report says `no pixels`, which the
  /// tests treat as a failure.
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
}

// MARK: - Drawing probe (test-only)

/// How far a pixel may sit from the white backdrop and still count as "nothing drawn here". The
/// backdrop is the page's own light appearance, so a control's pale capsule is still a thing.
private let nitroUiDrawingInkBudget = 24

/// How far a pixel may sit from the group's tint and still count as drawn in it. A label's glyph
/// is anti-aliased over the fill behind it, so only its centre pixels are the tint itself and the
/// budget has to cover the rest. A grey label is nowhere near a colour that was picked for it.
private let nitroUiTintBudget = 120

/// What the box `view` is drawing: the aggregate shares as `size=<WxH>,fill=<%>,tint=<%>`, and
/// where inside the box something is drawn, as point ranges `12.40~58.90|70.20~110.00`.
///
/// The rendered layer is the only thing in-process that tells one variant's drawing from
/// another's: a SwiftUI control keeps its capsule, its fill and its label colours to itself. The
/// backdrop makes every pixel comparable, including the ones a translucent material leaves open.
/// The ranges come from the same sample: what an item leaves empty beside its neighbour is only
/// visible where the two drawings end, not in the space each was measured into.
private func nitroUiSampleDrawing(
  of view: UIView,
  tint: UIColor?
) -> (aggregate: String, ink: String) {
  let bounds = view.bounds
  guard bounds.width >= 2, bounds.height >= 2 else {
    return ("size=\(Int(bounds.width))x\(Int(bounds.height)),fill=-,tint=-", "-")
  }
  let image = UIGraphicsImageRenderer(bounds: bounds).image { _ in
    view.drawHierarchy(in: bounds, afterScreenUpdates: true)
  }
  guard let bitmap = image.cgImage else { return ("no image", "-") }
  let width = bitmap.width, height = bitmap.height
  let bytesPerRow = 4 * width
  var data = [UInt8](repeating: 0, count: bytesPerRow * height)
  guard
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: &data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return ("no context", "-") }
  let backdrop = 255
  context.setFillColor(UIColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
  var target: (red: Int, green: Int, blue: Int)?
  if let tint {
    let argb = UInt32(truncatingIfNeeded: Int64(tint.nitroUiARGBValue))
    target = (Int((argb >> 16) & 0xff), Int((argb >> 8) & 0xff), Int(argb & 0xff))
  }
  var filled = 0, tinted = 0
  // Only the middle of the box is asked where the ink is: every item is drawn across it, while the
  // top and bottom of a capsule are empty beside a label of the same row.
  let bandHalf = max(1, height / 10)
  var inkColumns = [Bool](repeating: false, count: width)
  for row in 0..<height {
    for column in 0..<width {
      let offset = row * bytesPerRow + column * 4
      // Every pixel is opaque after the backdrop, so the channels are final.
      let red = Int(data[offset]), green = Int(data[offset + 1]), blue = Int(data[offset + 2])
      if abs(red - backdrop) + abs(green - backdrop) + abs(blue - backdrop)
        > nitroUiDrawingInkBudget
      {
        filled += 1
        if abs(row - height / 2) <= bandHalf {
          inkColumns[column] = true
        }
      }
      if let target,
        abs(red - target.red) + abs(green - target.green) + abs(blue - target.blue)
          <= nitroUiTintBudget
      {
        tinted += 1
      }
    }
  }
  let area = width * height
  let aggregate =
    "size=\(Int(bounds.width))x\(Int(bounds.height)),fill=\(filled * 100 / area),"
    + "tint=\(tint == nil ? "-" : String(tinted * 100 / area))"
  return (aggregate, nitroUiInkRanges(inkColumns, pointsPerColumn: bounds.width / CGFloat(width)))
}

/// The runs of `columns` that hold ink, as point ranges: columns of one word are closer together
/// than the space between two items, and a run narrower than a stroke is anti-aliasing.
private func nitroUiInkRanges(_ columns: [Bool], pointsPerColumn: CGFloat) -> String {
  guard pointsPerColumn > 0 else { return "-" }
  let join = max(1, Int(4.0 / pointsPerColumn))
  let narrowest = max(1, Int(2.0 / pointsPerColumn))
  var runs: [(start: Int, end: Int)] = []
  var start: Int?
  for (column, inked) in columns.enumerated() {
    if inked {
      if start == nil { start = column }
    } else if let begun = start {
      runs.append((begun, column))
      start = nil
    }
  }
  if let begun = start { runs.append((begun, columns.count)) }
  var merged: [(start: Int, end: Int)] = []
  for run in runs {
    if let last = merged.last, run.start - last.end <= join {
      merged[merged.count - 1] = (last.start, run.end)
    } else {
      merged.append(run)
    }
  }
  return merged
    .filter { $0.end - $0.start >= narrowest }
    .map {
      String(
        format: "%.2f~%.2f", CGFloat($0.start) * pointsPerColumn, CGFloat($0.end) * pointsPerColumn)
    }
    .joined(separator: "|")
}
