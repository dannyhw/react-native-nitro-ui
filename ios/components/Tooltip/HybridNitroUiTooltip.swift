//
//  HybridNitroUiTooltip.swift
//  react-native-nitro-ui
//
//  Tooltip (G18, DECISIONS D38, Q7 Appendix C2): a UIKit popover with SwiftUI content,
//  presented from a plain view through the core ``NitroUiPresentation`` helper. iOS has
//  no tooltip control; a popover anchored to a view is the platform's own way to point
//  at one, and DatePicker's `compact` field already presents one the same way.
//
//  The view React Native lays out is the **anchor**: the JS wrapper fills its own box
//  with it, behind the app's children, and it takes no touches and is invisible to
//  VoiceOver. There is no `NitroSwiftUIHost`: a closed tooltip on every row of a list
//  costs one plain view (Q5 B2's rule for the dialogs), and the hosting controller is
//  built only when the tooltip presents.
//
//  It presents from a window of its own (`NitroUiPresentation.presentInOwnWindow`), as
//  the dialogs do, and never from the app's chain: a popover in the chain is what the app's
//  top controller is presenting, so UIKit refuses the RN `Modal` an app opens while the
//  tooltip is up (measured, G18), and a `Modal` closing under it would strand (D35).
//

import NitroModules
import SwiftUI
import UIKit

// Perf ring buffer, shared with C++/Kotlin (cpp/core/NitroUiPerf.hpp).
private typealias NitroUiTooltipPerf = margelo.nitro.nitroui.NitroUiPerf

/// The view React Native lays out: the anchor. Nothing to draw, no touches, no
/// accessibility, and two jobs - say when it gains or loses a window (a popover can
/// only be presented from a view in one), and when its box changes (the popover's
/// source follows it).
final class NitroUiTooltipAnchorView: UIView {
  var onWindowChange: ((_ hasWindow: Bool) -> Void)?
  var onBoundsChange: (() -> Void)?

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

  override func layoutSubviews() {
    super.layoutSubviews()
    onBoundsChange?()
  }
}

/// What the SwiftUI content shows. One per mount, shared by every controller the mount
/// presents. Plain stored properties and one `objectWillChange` per apply, the rule
/// ``NitroUiModel`` states.
final class TooltipContentModel: NitroUiModel {
  var title: String?
  var message = ""
  var actions: [NitroUiTooltipAction] = []
  /// Runs an action's tap. Set by the Hybrid View; `nil` drops the tap.
  var perform: ((_ id: String) -> Void)?
}

/// The popover's content: Material's rich-tooltip slots, in SwiftUI's own type styles.
struct TooltipContent: View {
  @ObservedObject var model: TooltipContentModel

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let title = model.title {
        Text(title)
          .font(.headline)
      }
      Text(model.message)
        .font(model.title == nil ? .subheadline : .body)
      if !model.actions.isEmpty {
        HStack(spacing: 16) {
          ForEach(model.actions, id: \.id) { action in
            Button(action.title) {
              model.perform?(action.id)
            }
          }
        }
        .padding(.top, 4)
      }
    }
    // Wrap, never truncate: the width is bounded by the measurement below, and the
    // height is whatever the text then needs.
    .fixedSize(horizontal: false, vertical: true)
    .padding(12)
  }
}

/// The hosting controller, plus the one witness UIKit gives for every way a presented
/// controller goes away - an outside tap, the helper's dismissal, and a controller under
/// it dismissed with it on top. `viewDidDisappear` during a dismissal always runs.
final class NitroUiTooltipController: UIHostingController<TooltipContent> {
  var onDismissed: (() -> Void)?

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil {
      onDismissed?()
    }
  }
}

/// The Hybrid View React renders as `NitroUiTooltip`.
final class HybridNitroUiTooltip: HybridNitroUiTooltipSpec, RecyclableView {
  /// How many tooltips this process has on screen. See ``NitroUiPresentationCounter``.
  static let live = NitroUiPresentationCounter()

  /// Material's rich-tooltip maximum width, so the two platforms wrap at about the same
  /// width (Q7 C2).
  static let maxContentWidth: CGFloat = 320
  /// The narrowest margin the popover keeps from the window's edges.
  static let windowMargin: CGFloat = 16
  /// Room for UIKit's arrow and its gap, when deciding whether a side fits.
  static let arrowAllowance: CGFloat = 24

  private let anchor = NitroUiTooltipAnchorView()
  private let presentation = NitroUiPresentation(counter: HybridNitroUiTooltip.live)
  private let content = TooltipContentModel()
  /// The popover delegate, its own object so UIKit's weak reference has a stable target.
  private lazy var popoverDelegate = NitroUiTooltipPopoverDelegate(owner: self)
  /// Follows the anchor while the popover is up. See ``followAnchor()``.
  private lazy var tracker = NitroUiTooltipAnchorTracker { [weak self] in
    guard let self else { return false }
    guard self.popoverIsUp else { return false }
    self.followAnchor()
    return true
  }
  /// How many times the popover's source moved to follow the anchor, for the harness.
  private var sourceMoves = 0

  // MARK: Props, stored raw (setters only store; `afterUpdate()` applies)

  private var messageValue = ""
  private var titleValue: String?
  private var actionsValue: [NitroUiTooltipAction] = []
  private var placementValue = "auto"
  private var testIDValue: String?
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var presentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)?
  private var actionHandler: ((_ id: String) -> Void)?

  /// Whether the tooltip is up, behind the handshake: `js` is `presented` as React sent
  /// it, `displayed` is what native shows (core.md §4).
  private var state = NitroUiControlledValue<Bool>(displayed: false)

  // MARK: What is on screen

  /// The controller on screen, or the last one (until the next presentation). One per
  /// presentation, as a dialog's alert is: a tooltip presented again while the previous
  /// one is still leaving needs a controller of its own.
  private var popover: NitroUiTooltipController?
  /// Whether this mount has ended (`onDropView`).
  private var dropped = false
  /// Bumped per mount, so a deferred present or check from an ended mount stands down.
  private var mountGeneration = 0
  /// A present is queued for the next main turn.
  private var presentScheduled = false
  /// How many times this mount presented, for the harness.
  private var presentCount = 0
  /// What the app had presented on top when this tooltip last presented.
  private var appTopClass = "-"
  private var lifetimeDrops = 0
  private var lifetimeRecycles = 0

  private let reportLock = NSLock()
  private var report = ""

  override init() {
    super.init()
    anchor.onWindowChange = { [weak self] hasWindow in
      self?.windowChanged(hasWindow)
    }
    anchor.onBoundsChange = { [weak self] in
      self?.followAnchor()
    }
    content.perform = { [weak self] id in
      self?.actionTapped(id)
    }
    publishReport()
  }

  var view: UIView {
    return anchor
  }

  // MARK: - Props

  var presented: Bool {
    get { state.js ?? false }
    set { state.js = newValue }
  }

  var mostRecentEventCount: Double {
    get { Double(state.jsEvents) }
    set { state.jsEvents = Int(newValue) }
  }

  var message: String {
    get { messageValue }
    set { messageValue = newValue }
  }

  var title: Variant_NullType_String {
    get { titleValue.map { .second($0) } ?? .first(.null) }
    set { titleValue = newValue.asType(String.self) }
  }

  var actions: [NitroUiTooltipAction] {
    get { actionsValue }
    set { actionsValue = newValue }
  }

  var placement: String {
    get { placementValue }
    set { placementValue = newValue }
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

  var onAction: ((_ id: String) -> Void)? {
    get { actionHandler }
    set { actionHandler = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    mark(.propsApplied)
    // The handshake decides whether React's `presented` wins - including a close JS
    // refused, which is how a refused close presents again (D33).
    _ = state.reconcile()
    applyContent()
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    mark(.recycled)
    // First, before the props reset: an open tooltip belongs to the *previous* mount.
    tracker.stop()
    sourceMoves = 0
    presentation.dismissForTeardown()
    detachPopover()
    popover = nil
    presentation.forgetController()
    mountGeneration += 1
    presentScheduled = false
    state = NitroUiControlledValue<Bool>(displayed: false)
    messageValue = ""
    titleValue = nil
    actionsValue = []
    placementValue = "auto"
    testIDValue = nil
    presentedChange = nil
    actionHandler = nil
    presentCount = 0
    appTopClass = "-"
    perfInstanceId = nitroUiPerfNoInstance
    applyContent()
    // The next mount starts live: `dropped` belonged to the mount that just ended.
    dropped = false
    publishReport()
  }

  func onDropView() {
    lifetimeDrops += 1
    mark(.dropped)
    dropped = true
    mountGeneration += 1
    presentScheduled = false
    // A presentation must not outlive the mount that opened it. Callbacks go first, so
    // nothing this teardown causes can reach JS for a mount React has finished with.
    presentedChange = nil
    actionHandler = nil
    tracker.stop()
    if state.displayed || presentation.isOnScreen {
      state.displayed = false
      presentation.dismissForTeardown()
    }
    detachPopover()
    popover = nil
    presentation.forgetController()
    publishReport()
  }

  // MARK: - Content

  /// The props, into the content the popover shows - in place while it is up (C2 "Live
  /// updates"), with the popover's size measured again for the new text.
  private func applyContent() {
    let changed = content.title != titleValue || content.message != messageValue
      || content.actions.map(\.id) != actionsValue.map(\.id)
      || content.actions.map(\.title) != actionsValue.map(\.title)
    guard changed else { return }
    content.title = titleValue
    content.message = messageValue
    content.actions = actionsValue
    content.objectWillChange.send()
    guard let popover, popoverIsUp else { return }
    // SwiftUI applies an `objectWillChange` in its own update, which a measure made now
    // would precede - it read the text being replaced (measured: a message that wraps to
    // three lines kept the one-line height, in this turn and in the next). Laying the
    // hosting view out runs that update first.
    popover.view.setNeedsLayout()
    popover.view.layoutIfNeeded()
    let size = fittingSize(of: popover)
    if popover.preferredContentSize != size {
      popover.preferredContentSize = size
    }
  }

  /// The width the content wraps at: Material's 320, or the window less its margins on
  /// a narrower screen.
  private var maxWidth: CGFloat {
    let windowWidth = anchor.window?.bounds.width ?? Self.maxContentWidth + 2 * Self.windowMargin
    return min(Self.maxContentWidth, windowWidth - 2 * Self.windowMargin)
  }

  /// The size the content needs at ``maxWidth`` - `sizeThatFits(in:)` with an unbounded
  /// height, the measurement DatePicker's popover and the sizing engine both make.
  private func fittingSize(of controller: NitroUiTooltipController) -> CGSize {
    let fitted = controller.sizeThatFits(in: CGSize(width: maxWidth, height: .infinity))
    return CGSize(width: min(ceil(fitted.width), maxWidth), height: ceil(fitted.height))
  }

  // MARK: - Presenting

  /// Whether this mount's controller is on screen (or on its way) and not leaving.
  private var popoverIsUp: Bool {
    guard let popover else { return false }
    return popover.presentingViewController != nil && !popover.isBeingDismissed
  }

  /// Make the screen match `state.displayed`.
  private func sync() {
    nitroUiAssertMainThread()
    if state.displayed {
      if popoverIsUp {
        // Wanted and up. A JS `false` then `true` inside the entry transition left a
        // dismissal waiting for its completion; the newer write wins.
        presentation.cancelPendingDismissal()
      } else {
        schedulePresent()
      }
    } else if popoverIsUp {
      // React asked for it to close: animated, and no event - not a native interaction.
      presentation.dismissAnimated()
    }
  }

  /// Present on the next main turn: by then Fabric has laid the anchor out (a tooltip
  /// presented at mount gets its window before its frame).
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
    guard !dropped, state.displayed, !popoverIsUp else { return }
    guard let window = anchor.window else {
      // `didMoveToWindow` calls back here when the anchor gets one: a tooltip presented
      // at mount opens once its view is on screen.
      return
    }
    detachPopover()
    let controller = NitroUiTooltipController(rootView: TooltipContent(model: content))
    controller.view.backgroundColor = .clear
    controller.modalPresentationStyle = .popover
    controller.preferredContentSize = fittingSize(of: controller)
    if let testIDValue {
      controller.view.accessibilityIdentifier = "\(testIDValue)-tooltip"
    }
    controller.onDismissed = { [weak self, weak controller] in
      guard let self, let controller else { return }
      self.popoverWentAway(controller)
    }
    guard let source = controller.popoverPresentationController else { return }
    source.delegate = popoverDelegate
    popover = controller
    presentCount += 1
    appTopClass = NitroUiPresenterChain.topPresentedClass(in: window)
    // A window of its own, always - the dialogs' rule rather than BottomSheet's (D35).
    // Presented in the app's chain, the popover is what the top controller is presenting,
    // so an RN `Modal` the app opens while a tooltip is up is refused by UIKit and never
    // appears (`Tooltip.harness.tsx`, "closes and reports when a full-screen Modal takes
    // its view out of the window"), and a `Modal` closing under one would strand (D35).
    let presented = presentation.presentInOwnWindow(
      controller,
      over: anchor,
      animated: true,
      prepare: { [weak self] root in
        guard let self else { return }
        // The source is the anchor's box expressed in the presentation window's root, as
        // a dialog's is. Not the anchor itself: with a source view in the app's window,
        // UIKit presented the popover in the app's chain after all (measured).
        source.sourceView = root.view
        source.sourceRect = self.anchor.convert(self.anchor.bounds, to: root.view)
        source.permittedArrowDirections = self.arrowDirections(for: controller.preferredContentSize)
      },
      onShown: { [weak self, weak controller] in
        guard let self, let controller, controller === self.popover else { return }
        // VoiceOver reads the new content: the app opened it, so nothing else would tell
        // a screen-reader user it is there (C5).
        UIAccessibility.post(notification: .screenChanged, argument: controller.view)
        self.tracker.start()
        self.publishReport()
      }
    )
    if !presented {
      popover = nil
      presentCount -= 1
    }
    publishReport()
  }

  /// `placement` as UIKit's arrow directions. `auto` permits both and lets UIKit pick
  /// the side with room (DatePicker's choice); `above` and `below` permit their own side
  /// when the content fits there and flip to the other when it does not, as Material's
  /// position provider does - with a single permitted direction UIKit would squeeze the
  /// content into the room on that side instead.
  private func arrowDirections(for size: CGSize) -> UIPopoverArrowDirection {
    guard let window = anchor.window, placementValue == "above" || placementValue == "below" else {
      return [.up, .down]
    }
    let box = anchor.convert(anchor.bounds, to: window)
    let needed = size.height + Self.arrowAllowance
    let roomAbove = box.minY - window.safeAreaInsets.top
    let roomBelow = window.bounds.height - window.safeAreaInsets.bottom - box.maxY
    if placementValue == "above" {
      return roomAbove >= needed || roomAbove >= roomBelow ? .down : .up
    }
    return roomBelow >= needed || roomBelow >= roomAbove ? .up : .down
  }

  /// Point the popover at where the anchor is now. The source is a view in the
  /// presentation's own window, so nothing in UIKit follows the anchor for it: this runs
  /// each frame while the popover is up (``NitroUiTooltipAnchorTracker``) and when the
  /// anchor's own box changes, and moves the source only when the anchor did - a layout
  /// move, a scroll, a parent's animation.
  private func followAnchor() {
    guard let popover, popoverIsUp, anchor.window != nil,
      let source = popover.popoverPresentationController, let sourceView = source.sourceView
    else {
      return
    }
    let rect = anchor.convert(anchor.bounds, to: sourceView)
    guard abs(rect.minX - source.sourceRect.minX) > 0.5 || abs(rect.minY - source.sourceRect.minY) > 0.5
      || abs(rect.width - source.sourceRect.width) > 0.5 || abs(rect.height - source.sourceRect.height) > 0.5
    else {
      return
    }
    source.sourceRect = rect
    source.containerView?.setNeedsLayout()
    sourceMoves += 1
    publishReport()
  }

  /// Forget the previous controller's witness, so it can no longer report into this
  /// mount (an ended mount's popover finishing its dismissal, say).
  private func detachPopover() {
    popover?.onDismissed = nil
  }

  // MARK: - What the user did

  /// An action was tapped (or `nuiTestPerformAction` ran its handler): report the
  /// action, then the close - D32's order - then take the popover down.
  private func actionTapped(_ id: String) {
    guard state.displayed, popoverIsUp, actionsValue.contains(where: { $0.id == id }) else {
      return
    }
    actionHandler?(id)
    let count = state.user(false)
    presentedChange?(false, Double(count))
    presentation.dismissAnimated()
    publishReport()
  }

  /// A tap outside: UIKit took the popover down and said so through its delegate.
  fileprivate func popoverDismissedByUser(_ controller: UIViewController) {
    presentation.noteClosedByUIKit(controller)
    guard controller === popover, !dropped, state.displayed else {
      publishReport()
      return
    }
    let count = state.user(false)
    presentedChange?(false, Double(count))
    publishReport()
  }

  /// The witness: `controller` left the screen. Brings the count down when UIKit took
  /// it down on its own, and - one turn later, after the delegate's report of the same
  /// dismissal - reports a close nobody else reported (the controller under it was
  /// dismissed with it on top).
  private func popoverWentAway(_ controller: NitroUiTooltipController) {
    if presentation.isDismissingOnRequest(controller) {
      publishReport()
      return
    }
    presentation.noteClosedByUIKit(controller)
    DispatchQueue.main.async { [weak self, weak controller] in
      guard let self, let controller, controller === self.popover, !self.dropped,
        self.state.displayed
      else {
        self?.publishReport()
        return
      }
      let count = self.state.user(false)
      self.presentedChange?(false, Double(count))
      self.publishReport()
    }
    publishReport()
  }

  /// The anchor gained or lost its window.
  ///
  /// Gained: a tooltip React wants up and that is not up yet is presented now. Lost while
  /// up: one turn later - after an unmount's `onDropView`, which runs in the same mount
  /// transaction, and after a reparent that puts the view straight back - the popover is
  /// closed without animation and the close is reported, as a dialog's is.
  private func windowChanged(_ hasWindow: Bool) {
    if hasWindow {
      sync()
      publishReport()
      return
    }
    guard state.displayed || presentation.isOnScreen else { return }
    let generation = mountGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mountGeneration == generation, !self.dropped,
        self.anchor.window == nil
      else { return }
      let wasDisplayed = self.state.displayed
      if wasDisplayed {
        let count = self.state.user(false)
        self.presentedChange?(false, Double(count))
      }
      self.presentation.dismissForTeardown()
      self.publishReport()
    }
  }

  // MARK: - Methods

  func nuiTestStateReport() throws -> String {
    // Refresh on main for the next read - never wait for it (`NitroUiMainThread`).
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestPerformAction(id: String) throws {
    runOnMain { [weak self] in
      self?.actionTapped(id)
    }
  }

  func nuiTestDismiss() throws {
    runOnMain { [weak self] in
      guard let self, let popover = self.popover, self.popoverIsUp, self.state.displayed else {
        return
      }
      // What a tap outside reports, through the same handler; the dismissal itself is the
      // helper's, since UIKit offers no way to replay its own.
      self.popoverDismissedByUser(popover)
      self.presentation.dismissAnimated()
      self.publishReport()
    }
  }

  private func runOnMain(_ action: @escaping () -> Void) {
    if Thread.isMainThread {
      action()
    } else {
      DispatchQueue.main.async(execute: action)
    }
  }

  // MARK: - Report

  /// Snapshot what is on screen for ``nuiTestStateReport()``. Main thread only.
  private func publishReport() {
    var fields: [String] = []
    fields.append("presented=\(state.displayed ? 1 : 0)")
    fields.append("js=\(state.js == true ? 1 : 0)")
    fields.append("live=\(Self.live.value)")
    fields.append("presentCount=\(presentCount)")
    let onScreen = popoverIsUp
    fields.append("onScreen=\(onScreen ? 1 : 0)")
    fields.append("anchorW=\(Self.rounded(anchor.bounds.width))")
    fields.append("anchorH=\(Self.rounded(anchor.bounds.height))")
    fields.append("touchable=\(anchor.isUserInteractionEnabled ? 1 : 0)")
    if let popover, onScreen, let source = popover.popoverPresentationController {
      fields.append("kind=\(popover.modalPresentationStyle == .popover ? "popover" : "other")")
      fields.append("title=\(content.title ?? "-")")
      fields.append("message=\(content.message)")
      fields.append("actions=\(content.actions.count)")
      fields.append("ids=\(content.actions.map(\.id).joined(separator: ","))")
      fields.append("presenter=\(presentation.isInOwnWindow(popover) ? "ownWindow" : "chain")")
      fields.append("sourceIsOwnRoot=\(source.sourceView != nil && source.sourceView === presentation.ownWindowRoot(of: popover)?.view ? 1 : 0)")
      fields.append("sourceIsAnchorBox=\(Self.sameBox(source.sourceView.map { anchor.convert(anchor.bounds, to: $0) }, source.sourceRect) ? 1 : 0)")
      fields.append("sourceMoves=\(sourceMoves)")
      fields.append("permitted=\(Self.directions(source.permittedArrowDirections))")
      fields.append("arrow=\(Self.directions(source.arrowDirection))")
      fields.append("contentW=\(Self.rounded(popover.preferredContentSize.width))")
      fields.append("contentH=\(Self.rounded(popover.preferredContentSize.height))")
      fields.append("anchorRect=\(Self.screenRect(of: anchor))")
      fields.append("popRect=\(Self.screenRect(of: popover.viewIfLoaded))")
      fields.append("contentId=\(popover.viewIfLoaded?.accessibilityIdentifier ?? "-")")
    } else {
      fields.append("kind=none")
    }
    fields.append("appTop=\(appTopClass)")
    fields.append("topPresented=\(NitroUiPresenterChain.topPresentedClass(in: anchor.window))")
    fields.append("modalHosts=\(NitroUiPresenterChain.modalHostCount(near: anchor.window))")
    fields.append("windows=\(HybridNitroUiDialog.visibleWindowCount(near: anchor.window))")
    fields.append("drops=\(lifetimeDrops)")
    fields.append("recycles=\(lifetimeRecycles)")
    let line = fields.joined(separator: ";")
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  private static func sameBox(_ a: CGRect?, _ b: CGRect) -> Bool {
    guard let a else { return false }
    return abs(a.minX - b.minX) <= 0.5 && abs(a.minY - b.minY) <= 0.5
      && abs(a.width - b.width) <= 0.5 && abs(a.height - b.height) <= 0.5
  }

  private static func rounded(_ value: CGFloat) -> String {
    String(format: "%.1f", Double(value))
  }

  /// A view's box in its scene's coordinates - the space both the app's window and a
  /// presentation window of ours share - as `x,y,w,h`, or `-`.
  private static func screenRect(of view: UIView?) -> String {
    guard let view, let window = view.window else { return "-" }
    let inWindow = view.convert(view.bounds, to: window)
    let rect = window.windowScene.map { window.convert(inWindow, to: $0.coordinateSpace) } ?? inWindow
    return [rect.minX, rect.minY, rect.width, rect.height].map(rounded).joined(separator: ",")
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

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiTooltipPerf.mark(perfInstanceId, kind.rawValue)
  }
}

/// The popover's delegate: keep it a popover on a phone, and report a tap outside.
final class NitroUiTooltipPopoverDelegate: NSObject, UIPopoverPresentationControllerDelegate {
  private weak var owner: HybridNitroUiTooltip?

  init(owner: HybridNitroUiTooltip) {
    self.owner = owner
    super.init()
  }

  /// Without this, UIKit adapts a popover to a full-screen sheet at compact width,
  /// which is a different control (DatePicker's `:953`).
  func adaptivePresentationStyle(
    for controller: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    .none
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    owner?.popoverDismissedByUser(presentationController.presentedViewController)
  }
}

/// A display link that runs while a popover is up, so the popover can follow its anchor:
/// its source is a view in another window, which nothing in UIKit moves for it. `tick`
/// answers whether to keep running; the link stops itself once the popover has gone.
/// The target is this object, never the Hybrid View, so a link left running cannot
/// keep a dropped view alive.
final class NitroUiTooltipAnchorTracker: NSObject {
  private let tick: () -> Bool
  private var link: CADisplayLink?

  init(tick: @escaping () -> Bool) {
    self.tick = tick
    super.init()
  }

  func start() {
    guard link == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(step))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func stop() {
    link?.invalidate()
    link = nil
  }

  @objc private func step() {
    if !tick() {
      stop()
    }
  }
}
