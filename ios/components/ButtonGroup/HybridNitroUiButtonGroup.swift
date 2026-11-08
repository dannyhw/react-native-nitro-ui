//
//  HybridNitroUiButtonGroup.swift
//  react-native-nitro-ui
//
//  The ButtonGroup component: a row of commands, optionally with independent
//  toggles, that moves the items it cannot fit into an overflow menu
//  (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` Appendix B, DECISIONS D42).
//
//  iOS has half the control natively and none of the other half:
//
//  - **`appearance: 'connected'` is `ControlGroup`.** Measured (Appendix A): on
//    iOS 27.0 it draws the connected capsule row an app would otherwise hand-roll,
//    one `button` per item, and it *ignores* `variant`, `size` and `tintColor`
//    (`.controlSize` and `.tint` leave the probe row at 174.00 x 31.00). It also
//    draws no on state for a `Toggle`, so a group that contains a toggle falls back
//    to the standard row (D42 item 2) rather than shipping a toggle that looks off
//    while it is on.
//  - **`appearance: 'standard'` is a row of bordered controls** — the same
//    `Button`/`Toggle` styles the Button and Switch components already draw, at the
//    34.33 pt Appendix A measured for three of them.
//  - **Overflow is ours.** `ControlGroup` has none of its own (measured: six items
//    measure 396 pt inside a 369 pt box and draw outside it on both sides), so the
//    row is `ViewThatFits` over "all items", "n-1 items + a `Menu`", … — with the
//    `Menu` **beside** the group, because inside the group its segment is disabled
//    (Appendix A). On iOS 15 there is no `ViewThatFits`: every item draws and the
//    row clips to the box.
//
//  The value half is a *set*: ``ButtonGroupCheckedSet`` is the event-count handshake
//  (`docs/architecture/core.md` §4) for many toggles at once, which is why it is not
//  a ``NitroUiControlledValue``.
//

import NitroModules
import SwiftUI
import UIKit

/// How the items sit together.
enum ButtonGroupAppearance: String {
  /// 8 pt of space; each item keeps its own capsule.
  case standard
  /// `ControlGroup`'s connected track, or the standard row when a toggle is in it.
  case connected
}

/// Which half of an item's label the group draws.
enum ButtonGroupLabelStyle: String {
  /// iOS connected: icons only when the item has an icon (measured). Elsewhere: icon and title.
  case automatic
  case titleOnly
  case iconOnly
  case titleAndIcon
}

/// One item, as the composition draws it.
///
/// Parsed once per props batch by ``parseButtonGroupItems(_:)``, like Menu's rows: the
/// wire struct is a C++-backed type whose accessors convert on every read, so the
/// content must not walk it per render.
struct ButtonGroupItemState: Equatable {
  let id: String
  let title: String
  /// A symbol name that resolved to a real SF Symbol (Button's rule), or `nil`.
  let systemImage: String?
  let disabled: Bool
  let toggle: Bool
}

/// The wire's struct array, parsed for the content to read.
func parseButtonGroupItems(_ items: [NitroUiButtonGroupItem]) -> [ButtonGroupItemState] {
  items.map { item in
    ButtonGroupItemState(
      id: item.id,
      title: item.title,
      // Same rule as Button's and Menu's: a name that does not resolve would draw the
      // missing-symbol placeholder and say nothing useful to VoiceOver.
      systemImage: item.systemImage?
        .asType(String.self)
        .flatMap { UIImage(systemName: $0) == nil ? nil : $0 },
      disabled: item.disabled,
      toggle: item.toggle
    )
  }
}

/// The event-count handshake for a *set* of toggles (core.md §4).
///
/// The single-value twin is ``NitroUiControlledValue``; it cannot serve here because
/// the control owns a set that several items move independently:
///
/// - ``js`` is the whole checked set React sent, and only for the ids in
///   ``controlled`` — ids outside it are uncontrolled and no write may move them,
///   which is what lets controlled and uncontrolled items share one group;
/// - a write is stale while `jsEvents < nativeEvents`, exactly as in the single case,
///   so a flip JS refused (the next render's set unchanged) reverts instead of
///   stranding the item;
/// - one counter for the whole group, not one per item: per-item counts would let one
///   item's stale write be accepted on the strength of another item's event.
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

  /// Apply a pending React write. Returns whether ``displayed`` changed.
  ///
  /// Only the ``controlled`` ids move: an uncontrolled item the user has flipped keeps
  /// its state through a write, which is the whole point of sending ``controlled``.
  mutating func reconcile() -> Bool {
    guard let pending = js, jsEvents >= nativeEvents else { return false }
    let next = displayed.subtracting(controlled).union(pending.intersection(controlled))
    guard next != displayed else { return false }
    displayed = next
    return true
  }
}

/// State of one ButtonGroup. See ``NitroUiModel`` for why this is not `@Published`.
final class ButtonGroupModel: NitroUiModel {
  /// The items, in render order. Rendered, so a new list is a new layout.
  var items: [ButtonGroupItemState] = []
  var appearance: ButtonGroupAppearance = .standard
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var labelStyle: ButtonGroupLabelStyle = .automatic
  var disabled = false
  var tint: UIColor?
  var accessibilityLabel: String?
  /// What a reader is told the "More" control is. Android ignores it (Material has its
  /// own localised label and tooltip); it is iOS's, because iOS draws the control.
  var overflowAccessibilityLabel: String?
  var testID: String?

  /// The checked set on display. Written by the handshake and by a flip.
  var displayed: Set<String> = []
  /// The handshake.
  var state = ButtonGroupCheckedSet()
  /// The ids whose `defaultChecked` has already been applied, so it is applied once.
  private var seeded: Set<String> = []

  /// Seed the uncontrolled toggles, once per id.
  ///
  /// Re-applying the seed on every batch would let any re-render undo the tap that
  /// just happened — the same one-shot guard `Switch`'s `defaultChecked` has.
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

  /// One press of item `id`, through the path a tap takes.
  ///
  /// The content's `Button` action, its `Toggle` binding and `nuiTestPressItem` all
  /// call this, so a harness tap and a real one cannot disagree about what pressing an
  /// item means (Chip's and IconButton's shape). Refused while the group or the item is
  /// disabled, as the control refuses the tap — from the row or from the overflow menu
  /// alike, because both arrive here.
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

  /// The user's flip of one toggle: paint the new state *before* React has seen the
  /// event (§4), and emit the count that lets a refused change be snapped back.
  func toggle(_ id: String) {
    guard !disabled else { return }
    let next = state.user(id)
    displayed = next.0
    objectWillChange.send()
    onCheckedChange?(id, next.0.contains(id), Double(next.1))
  }

  // MARK: - Test witnesses

  private let reportLock = NSLock()
  /// The last row probe's answer: `visible=<n>;overflow=<0|1>;shown=<ids|none>`.
  private var rowReport = "visible=none;overflow=none;shown=none"
  /// The last accessibility probe's answer.
  private var accessibilityReport = "none"
  /// How many probes have answered, so a test can tell its own from the previous one's.
  private var probes = 0
  /// Whether the row composed an overflow control, and how many items it drew. `-1`
  /// means the body has not laid anything out yet.
  ///
  /// Written by the placement witness in the content — the one place that knows which
  /// `ViewThatFits` candidate was *laid out*, which is the only honest answer to "did
  /// this item overflow?". `ViewThatFits` measures every candidate, so "the body ran"
  /// says nothing; only the winner is placed. Plain storage behind a lock, never
  /// `@Published`: publishing from the body would ask for the recomposition that has
  /// just happened.
  private var placedVisible = -1
  private var placedOverflow = false

  /// Record what the row laid out. Safe from any thread.
  func recordPlacement(visible: Int, overflow: Bool) {
    reportLock.lock()
    placedVisible = visible
    placedOverflow = overflow
    reportLock.unlock()
  }

  /// Answer a row probe from the last placement. Safe from any thread.
  func publishRowReport(order: [String]) {
    reportLock.lock()
    probes += 1
    if placedVisible < 0 {
      rowReport = "visible=none;overflow=none;shown=none"
    } else {
      let shown = Array(order.prefix(placedVisible))
      rowReport =
        "visible=\(placedVisible);overflow=\(placedOverflow ? 1 : 0);"
        + "shown=\(shown.isEmpty ? "none" : shown.joined(separator: ","))"
    }
    reportLock.unlock()
  }

  /// Store what an accessibility probe found. Safe from any thread.
  func publishAccessibilityReport(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// What the control is showing, as one line. Safe from any thread.
  ///
  /// `checked` is read where the items are drawn, so it is a reading of the hosted
  /// control rather than an echo of a prop. `visible`/`overflow` are the last
  /// ``publishRowReport(order:)``. `menu` is the field Android answers with
  /// `open`/`closed` from Material's own menu state; iOS has no way to read a presented
  /// `Menu` before iOS 18's `isExpanded` and the deployment target is 15.1, so here it
  /// answers whether the row *composes* the control at all — the form D29's rule takes
  /// on this platform, because a disabled group composes none and `docs/components/
  /// button-group.md` says so.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    let checked =
      displayed.isEmpty
      ? "none"
      : items.filter { displayed.contains($0.id) }.map(\.id).joined(separator: ",")
    return
      "checked=\(checked);\(rowReport);menu=\(placedOverflow ? "composed" : "none");"
      + "probes=\(probes);a11y=\(accessibilityReport)"
  }

  /// Forget everything, for recycling.
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
    rowReport = "visible=none;overflow=none;shown=none"
    accessibilityReport = "none"
    probes = 0
    placedVisible = -1
    placedOverflow = false
    reportLock.unlock()
  }
}

/// The group's own placement witness, so the row can report what it *laid out*.
///
/// Transparent on purpose: ``sizeThatFits(proposal:subviews:cache:)`` forwards the
/// proposal to the one subview and returns its answer, and
/// ``placeSubviews(in:proposal:subviews:cache:)`` places it at the bounds it was given.
/// The only thing it adds is the `onPlace` call — which runs for the placed candidate
/// and for none of the candidates `ViewThatFits` measured and dropped. A wrapper that
/// resized anything would put itself between the host's `fillWidth` measure and the row
/// (`docs/architecture/sizing.md` §5), which is what it must not do.
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

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct ButtonGroupContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: ButtonGroupModel

  init(model: ButtonGroupModel) {
    self.model = model
  }

  /// 8 pt — the gap Appendix A measured for the row of bordered buttons this control's
  /// `standard` appearance is, and `HStack`'s own default at this control size.
  private static let spacing: CGFloat = 8

  var body: some View {
    let items = model.items
    if items.isEmpty {
      // An empty group is an empty row: nothing to draw, nothing to name.
      return AnyView(EmptyView())
    }
    if #available(iOS 16.0, *) {
      return AnyView(overflowingRow(items))
    }
    return AnyView(clippedRow(items))
  }

  // MARK: - The row, iOS 16+ (with overflow)

  /// `ViewThatFits` over "all items", then "k items + a `Menu` with the rest" for
  /// k = n-1 … 1, each candidate wrapped in a ``PlacementWitness`` so the harness can
  /// read which one was laid out (Appendix B3).
  ///
  /// The candidates go widest first, which is what makes `ViewThatFits` pick the most
  /// items that fit rather than the fewest. A one-item group has no narrower candidate,
  /// so it is one candidate and never a `Menu`.
  @available(iOS 16.0, *)
  private func overflowingRow(_ items: [ButtonGroupItemState]) -> some View {
    Group {
      if items.count == 1 {
        candidate(items: items, overflow: [])
      } else {
        ViewThatFits(in: .horizontal) {
          candidate(items: items, overflow: [])
          ForEach(Array(stride(from: items.count - 1, through: 1, by: -1)), id: \.self) {
            visible in
            candidate(items: Array(items[0..<visible]), overflow: Array(items[visible...]))
          }
        }
      }
    }
    .modifier(OptionalGroupAccessibility(label: model.accessibilityLabel))
  }

  @available(iOS 16.0, *)
  private func candidate(
    items: [ButtonGroupItemState],
    overflow: [ButtonGroupItemState]
  ) -> some View {
    PlacementWitness(
      // What the row *composed*, not what the candidate asked for: a disabled group
      // composes no overflow control at all (D29), and saying "this candidate carries
      // overflow items" would report a control that is not on screen.
      onPlace: {
        model.recordPlacement(
          visible: items.count,
          overflow: !overflow.isEmpty && !model.disabled
        )
      }
    ) {
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items)
        // D29's rule on this platform: a group that answers nothing cannot own a live
        // popup. Android can dismiss its own window (`model.menuState?.dismiss()`);
        // here the control is taken out of the row instead, so it cannot be opened and
        // cannot keep offering rows for a disabled group.
        if !overflow.isEmpty, !model.disabled {
          overflowMenu(overflow)
        }
      }
    }
  }

  // MARK: - The row, iOS 15 (no `ViewThatFits`, so no overflow)

  /// Every item, clipped to the box.
  ///
  /// Documented in `docs/components/button-group.md`: iOS 15 has no `ViewThatFits`, and
  /// drawing everything and clipping beats drawing outside the box, which is what the
  /// six-item probe in Appendix A did (396 pt of content in a 369 pt box).
  private func clippedRow(_ items: [ButtonGroupItemState]) -> some View {
    // The reading is direct here: with no candidates there is one row, and it drew
    // every item.
    model.recordPlacement(visible: items.count, overflow: false)
    return AnyView(
      HStack(spacing: ButtonGroupContent.spacing) {
        row(items)
      }
      .clipped()
      .modifier(OptionalGroupAccessibility(label: model.accessibilityLabel))
    )
  }

  /// The group itself: `ControlGroup` for a connected row with no toggles in it, the
  /// plain row otherwise.
  ///
  /// The toggle rule is D42 item 2, and it is measured, not guessed: three
  /// `Toggle(.button)`s inside a `ControlGroup` draw **no on state** — on and off are
  /// the same pixels (Appendix A). A group whose items include a toggle therefore draws
  /// the standard row, so the toggle has a state to show, and the docs say so instead
  /// of shipping a control that lies.
  @ViewBuilder private func row(_ items: [ButtonGroupItemState]) -> some View {
    if model.appearance == .connected && !items.contains(where: \.toggle) {
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

  /// The item's label: a `Label` whose style is the `labelStyle` prop.
  ///
  /// `automatic` is iOS's own answer, and the two appearances disagree — a connected
  /// group with `Label`s drops the titles (measured: 116.33 pt of icons where the text
  /// row is 174.00 pt), while a standard row draws both. So `automatic` means
  /// `.iconOnly` inside a `ControlGroup` when the item has a glyph, and `.titleAndIcon`
  /// everywhere else. An item with no glyph always draws its title: an `iconOnly` item
  /// with nothing to draw would be an empty, nameless control.
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

  /// The `labelStyle` to apply, after `automatic` is resolved.
  private func resolvedLabelStyle(inControlGroup: Bool) -> some LabelStyle {
    switch model.labelStyle {
    case .titleOnly:
      return AnyLabelStyle(.titleOnly)
    case .iconOnly:
      return AnyLabelStyle(.iconOnly)
    case .titleAndIcon:
      return AnyLabelStyle(.titleAndIcon)
    case .automatic:
      // The two branches are different `LabelStyle` types, which is the whole reason
      // this helper returns an erased style rather than the style itself.
      return inControlGroup ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon)
    }
  }

  // MARK: - The overflow control

  /// The "More" `Menu`, composed **beside** the group, never inside it.
  ///
  /// Measured (Appendix A): as a segment *inside* a `ControlGroup` it draws disabled —
  /// accessibility says so and a tap does nothing, containment or not. Beside the group
  /// it opens, and it is the host's `needsContainment = true` that lets it present from
  /// a view with no view-controller parent of its own (Menu's rule,
  /// `ios/core/NitroSwiftUIHost.swift`).
  private func overflowMenu(_ items: [ButtonGroupItemState]) -> some View {
    Menu {
      ForEach(items, id: \.id) { item in
        if item.toggle {
          // A `Toggle` inside a `Menu` is SwiftUI's checkable row, so a toggle item
          // stays a toggle item when it overflows: same handshake, same
          // `onCheckedChange`, same answer to "does the item at the end of the row
          // still work".
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

  /// The binding a toggle reads and writes. The setter ignores what SwiftUI asked for
  /// and goes through ``ButtonGroupModel/toggle(_:)``, because the control — not the
  /// binding — owns the new state and the event that reports it.
  private func toggleBinding(_ item: ButtonGroupItemState) -> Binding<Bool> {
    Binding(
      get: { model.displayed.contains(item.id) },
      set: { _ in model.toggle(item.id) }
    )
  }
}

/// `labelStyle(_:)` takes a concrete `LabelStyle`, so the switch picks the branch — the
/// same reason ``ButtonContent`` switches on `buttonStyle`. Without it the four styles
/// would be four copies of the item's label.
private struct AnyLabelStyle: LabelStyle {
  private let apply: @MainActor (LabelStyleConfiguration) -> AnyView

  init<S: LabelStyle>(_ style: S) {
    apply = { config in AnyView(style.makeBody(configuration: config)) }
  }

  func makeBody(configuration: LabelStyleConfiguration) -> some View {
    apply(configuration)
  }
}

/// The variant's button style, one branch per variant — ``ButtonVariant`` again, so a
/// group's item and a lone Button cannot drift apart on which Material role an iOS name
/// means (`docs/components/button.md` carries the table).
private struct ItemButtonStyle: ViewModifier {
  let variant: ButtonVariant

  func body(content: Content) -> some View {
    switch variant {
    case .filled, .elevated:
      // iOS has no elevated style; Button maps `elevated` to the prominent one, and a
      // group's item follows its own control.
      content.buttonStyle(.borderedProminent)
    case .tonal, .outlined:
      // No outlined style either: `.bordered` is the nearest. Button strokes a hairline
      // for `outlined` on its own; a group does not, because a row of four stroked
      // capsules reads as four borders where Button reads as one outlined control —
      // documented in `docs/components/button-group.md` rather than faked in.
      content.buttonStyle(.bordered)
    case .text:
      content.buttonStyle(.borderless)
    }
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
///
/// `nil` is also what a `ControlGroup` gets: a connected row ignores `.tint` entirely
/// (measured: `.tint(.red)` leaves the probe row at 174.00 x 31.00), so passing it would
/// only make the prop look honoured.
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

/// The group's name goes on the row, so a reader can step over it as one thing while the
/// items stay reachable inside it (`.contain`, not `.combine` — an item that could not
/// be focused is a row that cannot be used).
///
/// An empty `accessibilityLabel(_:)` would silence the items' own names, so it is applied
/// only when set — Button's and SegmentedControl's rule. `testID` deliberately does not
/// go in here: RN already puts it on the component view.
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

/// The Hybrid View React renders as `NitroUiButtonGroup`.
final class HybridNitroUiButtonGroup: HybridNitroUiButtonGroupSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ButtonGroupContent>

  /// The seed waiting for the batch it belongs to.
  private var pendingDefaults: [String]?

  /// This component's name in the sizing engine: `HybridNitroUiButtonGroupComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiButtonGroup"

  /// The size to lay a ButtonGroup out with before anything has been measured, in
  /// points: the `medium` rung's *standard* row, measured 34.33 pt for three items in
  /// Appendix A and rounded up to 34.4 so a cold first frame is never a tenth of a
  /// point short of the control it is laying out (D17).
  ///
  /// Only the height matters: a `fillWidth` entry files the height alone, and a wrong
  /// height moves every row on a cold first frame. The conformance rule measures the
  /// default configuration and compares, and `ButtonGroup.harness.tsx` measures from a
  /// *poisoned* fallback (height 99) so a failed correction cannot hide. The connected
  /// track is 31 pt (Appendix A), which is one cold configuration corrected once.
  private static let fallbackSize = (width: 300.0, height: 34.4)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process (the
  /// static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that matters:
  /// Fabric measures a shadow node before it creates any view, so a fallback declared
  /// from `init` is one measure too late for the first instance (T14). `init` still
  /// calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: ButtonGroupModel())
    super.init()
    // The width is the box's, because overflow can only be decided at the width the row
    // is given: an `intrinsic` group would be measured unbounded, would never overflow,
    // and would then be clamped by Yoga into a box it draws outside of (Appendix A
    // measured 396 pt of content in a 369 pt box). The height is measured and pushed.
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    // The overflow `Menu` presents a view controller of its own, and a hosted control
    // has no parent to present from — Menu's and Picker's rule.
    host.needsContainment = true
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before one can be measured.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<ButtonGroupContent> {
    return host
  }

  /// The model, through the host that owns it (one owner, no second reference).
  private var model: ButtonGroupModel { host.model }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var items: [NitroUiButtonGroupItem] {
    get {
      // Rebuilt as wire structs. Like Menu's `rows`, no `==` guard is possible on the
      // wire type (its C++ `operator==` is invisible to Swift); the guard lives one
      // level up in `ReactProp<std::vector<NitroUiButtonGroupItem>>::hasSameValue`,
      // which is also what keeps the parse below off the per-frame path.
      model.items.map { item in
        NitroUiButtonGroupItem(
          id: item.id,
          title: item.title,
          systemImage: item.systemImage.map { Variant_NullType_String.second($0) }
            ?? .first(NullType.null),
          // Never drawn on iOS and never answered from iOS: the platform has no SF
          // Symbols and no drawable names, so the round trip is `null`.
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
      // The row *is* the size: a different item list is a different height, and no
      // bounds or trait change is coming to say so (sizing.md §5's SwiftUI half).
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
      // The connected track and the bordered row are different heights (31 pt versus
      // 34.33 pt, measured), so this moves the size, not just the pixels.
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      guard let next = ButtonVariant(rawValue: newValue), next != model.variant else { return }
      model.variant = next
      // `.bordered` and `.borderedProminent` are the same shape and padding and
      // `.borderless` is shorter, so a variant change can move the row.
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
      // Whether a title is drawn moves the row's width, and a title is taller than a
      // glyph alone at some rungs, so the height is asked again.
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled row is the same size. It also drops the overflow
      // control, which is this platform's half of D29 — see `candidate(items:overflow:)`.
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
      // Not visual on its own: `displayed` follows in `afterUpdate()`, once the event
      // count says JS has caught up (§4).
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
      // Stored raw: applied in `afterUpdate()`, where the items it names exist
      // (core.md §3 — Nitro does not order props inside a batch).
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
      // Rendered: it is the "More" button's name, which iOS draws (Android uses
      // Material's own localised string and ignores it).
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
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view. It stays in the
      // spec because Android needs it as a `tag`.
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
      // The engine has no answer for a key it has not seen, so it lays this out at the
      // declared fallback; the new configuration may measure exactly what the old one
      // did, and that is the size the host's dedupe would swallow (review F1).
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
    // An item that left the list must not stay checked, and the seed needs the items it
    // names — which is why neither half is interpreted in a setter (core.md §3).
    model.pruneChecked()
    if let defaults = pendingDefaults {
      model.applyDefaults(defaults)
      pendingDefaults = nil
    }
    // The handshake: whether React's set wins over what the user just did, a refused
    // flip included (§4).
    if model.state.reconcile() {
      model.displayed = model.state.displayed
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    // The full reset the brief asks for: a recycled control that still held its previous
    // owner's items, checked set, event counts or seed would show them before its first
    // prop (core.md §6). The `seeded` set is the quiet one — a surviving entry makes the
    // next owner's `defaultCheckedIds` a no-op, which no screen can show and the
    // harness's recycle probe is written to catch.
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

  /// The size SwiftUI measured, from the host's cache. Safe on the JS thread (§1.4).
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

  /// Read what the row laid out, on the main thread. Returns at once.
  func nuiTestProbeRow() throws {
    let host = self.host
    let model = self.model
    let report = {
      // Lay the row out before answering. The placement record is written by
      // `placeSubviews`, so a probe that only reads the record answers with whatever
      // layout the host last happened to do — and a host that has been recycled into a
      // new mount has no reason to have laid anything out yet, where it would answer
      // "nothing" about a row that is on screen.
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

  /// iOS has no node to read in-process: the hosting view answers
  /// `accessibilityElements == []` to anything that is not an accessibility client
  /// (measured in `HybridNitroUiSlider.swift`). Saying so is the answer; the labels are
  /// XCUITest's to read, in `real-input:ios`. No UI is touched, so there is nothing to
  /// hop for.
  func nuiTestProbeAccessibility() throws {
    model.publishAccessibilityReport("unavailable")
  }

  func nuiTestStateReport() throws -> String {
    return model.stateReport()
  }
}
