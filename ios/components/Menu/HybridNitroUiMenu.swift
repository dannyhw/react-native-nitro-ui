//
//  HybridNitroUiMenu.swift
//  react-native-nitro-ui
//
//  The Menu component: SwiftUI `Menu` on the core runtime, with a trigger that is
//  a Button (`docs/tasks/Q1-menu-design.md` §2, amended by DECISIONS D29).
//
//  Structure is Button's - one model, one `NitroUIContent`, one host that is never
//  recreated - and what is new here is that the control *presents* something, so
//  the host needs containment (Picker's reasoning,
//  `ios/components/Picker/HybridNitroUiPicker.swift:279-284`).
//

import NitroModules
import SwiftUI
import UIKit

/// What one row of the flattened `group` is.
///
/// The wrapper sends one ordered array (`Menu.tsx`'s `flattenGroup`): a submenu's
/// items and a section's rows follow their parent and name it in `parentId`. The
/// depth cap is one level (D29), so this is a two-level shape and not a tree.
enum MenuRowKind: String {
  case action
  case submenu
  case section
}

/// A pickable row, as the content draws it.
struct MenuActionItem {
  let id: String
  let title: String
  let disabled: Bool
  let destructive: Bool
  /// A symbol name already checked to resolve, like Button's (`nil` renders no icon).
  let systemImage: String?
}

/// A row that opens a second-level menu.
struct MenuSubmenuItem {
  let id: String
  let title: String
  let systemImage: String?
  let items: [MenuActionItem]
}

/// A titled group. `title == nil` is a group that is only a divider.
struct MenuSectionItem {
  let id: String
  let title: String?
  let items: [MenuActionItem]
}

/// One top-level entry of the menu.
enum MenuTopEntry {
  case action(MenuActionItem)
  case submenu(MenuSubmenuItem)
  case section(MenuSectionItem)
}

/// The wrapper's flat array, as a shape the content can draw without re-walking it.
///
/// Done once in the `rows` setter rather than in `body`: the array's identity only
/// changes when the described menu changes (the wrapper caches it), but a commit can
/// rebuild the view any time, and a re-parse per render would be work the model can
/// do once.
func parseMenuRows(_ rows: [NitroUiMenuRow]) -> [MenuTopEntry] {
  var children: [String: [MenuActionItem]] = [:]
  var top: [MenuTopEntry] = []

  func action(_ row: NitroUiMenuRow) -> MenuActionItem {
    MenuActionItem(
      id: row.id,
      title: row.title,
      disabled: row.disabled,
      destructive: row.destructive,
      // Same rule as Button's `systemImage`: a name that does not resolve would
      // draw the missing-symbol placeholder and say nothing useful to VoiceOver.
      systemImage: row.systemImage?
        .asType(String.self)
        .flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
    )
  }

  // Children first, in the order they arrive, so a parent can take its rows as a
  // group. An unknown `parentId` is not dropped - it reads as a top-level row.
  for row in rows {
    guard let parentId = row.parentId?.asType(String.self) else { continue }
    children[parentId, default: []].append(action(row))
  }

  for row in rows {
    let kind = MenuRowKind(rawValue: row.kind)
    guard row.parentId?.asType(String.self) == nil else { continue }
    switch kind {
    case .action:
      top.append(.action(action(row)))
    case .submenu:
      top.append(
        .submenu(
          MenuSubmenuItem(
            id: row.id,
            title: row.title,
            systemImage: row.systemImage?
              .asType(String.self)
              .flatMap { UIImage(systemName: $0) == nil ? nil : $0 },
            items: children[row.id] ?? []
          )
        )
      )
    case .section:
      top.append(
        .section(
          MenuSectionItem(
            id: row.id,
            title: row.title.isEmpty ? nil : row.title,
            items: children[row.id] ?? []
          )
        )
      )
    case .none:
      // An unknown kind is a row the wrapper does not build. Say nothing and draw
      // nothing rather than guess: a row that renders as the wrong thing is worse
      // than a missing one, and the wrapper is the only writer.
      break
    }
  }
  return top
}

/// State of one Menu. See ``NitroUiModel`` for why this is not `@Published`.
final class MenuModel: NitroUiModel {
  var title: String = ""
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var disabled = false
  var tint: UIColor?
  var systemImage: String?
  /// The items as React sent them, kept so the `rows` prop reads back what was set.
  var rawRows: [NitroUiMenuRow] = []
  /// The flattened items, as the content draws them.
  var entries: [MenuTopEntry] = []
  /// Whether the caller passed a `primaryAction` (tap acts, long-press opens).
  var hasPrimaryAction = false
  var testID: String?
  var accessibilityLabel: String?
  var sizingKey = ""
  /// The picked row's id. A press is a gesture, not a value React owns, so there is
  /// no handshake here - Button's reasoning (`HybridNitroUiButton.swift:139-142`).
  var onSelect: ((String) -> Void)?
  /// iOS never calls these two; see ``HybridNitroUiMenu/onOpen``.
  var onOpen: (() -> Void)?
  var onClose: (() -> Void)?
  var primaryAction: (() -> Void)?

  /// How many rows a pick can name, for `nuiTestMenuReport()`.
  var actionableRowCount: Int {
    var count = 0
    for entry in entries {
      switch entry {
      case .action:
        count += 1
      case .submenu(let submenu):
        count += submenu.items.count
      case .section(let section):
        count += section.items.count
      }
    }
    return count
  }

  /// Look up a pickable row by id - `nil` for a submenu, a section, or a row that
  /// does not exist.
  func actionableRow(id: String) -> MenuActionItem? {
    for entry in entries {
      switch entry {
      case .action(let item) where item.id == id:
        return item
      case .submenu(let submenu):
        if let found = submenu.items.first(where: { $0.id == id }) { return found }
      case .section(let section):
        if let found = section.items.first(where: { $0.id == id }) { return found }
      default:
        continue
      }
    }
    return nil
  }

  /// A row was picked, however it was picked.
  ///
  /// A disabled row cannot be pressed, and a menu reports a pick and forgets it:
  /// there is no value to store, so nothing else happens here.
  func applyPick(_ id: String) {
    guard let row = actionableRow(id: id), !row.disabled else { return }
    onSelect?(row.id)
  }

  override init() {
    super.init()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct MenuContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: MenuModel

  init(model: MenuModel) {
    self.model = model
  }

  var body: some View {
    styledMenu
      // `.menuIndicator(.hidden)` is iOS 15 (SwiftUI.swiftinterface:25910), which the
      // pod's 15.1 floor already satisfies, so it needs no gate. Without it the
      // trigger draws the system's chevron, and a Button-sized trigger with a
      // chevron in it is not the box `docs/components/button.md` measures.
      .menuIndicator(.hidden)
      .controlSize(model.scale.controlSize)
      .disabled(model.disabled)
      .modifier(OptionalMenuTint(color: model.tint))
      .modifier(OptionalMenuAccessibility(label: model.accessibilityLabel))
  }

  /// The trigger with Button's chrome, one branch per variant.
  ///
  /// `.menuStyle(.button)` makes the label a button, but the *style* of that button
  /// is a separate environment value: without a `.buttonStyle` the trigger is the
  /// automatic (borderless) style, and the measured box is the title's text box -
  /// 53.33 x 20.33 pt for a medium `filled` "Variant" on iPhone 17, against Button's
  /// 61.0 x 34.3 for "Cancel" (`docs/components/button.md`). The whole sizing story of
  /// this control is that its box is a Button's box, so the same per-variant style
  /// Button picks is applied here, in Button's shape: the switch carries the style
  /// and everything shared stays outside it, so a variant change costs one style.
  ///
  /// The rows are unaffected: the menu's content is presented by the system, which
  /// draws its own rows rather than the SwiftUI buttons they are written as - and
  /// that claim is a reading, not a measurement, because no touch this environment
  /// can inject opens a SwiftUI `Menu` (`docs/tasks/G2-button.report.md` measured that
  /// for every Button style). It is on G7b's real-input list to confirm visually.
  @ViewBuilder private var styledMenu: some View {
    switch model.variant {
    case .filled:
      menu.buttonStyle(.borderedProminent)
    case .tonal:
      menu.buttonStyle(.bordered)
    case .outlined:
      menu
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .overlay(
          Capsule()
            .strokeBorder(Color(UIColor.separator), lineWidth: 1)
        )
    case .text:
      menu.buttonStyle(.borderless)
    case .elevated:
      menu.buttonStyle(.borderedProminent)
    }
  }

  /// The `Menu` itself, in the one branch its caller asked for.
  ///
  /// `primaryAction` is a different `init` and therefore a different view structure,
  /// so it is a branch rather than a runtime value - the same reason `PickerContent`
  /// has two (`ios/components/Picker/HybridNitroUiPicker.swift:131-137`). Both
  /// branches keep their structural identity, so a commit inside one is a diff
  /// rather than a rebuild.
  ///
  /// `.menuStyle(.button)` is iOS 16 (`SwiftUI.swiftinterface:11175`), above the
  /// 15.1 floor, so it is gated: below it the trigger is SwiftUI's default menu
  /// look. `Menu(content:label:primaryAction:)` is iOS 15
  /// (`:8776-8791`), under the floor, so it needs no gate of its own.
  @ViewBuilder private var menu: some View {
    if model.hasPrimaryAction, let primaryAction = model.primaryAction {
      if #available(iOS 16.0, *) {
        Menu(content: rows, label: trigger, primaryAction: primaryAction)
          .menuStyle(.button)
      } else {
        Menu(content: rows, label: trigger, primaryAction: primaryAction)
      }
    } else {
      if #available(iOS 16.0, *) {
        Menu(content: rows, label: trigger)
          .menuStyle(.button)
      } else {
        Menu(content: rows, label: trigger)
      }
    }
  }

  /// The trigger's label: Button's label composition.
  ///
  /// Copied rather than shared because Button keeps its label private inside
  /// `ButtonContent`, and the alternative is a `Menu` whose trigger is a *different*
  /// view from a Button's - which is the one thing this control's sizing story
  /// cannot survive (`docs/components/menu.md`: the box is a Button's box).
  private func trigger() -> some View {
    Group {
      if let systemImage = model.systemImage {
        Label {
          Text(model.title).lineLimit(1)
        } icon: {
          Image(systemName: systemImage)
        }
        .labelStyle(.titleAndIcon)
      } else {
        Text(model.title)
          .lineLimit(1)
      }
    }
  }

  /// The rows, in the order the wrapper sent them.
  ///
  /// `id: \.offset`, like `PickerContent`: a row id is unique within a menu, but an
  /// `id:` that is a caller's string would make a re-ordered list a rebuilt list,
  /// and a duplicate id would be a broken `ForEach` rather than two rows.
  private func rows() -> some View {
    ForEach(Array(model.entries.enumerated()), id: \.offset) { _, entry in
      switch entry {
      case .action(let item):
        rowButton(item)
      case .submenu(let submenu):
        // The nesting D29 keeps on iOS: a second-level `Menu`, whose own content
        // builder is a plain `ForEach` because the depth cap says there is nothing
        // third-level to draw.
        Menu {
          ForEach(Array(submenu.items.enumerated()), id: \.offset) { _, item in
            rowButton(item)
          }
        } label: {
          if let systemImage = submenu.systemImage {
            Label(submenu.title, systemImage: systemImage)
          } else {
            Text(submenu.title)
          }
        }
      case .section(let section):
        // `Section` is what renders as a menu group. A section with no title gets
        // the same view as one with an empty header - `Divider()`, which reads as a
        // group break and nothing else.
        if let title = section.title {
          Section(header: Text(title)) {
            ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
              rowButton(item)
            }
          }
        } else {
          Section {
            ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
              rowButton(item)
            }
          } header: {
            Divider()
          }
        }
      }
    }
  }

  /// One pickable row.
  ///
  /// `role: .destructive` is iOS's own red-and-warning treatment; the pick goes
  /// through the model so a test press and a real one cannot diverge.
  private func rowButton(_ item: MenuActionItem) -> some View {
    Button(
      role: item.destructive ? .destructive : nil,
      action: { model.applyPick(item.id) }
    ) {
      if let systemImage = item.systemImage {
        Label(item.title, systemImage: systemImage)
      } else {
        Text(item.title)
      }
    }
    .disabled(item.disabled)
  }

}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
private struct OptionalMenuTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the trigger's own label - which
/// is its title - so it is applied only when set. `testID` deliberately does *not*
/// go in here: RN already puts it on the component view, and putting it on the
/// SwiftUI element too would make the view match a testID query twice.
private struct OptionalMenuAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiMenu`.
final class HybridNitroUiMenu: HybridNitroUiMenuSpec, RecyclableView {
  private let host: NitroSwiftUIHost<MenuContent>

  /// This component's name in the sizing engine: `HybridNitroUiMenuComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiMenu"

  /// The size to lay a Menu out with before anything has been measured, in points.
  ///
  /// One pair for the component, which is what the engine can hold
  /// (`docs/architecture/sizing.md` §9), and the trigger is a Button, so the honest
  /// number is the Button's: this OS's medium filled button with a six-letter title.
  /// It is *not* Button's own declared pair (77 x 35) on purpose - the two controls
  /// have to be told apart by a harness that reads a fallback rather than a name, and
  /// `docs/tasks/X4-conformance.md` requires a declared fallback that differs from the
  /// size the fixture measures. Menu's own measured medium/"Menu" box is what goes
  /// here once the harness has measured it; see `docs/components/menu.md` Sizing.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process (the
  /// static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a Menu's shadow node before it creates any Menu view,
  /// so a fallback declared from `init` is one measure too late for the first
  /// instance (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The declared fallback - see ``declaresFallback``.
  ///
  /// Button-sized, because the trigger *is* a Button's box, and deliberately not any
  /// fixture's measured size: a fallback equal to the answer hides a correction that
  /// never arrived (X4's rule 1, and the reason `Menu.harness.tsx` keeps this pair as
  /// `DECLARED_FALLBACK` and asserts against it). Button declares 77×35 here and
  /// measures about 61×34 (`docs/components/button.md`), so this is the same
  /// neighbourhood, not a second guess of it (D17).
  private static let fallbackSize = (width: 74.0, height: 38.0)

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: MenuModel())
    super.init()
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A Menu presents something, so its hosting controller needs a view controller
    // to present from - Picker's reason, and the reason Button's `false` is wrong
    // here (`docs/tasks/Q1-menu-design.md` §2).
    host.needsContainment = true
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before one can be measured, and a host built
    // without that table still gets its fallback here.
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<MenuContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var title: String {
    get { model.title }
    set {
      guard newValue != model.title else { return }
      model.title = newValue
      host.markDirty()
      // A different string is a different trigger width, and nothing else notices.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      let next = ButtonVariant(rawValue: newValue) ?? .filled
      guard next != model.variant else { return }
      model.variant = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var size: String {
    get { model.scale.rawValue }
    set {
      let next = ButtonScale(rawValue: newValue) ?? .medium
      guard next != model.scale else { return }
      model.scale = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled control is the same size.
      //
      // D29 asks a `disabled` that arrives while the menu is open to close it. On iOS
      // we cannot honour that *and* report it: SwiftUI owns the open state of its own
      // `Menu`, `.disabled(true)` on it is not documented to dismiss an open menu, and
      // we have no signal telling us one is open to act on - the same limit that makes
      // `onOpen`/`onClose` Android-only here. Android, where the popup is our window,
      // both closes it and says so; the harness gates that side, and
      // `docs/components/menu.md` says what iOS does.
      host.markDirty()
    }
  }

  var rows: [NitroUiMenuRow] {
    get { model.rawRows }
    set {
      // No guard here, unlike the string props: the generated struct has a C++
      // `operator==` that Swift cannot see, so comparing the array in Swift would
      // mean walking it by hand on every commit. The guard is one level up -
      // `ReactProp<std::vector<NitroUiMenuRow>>::hasSameValue`
      // (`HybridNitroUiMenuComponent.hpp:76`) compares the converted values and does
      // not call this setter when nothing moved, which is also what makes the parse
      // below cheap rather than per-frame.
      model.rawRows = newValue
      model.entries = parseMenuRows(newValue)
      // The items live in a popup: a different menu is the same trigger box, so
      // this marks dirty and never asks for a measure. `group` is out of the sizing
      // key for the same reason (Q1 §5).
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

  var systemImage: Variant_NullType_String {
    get { model.systemImage.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.systemImage else { return }
      // Only a name that resolves to a symbol reaches the content (Button's rule).
      model.systemImage = next.flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var hasPrimaryAction: Bool {
    get { model.hasPrimaryAction }
    set {
      guard newValue != model.hasPrimaryAction else { return }
      model.hasPrimaryAction = newValue
      // A different `init` is a different view structure, so it is a commit - and a
      // trigger that acts instead of opening is still the same box.
      host.markDirty()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. It stays in the spec because Android needs it as
      // a `tag`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // Rendered, not bookkeeping: the label is on the SwiftUI element, so it needs
      // a commit or a late-set label never reaches VoiceOver.
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
      // Button's reason: the engine has no answer for a key it has not seen, so it
      // lays this out at the declared fallback, and the new configuration may measure
      // exactly what the old one did (review F1).
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onSelect: ((String) -> Void)? {
    get { model.onSelect }
    set { model.onSelect = newValue }
  }

  /// Whether the menu opened. **Never called on iOS.**
  ///
  /// SwiftUI's `Menu` has no expansion binding in the iPhoneOS 27.0 SDK - `Menu`'s
  /// inits take `content`, `label` and `primaryAction` (`SwiftUI.swiftinterface:8767`
  /// and `:8778`), and `isExpanded:` exists on `Section`, `DisclosureGroup` and table
  /// rows but not on `Menu`. The menu is also presented by the system rather than by
  /// our hosting controller, so there is no window of ours to notice. Nothing here can
  /// see an open, so nothing here can report one; storing the callback is all this
  /// does. Android's popup is our own window and does call it.
  var onOpen: (() -> Void)? {
    get { model.onOpen }
    set { model.onOpen = newValue }
  }

  /// Whether the menu closed. **Never called on iOS** - see ``onOpen``.
  var onClose: (() -> Void)? {
    get { model.onClose }
    set { model.onClose = newValue }
  }

  var primaryAction: (() -> Void)? {
    get { model.primaryAction }
    set { model.primaryAction = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // No controlled value, so nothing to reconcile: one commit per React commit
    // (`docs/architecture/core.md` §12).
    host.commit()
  }

  func prepareForRecycle() {
    model.title = ""
    model.variant = .filled
    model.scale = .medium
    model.disabled = false
    model.tint = nil
    model.systemImage = nil
    model.rawRows = []
    model.entries = []
    model.hasPrimaryAction = false
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onSelect = nil
    model.onOpen = nil
    model.onClose = nil
    model.primaryAction = nil
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onSelect = nil
    model.onOpen = nil
    model.onClose = nil
    model.primaryAction = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this Menu, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may only
  /// be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiMenuSize {
    guard let size = host.contentSize else {
      return NitroUiMenuSize(width: 0, height: 0)
    }
    return NitroUiMenuSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press one row by id, from a test.
  ///
  /// Test-only; see the spec for why it exists - the harness's touch injector reaches
  /// the app window, and an iOS menu is presented by the system outside it. Hops to
  /// the main thread because JS calls it and a real press runs on the UI thread
  /// (core.md §5), and the hop is what keeps the timing of a real pick rather than
  /// flattening it. A disabled row, a submenu, a section and an unknown id all report
  /// nothing, exactly as a real press of them would.
  func nuiTestSelectRow(id: String) throws {
    let model = host.model
    let run = { model.applyPick(id) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// What the menu and its anchor are, as this host can see them.
  ///
  /// Test-only; see the spec for the format. iOS has no popup of its own to measure -
  /// SwiftUI hands the menu to the system's presentation - so `expanded`, `live`,
  /// `anchor` and `menu` answer `-1`, "not measurable here", rather than a `0` that
  /// would read as "checked, and none left behind". `rows` is the one field that *is*
  /// knowable here, because the items are data we were handed rather than a window we
  /// cannot see, so it answers the real count. Picker says the same about its menu
  /// (`HybridNitroUiPicker.swift:555-565`).
  func nuiTestMenuReport() throws -> String {
    return "expanded=-1;live=-1;anchor=-1,-1,-1,-1;menu=-1,-1,-1,-1;rows=\(host.model.actionableRowCount)"
  }

  private var model: MenuModel {
    return host.model
  }
}
