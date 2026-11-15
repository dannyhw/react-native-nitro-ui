// Popover: a `UIPopoverPresentationController` whose content is React Native views, anchored to a
// view the app lays out in place. Main thread only; the test report is snapshotted here and read
// from the JS thread.

import NitroModules
import UIKit

private typealias NitroUiPopoverPerf = margelo.nitro.nitroui.NitroUiPerf

// MARK: - Views

/// The React Native children's parent, adopted by the presentation while it is up. Hidden whenever
/// it is not in a popover: Fabric lays it out in the app's tree before the present and after the
/// dismissal, and the children must draw nowhere else.
final class NitroUiPopoverContentView: UIView {
  /// The content box's size changed (a Fabric layout). Main thread.
  var onSizeChange: ((CGSize) -> Void)?
  /// The view moved to a new superview (Nitro's `setContentView:` at init, then the
  /// popover's adopt and the restore back into the component view).
  var onSuperviewChange: (() -> Void)?
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
    let size = contentBoxSize
    guard abs(size.width - lastSize.width) > 0.25 || abs(size.height - lastSize.height) > 0.25 else {
      return
    }
    lastSize = size
    onSizeChange?(size)
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    onSuperviewChange?()
  }

  /// The content box: the one child the wrapper renders, as Yoga sized it. `zero` while
  /// the wrapper has no content mounted (a closed popover).
  var contentBoxSize: CGSize {
    guard let box = subviews.first else { return .zero }
    return CGSize(width: ceil(box.bounds.width), height: ceil(box.bounds.height))
  }
}

/// A `0 x 0` view left in the component view while the content is elsewhere: it says when
/// the popover's place in the app gains or loses a window, which is the one thing a
/// popover must know about a screen it is not in.
final class NitroUiPopoverAnchorView: UIView {
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

// MARK: - The presentation's controller

/// The popover's controller: an empty box that adopts the React Native content, and the delegate
/// that keeps it a popover on a phone. UIKit has no single callback for every way a presented
/// controller goes away, so `viewDidDisappear` is the witness and
/// `presentationControllerDidDismiss` marks a tap outside.
final class NitroUiPopoverController: UIViewController, UIPopoverPresentationControllerDelegate {
  /// The React Native content's host inside the popover's own safe area.
  let contentHost = UIView()
  /// Runs once, however the popover left.
  var onGone: (() -> Void)?
  /// Whether the last thing that took this popover down was a tap outside it.
  private(set) var dismissedByUser = false
  private var gone = false
  private var touchHandler: UIGestureRecognizer?

  /// How many popover controllers this process has alive: a leak check. `HybridNitroUiPopover.live`
  /// counts presentations and drops when one ends, while a controller lives until its dismissal has
  /// released it.
  static let alive = NitroUiSheetCount()

  override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .popover
    Self.alive.add(1)
  }

  convenience init() {
    self.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func loadView() {
    let root = UIView()
    root.backgroundColor = .clear
    // VoiceOver stays inside the popover while it is up, as a sheet's does.
    root.accessibilityViewIsModal = true
    contentHost.backgroundColor = .clear
    root.addSubview(contentHost)
    view = root
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // React Native's touch handler must be attached to the presented view, as RN's own `Modal`
    // does, or nothing inside takes a touch.
    touchHandler = NitroUiTouchRoot.attach(to: view)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let insets = view.safeAreaInsets
    let frame = CGRect(
      x: insets.left,
      y: insets.top,
      width: max(0, view.bounds.width - insets.left - insets.right),
      height: max(0, view.bounds.height - insets.top - insets.bottom)
    )
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

  deinit {
    if let touchHandler, isViewLoaded {
      NitroUiTouchRoot.detach(touchHandler, from: view)
    }
    Self.alive.add(-1)
  }

  func adopt(_ content: UIView) {
    loadViewIfNeeded()
    if content.superview !== contentHost {
      contentHost.addSubview(content)
    }
    content.isHidden = false
  }

  /// The test seam: close the popover the way a tap outside does, through the same
  /// delegate path, so it reports a close.
  func closeAsUser() {
    dismissedByUser = true
    dismiss(animated: true)
  }

  private func noteGone() {
    guard !gone else { return }
    gone = true
    if let touchHandler {
      NitroUiTouchRoot.detach(touchHandler, from: view)
      self.touchHandler = nil
    }
    onGone?()
  }

  // MARK: UIPopoverPresentationControllerDelegate

  /// Without these, UIKit adapts a popover to a full-screen sheet at compact width.
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

// MARK: - The first-frame witness

/// Test-only: reads the popover's size on every display frame for one second after the present, so
/// a test can check that the first visible frame was already the final size. Started only once a
/// test has asked for a report.
final class NitroUiPopoverSampler: NSObject {
  private weak var controller: UIViewController?
  private var link: CADisplayLink?
  private var startedAt: CFTimeInterval = 0
  private(set) var running = false
  private(set) var visibleFrames = 0
  private(set) var first: CGSize?
  private(set) var last: CGSize?
  private(set) var distinct: [CGSize] = []
  var onDone: (() -> Void)?

  func start(_ controller: UIViewController) {
    stop()
    self.controller = controller
    visibleFrames = 0
    first = nil
    last = nil
    distinct = []
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
  }
}

// MARK: - The Hybrid View

final class HybridNitroUiPopover: HybridNitroUiPopoverSpec, RecyclableView {
  static let live = NitroUiPresentationCounter()

  /// Whether any test has ever asked for a report. Until one has, no report is built and the frame
  /// sampler never starts.
  static let reportsWanted = NitroUiSheetCount()

  /// The narrowest margin the popover keeps from the window's edges. The JS wrapper caps the
  /// content with the same number.
  static let windowMargin: CGFloat = 16

  private let container = NitroUiPopoverContentView()
  private let anchor = NitroUiPopoverAnchorView()
  private let presentation = NitroUiPresentation(counter: HybridNitroUiPopover.live)
  private let sampler = NitroUiPopoverSampler()

  /// Where the content lived before the popover took it: the component view.
  private weak var home: UIView?

  // MARK: Props, stored raw (setters only store; `afterUpdate()` applies)

  private var maxWidthValue: Double = 0
  private var testIDValue: String?
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var presentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)?
  private var dismissed: ((_ ended: Bool) -> Void)?
  private var state = NitroUiControlledValue<Bool>(displayed: false)

  // MARK: What is on screen

  private var popover: NitroUiPopoverController?
  /// Whether this mount has ended (`onDropView`).
  private var dropped = false
  /// Bumped per mount, so a deferred present or check from an ended mount stands down.
  private var mountGeneration = 0
  /// A present is queued for the next main turn.
  private var presentScheduled = false
  /// React wants a popover and none is up: the wait for the content's first layout.
  private var awaitingPresent = false
  /// React has asked for a popover and no presentation has ended since, so the next
  /// `presented = false` owes the wrapper an `onDismissed(false)`.
  private var owesDismissal = false
  /// How many turns the present has waited for the content box to have a size.
  private var contentWaits = 0
  /// The RN `Modal` host the anchor lived in, remembered while it had a window, and whether its
  /// going away is what closed this popover, which closes it silently.
  private weak var enclosingModalHost: UIViewController?
  private var closingWithTheModal = false
  /// How many times this mount presented (test read-out).
  private var presentCount = 0
  /// The size the popover was presented with (test read-out).
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
      self?.noteContentSuperview()
    }
    container.onSizeChange = { [weak self] size in
      self?.contentBoxChanged(size)
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

  var testID: Variant_NullType_String {
    get { testIDValue.map { .second($0) } ?? .first(.null) }
    set { testIDValue = newValue.asType(String.self) }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
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
    mark(.propsApplied)
    // The handshake decides whether React's `presented` wins, including a close JS refused, which
    // presents again.
    _ = state.reconcile()
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    mark(.recycled)
    closingWithTheModal = false
    enclosingModalHost = nil
    teardown()
    state = NitroUiControlledValue<Bool>(displayed: false)
    maxWidthValue = 0
    testIDValue = nil
    presentedChange = nil
    dismissed = nil
    presentCount = 0
    contentWaits = 0
    sizeAtPresent = .zero
    userDismissals = 0
    unaskedExits = 0
    dropped = false
    perfInstanceId = nitroUiPerfNoInstance
    publishReport()
  }

  func onDropView() {
    lifetimeDrops += 1
    mark(.dropped)
    dropped = true
    // A presentation must not outlive the mount that opened it. Callbacks go first, so nothing this
    // teardown causes can reach JS for a mount React has finished with.
    presentedChange = nil
    dismissed = nil
    teardown()
    publishReport()
  }

  /// Close whatever this mount has up, without animation, and take the content back.
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
        // The dismissal holds the controller itself; a pooled view must not.
        presentation.forgetController()
      }
    }
    popover = nil
    restoreContent()
  }

  // MARK: Where the content lives

  /// The first superview is the component view: remember it as home, where the content goes back
  /// to, and add the window witness beside it.
  private func noteContentSuperview() {
    guard let superview = container.superview else { return }
    if home == nil, !(superview.superview?.next is NitroUiPopoverController) {
      home = superview
      anchor.frame = .zero
      superview.addSubview(anchor)
    }
  }

  private func restoreContent() {
    container.isHidden = true
    guard let home, container.superview !== home else { return }
    home.insertSubview(container, at: 0)
  }

  /// Yoga gave the content box a size. While the popover is up that is a content resize in
  /// front of the user, and UIKit resizes a popover around its `preferredContentSize`.
  private func contentBoxChanged(_ size: CGSize) {
    if popover == nil, state.displayed, awaitingPresent, size.width > 0, size.height > 0 {
      // The content box got its size after `presentIfPossible` stopped waiting for it (content that
      // measures itself late). Resume the present.
      contentWaits = 0
      schedulePresent()
      publishReport()
      return
    }
    guard let popover, popoverIsUp, size.width > 0, size.height > 0 else {
      publishReport()
      return
    }
    if popover.preferredContentSize != size {
      popover.preferredContentSize = size
    }
    publishReport()
  }

  /// The anchor's box: the JS wrapper around the app's anchor element, which is this component
  /// view's parent.
  private var anchorBox: UIView? {
    home?.superview ?? home
  }

  // MARK: Presenting

  /// Whether this mount's popover is on screen (or on its way) and not leaving.
  private var popoverIsUp: Bool {
    guard let popover else { return false }
    return popover.presentingViewController != nil && !popover.isBeingDismissed
  }

  /// Make the screen match `state.displayed`.
  private func sync() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      if state.displayed {
        owesDismissal = true
        if popover != nil {
          if popoverIsUp {
            // A JS `false` then `true` inside the entry transition left a dismissal
            // waiting for its completion; the newer write wins.
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
        if let popover, popoverIsUp {
          // React asked for it to close: animated, and no event - not a native interaction.
          presentation.dismissAnimated()
        } else if popover == nil, owesDismissal {
          // React withdrew a popover that never got up. The wrapper still has content mounted for
          // it, so it still has to be told it can go.
          awaitingPresent = false
          reportDismissed(ended: false)
        }
      }
    }
  }

  /// Present one turn after the commit: the content mounted in it has its layout by then.
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
    guard anchor.window != nil, let source = anchorBox else {
      // `didMoveToWindow` calls back here when the anchor gets one: a popover React asked
      // for at mount opens once its view is on screen.
      return
    }
    let size = cappedSize(container.contentBoxSize)
    if size.width <= 0 || size.height <= 0 {
      // No layout yet. Wait a bounded number of turns: a popover presented without a size opens at
      // UIKit's default size and then jumps.
      contentWaits += 1
      guard contentWaits <= 60 else {
        awaitingPresent = true
        publishReport()
        return
      }
      let generation = mountGeneration
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { [weak self] in
        guard let self, self.mountGeneration == generation else { return }
        MainActor.assumeIsolated { self.presentIfPossible() }
      }
      return
    }
    awaitingPresent = false
    // A presentation of its own: the next close of this one is a close to report.
    closingWithTheModal = false
    let controller = NitroUiPopoverController()
    controller.adopt(container)
    sizeAtPresent = size
    controller.preferredContentSize = size
    if let testIDValue {
      controller.view.accessibilityIdentifier = "\(testIDValue)-popover"
    }
    controller.onGone = { [weak self] in
      self?.popoverGone(controller)
    }
    guard let popoverSource = controller.popoverPresentationController else {
      restoreContent()
      publishReport()
      return
    }
    popoverSource.delegate = controller
    popover = controller
    presentCount += 1
    if Self.reportsWanted.value > 0 {
      sampler.start(controller)
    }
    // A window of its own: a popover in the app's chain is what the top controller is presenting,
    // so UIKit would refuse the next RN `Modal` the app opens, and closing a `Modal` would dismiss
    // the popover instead.
    let shown = presentation.presentInOwnWindow(
      controller,
      over: anchor,
      animated: true,
      prepare: { root in
        // The source is the wrapper's box expressed in the presentation window's root. With a view
        // in the app's window as the source, UIKit puts the popover back in the app's chain.
        popoverSource.sourceView = root.view
        popoverSource.sourceRect = source.convert(source.bounds, to: root.view)
        popoverSource.permittedArrowDirections = [.up, .down]
      },
      onShown: { [weak self, weak controller] in
        guard let self, let controller, controller === self.popover else { return }
        // The app opened it, so nothing else would tell a screen-reader user it is there.
        UIAccessibility.post(notification: .screenChanged, argument: controller.view)
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

  /// The content's box, never wider than the cap the wrapper sent or the window less its margins.
  /// The wrapper applies the same cap, so this only matters when the window shrank between the
  /// commit and the present.
  private func cappedSize(_ size: CGSize) -> CGSize {
    guard size.width > 0, size.height > 0 else { return .zero }
    let windowWidth = anchor.window?.bounds.width ?? .infinity
    let wanted = maxWidthValue > 0 ? CGFloat(maxWidthValue) : .infinity
    let limit = max(0, min(wanted, windowWidth - 2 * Self.windowMargin))
    guard size.width > limit else { return size }
    return CGSize(width: limit, height: size.height)
  }

  /// The witness: this mount's popover left the screen, whoever took it down.
  private func popoverGone(_ controller: NitroUiPopoverController) {
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
    // A close caused by a closing `Modal` counts as a drop: nothing is reported to the app.
    let withTheModal = closingWithTheModal
    closingWithTheModal = false
    if withTheModal {
      owesDismissal = state.displayed
      publishReport()
      return
    }
    if !asked, !dropped {
      if controller.dismissedByUser {
        userDismissals += 1
      } else {
        // Nobody asked, neither the app nor a tap outside: the window under the popover went away.
        unaskedExits += 1
      }
      if state.displayed {
        let count = state.user(false)
        presentedChange?(false, Double(count))
      }
    }
    reportDismissed(ended: true)
    if state.displayed {
      // Wanted again before this one finished leaving (a JS `false` then `true`, or a close
      // the app refused).
      schedulePresent()
    }
    publishReport()
  }

  /// The nearest RN `Modal` host in `view`'s responder chain. Read while the anchor still has a
  /// window: a view with no window is asked too late.
  private static func enclosingModalHost(for view: UIView?) -> UIViewController? {
    var responder: UIResponder? = view?.next
    while let current = responder {
      if let controller = current as? UIViewController {
        if NitroUiPresenterChain.isModalHost(controller) { return controller }
      }
      responder = current.next
    }
    return nil
  }

  /// Whether the `Modal` this popover's anchor was in has gone or is going. `isBeingDismissed`
  /// covers an animated close; a `Modal` closed without animation is already off the chain and out
  /// of the window.
  private func modalHostIsGoingAway() -> Bool {
    guard let host = enclosingModalHost ?? Self.enclosingModalHost(for: anchor) else {
      return false
    }
    return host.isBeingDismissed || (host.presentingViewController == nil && host.view.window == nil)
  }

  /// Tell the wrapper its content can go; `ended` when a presentation really ended. The debt is
  /// taken on whenever React asks for a popover, and settled by a presentation ending or by the
  /// first `false` that finds nothing on screen.
  private func reportDismissed(ended: Bool) {
    owesDismissal = state.displayed
    dismissed?(ended)
  }

  /// The anchor gained or lost its window. Gained: a popover React wants up is presented now. Lost
  /// while up: one turn later (after an unmount's `onDropView` in the same mount transaction, or a
  /// reparent that puts the view straight back) the popover is closed without animation and the
  /// close is reported.
  private func windowChanged(_ hasWindow: Bool) {
    if hasWindow {
      if enclosingModalHost == nil {
        enclosingModalHost = Self.enclosingModalHost(for: anchor)
      }
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
      // Report the close first, then tear down: a non-animated dismissal can finish inside
      // `dismissForTeardown`. The exception is a window lost because the RN `Modal` the anchor was
      // in is closing: that mount is being dropped, and a dropped popover closes silently. On iOS
      // the anchor loses its window before the unmount, because RN keeps a closing Modal's content
      // mounted until its dismissal ends.
      let withTheModal = self.modalHostIsGoingAway()
      if withTheModal {
        self.closingWithTheModal = true
      } else if self.state.displayed {
        let count = self.state.user(false)
        self.presentedChange?(false, Double(count))
      }
      if let popover = self.popover, self.presentation.controller === popover {
        self.presentation.dismissForTeardown()
      } else if self.owesDismissal, !withTheModal {
        self.awaitingPresent = false
        self.reportDismissed(ended: false)
      }
      self.publishReport()
    }
  }

  // MARK: Methods

  func nuiTestStateReport() throws -> String {
    // Reports are built only once a test has asked for one. Refresh on main for the next read,
    // never wait for it.
    Self.reportsWanted.add(Self.reportsWanted.value == 0 ? 1 : 0)
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestDismiss() throws {
    runOnMain { [weak self] in
      guard let self, let popover = self.popover, self.popoverIsUp else { return }
      popover.closeAsUser()
    }
  }

  private func runOnMain(_ action: @escaping () -> Void) {
    if Thread.isMainThread {
      action()
    } else {
      DispatchQueue.main.async(execute: action)
    }
  }

  // MARK: Report

  private func publishReport() {
    guard Self.reportsWanted.value > 0 else { return }
    reportSeq += 1
    var fields: [String] = ["seq=\(reportSeq)"]
    fields.append("presented=\(state.displayed ? 1 : 0)")
    fields.append("js=\(state.js == true ? 1 : 0)")
    fields.append("live=\(Self.live.value)")
    fields.append("presentCount=\(presentCount)")
    fields.append("onScreen=\(popoverIsUp ? 1 : 0)")
    let box = container.contentBoxSize
    fields.append("contentW=\(Int(box.width))")
    fields.append("contentH=\(Int(box.height))")
    fields.append("askedW=\(Int(sizeAtPresent.width))")
    fields.append("askedH=\(Int(sizeAtPresent.height))")
    fields.append("contentWaits=\(contentWaits)")
    fields.append("sampling=\(sampler.running ? 1 : 0)")
    fields.append("visibleFrames=\(sampler.visibleFrames)")
    fields.append("firstW=\(Int(sampler.first?.width ?? 0))")
    fields.append("firstH=\(Int(sampler.first?.height ?? 0))")
    fields.append("finalW=\(Int(sampler.last?.width ?? 0))")
    fields.append("finalH=\(Int(sampler.last?.height ?? 0))")
    fields.append(
      "sizes=\(sampler.distinct.map { "\(Int($0.width))x\(Int($0.height))" }.joined(separator: ","))"
    )
    fields.append("maxWidth=\(Int(maxWidthValue))")
    fields.append("nodeW=\(Int(container.bounds.width.rounded()))")
    fields.append("nodeH=\(Int(container.bounds.height.rounded()))")
    if let popover, let view = popover.viewIfLoaded {
      fields.append("prefW=\(Int(popover.preferredContentSize.width.rounded()))")
      fields.append("prefH=\(Int(popover.preferredContentSize.height.rounded()))")
      fields.append("viewW=\(Int(view.bounds.width.rounded()))")
      fields.append("viewH=\(Int(view.bounds.height.rounded()))")
      fields.append("arrow=\(Self.direction(popover.popoverPresentationController?.arrowDirection ?? .unknown))")
      fields.append("ownWindow=\(presentation.isInOwnWindow(popover) ? 1 : 0)")
      fields.append("windowLevel=\(Int(view.window?.windowLevel.rawValue ?? -1))")
      fields.append("windowKey=\(view.window?.isKeyWindow == true ? 1 : 0)")
      fields.append("popRect=\(Self.screenRect(of: view))")
      fields.append("id=\(view.accessibilityIdentifier ?? "-")")
    }
    fields.append("anchorRect=\(Self.screenRect(of: anchorBox))")
    // Two views up: the content sits in the controller's host, whose `next` is the controller's
    // root view, not the controller.
    fields.append(
      "inPopover=\(container.superview?.superview?.next is NitroUiPopoverController ? 1 : 0)"
    )
    fields.append("hidden=\(container.isHidden ? 1 : 0)")
    fields.append("children=\(container.subviews.count)")
    fields.append("topPresented=\(NitroUiPresenterChain.topPresentedClass(in: anchor.window))")
    fields.append("modalHosts=\(NitroUiPresenterChain.modalHostCount(near: anchor.window))")
    fields.append("windows=\(HybridNitroUiDialog.visibleWindowCount(near: anchor.window))")
    fields.append("controllers=\(NitroUiPopoverController.alive.value)")
    fields.append("touchRoots=\(NitroUiTouchRoot.attached)")
    fields.append("userDismissals=\(userDismissals)")
    fields.append("unasked=\(unaskedExits)")
    fields.append("anchored=\(anchor.window != nil ? 1 : 0)")
    fields.append("drops=\(lifetimeDrops)")
    fields.append("recycles=\(lifetimeRecycles)")
    let line = fields.joined(separator: ";")
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  /// The view's box in its window's coordinates, or `-` when it has no window.
  private static func screenRect(of view: UIView?) -> String {
    guard let view, let window = view.window else { return "-" }
    let inWindow = view.convert(view.bounds, to: window)
    return [inWindow.minX, inWindow.minY, inWindow.width, inWindow.height]
      .map { String(format: "%.1f", Double($0)) }
      .joined(separator: ",")
  }

  private static func direction(_ value: UIPopoverArrowDirection) -> String {
    switch value {
    case .up: return "up"
    case .down: return "down"
    case .left: return "left"
    case .right: return "right"
    default: return "unknown"
    }
  }

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiPopoverPerf.mark(perfInstanceId, kind.rawValue)
  }
}

