//
//  HybridNitroUiPopover.swift
//  react-native-nitro-ui
//
//  Popover (G22, DECISIONS D44): `UIPopoverPresentationController` whose content is React
//  Native views, anchored to a view the app lays out in place. S5 built the prototype
//  (`docs/tasks/S5-popover-spike.report.md`) and measured the three things this file is
//  shaped around:
//
//  1. **The box is Yoga's.** The JS wrapper makes this view as wide as the cap with
//     `alignItems: 'flex-start'`, so Yoga gives its one child - the content box - the
//     content's own width and height. `preferredContentSize` is that child's frame, read
//     one turn after the commit that mounted it, *before* the present. Without that
//     ordering the first frame is UIKit's default 320x480 and then jumps (S5's red arm).
//  2. **The content is adopted, not copied.** The generated `.mm` mounts the React Native
//     children into this view (`CONTENT_CHILDREN_VIEWS` in `scripts/patch-nitrogen.mjs`),
//     and the presentation adopts that view while it is up - BottomSheet's move (G14) -
//     which is what keeps their frames, their responder chain and their accessibility
//     tree intact inside the popover.
//  3. **Touch.** The presentation owns an `RCTSurfaceTouchHandler` (`NitroUiTouchRoot`)
//     over its content, as RN's own `Modal` does, or nothing inside would take a touch.
//
//  It presents from a window of its own (`NitroUiPresentation.presentInOwnWindow`), as
//  Tooltip does (D41) and not through D35's chain. The reason is Tooltip's, measured there
//  and re-measured here (`Popover.harness.tsx`, "a Modal opened while it is up still
//  shows"): a popover sitting in the app's chain *is* what the top controller is
//  presenting, so UIKit refuses the next RN `Modal` an app opens, and closing a `Modal`
//  dismisses the popover instead of the Modal.
//
//  All members are main-thread only (`NitroUiMainThread`); the test report is snapshotted
//  here and read from the JS thread without waiting for main.
//

import NitroModules
import UIKit

// Perf ring buffer, shared with C++/Kotlin (cpp/core/NitroUiPerf.hpp).
private typealias NitroUiPopoverPerf = margelo.nitro.nitroui.NitroUiPerf

// MARK: - Views

/// The React Native children's parent, adopted by the presentation while it is up.
///
/// Hidden whenever it is *not* in a popover: Fabric lays it out at the content's box in
/// the app's tree before the present and after the dismissal, and the children must draw
/// nowhere but in the popover.
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

/// The popover's controller: an empty box that adopts the React Native content, and the
/// delegate that keeps it a popover on a phone and reports the ways it leaves.
///
/// UIKit gives no witness for "this presented controller is gone" that covers every route
/// - a tap outside, a dismissal we asked for, and a controller under it dismissed with it
/// on top - so `viewDidDisappear` is the witness and the delegate's
/// `presentationControllerDidDismiss` is the tap-outside half of it (D35 item 2's rule).
final class NitroUiPopoverController: UIViewController, UIPopoverPresentationControllerDelegate {
  /// The React Native content's host inside the popover's own safe area.
  let contentHost = UIView()
  /// Runs once, however the popover left.
  var onGone: (() -> Void)?
  /// Whether the last thing that took this popover down was a tap outside it.
  private(set) var dismissedByUser = false
  private var gone = false
  private var touchHandler: UIGestureRecognizer?

  /// How many popover controllers this process has alive - a leak witness beside
  /// ``HybridNitroUiPopover/live``, which counts *presentations* and comes down as soon as
  /// one ends, while a controller lives until its dismissal has finished releasing it.
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

  /// Take the React Native content in for as long as the popover is up.
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

  /// Without these, UIKit adapts a popover to a full-screen sheet at compact width, which
  /// is a different control (Tooltip and DatePicker both say this).
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

/// Reads the popover's size on every display frame from the present until one second after
/// it, so a test can say "the first frame the user could see was the final size" rather
/// than assert it. Only ever started while a test is reading reports
/// (`HybridNitroUiPopover.reportsWanted`), so an app pays nothing.
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

/// The Hybrid View React renders as `NitroUiPopover`.
final class HybridNitroUiPopover: HybridNitroUiPopoverSpec, RecyclableView {
  /// How many popovers this process has on screen. See ``NitroUiPresentationCounter``:
  /// process-wide because a dropped mount has nothing left to report, so a harness reads
  /// the count through a *fresh* mount.
  static let live = NitroUiPresentationCounter()

  /// Whether any test has ever asked for a report. Until one has, `publishReport` returns
  /// without building a line and the frame sampler never starts, so a shipped app pays
  /// nothing for the witnesses (BottomSheet's rule).
  static let reportsWanted = NitroUiSheetCount()

  /// The narrowest margin the popover keeps from the window's edges. The wrapper caps the
  /// content with the same number (`Popover.tsx`); it is here so a popover presented in an
  /// app that never heard of the cap still cannot span a notch.
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
  /// How many times this mount presented, for the harness.
  private var presentCount = 0
  /// The box the popover was presented with, for the harness's "first frame is the size we
  /// asked for" line.
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
    // The handshake decides whether React's `presented` wins - including a close JS
    // refused, which is how a refused close presents again (D33).
    _ = state.reconcile()
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    mark(.recycled)
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
    // A presentation must not outlive the mount that opened it. Callbacks go first, so
    // nothing this teardown causes can reach JS for a mount React has finished with -
    // the drop rule D44 item 2 gives Popover with BottomSheet's.
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

  /// The first turn has the component view: remember it as home, where the content goes
  /// back to, and leave the window witness beside it.
  private func noteContentSuperview() {
    guard let superview = container.superview else { return }
    if home == nil, !(superview.superview?.next is NitroUiPopoverController) {
      home = superview
      anchor.frame = .zero
      superview.addSubview(anchor)
    }
  }

  /// Take the content out of the popover and hide it in the app's tree again.
  private func restoreContent() {
    container.isHidden = true
    guard let home, container.superview !== home else { return }
    home.insertSubview(container, at: 0)
  }

  /// Yoga gave the content box a size. While the popover is up that is a content resize in
  /// front of the user, and UIKit resizes a popover around its `preferredContentSize`.
  private func contentBoxChanged(_ size: CGSize) {
    guard let popover, popoverIsUp, size.width > 0, size.height > 0 else {
      publishReport()
      return
    }
    if popover.preferredContentSize != size {
      popover.preferredContentSize = size
    }
    publishReport()
  }

  /// The anchor's box: the wrapper that hugs the app's anchor element - this component
  /// view's parent. The wrapper is the component's own JSX, so its parent is never a view
  /// of the app's that happens to look right: it is ours.
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
          // React withdrew a popover that never got up: the wrapper still has content
          // mounted for it, so it still has to be told it can go (the spec's second call).
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
      // No layout yet. Wait a bounded number of turns: a popover of nothing would open at
      // UIKit's default size and then jump, which is the thing this ordering exists to
      // prevent, so it is better not open than to open wrong.
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
    let shown = presentation.presentInOwnWindow(
      controller,
      over: anchor,
      animated: true,
      prepare: { root in
        // The source is the wrapper's box expressed in the presentation window's root. Not
        // a view in the app's window: with one of those as the source, UIKit put the
        // popover back in the app's chain after all (measured for Tooltip, G18).
        popoverSource.sourceView = root.view
        popoverSource.sourceRect = source.convert(source.bounds, to: root.view)
        popoverSource.permittedArrowDirections = [.up, .down]
      },
      onShown: { [weak self, weak controller] in
        guard let self, let controller, controller === self.popover else { return }
        // VoiceOver reads the new content: the app opened it, so nothing else would tell a
        // screen-reader user it is there (Tooltip's C5).
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

  /// The content's box, never wider than the cap the wrapper sent or the window less its
  /// margins.
  ///
  /// The wrapper caps the layout with the same two numbers, so this normally changes
  /// nothing; it is here for the case the wrapper cannot see - a window that shrank between
  /// the commit and this turn - where presenting what Yoga laid out would put content
  /// through the edge of the screen.
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
    if !asked, !dropped {
      if controller.dismissedByUser {
        userDismissals += 1
      } else {
        // Gone while nobody asked - not the app, not a tap outside: the window under it
        // went away with the popover on it. D44 item 2's case.
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

  /// Tell the wrapper its content can go: `ended` when a presentation really ended.
  ///
  /// The debt is what makes the second kind exact: it is taken on whenever React asks for a
  /// popover, settled by a presentation ending while React no longer wants it, and
  /// otherwise by the first `false` that finds nothing on screen (the spec).
  private func reportDismissed(ended: Bool) {
    owesDismissal = state.displayed
    dismissed?(ended)
  }

  /// The anchor gained or lost its window.
  ///
  /// Gained: a popover React wants up and that is not up yet is presented now. Lost while
  /// up: one turn later - after an unmount's `onDropView`, which runs in the same mount
  /// transaction, and after a reparent that puts the view straight back - the popover is
  /// closed without animation and the close reported, as a sheet's is. The drop rule
  /// (D44 item 2) is what that one-turn wait protects: a `Modal` closing under an open
  /// popover drops this view in the same turn, and a dropped mount reports nothing.
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
      // The close first, then the teardown: a non-animated dismissal can finish inside
      // `dismissForTeardown`, and the presentation's end should follow its reason.
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
    // From the first read on, every state change keeps the report fresh; until then nothing
    // builds it (`reportsWanted`). Refresh on main for the next read - never wait for it.
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
    fields.append("sizes=\(sampler.distinct.map { "\($0.width)x\($0.height)" }.joined(separator: ","))")
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
    fields.append("inPopover=\(container.superview?.next is NitroUiPopoverController ? 1 : 0)")
    fields.append("hidden=\(container.isHidden ? 1 : 0)")
    fields.append("children=\(container.subviews.count)")
    fields.append("topPresented=\(NitroUiPresenterChain.topPresentedClass(in: anchor.window))")
    fields.append("modalHosts=\(NitroUiPresenterChain.modalHostCount(near: anchor.window))")
    fields.append("windows=\(HybridNitroUiDialog.visibleWindowCount(near: anchor.window))")
    fields.append("controllers=\(NitroUiPopoverController.alive.value)")
    fields.append("touchRoots=\(NitroUiTouchRoot.attached)")
    fields.append("userDismissals=\(userDismissals)")
    fields.append("unaskedExits=\(unaskedExits)")
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

