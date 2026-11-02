//
//  NitroUiPresentation.swift
//  react-native-nitro-ui
//
//  UIKit presentation from a plain view, shared by every component that opens a
//  window of its own: DatePicker's popover (G5) and the dialogs (G11). Factored out
//  of `NitroUiDatePickerPresentation` (G11, DECISIONS D33), whose lifecycle rules it
//  keeps word for word: the process-wide live count, the hide-then-dismiss for a
//  teardown during the entry transition, and the real dismissal deferred to the
//  presentation's own completion.
//

import UIKit

/// How many presentations of one kind this process has open right now.
///
/// Process-wide rather than per mount, because the property it guards is "no
/// presentation outlives the mount that opened it" - and a mount that has been
/// dropped has nothing left to report, so a harness reads it through a *fresh*
/// mount. One counter per component, so a dialog left open cannot make a
/// DatePicker assertion read wrong, and the reverse.
///
/// Locked rather than a plain integer: the writes are all on main, but a
/// component's test report reads it from the JS thread, and JS must never hop to
/// main for it (`core.md` §1.4).
final class NitroUiPresentationCounter {
  private let lock = NSLock()
  private var count = 0

  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }

  fileprivate func opened() {
    lock.lock()
    count += 1
    lock.unlock()
  }

  fileprivate func closed() {
    lock.lock()
    count -= 1
    lock.unlock()
  }
}

/// One component's presentation: the controller it put on screen, and whether it is
/// still there.
///
/// It owns *when* UIKit is asked, never *what* is presented: the component builds its
/// controller (a hosting controller for DatePicker's calendar, a `UIAlertController`
/// for a dialog) and configures its presentation style, and this class presents it,
/// counts it, and takes it down - including in the two cases UIKit makes hard:
///
/// - **a teardown during the entry transition.** UIKit refuses a dismissal that
///   arrives while the presentation is still animating in, and a dropped view does not
///   wait for the animation: the refusal is then not a delay but a leak. So the request
///   is remembered and carried out by the presentation's own completion, and in the
///   meantime the presentation's container view is hidden, which takes the window and
///   its dimming layer out of the draw and out of `hitTest:` in the same turn (measured
///   in G5: a DatePicker dropped 140 ms after its press kept swallowing touches for
///   another 500 ms without this);
/// - **a presentation UIKit closed on its own** - a popover's outside tap, an alert's
///   action, a parent controller dismissed with this one on top of it. The component
///   tells this class (``noteClosedByUIKit()``), so the count comes down exactly once.
///
/// The entry transition and the dismissal carried through it are kept **per
/// controller**. DatePicker presents one controller again and again, but a dialog
/// builds one per presentation, and a recycled dialog view presents its next mount's
/// controller while the previous mount's may still be animating in (a re-key inside
/// the ~300 ms entry). One flag for the instance was overwritten by the new `present`:
/// the old controller's carried dismissal was lost, its alert stayed up in a key window
/// of its own, and its completion marked the *new* entry finished, so the new mount's
/// teardown was refused as well (G11 review).
///
/// All members are main-thread only (`NitroUiMainThread`).
final class NitroUiPresentation: NSObject {
  let counter: NitroUiPresentationCounter

  /// A dismissal that arrived during a controller's entry transition, carried to that
  /// transition's completion.
  private struct CarriedDismissal {
    /// Whether one was asked for.
    var requested = false
    /// Whether it animates (a JS write) or not (a teardown).
    var animated = false
  }

  /// A presentation window, and where key status goes back to when it closes.
  private struct OwnWindow {
    let window: UIWindow
    /// The window that was key when this one was made key: the app's, or another
    /// presentation's (a dialog over a dialog).
    weak var previousKey: UIWindow?
    /// The app's window the presentation was anchored in, for when `previousKey` has
    /// gone in the meantime.
    weak var appWindow: UIWindow?
  }

  /// The controller this instance last presented, kept so a component can update it
  /// in place and so a dismissal knows what to dismiss.
  private(set) var controller: UIViewController?
  /// The controllers whose entry transition is still running, each with the dismissal
  /// carried to its completion, if one arrived. A controller leaves this map in its
  /// own completion, and nothing else's.
  private var entering: [ObjectIdentifier: CarriedDismissal] = [:]
  /// The presentations this instance has counted and not yet uncounted, by
  /// controller. One presentation, one decrement: a programmatic dismissal whose
  /// completion lands next to UIKit's own report of the same teardown must not take
  /// the count below zero, or a harness would read "nothing presented" while a window
  /// is still up. Keyed per controller rather than one flag, because a dialog the app
  /// re-presents (a refused dismissal) puts a new controller up while the old one is
  /// still animating out, and each must come down on its own report.
  private var counted = Set<ObjectIdentifier>()
  /// The controllers whose dismissal this class asked for and UIKit has not finished,
  /// so a component's "the controller went away" witness can tell that from a
  /// dismissal UIKit did on its own.
  private var requested = Set<ObjectIdentifier>()
  /// The windows of presentations made with ``presentInOwnWindow(_:over:animated:prepare:onShown:)``,
  /// by controller, each released when its presentation ends.
  private var windows: [ObjectIdentifier: OwnWindow] = [:]

  init(counter: NitroUiPresentationCounter) {
    self.counter = counter
    super.init()
  }

  /// Whether ``controller`` is on screen (or on its way): it has a presenter.
  var isOnScreen: Bool {
    controller?.presentingViewController != nil
  }

  /// Present `controller` from `presenter`. The caller has configured its style (and
  /// a popover's source) already.
  ///
  /// `onShown` runs in the presentation's completion, after the count has gone up and
  /// before a dismissal carried through the entry transition is honoured.
  @MainActor
  func present(
    _ controller: UIViewController,
    from presenter: UIViewController,
    animated: Bool = true,
    onShown: (() -> Void)? = nil
  ) {
    self.controller = controller
    let key = ObjectIdentifier(controller)
    entering[key] = CarriedDismissal()
    // `self` is held until the completion runs - one transition - so a dismissal carried
    // to it still happens when the view that owned the presentation was dropped and
    // released in the meantime. The closure is released once it has run. It settles
    // *this* controller only: a newer one presented meanwhile has its own entry.
    presenter.present(controller, animated: animated) {
      let carried = self.entering.removeValue(forKey: key) ?? CarriedDismissal()
      if self.counted.insert(key).inserted {
        self.counter.opened()
      }
      onShown?()
      if carried.requested {
        self.dismissNow(controller, animated: carried.animated)
      }
    }
  }

  /// Present `controller` from a window of its own, above the app's.
  ///
  /// What a dialog uses on iOS, for the reason React Native's own `Alert` does
  /// (`RCTAlertController`, a `UIWindow` at `UIWindowLevelAlert + 1`): a controller
  /// presented *in* the app's chain sits on top of whatever is presented there, and
  /// React Native dismisses its `Modal` with `[modalController
  /// dismissViewControllerAnimated:]` - which UIKit reads as "dismiss what this
  /// controller presented". With a dialog on top of the Modal, closing the Modal took
  /// the dialog down instead and left the Modal on screen for good (G11 spike,
  /// `example/__tests__/Dialog.harness.tsx`). A window of its own touches nobody's
  /// chain: there is always a free controller to present from, over an RN `Modal`, a
  /// screens `formSheet` or another dialog, and closing any of those cannot reach it.
  ///
  /// `false` when the anchor has no window scene to put a window in.
  @MainActor
  @discardableResult
  func presentInOwnWindow(
    _ controller: UIViewController,
    over anchor: UIView,
    animated: Bool = true,
    prepare: ((_ root: UIViewController) -> Void)? = nil,
    onShown: (() -> Void)? = nil
  ) -> Bool {
    guard let appWindow = anchor.window, let scene = appWindow.windowScene else {
      return false
    }
    let window = UIWindow(windowScene: scene)
    window.frame = scene.coordinateSpace.bounds
    window.windowLevel = UIWindow.Level.alert + 1
    window.overrideUserInterfaceStyle = appWindow.overrideUserInterfaceStyle
    window.backgroundColor = .clear
    let root = NitroUiPresentationRootController()
    // The window is above the app's, so its root is what UIKit asks about the status
    // bar and the orientations while the presentation is up: it answers as the screen
    // it covers.
    root.covered = Self.topController(of: appWindow)
    window.rootViewController = root
    windows[ObjectIdentifier(controller)] = OwnWindow(
      window: window,
      previousKey: scene.keyWindow,
      appWindow: appWindow
    )
    window.makeKeyAndVisible()
    // After the window is visible, so the root's view is in it and a popover source can
    // be expressed in its coordinates.
    prepare?(root)
    present(controller, from: root, animated: animated, onShown: onShown)
    return true
  }

  /// Whether `controller` was presented from a window of its own.
  func isInOwnWindow(_ controller: UIViewController) -> Bool {
    windows[ObjectIdentifier(controller)] != nil
  }

  /// The root of the window `controller` was presented in, if it has one of its own -
  /// what decides the status bar and the orientations while it is up. For a harness.
  func ownWindowRoot(of controller: UIViewController) -> UIViewController? {
    windows[ObjectIdentifier(controller)]?.window.rootViewController
  }

  /// Hide and let go of the window `controller` was presented in, if it has one.
  private func releaseWindow(for controller: UIViewController) {
    guard let owned = windows.removeValue(forKey: ObjectIdentifier(controller)) else {
      return
    }
    Self.close(owned)
  }

  /// Take a presentation window down. If it was the key window, key status goes back
  /// to the window that had it before (or the app's), and VoiceOver is told the screen
  /// changed, so its focus leaves the closed alert for the app instead of being lost.
  private static func close(_ owned: OwnWindow) {
    let window = owned.window
    let wasKey = window.isKeyWindow
    window.isHidden = true
    window.rootViewController = nil
    guard wasKey else { return }
    let next = [owned.previousKey, owned.appWindow]
      .compactMap { $0 }
      .first { $0 !== window && !$0.isHidden && $0.windowScene != nil }
    next?.makeKey()
    UIAccessibility.post(notification: .screenChanged, argument: nil)
  }

  /// The top-most controller in `window`: the last one presented there, or its root.
  private static func topController(of window: UIWindow) -> UIViewController? {
    var top = window.rootViewController
    while let next = top?.presentedViewController {
      top = next
    }
    return top
  }

  /// Keep a presentation that a teardown asked to close during its entry transition,
  /// because a new request wants the same window: a press arriving now on a mount that
  /// replaced the one that asked. Cancelling the pending close is what makes the flag
  /// the caller just wrote true.
  func cancelPendingDismissal() {
    guard let controller else { return }
    let key = ObjectIdentifier(controller)
    if entering[key] != nil {
      entering[key] = CarriedDismissal()
    }
  }

  /// Close the presentation for a teardown (recycle, drop): not animated, because the
  /// view that owned it is going away in the same turn, and hidden at once if the entry
  /// transition is still running (see the class).
  func dismissForTeardown() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      guard let controller else { return }
      let key = ObjectIdentifier(controller)
      if entering[key] != nil {
        hideImmediately(controller)
        entering[key] = CarriedDismissal(requested: true, animated: false)
        return
      }
      dismissNow(controller, animated: false)
    }
  }

  /// Close the presentation because the app asked to (a dialog's `isPresented` written
  /// `false`): animated, and carried to the completion if the entry transition is still
  /// running - but never hidden early, since nothing is being torn down.
  func dismissAnimated() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      guard let controller else { return }
      let key = ObjectIdentifier(controller)
      if entering[key] != nil {
        entering[key] = CarriedDismissal(requested: true, animated: true)
        return
      }
      dismissNow(controller, animated: true)
    }
  }

  /// UIKit closed the presentation without being asked by this class. Brings the count
  /// down if that presentation was counted, and decides nothing else: the component
  /// says what the closure means.
  func noteClosedByUIKit(_ closed: UIViewController? = nil) {
    guard let closed = closed ?? controller else { return }
    if counted.remove(ObjectIdentifier(closed)) != nil {
      counter.closed()
    }
    releaseWindow(for: closed)
  }

  /// Whether `controller` is going away because this class asked it to.
  func isDismissingOnRequest(_ controller: UIViewController) -> Bool {
    requested.contains(ObjectIdentifier(controller))
  }

  /// Take the presentation out of the app's way without waiting for UIKit's teardown.
  ///
  /// UIKit installs a presentation in one full-screen view (measured on iOS 27: the
  /// window's child `presentationController.containerView`, holding the dimming view
  /// and the presented view), so hiding that one view takes both out of the draw and
  /// out of `hitTest:` in the same turn. Nothing here is UIKit's teardown: the carried
  /// dismissal still dismisses for real at the completion. Hiding may stay set because
  /// the presentation controller is rebuilt per presentation.
  @MainActor
  private func hideImmediately(_ controller: UIViewController) {
    controller.presentationController?.containerView?.isHidden = true
  }

  /// The dismissal UIKit can perform right now, of `controller` - which, from an entry
  /// completion, may no longer be the newest.
  @MainActor
  private func dismissNow(_ controller: UIViewController, animated: Bool) {
    guard controller.presentingViewController != nil else {
      return
    }
    if controller.isBeingDismissed {
      // Already on its way out - an alert's own action tap, say. A second request
      // would be refused; the first one's report is what brings the count down.
      return
    }
    // Take the ticket before asking, and hand *that* to the completion: this can be
    // called for a presentation that was never counted, and an unearned decrement would
    // put the harness's witness at "nothing presented" while a window is still up. The
    // completion deliberately does not capture `self` strongly - it has to run even when
    // the view that owned the presentation is already gone, which is the normal case for
    // a drop.
    let key = ObjectIdentifier(controller)
    let wasCounted = counted.remove(key) != nil
    let counter = self.counter
    // The window goes with the presentation, captured here rather than read from `self`
    // in the completion, for the same reason the ticket is.
    let owned = windows.removeValue(forKey: key)
    requested.insert(key)
    controller.dismiss(animated: animated) { [weak self] in
      if wasCounted {
        counter.closed()
      }
      if let owned {
        Self.close(owned)
      }
      self?.requested.remove(key)
    }
  }
}

/// The root of a presentation window: nothing to draw, and no touches of its own.
///
/// The window is full screen and above the app's, so while a teardown has hidden a
/// presentation that UIKit is still animating in, a root view that answered `hitTest:`
/// would keep the app untouchable until the transition ends - the 500 ms G5 measured.
/// Passing through hands the touch to the windows underneath.
///
/// It also answers for the screen it covers. The window sits above the app's, so while
/// a presentation is up UIKit asks this root - not the app's controllers - whether the
/// status bar is hidden, its style, and which orientations are allowed; a root with
/// answers of its own would show a status bar the app hid, or let the screen rotate
/// under a portrait-only RN `Modal`. `covered` is the app window's top-most controller
/// when the presentation began, and its answers are forwarded (following the
/// `childForStatusBar...` chain UIKit itself would follow).
final class NitroUiPresentationRootController: UIViewController {
  /// The controller this window covers. Weak: the presentation must not keep the
  /// app's screen alive.
  weak var covered: UIViewController?

  override func loadView() {
    view = NitroUiPassThroughView()
  }

  override var prefersStatusBarHidden: Bool {
    Self.resolve(covered, \.childForStatusBarHidden)?.prefersStatusBarHidden ?? false
  }

  override var preferredStatusBarStyle: UIStatusBarStyle {
    Self.resolve(covered, \.childForStatusBarStyle)?.preferredStatusBarStyle ?? .default
  }

  override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
    covered?.supportedInterfaceOrientations ?? super.supportedInterfaceOrientations
  }

  /// `controller`, or the child it delegates the answer to, as far down as that goes.
  private static func resolve(
    _ controller: UIViewController?,
    _ child: KeyPath<UIViewController, UIViewController?>
  ) -> UIViewController? {
    var current = controller
    // Bounded: a controller that names itself (or a cycle) must not hang the status bar.
    for _ in 0..<8 {
      guard let next = current?[keyPath: child], next !== current else { break }
      current = next
    }
    return current
  }
}

/// A view that is never the target of a touch itself.
final class NitroUiPassThroughView: UIView {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}
