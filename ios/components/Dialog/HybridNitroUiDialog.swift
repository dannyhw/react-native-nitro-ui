//
//  HybridNitroUiDialog.swift
//  react-native-nitro-ui
//
//  AlertDialog and ConfirmationDialog (G11, DECISIONS D33): one native view behind
//  both exports, presenting UIKit's `UIAlertController` (`.alert` or `.actionSheet`)
//  through the core ``NitroUiPresentation`` helper factored out of DatePicker.
//
//  There is no `NitroSwiftUIHost` and no hosting controller here: a closed dialog in
//  every row of a list should cost a view, not a SwiftUI graph (Q5 B2). The view React
//  Native lays out is a `0 x 0` anchor that takes no touches and is invisible to
//  VoiceOver; the presented window belongs to UIKit.
//

import NitroModules
import UIKit

// Perf ring buffer, shared with C++/Kotlin (cpp/core/NitroUiPerf.hpp).
private typealias NitroUiDialogPerf = margelo.nitro.nitroui.NitroUiPerf

/// The view React Native lays out: nothing to draw, no touches, no accessibility, and
/// one job - say when it gains or loses a window, because a dialog can only be
/// presented from a view that is in one.
final class NitroUiDialogAnchorView: UIView {
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

/// A `UIAlertController` that says when it went away, whoever took it down.
///
/// UIKit reports nothing to anyone when an alert leaves the screen because of an
/// action tap or because the controller under it was dismissed with it on top (an RN
/// `Modal` closing under an open dialog). The live count and the "the dialog closed"
/// event both depend on knowing, and `viewDidDisappear` during a dismissal is the one
/// place that always runs. The subclass adds that witness and nothing else.
final class NitroUiAlertController: UIAlertController {
  var onDismissed: (() -> Void)?

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Another controller presented over this one does not take it off screen for an
    // alert (it is an over-full-screen presentation); a dismissal does.
    if isBeingDismissed || presentingViewController == nil {
      onDismissed?()
    }
  }
}

/// The Hybrid View React renders as `NitroUiDialog`.
final class HybridNitroUiDialog: HybridNitroUiDialogSpec, RecyclableView {
  /// How many dialogs this process has on screen. See ``NitroUiPresentationCounter``.
  static let live = NitroUiPresentationCounter()

  private let anchor = NitroUiDialogAnchorView()
  private let presentation = NitroUiPresentation(counter: HybridNitroUiDialog.live)

  // MARK: Props, stored raw (setters only store; `afterUpdate()` applies)

  private var variantValue = "alert"
  private var titleValue = ""
  private var messageValue: String?
  private var titleVisibilityValue = "automatic"
  private var actionsValue: [NitroUiDialogAction] = []
  private var dismissibleValue = true
  private var tint: UIColor?
  private var testIDValue: String?
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var presentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)?
  private var actionHandler: ((_ id: String) -> Void)?

  /// Whether the dialog is up, behind the handshake: `js` is `presented` as React sent
  /// it, `displayed` is what native shows (core.md §4).
  private var state = NitroUiControlledValue<Bool>(displayed: false)

  // MARK: What is on screen

  /// The controller on screen, or the last one (until the next presentation).
  private var alert: NitroUiAlertController?
  /// The ids of `alert`'s actions, in order; `nil` for the implicit Cancel.
  private var builtActionIds: [String?] = []
  /// Whether this mount has ended (`onDropView`) - the deferred window-loss check and
  /// the transition retry both stand down once it has.
  private var dropped = false
  /// How many times this mount presented, for the harness (B7 test 5).
  private var presentCount = 0
  /// What the app had presented on top when this dialog last presented (an RN
  /// `Modal`'s controller, say) - the dialog itself is always in a window of its own.
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
    publishReport()
  }

  var view: UIView {
    return anchor
  }

  // MARK: - Props

  var variant: String {
    get { variantValue }
    set { variantValue = newValue }
  }

  var presented: Bool {
    get { state.js ?? false }
    set { state.js = newValue }
  }

  var mostRecentEventCount: Double {
    get { Double(state.jsEvents) }
    set { state.jsEvents = Int(newValue) }
  }

  var title: String {
    get { titleValue }
    set { titleValue = newValue }
  }

  var message: Variant_NullType_String {
    get { messageValue.map { .second($0) } ?? .first(.null) }
    set { messageValue = newValue.asType(String.self) }
  }

  var titleVisibility: String {
    get { titleVisibilityValue }
    set { titleVisibilityValue = newValue }
  }

  var actions: [NitroUiDialogAction] {
    get { actionsValue }
    set { actionsValue = newValue }
  }

  var dismissible: Bool {
    get { dismissibleValue }
    set { dismissibleValue = newValue }
  }

  var tintColor: Variant_NullType_Double {
    get { tint.map { .second($0.nitroUiARGBValue) } ?? .first(.null) }
    set { tint = newValue.asType(Double.self).flatMap(UIColor.init(nitroUiARGB:)) }
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
    // The handshake decides whether React's `presented` wins - including a dismissal JS
    // refused, which is how a refused dismissal presents again (D33).
    _ = state.reconcile()
    applyInPlace()
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    mark(.recycled)
    // First, before the props reset: an open dialog belongs to the *previous* mount.
    presentation.dismissForTeardown()
    detachAlert()
    state = NitroUiControlledValue<Bool>(displayed: false)
    variantValue = "alert"
    titleValue = ""
    messageValue = nil
    titleVisibilityValue = "automatic"
    actionsValue = []
    dismissibleValue = true
    tint = nil
    testIDValue = nil
    presentedChange = nil
    actionHandler = nil
    presentCount = 0
    appTopClass = "-"
    perfInstanceId = nitroUiPerfNoInstance
    // The next mount starts live: `dropped` belonged to the mount that just ended.
    dropped = false
    publishReport()
  }

  func onDropView() {
    lifetimeDrops += 1
    mark(.dropped)
    dropped = true
    // A presentation must not outlive the mount that opened it. Callbacks go first, so
    // nothing this teardown causes can reach JS for a mount React has finished with.
    presentedChange = nil
    actionHandler = nil
    if state.displayed || presentation.isOnScreen {
      state.displayed = false
      presentation.dismissForTeardown()
    }
    publishReport()
  }

  // MARK: - Presenting

  /// Make the screen match `state.displayed`.
  private func sync() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      let onScreen = presentation.isOnScreen && !(alert?.isBeingDismissed ?? false)
      if state.displayed {
        if onScreen {
          // Wanted and up. A JS `false` then `true` inside the entry transition left a
          // dismissal waiting for its completion; the newer write wins.
          presentation.cancelPendingDismissal()
        } else {
          presentIfPossible()
        }
      } else if onScreen {
        // React asked for it to close: animated, and no event - it was not a native
        // interaction.
        presentation.dismissAnimated()
      }
    }
  }

  @MainActor
  private func presentIfPossible() {
    guard !dropped, anchor.window != nil else {
      // `didMoveToWindow` calls back here when the view gets one: a dialog presented at
      // mount opens once, when its view first has a window (B1).
      return
    }
    let controller = buildAlert()
    appTopClass = Self.topPresentedClass(in: anchor.window)
    presentCount += 1
    // A window of its own, never the app's presentation chain: see
    // ``NitroUiPresentation/presentInOwnWindow(_:over:animated:prepare:onShown:)`` for the
    // RN `Modal` it would otherwise strand on screen.
    let presented = presentation.presentInOwnWindow(
      controller,
      over: anchor,
      animated: true,
      prepare: { [weak self] root in
        guard let self, let popover = controller.popoverPresentationController else { return }
        // Mandatory on iPad, where UIKit throws for an action sheet with no source; the
        // anchor's box, expressed in the presentation window's coordinates.
        popover.sourceView = root.view
        popover.sourceRect = self.anchor.convert(self.anchor.bounds, to: root.view)
      },
      onShown: { [weak self] in
        self?.publishReport()
      }
    )
    if !presented {
      presentCount -= 1
    }
  }

  /// A fresh controller for the current props. `UIAlertController` cannot drop an
  /// action, so the action set is built per presentation (B2).
  @MainActor
  private func buildAlert() -> NitroUiAlertController {
    detachAlert()
    let isSheet = variantValue == "confirmation"
    let showsTitle: Bool
    if isSheet {
      // SwiftUI's `Visibility` for a confirmation dialog: `automatic` hides the title
      // of an iOS action sheet, which is SwiftUI's own default (Q5 B2).
      showsTitle = titleVisibilityValue == "visible"
    } else {
      showsTitle = true
    }
    let controller = NitroUiAlertController(
      title: showsTitle ? titleValue : nil,
      message: messageValue,
      preferredStyle: isSheet ? .actionSheet : .alert
    )
    var ids: [String?] = []
    var hasCancel = false
    for action in actionsValue {
      let style: UIAlertAction.Style
      switch action.role {
      case "cancel" where !hasCancel:
        // `UIAlertController` raises for a second `.cancel`; the wrapper never sends
        // one, and this is the native half of that rule.
        style = .cancel
        hasCancel = true
      case "destructive":
        style = .destructive
      default:
        style = .default
      }
      let id = action.id
      let item = UIAlertAction(title: action.title, style: style) { [weak self, weak controller] _ in
        guard let self, let controller else { return }
        self.performAction(id, from: controller)
      }
      item.isEnabled = !action.disabled
      controller.addAction(item)
      ids.append(id)
    }
    if isSheet, !hasCancel, dismissibleValue {
      // SwiftUI's confirmation dialog adds a Cancel button when the caller gave none;
      // so does this one, and its tap is a dismissal without an action (B1).
      let cancel = UIAlertAction(title: Self.cancelTitle, style: .cancel) { [weak self, weak controller] _ in
        guard let self, let controller else { return }
        self.userDismissed(from: controller)
      }
      controller.addAction(cancel)
      ids.append(nil)
    }
    if let tint {
      controller.view.tintColor = tint
    }
    if let testIDValue {
      controller.view.accessibilityIdentifier = "\(testIDValue)-dialog"
    }
    controller.isModalInPresentation = !dismissibleValue
    controller.onDismissed = { [weak self, weak controller] in
      guard let self, let controller else { return }
      self.alertWentAway(controller)
    }
    alert = controller
    builtActionIds = ids
    return controller
  }

  /// Forget the previous controller's witness, so it can no longer report into this
  /// mount (a dropped mount's alert finishing its dismissal, say).
  private func detachAlert() {
    alert?.onDismissed = nil
  }

  /// Title, message and `isEnabled` follow the props while the alert is up (B2). The
  /// action set does not: adding, removing or renaming an action applies at the next
  /// presentation, because `UIAlertController` cannot drop an action.
  private func applyInPlace() {
    guard let alert, presentation.isOnScreen, !alert.isBeingDismissed else { return }
    let showsTitle = alert.preferredStyle == .alert || titleVisibilityValue == "visible"
    let nextTitle = showsTitle ? titleValue : nil
    if alert.title != nextTitle { alert.title = nextTitle }
    if alert.message != messageValue { alert.message = messageValue }
    let byId = Dictionary(actionsValue.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    for (index, id) in builtActionIds.enumerated() {
      guard let id, index < alert.actions.count, let action = byId[id] else { continue }
      let enabled = !action.disabled
      if alert.actions[index].isEnabled != enabled {
        alert.actions[index].isEnabled = enabled
      }
    }
    if let tint, alert.view.tintColor != tint {
      alert.view.tintColor = tint
    }
  }

  // MARK: - What the user did

  /// An action was tapped (or `nuiTestPerformAction` ran its handler): report the
  /// action, then the close - D32's order - and close it if UIKit is not already.
  private func performAction(_ id: String, from controller: UIAlertController) {
    guard controller === alert, state.displayed else { return }
    actionHandler?(id)
    let count = state.user(false)
    presentedChange?(false, Double(count))
    if presentation.isOnScreen, !controller.isBeingDismissed {
      // A real tap is already on its way out; only the test seam gets here.
      presentation.dismissAnimated()
    }
    publishReport()
  }

  /// A close with no action: the implicit Cancel, or `nuiTestDismiss`.
  private func userDismissed(from controller: UIAlertController) {
    guard controller === alert, state.displayed else { return }
    let count = state.user(false)
    presentedChange?(false, Double(count))
    if presentation.isOnScreen, !controller.isBeingDismissed {
      presentation.dismissAnimated()
    }
    publishReport()
  }

  /// The witness: `controller` left the screen. Brings the count down when UIKit took
  /// it down on its own, and - one turn later, after any action handler UIKit runs in
  /// the same dismissal - reports a close nobody else reported (the controller under
  /// it was dismissed, an iPad popover's outside tap with no Cancel).
  private func alertWentAway(_ controller: NitroUiAlertController) {
    if presentation.isDismissingOnRequest(controller) {
      publishReport()
      return
    }
    presentation.noteClosedByUIKit(controller)
    DispatchQueue.main.async { [weak self, weak controller] in
      guard let self, let controller, controller === self.alert, !self.dropped,
        self.state.displayed else {
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
  /// Gained: a dialog React wants up and that is not up yet is presented now. Lost
  /// while up: one turn later - after an unmount's `onDropView`, which runs in the same
  /// mount transaction, and after a reparent that puts the view straight back - the
  /// dialog is closed without animation and the close is reported (B2).
  private func windowChanged(_ hasWindow: Bool) {
    if hasWindow {
      sync()
      publishReport()
      return
    }
    guard state.displayed || presentation.isOnScreen else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.dropped, self.anchor.window == nil else { return }
      let wasDisplayed = self.state.displayed
      self.presentation.dismissForTeardown()
      if wasDisplayed {
        let count = self.state.user(false)
        self.presentedChange?(false, Double(count))
      }
      self.publishReport()
    }
  }

  // MARK: - Methods

  func nuiTestStateReport() throws -> String {
    // Refresh on main for the next read - never wait for it (`NitroUiMainThread`): the
    // harness polls, and `topPresented` is the one field nothing else republishes when
    // a dropped mount's carried dismissal finishes.
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestPerformAction(id: String) throws {
    runOnMain { [weak self] in
      guard let self, let alert = self.alert, self.state.displayed else { return }
      guard let index = self.builtActionIds.firstIndex(of: id), index < alert.actions.count else {
        return
      }
      // A disabled action does nothing, as a tap on it would.
      guard alert.actions[index].isEnabled else { return }
      self.performAction(id, from: alert)
    }
  }

  func nuiTestDismiss() throws {
    runOnMain { [weak self] in
      guard let self, let alert = self.alert, self.state.displayed, self.dismissibleValue else {
        return
      }
      self.userDismissed(from: alert)
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
    let onScreen = presentation.isOnScreen && !(alert?.isBeingDismissed ?? false)
    fields.append("onScreen=\(onScreen ? 1 : 0)")
    if let alert, onScreen {
      fields.append("kind=\(alert.preferredStyle == .actionSheet ? "sheet" : "alert")")
      fields.append("title=\(alert.title ?? "-")")
      fields.append("message=\(alert.message ?? "-")")
      fields.append("actions=\(builtActionIds.compactMap { $0 }.count)")
      fields.append("ids=\(builtActionIds.map { $0 ?? "*cancel" }.joined(separator: ","))")
      fields.append("enabled=\(alert.actions.map { $0.isEnabled ? "1" : "0" }.joined(separator: ","))")
      fields.append("implicitCancel=\(builtActionIds.contains(where: { $0 == nil }) ? 1 : 0)")
    } else {
      fields.append("kind=none")
    }
    fields.append("appTop=\(appTopClass)")
    fields.append("ownWindow=\(alert.map { presentation.isInOwnWindow($0) } == true ? 1 : 0)")
    fields.append("topPresented=\(Self.topPresentedClass(in: anchor.window))")
    fields.append("windows=\(Self.visibleWindowCount(near: anchor.window))")
    fields.append("drops=\(lifetimeDrops)")
    fields.append("recycles=\(lifetimeRecycles)")
    let line = fields.joined(separator: ";")
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  /// The app's window: the anchor's, or the scene's key window that is not one of ours.
  private static func appWindow(_ window: UIWindow?) -> UIWindow? {
    if let window { return window }
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { !($0.rootViewController is NitroUiPresentationRootController) && !$0.isHidden }
  }

  /// The class of the top-most controller presented in the app's window, or `-`.
  static func topPresentedClass(in window: UIWindow?) -> String {
    guard var top = appWindow(window)?.rootViewController else { return "-" }
    var presentedAny = false
    while let next = top.presentedViewController {
      top = next
      presentedAny = true
    }
    return presentedAny ? String(describing: type(of: top)) : "-"
  }

  /// How many presentation windows (ours) are visible in the app's scene: a leaked
  /// window is one that is still here with nothing in it.
  static func visibleWindowCount(near window: UIWindow?) -> Int {
    guard let scene = appWindow(window)?.windowScene else { return 0 }
    return scene.windows.filter {
      $0.rootViewController is NitroUiPresentationRootController && !$0.isHidden
    }.count
  }

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiDialogPerf.mark(perfInstanceId, kind.rawValue)
  }

  /// UIKit's own localised "Cancel", which is what SwiftUI's implicit button says.
  private static let cancelTitle: String = {
    Bundle(for: UIApplication.self).localizedString(forKey: "Cancel", value: "Cancel", table: nil)
  }()
}
