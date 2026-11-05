//
//  HybridNitroUiContextMenu.swift
//  react-native-nitro-ui
//
//  ContextMenu (G16, DECISIONS D36/D37; design `docs/tasks/Q6-contextmenu-design.report.md`
//  Appendix B, measured by S3): a `UIContextMenuInteraction` on the Nitro-generated
//  component view, whose React Native children Fabric already mounts there.
//
//  1. **Mount: no `.mm` patch.** `RCTViewComponentView` mounts children into
//     `currentContainerView` - the component view itself - at the frames Yoga gives them
//     relative to its outer border. The Hybrid View's own view is installed with
//     `setContentView:` and framed *inside* padding and border, so mounting the children
//     into it (G14's `CONTENT_CHILDREN_VIEWS` patch) would offset a padded ContextMenu's
//     children twice (D36 item 5). The content view here is an empty, transparent,
//     touch-transparent box whose one job is to find the component view
//     (`didMoveToSuperview`) - and to answer `isAccessibilityElement` for it (below).
//  2. **Arbitration.** UIKit's recognizers cannot cancel React Native's touch: the
//     surface's `RCTSurfaceTouchHandler` cannot be prevented by a recognizer on a
//     descendant view. So at `willDisplayMenu` the nearest surface handler is toggled
//     off and on, which is RN's own `_cancelTouches`: the `Pressable` under the finger
//     gets `onResponderTerminate`, so `onPressOut` and never `onPress` (Q6 D2). iOS 27's
//     lift already ends RN's touch (S3 Q1), so on 27 this is belt and braces; D37 item 1
//     keeps it for older systems.
//  3. **Order.** UIKit calls a row's handler before `willEnd` (S3 Q4, 10/10), and
//     `onClose` fires from the end animator's completion, so a pick reports `onSelect`
//     then `onClose` (D32).
//

import NitroModules
import UIKit

// Perf ring buffer, shared with C++/Kotlin (cpp/core/NitroUiPerf.hpp).
private typealias NitroUiContextMenuPerf = margelo.nitro.nitroui.NitroUiPerf

// MARK: - The content view

/// The Hybrid View's view: an empty box that tells the Hybrid which component view it
/// was installed in, and takes nothing from it.
final class ContextMenuContentView: UIView {
  var onSuperview: ((UIView?) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    // `betterHitTest` walks the subviews top-first, and this view is the last (top) one:
    // an interactive full-size content view would swallow every touch meant for the
    // children.
    isUserInteractionEnabled = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    onSuperview?(superview)
  }

  /// The component view's own `accessible`, read back for it (DECISIONS D37 item 2).
  ///
  /// `RCTViewComponentView.isAccessibilityElement` answers with its `contentView`'s value
  /// whenever it has one (`RCTViewComponentView.mm`, `isAccessibilityElement`), so a plain
  /// `false` here makes an `accessible` ContextMenu invisible to VoiceOver as one element:
  /// S3 measured `ax=0` with the label set. The value React Native stored is on the
  /// component view itself (`self.accessibilityElement.isAccessibilityElement = accessible`),
  /// so it is read through `UIView`'s own getter, skipping the override that asks this view.
  /// `ContextMenu.harness.tsx` reads `ax` for an accessible and a plain ContextMenu, so a
  /// React Native that moves this answer again goes red there.
  override var isAccessibilityElement: Bool {
    get {
      guard let host = superview else { return false }
      typealias Getter = @convention(c) (AnyObject, Selector) -> Bool
      let selector = NSSelectorFromString("isAccessibilityElement")
      guard let imp = class_getMethodImplementation(UIView.self, selector) else { return false }
      return unsafeBitCast(imp, to: Getter.self)(host, selector)
    }
    set { _ = newValue }
  }
}

// MARK: - The delegate

/// The interaction's delegate: a separate object the Hybrid owns, because the interaction
/// holds its delegate weakly.
final class ContextMenuInteractionDelegate: NSObject, UIContextMenuInteractionDelegate {
  weak var owner: HybridNitroUiContextMenu?

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    return owner?.configuration(at: location)
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    owner?.willDisplay(configuration)
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    owner?.willEnd(configuration, animator: animator)
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return owner?.targetedPreview()
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return owner?.targetedPreview()
  }

  // The iOS 13-15 names of the two above: the podspec floor is 15.1.
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return owner?.targetedPreview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return owner?.targetedPreview()
  }
}

// MARK: - React Native's touches

/// RN's own `_cancelTouches` on the nearest surface touch handler up the tree.
///
/// The class is looked up by name, as `NitroUiTouchRoot` does, so Swift never imports
/// React. Toggling `isEnabled` resets the recognizer, which sends `touchCancel` for every
/// active touch (`RCTSurfaceTouchHandler.mm`, `reset`); a set UIKit already ended is
/// empty, and the toggle then sends nothing. The nearest handler is the surface's, an RN
/// `Modal`'s or a BottomSheet's own, whichever window the ContextMenu is in.
enum NitroUiReactTouches {
  /// Whether a handler was found and toggled.
  @discardableResult
  static func cancel(around view: UIView?) -> Bool {
    var current = view
    while let candidate = current {
      for recognizer in candidate.gestureRecognizers ?? []
      where NSStringFromClass(type(of: recognizer)) == "RCTSurfaceTouchHandler" {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
        return true
      }
      current = candidate.superview
    }
    return false
  }
}

// MARK: - The Hybrid View

/// The Hybrid View React renders as `NitroUiContextMenu`.
final class HybridNitroUiContextMenu: HybridNitroUiContextMenuSpec, RecyclableView {
  private let content = ContextMenuContentView()
  private let menuDelegate = ContextMenuInteractionDelegate()
  /// The generated component view: the box, the children's parent, and the view the
  /// interaction lives on. Attached once and never detached - every iOS recycle is also a
  /// drop (the generated `prepareForRecycle` calls `notifyOnDropView` first), so an
  /// interaction removed at drop would leave the recycled view with no menu.
  private weak var host: UIView?
  private var interaction: UIContextMenuInteraction?

  // Props, stored raw and applied in `afterUpdate`.
  private var rawRows: [NitroUiMenuRow] = []
  private var entries: [MenuTopEntry] = []
  private var rawTitle: String?
  private var rawDisabled = false
  private var rawRadius: CGFloat?
  private var menuDirty = false
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var select: ((String) -> Void)?
  private var open: (() -> Void)?
  private var close: (() -> Void)?

  // State, main thread only.
  private var isOpen = false
  /// Bumped per configuration and written into its `identifier`. Never reset, not even by
  /// a recycle: an end animator that completes after one must not match a new menu.
  private var generation = 0
  /// The `identifier` of the configuration whose menu is up, or `-1`. A close is matched
  /// to it, never to `generation`: UIKit asks for a new configuration as soon as a new
  /// touch begins, which can be during the last menu's dismiss animation.
  private var openGeneration = -1
  private var opens = 0
  private var closes = 0
  private var selects = 0
  private var configs = 0
  private var cancels = 0
  private var lastRadius: CGFloat = -1
  private var drawn = "-1"

  private let reportLock = NSLock()
  private var report = "pending"
  /// Whether a harness has asked this object for a report (under `reportLock`). An app
  /// never does, so its ContextMenus never build one. A recycle clears it, so a new owner
  /// is built for only once it is asked about.
  private var reportsWanted = false
  /// Reports built (main thread).
  private var reportSeq = 0

  override init() {
    super.init()
    menuDelegate.owner = self
    content.onSuperview = { [weak self] superview in
      self?.attach(to: superview)
    }
  }

  var view: UIView {
    return content
  }

  // MARK: - Props

  var rows: [NitroUiMenuRow] {
    get { rawRows }
    set {
      rawRows = newValue
      entries = parseMenuRows(newValue)
      menuDirty = true
    }
  }

  var title: Variant_NullType_String {
    get { rawTitle.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != rawTitle else { return }
      rawTitle = next
      menuDirty = true
    }
  }

  var disabled: Bool {
    get { rawDisabled }
    set { rawDisabled = newValue }
  }

  var previewCornerRadius: Variant_NullType_Double {
    get { rawRadius.map { .second(Double($0)) } ?? .first(.null) }
    set { rawRadius = newValue.asType(Double.self).map { CGFloat($0) } }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var onSelect: ((_ id: String) -> Void)? {
    get { select }
    set { select = newValue }
  }

  var onOpen: (() -> Void)? {
    get { open }
    set { open = newValue }
  }

  var onClose: (() -> Void)? {
    get { close }
    set { close = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    nitroUiAssertMainThread()
    if isOpen {
      if rawDisabled || actionableRowCount == 0 {
        // A control that answers nothing cannot own a live menu (D29). UIKit ends the
        // menu, and `willEnd` reports the close.
        interaction?.dismissMenu()
      } else if menuDirty {
        // A `group` changed while the menu is up: rebuild it in place (iOS 14).
        interaction?.updateVisibleMenu { [weak self] current in
          self?.buildMenu() ?? current
        }
      }
    }
    menuDirty = false
    mark(.propsApplied)
    publishReport()
  }

  func onDropView() {
    nitroUiAssertMainThread()
    // The menu goes with the mount. The close is reported now, while the app's handler is
    // still connected, so an app that tracks open state from `onOpen`/`onClose` never
    // keeps a menu that no longer exists; the end animator's completion then finds the
    // menu already closed and reports nothing twice.
    if isOpen {
      interaction?.dismissMenu()
      finishClose(generation: openGeneration)
    }
    select = nil
    open = nil
    close = nil
    mark(.dropped)
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    // Close first, ahead of everything else: a recycled view must not come back open.
    interaction?.dismissMenu()
    isOpen = false
    rawRows = []
    entries = []
    rawTitle = nil
    rawDisabled = false
    rawRadius = nil
    menuDirty = false
    select = nil
    open = nil
    close = nil
    openGeneration = -1
    opens = 0
    closes = 0
    selects = 0
    configs = 0
    cancels = 0
    lastRadius = -1
    drawn = "-1"
    mark(.recycled)
    perfInstanceId = nitroUiPerfNoInstance
    reportSeq = 0
    reportLock.lock()
    reportsWanted = false
    report = "pending"
    reportLock.unlock()
  }

  // MARK: - Methods

  func nuiTestSelectRow(id: String) throws {
    let run = { [weak self] in self?.applyPick(id) }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  func nuiTestMenuProbe() throws {
    let run = { [weak self] in
      guard let self else { return }
      // The same refusal `configuration(at:)` makes, without counting a configuration:
      // the probe reads what UIKit would be handed, it does not ask for a menu.
      self.drawn = self.canOpen ? Self.describe(self.buildMenu().children) : "nil"
      self.publishReport()
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  func nuiTestContextMenuReport() throws -> String {
    // From the first read on, every state change keeps the report fresh; until then
    // nothing builds it. This read returns the last one built.
    reportLock.lock()
    reportsWanted = true
    let line = report
    reportLock.unlock()
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    return line
  }

  func nuiTestA11yLongClick() throws {
    // Android only: iOS screen readers reach the menu through UIKit's own action.
  }

  // MARK: - The interaction

  private func attach(to superview: UIView?) {
    guard let superview, host !== superview else { return }
    #if DEBUG
      // The shape `scripts/patch-nitrogen.mjs` also depends on: Nitro installs this view
      // with `setContentView:` on an `RCTViewComponentView`.
      if let viewClass = NSClassFromString("RCTViewComponentView") {
        assert(superview.isKind(of: viewClass), "ContextMenu: the content view's superview is not a component view")
      }
    #endif
    if let interaction, let old = host {
      old.removeInteraction(interaction)
    }
    host = superview
    let made = UIContextMenuInteraction(delegate: menuDelegate)
    superview.addInteraction(made)
    interaction = made
    publishReport()
  }

  private var canOpen: Bool {
    return !rawDisabled && actionableRowCount > 0
  }

  fileprivate func configuration(at location: CGPoint) -> UIContextMenuConfiguration? {
    configs += 1
    // `nil`: no highlight starts, and the children keep the gesture.
    guard canOpen else { return nil }
    generation += 1
    let configuration = UIContextMenuConfiguration(
      identifier: NSNumber(value: generation),
      previewProvider: nil
    ) { [weak self] _ in
      self?.buildMenu()
    }
    if #available(iOS 16.0, *) {
      // `group`'s order, as on Android. `.priority` keeps the first row nearest the
      // finger, which reverses a menu that opens above it.
      configuration.preferredMenuElementOrder = .fixed
    }
    return configuration
  }

  fileprivate func willDisplay(_ configuration: UIContextMenuConfiguration) {
    // First the cancel, so the `Pressable` under the finger never presses for this hold.
    if NitroUiReactTouches.cancel(around: host) {
      cancels += 1
    }
    let showing = Self.menuId(of: configuration)
    if isOpen {
      guard showing != openGeneration else { return }
      // A new menu before the last one's end animator completed: that close is due now,
      // so every `onOpen` still has its one `onClose`, in order.
      finishClose(generation: openGeneration)
    }
    isOpen = true
    openGeneration = showing
    opens += 1
    open?()
    publishReport()
  }

  fileprivate func willEnd(
    _ configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    // The configuration that ended, not the latest one asked for (see `openGeneration`).
    let ending = Self.menuId(of: configuration)
    if let animator {
      animator.addCompletion { [weak self] in
        self?.finishClose(generation: ending)
      }
    } else {
      // No animator: the next main-queue turn, which still comes after a row's handler.
      // Not a thread hop - both callbacks are UIKit's, on main.
      DispatchQueue.main.async { [weak self] in
        self?.finishClose(generation: ending)
      }
    }
  }

  private func finishClose(generation ending: Int) {
    guard isOpen, ending == openGeneration else { return }
    isOpen = false
    openGeneration = -1
    closes += 1
    close?()
    publishReport()
  }

  private static func menuId(of configuration: UIContextMenuConfiguration) -> Int {
    return (configuration.identifier as? NSNumber)?.intValue ?? -1
  }

  fileprivate func targetedPreview() -> UITargetedPreview? {
    guard let host, host.window != nil else { return nil }
    let parameters = UIPreviewParameters()
    // The style's radius, never the layer's: React Native draws a visible border in a
    // layer of its own and leaves `layer.cornerRadius` at 0 (S3 change 2).
    let radius = min(rawRadius ?? 0, min(host.bounds.width, host.bounds.height) / 2)
    parameters.visiblePath = UIBezierPath(roundedRect: host.bounds, cornerRadius: radius)
    lastRadius = radius
    return UITargetedPreview(view: host, parameters: parameters)
  }

  // MARK: - Picks

  private func applyPick(_ id: String) {
    nitroUiAssertMainThread()
    if !rawDisabled, let row = actionableRow(id: id), !row.disabled {
      selects += 1
      select?(row.id)
    }
    // A pick ends the menu whichever way it was refused, as a row press does; `willEnd`
    // reports the close after the choice.
    if isOpen {
      interaction?.dismissMenu()
    }
    publishReport()
  }

  private func actionableRow(id: String) -> MenuActionItem? {
    for entry in entries {
      switch entry {
      case .action(let item):
        if item.id == id { return item }
      case .submenu(let submenu):
        if let item = submenu.items.first(where: { $0.id == id }) { return item }
      case .section(let section):
        if let item = section.items.first(where: { $0.id == id }) { return item }
      }
    }
    return nil
  }

  private var actionableRowCount: Int {
    var count = 0
    for entry in entries {
      switch entry {
      case .action: count += 1
      case .submenu(let submenu): count += submenu.items.count
      case .section(let section): count += section.items.count
      }
    }
    return count
  }

  // MARK: - The menu

  /// Menu's rows as a `UIMenu` (Q6 B3): a submenu nests (D29), a section is an inline
  /// group - titled or not - and the root carries `title`.
  private func buildMenu() -> UIMenu {
    var top: [UIMenuElement] = []
    for entry in entries {
      switch entry {
      case .action(let item):
        top.append(action(item))
      case .submenu(let submenu):
        top.append(
          UIMenu(
            title: submenu.title,
            image: submenu.systemImage.flatMap { UIImage(systemName: $0) },
            children: submenu.items.map(action)
          )
        )
      case .section(let section):
        top.append(
          UIMenu(title: section.title ?? "", options: .displayInline, children: section.items.map(action))
        )
      }
    }
    return UIMenu(title: rawTitle ?? "", children: top)
  }

  private func action(_ item: MenuActionItem) -> UIAction {
    var attributes: UIMenuElement.Attributes = []
    if item.destructive { attributes.insert(.destructive) }
    if item.disabled { attributes.insert(.disabled) }
    let id = item.id
    // A `checked` row is a menu toggle: its state draws the check. `nil` is a plain row.
    // A pick reports the id; the next `checked` is the app's to send (Menu's rule).
    return UIAction(
      title: item.title,
      subtitle: item.subtitle,
      image: item.systemImage.flatMap { UIImage(systemName: $0) },
      identifier: UIAction.Identifier(id),
      attributes: attributes,
      state: item.checked == true ? .on : .off
    ) { [weak self] _ in
      self?.applyPick(id)
    }
  }

  /// Menu's `drawn` notation (`Menu.nitro.ts`), for one level of a `UIMenu`.
  /// `@<subtitle>` for an action that has one. The getter is iOS 15+, which is the
  /// library's floor (15.1), so it needs no `#available` guard: one there would be a
  /// check the compiler flags as always true.
  private static func subtitleMark(_ action: UIAction) -> String {
    guard let subtitle = action.subtitle, !subtitle.isEmpty
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

  // MARK: - Witnesses

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiContextMenuPerf.mark(perfInstanceId, kind.rawValue)
  }

  /// The report line (`ContextMenu.nitro.ts`), published on main for JS to read - once a
  /// harness has asked for one, and never before.
  private func publishReport() {
    reportLock.lock()
    let wanted = reportsWanted
    reportLock.unlock()
    guard wanted else { return }
    reportSeq += 1
    var kids: [String] = []
    var box = "-1"
    var contentIndex = "-1"
    var attached = 0
    var ax = 0
    if let host {
      for subview in host.subviews where subview !== content {
        let frame = subview.frame
        kids.append(
          "\(subview.accessibilityIdentifier ?? "-")@\(fmt(frame.minX)),\(fmt(frame.minY)),"
            + "\(fmt(frame.width)),\(fmt(frame.height))"
        )
      }
      box = "\(fmt(host.bounds.width))x\(fmt(host.bounds.height))"
      contentIndex = "\(host.subviews.firstIndex(of: content) ?? -1)/\(host.subviews.count)"
      attached = host.interactions.contains { $0 === interaction } ? 1 : 0
      ax = host.isAccessibilityElement ? 1 : 0
    }
    let line =
      "open=\(isOpen ? 1 : 0);opens=\(opens);closes=\(closes);selects=\(selects);configs=\(configs);"
      + "cancels=\(cancels);rows=\(actionableRowCount);drawn=\(drawn);title=\(rawTitle ?? "-");"
      + "box=\(box);contentIndex=\(contentIndex);interaction=\(attached);ax=\(ax);a11yAction=-1;"
      + "radius=\(lastRadius < 0 ? "-1" : fmt(lastRadius));press=-1;menu=-1;live=-1;arms=-1;armed=-1;"
      + "copies=-1;watchStray=-1;seq=\(reportSeq);kids=\(kids.joined(separator: "|"))"
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  private func fmt(_ value: CGFloat) -> String {
    return String(format: "%.1f", value)
  }
}
