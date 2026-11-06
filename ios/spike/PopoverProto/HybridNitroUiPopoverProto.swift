//
//  HybridNitroUiPopoverProto.swift
//  react-native-nitro-ui
//
//  S5 spike only (never merged): a UIKit popover whose content is React Native views,
//  Q7 Appendix F. BottomSheet's three moves (G14) with Tooltip's presentation (D41):
//
//  1. **Mount.** The generated `.mm` mounts the children into this view
//     (`CONTENT_CHILDREN_VIEWS`), and the popover's controller adopts it while it is up.
//  2. **Layout.** The JS wrapper makes the node as wide as the cap and lays its one
//     child - the content box - out with `alignItems: 'flex-start'`, so Yoga gives that
//     box the content's own width and height. Its frame is read here, one turn after the
//     commit that mounted it, and becomes `preferredContentSize` *before* the present.
//  3. **Touch.** The controller owns an `RCTSurfaceTouchHandler` (`NitroUiTouchRoot`).
//
//  It presents `.popover`, `.none` adaptation, from a window of its own (D41's rule:
//  a popover in the app's chain makes UIKit refuse the next RN `Modal`).
//
//  Witnesses for the spike: a per-frame sampler from the present to one second after it
//  (Q1), process-wide counts of controllers, touch roots and presentations (Q5).
//

import NitroModules
import UIKit

// MARK: - Views

/// The React Native children's parent, adopted by the popover while it is up.
final class NitroUiPopoverProtoContentView: UIView {
  var onSuperviewChange: (() -> Void)?
  var onSizeChange: (() -> Void)?
  private var lastSize = CGSize.zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    noteSize()
  }

  override var frame: CGRect {
    didSet { noteSize() }
  }

  private func noteSize() {
    let size = bounds.size
    guard abs(size.width - lastSize.width) > 0.25 || abs(size.height - lastSize.height) > 0.25 else {
      return
    }
    lastSize = size
    onSizeChange?()
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    onSuperviewChange?()
  }
}

/// A `0 x 0` view left in the component view while the content is in the popover: it
/// says when the Popover's place in the app gains or loses a window.
final class NitroUiPopoverProtoAnchorView: UIView {
  var onWindowChange: ((_ hasWindow: Bool) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    onWindowChange?(window != nil)
  }
}

// MARK: - The popover's controller

final class NitroUiPopoverProtoController: UIViewController, UIPopoverPresentationControllerDelegate {
  static let alive = NitroUiSheetCount()

  private var touchHandler: UIGestureRecognizer?
  private var gone = false
  private(set) var dismissedByUser = false
  /// Where the content sits: the view's safe area origin.
  let contentHost = UIView()

  var onGone: ((NitroUiPopoverProtoController) -> Void)?

  init() {
    super.init(nibName: nil, bundle: nil)
    Self.alive.add(1)
    modalPresentationStyle = .popover
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    if let touchHandler, isViewLoaded {
      NitroUiTouchRoot.detach(touchHandler, from: view)
    }
    Self.alive.add(-1)
  }

  override func loadView() {
    let root = UIView()
    root.backgroundColor = .clear
    root.accessibilityViewIsModal = true
    contentHost.backgroundColor = .clear
    root.addSubview(contentHost)
    view = root
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    touchHandler = NitroUiTouchRoot.attach(to: view)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let insets = view.safeAreaInsets
    let frame = CGRect(
      x: insets.left, y: insets.top,
      width: max(0, view.bounds.width - insets.left - insets.right),
      height: max(0, view.bounds.height - insets.top - insets.bottom))
    if contentHost.frame != frame {
      contentHost.frame = frame
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil {
      noteGone()
    }
  }

  func adopt(_ content: UIView) {
    loadViewIfNeeded()
    if content.superview !== contentHost {
      contentHost.addSubview(content)
    }
    content.isHidden = false
  }

  private func noteGone() {
    guard !gone else { return }
    gone = true
    if let touchHandler {
      NitroUiTouchRoot.detach(touchHandler, from: view)
      self.touchHandler = nil
    }
    onGone?(self)
  }

  /// The test seam: what a tap outside does.
  func dismissAsUser() {
    dismissedByUser = true
    dismiss(animated: true)
  }

  // MARK: UIPopoverPresentationControllerDelegate

  func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle {
    .none
  }

  func adaptivePresentationStyle(
    for controller: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    .none
  }

  func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
    dismissedByUser = true
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    dismissedByUser = true
    noteGone()
  }
}

// MARK: - The Q1 sampler

/// Reads the popover's geometry on every display frame from the present until one second
/// after it: the view's bounds (what the content is laid out in), and the presented
/// view's on-screen frame and opacity from its presentation layer (what a person sees,
/// transform and fade included).
final class NitroUiPopoverProtoSampler: NSObject {
  private weak var controller: UIViewController?
  private var link: CADisplayLink?
  private var startedAt: CFTimeInterval = 0
  private(set) var frames = 0
  private(set) var visibleFrames = 0
  private(set) var first: CGSize?
  private(set) var last: CGSize?
  private(set) var distinct: [CGSize] = []
  private(set) var trace: [String] = []
  private(set) var running = false
  var onDone: (() -> Void)?

  func start(_ controller: UIViewController) {
    stop()
    self.controller = controller
    frames = 0
    visibleFrames = 0
    first = nil
    last = nil
    distinct = []
    trace = []
    startedAt = CACurrentMediaTime()
    running = true
    let link = CADisplayLink(target: self, selector: #selector(step))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func stop() {
    link?.invalidate()
    link = nil
    running = false
  }

  @objc private func step() {
    frames += 1
    let elapsed = CACurrentMediaTime() - startedAt
    defer {
      if elapsed > 1.0 || controller == nil {
        stop()
        onDone?()
      }
    }
    guard let controller, let view = controller.viewIfLoaded, view.window != nil else { return }
    let size = CGSize(width: view.bounds.width.rounded(), height: view.bounds.height.rounded())
    guard size.width > 0, size.height > 0 else { return }
    visibleFrames += 1
    if first == nil { first = size }
    last = size
    if !distinct.contains(size) { distinct.append(size) }
    if trace.count < 8 {
      let presented = controller.presentationController?.presentedView ?? view
      let layer = presented.layer.presentation() ?? presented.layer
      let visual = layer.frame.size
      trace.append(
        "\(Int(size.width))x\(Int(size.height))/v\(Int(visual.width.rounded()))x\(Int(visual.height.rounded()))"
          + "/o\(String(format: "%.2f", layer.opacity))")
    }
  }
}

// MARK: - The Hybrid View

final class HybridNitroUiPopoverProto: HybridNitroUiPopoverProtoSpec, RecyclableView {
  static let live = NitroUiPresentationCounter()

  private let container = NitroUiPopoverProtoContentView()
  private let anchor = NitroUiPopoverProtoAnchorView()
  private let presentation = NitroUiPresentation(counter: HybridNitroUiPopoverProto.live)
  private let sampler = NitroUiPopoverProtoSampler()
  private weak var home: UIView?

  // Props, stored raw.
  private var maxWidthValue: Double = 320
  private var sizeBeforePresentValue = true
  private var testIDValue: String?
  private var presentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)?
  private var dismissed: ((_ ended: Bool) -> Void)?
  private var state = NitroUiControlledValue<Bool>(displayed: false)

  // What is on screen.
  private var popover: NitroUiPopoverProtoController?
  private var presentScheduled = false
  private var awaitingPresent = false
  private var owesDismissal = false
  private var dropped = false
  private var mountGeneration = 0
  private var presentCount = 0
  private var contentWaits = 0
  /// The content box when the popover was asked for, and `preferredContentSize` then.
  private var sizeAtPresent = CGSize.zero
  private var userDismissals = 0
  private var unaskedExits = 0
  private var lifetimeDrops = 0
  private var lifetimeRecycles = 0

  private let reportLock = NSLock()
  private var report = ""
  private var reportSeq = 0

  override init() {
    super.init()
    anchor.onWindowChange = { [weak self] hasWindow in
      self?.windowChanged(hasWindow)
    }
    container.onSuperviewChange = { [weak self] in
      self?.contentMoved()
    }
    container.onSizeChange = { [weak self] in
      self?.publishReport()
    }
    sampler.onDone = { [weak self] in
      self?.publishReport()
    }
    publishReport()
  }

  var view: UIView {
    container
  }

  // MARK: Props

  var presented: Bool {
    get { state.js ?? false }
    set { state.js = newValue }
  }

  var mostRecentEventCount: Double {
    get { Double(state.jsEvents) }
    set { state.jsEvents = Int(newValue) }
  }

  var maxWidth: Double {
    get { maxWidthValue }
    set { maxWidthValue = newValue }
  }

  var sizeBeforePresent: Bool {
    get { sizeBeforePresentValue }
    set { sizeBeforePresentValue = newValue }
  }

  var testID: Variant_NullType_String {
    get { testIDValue.map { .second($0) } ?? .first(.null) }
    set { testIDValue = newValue.asType(String.self) }
  }

  var onPresentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)? {
    get { presentedChange }
    set { presentedChange = newValue }
  }

  var onDismissed: ((_ ended: Bool) -> Void)? {
    get { dismissed }
    set { dismissed = newValue }
  }

  // MARK: Lifecycle

  func afterUpdate() {
    _ = state.reconcile()
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    teardown()
    state = NitroUiControlledValue<Bool>(displayed: false)
    maxWidthValue = 320
    sizeBeforePresentValue = true
    testIDValue = nil
    presentedChange = nil
    dismissed = nil
    presentCount = 0
    contentWaits = 0
    sizeAtPresent = .zero
    userDismissals = 0
    unaskedExits = 0
    dropped = false
    publishReport()
  }

  func onDropView() {
    lifetimeDrops += 1
    dropped = true
    presentedChange = nil
    dismissed = nil
    teardown()
    publishReport()
  }

  private func teardown() {
    mountGeneration += 1
    presentScheduled = false
    awaitingPresent = false
    owesDismissal = false
    state.displayed = false
    sampler.stop()
    if let popover {
      popover.onGone = nil
      if presentation.controller === popover {
        presentation.dismissForTeardown()
        presentation.forgetController()
      }
    }
    popover = nil
    restoreContent()
  }

  // MARK: Where the content lives

  private func contentMoved() {
    guard let superview = container.superview else { return }
    if home == nil, !(superview.superview?.next is NitroUiPopoverProtoController) {
      home = superview
      superview.addSubview(anchor)
      anchor.frame = .zero
    }
  }

  private func restoreContent() {
    container.isHidden = true
    guard let home, container.superview !== home else { return }
    home.insertSubview(container, at: 0)
  }

  /// The content box: the node's one child, which Yoga sized to the content.
  private var contentSize: CGSize {
    guard let box = container.subviews.first else { return .zero }
    return CGSize(width: ceil(box.bounds.width), height: ceil(box.bounds.height))
  }

  /// The anchor's box: the wrapper that hugs it - this component view's parent.
  private var anchorBox: UIView? {
    home?.superview ?? home
  }

  // MARK: Presenting

  private func popoverIsUp(_ controller: NitroUiPopoverProtoController) -> Bool {
    controller.presentingViewController != nil && !controller.isBeingDismissed
  }

  private func sync() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      if state.displayed {
        owesDismissal = true
        if let popover {
          if popoverIsUp(popover) {
            presentation.cancelPendingDismissal()
          }
          return
        }
        if !awaitingPresent {
          awaitingPresent = true
          contentWaits = 0
        }
        schedulePresent()
      } else {
        presentScheduled = false
        if let popover, popoverIsUp(popover) {
          presentation.dismissAnimated()
        } else if popover == nil, owesDismissal {
          awaitingPresent = false
          reportDismissed(ended: false)
        }
      }
    }
  }

  /// One turn after the commit: the content mounted in it has its layout by then.
  private func schedulePresent() {
    guard !presentScheduled else { return }
    presentScheduled = true
    let generation = mountGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mountGeneration == generation, self.presentScheduled else { return }
      self.presentScheduled = false
      MainActor.assumeIsolated {
        self.presentIfPossible()
      }
    }
  }

  @MainActor
  private func presentIfPossible() {
    guard !dropped, state.displayed, popover == nil else { return }
    guard anchor.window != nil, let source = anchorBox else { return }
    let size = contentSize
    if size.width <= 0 || size.height <= 0 {
      // The content has no layout yet: wait a turn, bounded (a popover of nothing would
      // open at UIKit's default size and then jump).
      contentWaits += 1
      guard contentWaits <= 60 else { return }
      let generation = mountGeneration
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { [weak self] in
        guard let self, self.mountGeneration == generation else { return }
        MainActor.assumeIsolated { self.presentIfPossible() }
      }
      return
    }
    awaitingPresent = false
    let controller = NitroUiPopoverProtoController()
    controller.adopt(container)
    sizeAtPresent = size
    if sizeBeforePresentValue {
      controller.preferredContentSize = size
    }
    controller.view.accessibilityIdentifier = testIDValue.map { "\($0)-popover" }
    controller.onGone = { [weak self] controller in
      self?.popoverGone(controller)
    }
    guard let popoverSource = controller.popoverPresentationController else {
      restoreContent()
      return
    }
    popoverSource.delegate = controller
    popover = controller
    presentCount += 1
    sampler.start(controller)
    let shown = presentation.presentInOwnWindow(
      controller,
      over: anchor,
      animated: true,
      prepare: { root in
        popoverSource.sourceView = root.view
        popoverSource.sourceRect = source.convert(source.bounds, to: root.view)
        popoverSource.permittedArrowDirections = [.up, .down]
      },
      onShown: { [weak self, weak controller] in
        guard let self, let controller, controller === self.popover else { return }
        if !self.sizeBeforePresentValue {
          // The Q1 red proof: the size arrives only once the popover is up.
          controller.preferredContentSize = self.contentSize
        }
        self.publishReport()
      }
    )
    if !shown {
      popover = nil
      presentCount -= 1
      sampler.stop()
      restoreContent()
    }
    publishReport()
  }

  private func popoverGone(_ controller: NitroUiPopoverProtoController) {
    let asked = presentation.isDismissingOnRequest(controller)
    if !asked {
      presentation.noteClosedByUIKit(controller)
    }
    guard controller === popover else {
      publishReport()
      return
    }
    controller.onGone = nil
    popover = nil
    if presentation.controller === controller {
      presentation.forgetController()
    }
    restoreContent()
    if !asked, !dropped {
      if controller.dismissedByUser {
        userDismissals += 1
      } else {
        unaskedExits += 1
      }
      if state.displayed {
        let count = state.user(false)
        presentedChange?(false, Double(count))
      }
    }
    reportDismissed(ended: true)
    if state.displayed {
      schedulePresent()
    }
    publishReport()
  }

  private func reportDismissed(ended: Bool) {
    owesDismissal = state.displayed
    dismissed?(ended)
  }

  private func windowChanged(_ hasWindow: Bool) {
    if hasWindow {
      sync()
      publishReport()
      return
    }
    guard state.displayed || popover != nil else { return }
    let generation = mountGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mountGeneration == generation, !self.dropped,
        self.anchor.window == nil
      else { return }
      if self.state.displayed {
        let count = self.state.user(false)
        self.presentedChange?(false, Double(count))
      }
      if let popover = self.popover, self.presentation.controller === popover {
        self.presentation.dismissForTeardown()
      } else if self.owesDismissal {
        self.awaitingPresent = false
        self.reportDismissed(ended: false)
      }
      self.publishReport()
    }
  }

  // MARK: Methods

  func nuiTestStateReport() throws -> String {
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestDismiss() throws {
    let run = { [weak self] in
      guard let self, let popover = self.popover, self.popoverIsUp(popover) else { return }
      popover.dismissAsUser()
    }
    if Thread.isMainThread { run() } else { DispatchQueue.main.async(execute: run) }
  }

  // MARK: Report

  private func publishReport() {
    reportSeq += 1
    var f: [String] = ["seq=\(reportSeq)"]
    f.append("presented=\(state.displayed ? 1 : 0)")
    f.append("js=\(state.js == true ? 1 : 0)")
    f.append("live=\(Self.live.value)")
    f.append("presentCount=\(presentCount)")
    let up = popover.map(popoverIsUp) ?? false
    f.append("onScreen=\(up ? 1 : 0)")
    let content = contentSize
    f.append("contentW=\(Int(content.width))")
    f.append("contentH=\(Int(content.height))")
    f.append("nodeW=\(Int(container.bounds.width.rounded()))")
    f.append("nodeH=\(Int(container.bounds.height.rounded()))")
    f.append("askedW=\(Int(sizeAtPresent.width))")
    f.append("askedH=\(Int(sizeAtPresent.height))")
    f.append("contentWaits=\(contentWaits)")
    f.append("sampling=\(sampler.running ? 1 : 0)")
    f.append("frames=\(sampler.frames)")
    f.append("visibleFrames=\(sampler.visibleFrames)")
    f.append("firstW=\(Int(sampler.first?.width ?? 0))")
    f.append("firstH=\(Int(sampler.first?.height ?? 0))")
    f.append("finalW=\(Int(sampler.last?.width ?? 0))")
    f.append("finalH=\(Int(sampler.last?.height ?? 0))")
    f.append("sizes=\(sampler.distinct.map { "\(Int($0.width))x\(Int($0.height))" }.joined(separator: ","))")
    f.append("trace=\(sampler.trace.joined(separator: ","))")
    if let popover, let view = popover.viewIfLoaded {
      f.append("prefW=\(Int(popover.preferredContentSize.width.rounded()))")
      f.append("prefH=\(Int(popover.preferredContentSize.height.rounded()))")
      f.append("viewW=\(Int(view.bounds.width.rounded()))")
      f.append("viewH=\(Int(view.bounds.height.rounded()))")
      let s = view.safeAreaInsets
      f.append("safe=\(Int(s.top)),\(Int(s.left)),\(Int(s.bottom)),\(Int(s.right))")
      f.append("arrow=\(Self.directions(popover.popoverPresentationController?.arrowDirection ?? .unknown))")
      f.append("ownWindow=\(presentation.isInOwnWindow(popover) ? 1 : 0)")
      f.append("windowLevel=\(Int(view.window?.windowLevel.rawValue ?? -1))")
      f.append("windowKey=\(view.window?.isKeyWindow == true ? 1 : 0)")
      f.append("popRect=\(Self.screenRect(of: view))")
      f.append("hit=\(HybridNitroUiBottomSheet.contentTakesHit(container) ? 1 : 0)")
      f.append("popoverId=\(view.accessibilityIdentifier ?? "-")")
    }
    f.append("anchorRect=\(Self.screenRect(of: anchorBox))")
    f.append("inPopover=\(container.superview?.superview?.next is NitroUiPopoverProtoController ? 1 : 0)")
    f.append("hidden=\(container.isHidden ? 1 : 0)")
    f.append("children=\(container.subviews.count)")
    f.append("topPresented=\(NitroUiPresenterChain.topPresentedClass(in: anchor.window))")
    f.append("modalHosts=\(NitroUiPresenterChain.modalHostCount(near: anchor.window))")
    f.append("windows=\(HybridNitroUiDialog.visibleWindowCount(near: anchor.window))")
    f.append("controllers=\(NitroUiPopoverProtoController.alive.value)")
    f.append("touchRoots=\(NitroUiTouchRoot.attached)")
    f.append("userDismissals=\(userDismissals)")
    f.append("unasked=\(unaskedExits)")
    f.append("anchored=\(anchor.window != nil ? 1 : 0)")
    f.append("drops=\(lifetimeDrops)")
    f.append("recycles=\(lifetimeRecycles)")
    let line = f.joined(separator: ";")
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  private static func screenRect(of view: UIView?) -> String {
    guard let view, let window = view.window else { return "-" }
    let inWindow = view.convert(view.bounds, to: window)
    let rect = window.windowScene.map { window.convert(inWindow, to: $0.coordinateSpace) } ?? inWindow
    return [rect.minX, rect.minY, rect.width, rect.height].map { String(format: "%.1f", Double($0)) }
      .joined(separator: ",")
  }

  private static func directions(_ value: UIPopoverArrowDirection) -> String {
    if value == .unknown { return "unknown" }
    var names: [String] = []
    if value.contains(.up) { names.append("up") }
    if value.contains(.down) { names.append("down") }
    if value.contains(.left) { names.append("left") }
    if value.contains(.right) { names.append("right") }
    return names.isEmpty ? "none" : names.joined(separator: "+")
  }
}
