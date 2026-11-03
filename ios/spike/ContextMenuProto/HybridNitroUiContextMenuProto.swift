//
//  HybridNitroUiContextMenuProto.swift
//  react-native-nitro-ui
//
//  S3 spike only (DECISIONS D36, Q6 Appendix B): never merged.
//
//  A `UIContextMenuInteraction` on the Nitro-generated component view, whose React
//  Native children Fabric already mounts there (no `.mm` patch). The Hybrid View's own
//  view is an empty, non-interactive content view that only exists to find that
//  component view (`didMoveToSuperview`). At `willDisplay` the nearest
//  `RCTSurfaceTouchHandler` is toggled off and on, which is RN's own `_cancelTouches`,
//  so the `Pressable` under the finger gets a cancel and never an `onPress`.
//
//  Every native event is written to `onTrace` with the main-thread uptime clock (the
//  clock `UITouch.timestamp` uses), so JS can read the order of a pick (Q4) and the
//  touch-down -> display latency (Q7).
//

import NitroModules
import UIKit

/// The Hybrid View's view: an empty, transparent, touch-transparent box that tells the
/// Hybrid which component view it was installed in.
final class S3ContextMenuContentView: UIView {
  var onSuperview: ((UIView?) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
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

  /// `RCTViewComponentView.isAccessibilityElement` answers from its `contentView` when
  /// it has one (rn:React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm,
  /// `isAccessibilityElement`), so with a plain `false` here an `accessible` ContextMenu
  /// is never an element: measured, the label lands and `isAccessibilityElement` reads 0.
  /// Answer with the value RN stored on the component view instead, read through
  /// `UIView`'s own getter so the override that asks this view is skipped.
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

/// A recognizer that never recognizes: it stamps a touch-down (Q7) and fails at once,
/// so it takes nothing from React Native or UIKit.
final class S3TouchStamp: UIGestureRecognizer, UIGestureRecognizerDelegate {
  var onBegan: ((TimeInterval) -> Void)?

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    if let touch = touches.first {
      onBegan?(touch.timestamp)
    }
    state = .failed
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return true
  }
}

/// The interaction's delegate. A separate object, held by the Hybrid; the interaction
/// holds it weakly.
final class S3ContextMenuDelegate: NSObject, UIContextMenuInteractionDelegate {
  weak var owner: HybridNitroUiContextMenuProto?

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
    owner?.willDisplay()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    owner?.willEnd(animator: animator)
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

final class HybridNitroUiContextMenuProto: HybridNitroUiContextMenuProtoSpec {
  private let content = S3ContextMenuContentView()
  private let menuDelegate = S3ContextMenuDelegate()
  private let stamp = S3TouchStamp(target: nil, action: nil)
  private weak var host: UIView?
  private var interaction: UIContextMenuInteraction?

  // Props, stored raw.
  private var rawRows: [NitroUiMenuRow] = []
  private var rawTitle: String?
  private var rawDisabled = false
  private var rawCancel = true
  private var select: ((String) -> Void)?
  private var open: (() -> Void)?
  private var close: (() -> Void)?
  private var trace: ((String) -> Void)?

  // State (main thread).
  private var isOpen = false
  private var generation = 0
  private var seq = 0
  private var lastTouchDown: TimeInterval = 0
  private var lastConfigAt: TimeInterval = 0
  private var lastLocation = CGPoint.zero
  private var opens = 0
  private var closes = 0
  private var selects = 0
  private var configs = 0
  private var cancels = 0

  private let reportLock = NSLock()
  private var report = "pending"

  override init() {
    super.init()
    menuDelegate.owner = self
    stamp.onBegan = { [weak self] timestamp in
      self?.lastTouchDown = timestamp
    }
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
    set { rawRows = newValue }
  }

  var title: Variant_NullType_String {
    get { rawTitle.map { .second($0) } ?? .first(.null) }
    set { rawTitle = newValue.asType(String.self) }
  }

  var disabled: Bool {
    get { rawDisabled }
    set { rawDisabled = newValue }
  }

  var cancelTouches: Bool {
    get { rawCancel }
    set { rawCancel = newValue }
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

  var onTrace: ((_ line: String) -> Void)? {
    get { trace }
    set { trace = newValue }
  }

  func afterUpdate() {
    if rawDisabled, isOpen {
      interaction?.dismissMenu()
    }
    if isOpen {
      interaction?.updateVisibleMenu { [weak self] _ in
        self?.buildMenu() ?? UIMenu(children: [])
      }
    }
    publishReport()
  }

  func onDropView() {
    interaction?.dismissMenu()
    select = nil
    open = nil
    close = nil
    trace = nil
  }

  // MARK: - Methods

  func nuiTestReport() throws -> String {
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestA11yLongClick() throws {
    // Android only.
  }

  func nuiTestSynthHold(fx: Double, fy: Double, ms: Double) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self, let host = self.host, let window = host.window else {
        self?.emit("synth", "result=no-window")
        return
      }
      let local = CGPoint(x: host.bounds.width * fx, y: host.bounds.height * fy)
      let point = host.convert(local, to: window)
      guard let synth = NSClassFromString("NitroUiS3TouchSynth") as? NSObject.Type else {
        self.emit("synth", "result=no-helper")
        return
      }
      self.emit("synth", "at=\(Int(point.x)),\(Int(point.y)) ms=\(Int(ms))")
      _ = synth.perform(
        NSSelectorFromString("holdAt:ms:"),
        with: NSValue(cgPoint: point),
        with: NSNumber(value: ms)
      )
    }
  }

  // MARK: - The interaction

  private func attach(to superview: UIView?) {
    guard let superview, host !== superview else { return }
    #if DEBUG
      if let viewClass = NSClassFromString("RCTViewComponentView") {
        assert(superview.isKind(of: viewClass), "S3: the content view's superview is not a component view")
      }
    #endif
    if let interaction, let old = host {
      old.removeInteraction(interaction)
      old.removeGestureRecognizer(stamp)
    }
    host = superview
    let made = UIContextMenuInteraction(delegate: menuDelegate)
    superview.addInteraction(made)
    superview.addGestureRecognizer(stamp)
    interaction = made
    publishReport()
  }

  fileprivate func configuration(at location: CGPoint) -> UIContextMenuConfiguration? {
    configs += 1
    lastConfigAt = ProcessInfo.processInfo.systemUptime
    lastLocation = location
    guard !rawDisabled, !rawRows.isEmpty else {
      emit("cfg", "result=nil")
      return nil
    }
    generation += 1
    emit("cfg", "dt=\(ms(lastConfigAt - lastTouchDown)) at=\(Int(location.x)),\(Int(location.y))")
    let menuConfiguration = UIContextMenuConfiguration(
      identifier: NSNumber(value: generation),
      previewProvider: nil
    ) { [weak self] _ in
      self?.buildMenu()
    }
    if #available(iOS 16.0, *) {
      menuConfiguration.preferredMenuElementOrder = .fixed
    }
    return menuConfiguration
  }

  fileprivate func willDisplay() {
    let now = ProcessInfo.processInfo.systemUptime
    var cancelled = "skipped"
    if rawCancel {
      cancelled = cancelReactNativeTouches()
    }
    isOpen = true
    opens += 1
    var loads = [Double](repeating: 0, count: 3)
    getloadavg(&loads, 3)
    emit(
      "display",
      "dt=\(ms(now - lastTouchDown)) cfgToDisplay=\(ms(now - lastConfigAt)) cancel=\(cancelled) "
        + "load1=\(String(format: "%.1f", loads[0]))"
    )
    open?()
    publishReport()
  }

  fileprivate func willEnd(animator: UIContextMenuInteractionAnimating?) {
    emit("willEnd", "animator=\(animator == nil ? 0 : 1)")
    let ending = generation
    if let animator {
      animator.addCompletion { [weak self] in
        self?.finishClose(via: "completion", generation: ending)
      }
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.finishClose(via: "nextTurn", generation: ending)
      }
    }
  }

  private func finishClose(via: String, generation ending: Int) {
    guard isOpen else {
      emit("closeSkipped", "via=\(via)")
      return
    }
    isOpen = false
    closes += 1
    emit("close", "via=\(via) gen=\(ending)")
    close?()
    publishReport()
  }

  fileprivate func targetedPreview() -> UITargetedPreview? {
    guard let host, host.window != nil else { return nil }
    let parameters = UIPreviewParameters()
    let radius = host.layer.cornerRadius
    parameters.visiblePath = UIBezierPath(roundedRect: host.bounds, cornerRadius: radius)
    return UITargetedPreview(view: host, parameters: parameters)
  }

  /// RN's own `_cancelTouches`, on the nearest surface touch handler up the tree.
  private func cancelReactNativeTouches() -> String {
    var view: UIView? = host
    while let current = view {
      for recognizer in current.gestureRecognizers ?? []
      where NSStringFromClass(type(of: recognizer)) == "RCTSurfaceTouchHandler" {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
        cancels += 1
        return "ok"
      }
      view = current.superview
    }
    return "no-handler"
  }

  // MARK: - The menu

  private func buildMenu() -> UIMenu {
    var children: [String: [UIMenuElement]] = [:]
    for row in rawRows {
      guard let parent = row.parentId?.asType(String.self) else { continue }
      children[parent, default: []].append(action(row))
    }
    var top: [UIMenuElement] = []
    for row in rawRows where row.parentId?.asType(String.self) == nil {
      switch row.kind {
      case "submenu":
        top.append(UIMenu(title: row.title, children: children[row.id] ?? []))
      case "section":
        top.append(UIMenu(title: row.title, options: .displayInline, children: children[row.id] ?? []))
      default:
        top.append(action(row))
      }
    }
    return UIMenu(title: rawTitle ?? "", children: top)
  }

  private func action(_ row: NitroUiMenuRow) -> UIAction {
    var attributes: UIMenuElement.Attributes = []
    if row.destructive { attributes.insert(.destructive) }
    if row.disabled { attributes.insert(.disabled) }
    let image = row.systemImage?.asType(String.self).flatMap { UIImage(systemName: $0) }
    let id = row.id
    return UIAction(title: row.title, image: image, identifier: UIAction.Identifier(id), attributes: attributes) {
      [weak self] _ in
      self?.picked(id)
    }
  }

  private func picked(_ id: String) {
    selects += 1
    emit("handler", "id=\(id) open=\(isOpen ? 1 : 0)")
    select?(id)
  }

  // MARK: - Witnesses

  private func emit(_ event: String, _ detail: String) {
    seq += 1
    let now = ProcessInfo.processInfo.systemUptime
    trace?("\(seq)|\(event)|t=\(ms(now))|\(detail)")
  }

  private func ms(_ seconds: TimeInterval) -> Int {
    return Int((seconds * 1000).rounded())
  }

  private func publishReport() {
    guard let host else { return }
    var kids: [String] = []
    for subview in host.subviews where subview !== content {
      let frame = subview.frame
      let id = subview.accessibilityIdentifier ?? "-"
      kids.append(
        "\(id)@\(fmt(frame.minX)),\(fmt(frame.minY)),\(fmt(frame.width)),\(fmt(frame.height))"
      )
    }
    let box = host.bounds
    let contentFrame = content.frame
    let actions = (host.accessibilityCustomActions ?? []).map { $0.name }.joined(separator: "/")
    let firstChild = host.subviews.first { $0 !== content }
    let childActions = (firstChild?.accessibilityCustomActions ?? []).map { $0.name }.joined(separator: "/")
    let line =
      "box=\(fmt(box.width))x\(fmt(box.height));content=\(fmt(contentFrame.minX)),\(fmt(contentFrame.minY));"
      + "contentIndex=\(host.subviews.firstIndex(of: content) ?? -1)/\(host.subviews.count);"
      + "interaction=\(host.interactions.contains { $0 === interaction } ? 1 : 0);"
      + "open=\(isOpen ? 1 : 0);opens=\(opens);closes=\(closes);selects=\(selects);configs=\(configs);"
      + "cancels=\(cancels);loc=\(Int(lastLocation.x)),\(Int(lastLocation.y));"
      + "ax=\(host.isAccessibilityElement ? 1 : 0);axLabel=\(host.accessibilityLabel ?? "-");"
      + "axActions=\(actions.isEmpty ? "-" : actions);childAxActions=\(childActions.isEmpty ? "-" : childActions);"
      + "vo=\(UIAccessibility.isVoiceOverRunning ? 1 : 0);"
      + "kids=\(kids.joined(separator: "|"))"
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  private func fmt(_ value: CGFloat) -> String {
    return String(format: "%.1f", value)
  }
}
