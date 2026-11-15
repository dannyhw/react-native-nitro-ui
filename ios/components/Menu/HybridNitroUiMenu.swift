// The Menu component: SwiftUI's `Menu` with a Button-styled trigger. The control presents
// something, so its host needs view-controller containment.

import NitroModules
import SwiftUI
import UIKit

/// The wrapper sends one flat, ordered array: a submenu's items and a section's rows follow
/// their parent and name it in `parentId`. Nesting is one level deep.
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
  /// A symbol name already checked to resolve; `nil` renders no icon.
  let systemImage: String?
  /// The row's second line (`UIAction.subtitle`), or `nil` for none.
  let subtitle: String?
  /// `nil` for a plain row; otherwise the row is a menu toggle in this state.
  let checked: Bool?
}

/// A row that opens a second-level menu.
struct MenuSubmenuItem {
  let id: String
  let title: String
  let systemImage: String?
  let items: [MenuActionItem]
}

/// A group with an optional header. `title == nil` is a `Section` with no header.
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

/// Parses the wrapper's flat array once, in the `rows` setter rather than in `body`, which
/// can run on any commit.
func parseMenuRows(_ rows: [NitroUiMenuRow]) -> [MenuTopEntry] {
  var children: [String: [MenuActionItem]] = [:]
  var top: [MenuTopEntry] = []

  func action(_ row: NitroUiMenuRow) -> MenuActionItem {
    MenuActionItem(
      id: row.id,
      title: row.title,
      disabled: row.disabled,
      destructive: row.destructive,
      // A name that does not resolve would draw the missing-symbol placeholder.
      systemImage: row.systemImage?
        .asType(String.self)
        .flatMap { UIImage(systemName: $0) == nil ? nil : $0 },
      subtitle: row.subtitle?.asType(String.self).flatMap { $0.isEmpty ? nil : $0 },
      checked: row.checked?.asType(Bool.self)
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
      // An unknown kind draws nothing: a row rendered as the wrong thing is worse than a
      // missing one.
      break
    }
  }
  return top
}

final class MenuModel: NitroUiModel {
  var title: String = ""
  var variant: ButtonVariant = .filled
  var scale: ButtonScale = .medium
  var disabled = false
  var tint: UIColor?
  var systemImage: String?
  /// The Android icon string. Stored, never drawn.
  var androidIcon: String?
  /// The items as React sent them, kept so the `rows` prop reads back what was set.
  var rawRows: [NitroUiMenuRow] = []
  /// The flattened items, as the content draws them.
  var entries: [MenuTopEntry] = []
  /// Whether the caller passed a `primaryAction` (tap acts, long-press opens).
  var hasPrimaryAction = false
  var testID: String?
  var accessibilityLabel: String?
  var sizingKey = ""
  /// Receives the picked row's id.
  var onSelect: ((String) -> Void)?
  /// Never called on iOS: SwiftUI's `Menu` does not report when it opens or closes.
  var onOpen: (() -> Void)?
  var onClose: (() -> Void)?
  var primaryAction: (() -> Void)?

  /// How many rows a pick can name.
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

  /// A disabled row cannot be picked. A menu has no value to store, so a pick is only
  /// reported.
  func applyPick(_ id: String) {
    guard let row = actionableRow(id: id), !row.disabled else { return }
    onSelect?(row.id)
  }

  override init() {
    super.init()
  }
}

struct MenuContent: NitroUIContent {
  @ObservedObject private var model: MenuModel

  init(model: MenuModel) {
    self.model = model
  }

  var body: some View {
    styledMenu
      // Without this the trigger draws the system's chevron and is no longer a Button's size.
      .menuIndicator(.hidden)
      .controlSize(model.scale.controlSize)
      .disabled(model.disabled)
      .modifier(OptionalMenuTint(color: model.tint))
      .modifier(OptionalMenuAccessibility(label: model.accessibilityLabel))
  }

  /// The trigger with Button's styling, one branch per variant.
  ///
  /// `.menuStyle(.button)` makes the label a button, but that button's style is a separate
  /// environment value: without a `.buttonStyle` it is borderless and the box is only the
  /// title's text. The system draws the menu's rows itself, so the style does not reach them.
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

  /// `primaryAction` is a different `init` and so a different view structure, hence a branch
  /// rather than a runtime value. `.menuStyle(.button)` is iOS 16; below it the trigger has
  /// SwiftUI's default menu look.
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

  /// The same label composition as Button's, so the trigger measures as a Button does.
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

  /// `id: \.offset`: keyed by the caller's ids, a re-ordered list would be rebuilt and a
  /// duplicate id would break the `ForEach`.
  private func rows() -> some View {
    ForEach(Array(model.entries.enumerated()), id: \.offset) { _, entry in
      switch entry {
      case .action(let item):
        rowButton(item)
      case .submenu(let submenu):
        // Nesting is one level deep, so a submenu's content is a plain `ForEach`.
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
        // SwiftUI turns a `Section` into an inline `UIMenu`, which UIKit already separates
        // from its neighbours. An untitled section must get no header at all: given a
        // `Divider()` as its header, SwiftUI builds an inline menu with no children.
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
          }
        }
      }
    }
  }

  /// A row with a `checked` is a `Toggle`, which SwiftUI turns into a menu action with a
  /// check. Its binding reads the prop and a flip is a pick; the app sends the next
  /// `checked`. A `Toggle` takes no role, so a checkable row is never drawn destructive.
  @ViewBuilder
  private func rowButton(_ item: MenuActionItem) -> some View {
    if let checked = item.checked {
      Toggle(
        isOn: Binding(get: { checked }, set: { _ in model.applyPick(item.id) })
      ) {
        rowLabel(item)
      }
      .disabled(item.disabled)
    } else {
      Button(
        role: item.destructive ? .destructive : nil,
        action: { model.applyPick(item.id) }
      ) {
        rowLabel(item)
      }
      .disabled(item.disabled)
    }
  }

  /// The subtitle is a second `Text`, which SwiftUI turns into the menu action's `subtitle`.
  @ViewBuilder
  private func rowLabel(_ item: MenuActionItem) -> some View {
    if let systemImage = item.systemImage {
      Label {
        rowTexts(item)
      } icon: {
        Image(systemName: systemImage)
      }
    } else {
      rowTexts(item)
    }
  }

  @ViewBuilder
  private func rowTexts(_ item: MenuActionItem) -> some View {
    Text(item.title)
    if let subtitle = item.subtitle {
      Text(subtitle)
    }
  }

}

/// `.tint()` has no "unset" form, so it is applied only when a colour is set.
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

/// An empty `accessibilityLabel(_:)` would silence the trigger's own label (its title), so
/// it is applied only when set. `testID` is not applied here: React Native already puts it
/// on the component view, and a second copy would match a testID query twice.
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

final class HybridNitroUiMenu: HybridNitroUiMenuSpec, RecyclableView {
  private let host: NitroSwiftUIHost<MenuContent>

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiMenu"

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// Menu's shadow node before it creates any Menu view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// In points. Button-sized, because the trigger is a Button's box.
  private static let fallbackSize = (width: 74.0, height: 38.0)

  override init() {
    host = NitroSwiftUIHost(model: MenuModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // A Menu presents something, so its hosting controller needs a view controller to
    // present from.
    host.needsContainment = true
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
      // Repaints only: a disabled control is the same size. On iOS this does not close an
      // open menu: SwiftUI owns its `Menu`'s open state and gives no signal that one is open.
      host.markDirty()
    }
  }

  var rows: [NitroUiMenuRow] {
    get { model.rawRows }
    set {
      // No equality guard: the generated struct's `operator==` is C++ and invisible to Swift.
      // Nitro compares the converted values first and does not call this setter when nothing
      // changed.
      model.rawRows = newValue
      model.entries = parseMenuRows(newValue)
      // The items live in a popup, so the trigger's size does not change.
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
      // Only a name that resolves to a symbol reaches the content.
      model.systemImage = next.flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  /// Android only. Stored so the getter answers, without `markDirty()`: nothing draws it.
  var androidIcon: Variant_NullType_String {
    get { model.androidIcon.map { .second($0) } ?? .first(.null) }
    set { model.androidIcon = newValue.asType(String.self) }
  }

  var hasPrimaryAction: Bool {
    get { model.hasPrimaryAction }
    set {
      guard newValue != model.hasPrimaryAction else { return }
      model.hasPrimaryAction = newValue
      // A different `init` is a different view structure, but the same box.
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
      // The label is on the SwiftUI element, so it needs a commit to reach VoiceOver.
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
      // report as a duplicate.
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

  /// Never called on iOS. SwiftUI's `Menu` has no expansion binding, and the system presents
  /// the menu outside our hosting controller, so nothing here can see it open.
  /// `.onAppear`/`.onDisappear` on the menu's content do not work either: the content's
  /// identity survives the presentation, so appear fires once and disappear never.
  var onOpen: (() -> Void)? {
    get { model.onOpen }
    set { model.onOpen = newValue }
  }

  /// Never called on iOS, like `onOpen`.
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
    host.commit()
  }

  func prepareForRecycle() {
    model.title = ""
    model.variant = .filled
    model.scale = .medium
    model.disabled = false
    model.tint = nil
    model.systemImage = nil
    model.androidIcon = nil
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
    // A probe's answer describes the previous owner's menu.
    storeDrawn("-1")
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

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiMenuSize {
    guard let size = host.contentSize else {
      return NitroUiMenuSize(width: 0, height: 0)
    }
    return NitroUiMenuSize(width: Double(size.width), height: Double(size.height))
  }

  /// Test-only: picks one row by id, because an iOS menu is presented by the system outside
  /// the app window, where injected touches do not reach. Runs on main, as a real pick does.
  func nuiTestSelectRow(id: String) throws {
    let model = host.model
    let run = { model.applyPick(id) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Test-only. iOS hands the menu to the system's presentation, and a `primaryAction` is a
  /// gesture on one button, so the popup and split-trigger fields answer `-1` ("not
  /// measurable here"). `rows` is the model's count, and `drawn` is what
  /// `nuiTestMenuProbe()` last read from UIKit.
  func nuiTestMenuReport() throws -> String {
    return "expanded=-1;live=-1;anchor=-1,-1,-1,-1;menu=-1,-1,-1,-1"
      + ";rows=\(host.model.actionableRowCount);drawn=\(readDrawn())"
      + ";split=-1;leading=-1,-1,-1,-1;trailing=-1,-1,-1,-1"
      // Android's field: iOS has no Android glyph to tint, so it answers `-`.
      + ";iconTints=-"
  }

  /// Test-only: opens the menu, copies the tree UIKit built for it, and closes it, in one
  /// main-thread turn. SwiftUI only fills in the trigger's `UIMenu` when the menu is
  /// presented. The answer is stored for `nuiTestMenuReport()` rather than returned, so JS
  /// never waits on the main thread.
  func nuiTestMenuProbe() throws {
    let run = { [weak self] in
      guard let self else { return }
      self.storeDrawn(self.probeDrawnMenu())
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  // MARK: - Pixel probes (test-only)

  private let probesLock = NSLock()
  private var triggerProbes = 0
  private var menuProbes = 0

  /// iOS has no Android icon glyph in its trigger to sample, so the report says `no pixels`,
  /// which the tests treat as a failure.
  func nuiTestPixelProbe(color: Double) throws {
    probesLock.lock()
    triggerProbes += 1
    probesLock.unlock()
  }

  func nuiTestPixelReport() throws -> String {
    probesLock.lock()
    let probes = triggerProbes
    probesLock.unlock()
    return "n=\(probes) no pixels platform=ios"
  }

  /// The system presents the menu in a window this process cannot rasterise, so there is
  /// nothing to sample and the report says `no pixels`.
  func nuiTestMenuPixelProbe(color: Double) throws {
    probesLock.lock()
    menuProbes += 1
    probesLock.unlock()
  }

  func nuiTestMenuPixelReport() throws -> String {
    probesLock.lock()
    let probes = menuProbes
    probesLock.unlock()
    return "n=\(probes) no pixels platform=ios"
  }

  /// The probe's last answer, or `-1` before there is one.
  private var drawn = "-1"
  /// `drawn` is written on main and read from JS.
  private let drawnLock = NSLock()

  private func storeDrawn(_ value: String) {
    drawnLock.lock()
    drawn = value
    drawnLock.unlock()
  }

  private func readDrawn() -> String {
    drawnLock.lock()
    defer { drawnLock.unlock() }
    return drawn
  }

  /// What UIKit holds for this trigger, as the spec's `drawn` tree, or `-1`.
  private func probeDrawnMenu() -> String {
    nitroUiAssertMainThread()
    // A trigger with a `primaryAction` acts on a tap rather than opening, and a disabled one
    // does nothing.
    guard #available(iOS 17.4, *), !model.hasPrimaryAction, !model.disabled,
      let button = Self.menuButton(in: host), button.showsMenuAsPrimaryAction
    else { return "-1" }
    button.performPrimaryAction()
    let tree = button.menu.map { Self.describe($0.children) } ?? "-1"
    button.contextMenuInteraction?.dismissMenu()
    return tree
  }

  /// The trigger's `UIButton`, matched by public API (a button whose `menu` is set) rather
  /// than by SwiftUI's private class name.
  private static func menuButton(in view: UIView) -> UIButton? {
    if let button = view as? UIButton, button.menu != nil { return button }
    for child in view.subviews {
      if let found = menuButton(in: child) { return found }
    }
    return nil
  }

  /// `@<subtitle>` for an action that has one. The getter is iOS 16+; before that the mark
  /// is left off.
  private static func subtitleMark(_ action: UIAction) -> String {
    guard #available(iOS 16.0, *), let subtitle = action.subtitle, !subtitle.isEmpty
    else { return "" }
    return "@\(subtitle)"
  }

  private static func describe(_ elements: [UIMenuElement]) -> String {
    elements.map { element -> String in
      if let menu = element as? UIMenu {
        let rows = describe(menu.children)
        return menu.options.contains(.displayInline)
          ? "(\(menu.title):\(rows))"
          : "{\(menu.title):\(rows)}"
      }
      if let action = element as? UIAction {
        return action.title
          + Self.subtitleMark(action)
          + (action.state == .on ? "+" : "")
          + (action.attributes.contains(.destructive) ? "!" : "")
          + (action.attributes.contains(.disabled) ? "~" : "")
      }
      return "?"
    }
    .joined(separator: ",")
  }

  private var model: MenuModel {
    return host.model
  }
}
