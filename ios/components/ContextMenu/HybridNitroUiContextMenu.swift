// ContextMenu: a `UIContextMenuInteraction` on the Nitro-generated component view, where
// Fabric already mounts the React Native children.

import NitroModules
import UIKit

// Perf ring buffer, shared with C++ and Kotlin.
private typealias NitroUiContextMenuPerf = margelo.nitro.nitroui.NitroUiPerf

// MARK: - The content view

/// The Hybrid View's view: an empty, touch-transparent box whose job is to find the component
/// view it was installed in. React Native mounts the children into that component view, at
/// frames relative to its border box, so they are not mounted here.
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

  /// `RCTViewComponentView.isAccessibilityElement` answers with its content view's value, so
  /// a plain `false` here would hide an `accessible` ContextMenu from VoiceOver. The value
  /// React Native stored is on the component view, and is read through `UIView`'s own getter
  /// to skip the override that asks this view.
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

/// Cancels React Native's active touches by toggling the nearest surface touch handler up the
/// tree, so a `Pressable` under the finger gets `onPressOut` and never `onPress`. A recognizer
/// on a descendant view cannot prevent that handler, so UIKit's own gesture arbitration does
/// not do this. The class is looked up by name, so Swift never imports React.
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

final class HybridNitroUiContextMenu: HybridNitroUiContextMenuSpec, RecyclableView {
  private let content = ContextMenuContentView()
  private let menuDelegate = ContextMenuInteractionDelegate()
  /// The generated component view: the children's parent, and the view the interaction lives
  /// on. Attached once and never detached: every iOS recycle is also a drop, so an
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
  /// Whether a test has asked for a report (under `reportLock`). An app never does, so its
  /// ContextMenus never build one.
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
        // A disabled or empty control cannot own a live menu. UIKit ends the menu, and
        // `willEnd` reports the close.
        interaction?.dismissMenu()
      } else if menuDirty {
        // The rows changed while the menu is up: rebuild it in place.
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
    // Report the close now, while the app's handler is still connected. The end animator's
    // completion then finds the menu already closed and reports nothing twice.
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
      // Reads what UIKit would be handed, without counting a configuration.
      self.drawn = self.canOpen ? Self.describe(self.buildMenu().children) : "nil"
      self.publishReport()
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  // MARK: - Pixel probes (test-only)

  private let pixelProbesLock = NSLock()
  private var pixelProbes = 0

  /// The system presents a context menu in a window this process cannot rasterise, so there
  /// is nothing to sample and the report says `no pixels`.
  func nuiTestMenuPixelProbe(color: Double) throws {
    pixelProbesLock.lock()
    pixelProbes += 1
    pixelProbesLock.unlock()
  }

  func nuiTestMenuPixelReport() throws -> String {
    pixelProbesLock.lock()
    let probes = pixelProbes
    pixelProbesLock.unlock()
    return "n=\(probes) no pixels platform=ios"
  }

  func nuiTestContextMenuReport() throws -> String {
    // Nothing builds a report until the first read, which returns the last one built.
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
      // Nitro installs this view with `setContentView:` on an `RCTViewComponentView`.
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
    // The configuration that ended, not the latest one asked for. UIKit calls a row's handler
    // before this, and the close fires from the animator's completion, so a pick reports
    // `onSelect` then `onClose`.
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
    // The style's radius, never the layer's: React Native draws a visible border in a layer
    // of its own and leaves `layer.cornerRadius` at 0.
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

  /// A submenu nests, a section is an inline group (titled or not), and the root carries
  /// `title`.
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
    // A `checked` row draws its check through `state`. A pick only reports the id; the app
    // sends the next `checked`.
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

  // MARK: - Witnesses

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiContextMenuPerf.mark(perfInstanceId, kind.rawValue)
  }

  /// Built on main for JS to read, and only once a test has asked for one.
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
      + "copies=-1;watchStray=-1;seq=\(reportSeq);"
      // Android's field: iOS has no Android glyph to tint, so it answers `-`.
      + "iconTints=-;kids=\(kids.joined(separator: "|"))"
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  private func fmt(_ value: CGFloat) -> String {
    return String(format: "%.1f", value)
  }
}
