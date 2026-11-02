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
/// All members are main-thread only (`NitroUiMainThread`).
final class NitroUiPresentation: NSObject {
  let counter: NitroUiPresentationCounter

  /// The controller this instance last presented, kept so a component can update it
  /// in place and so a dismissal knows what to dismiss.
  private(set) var controller: UIViewController?
  /// Whether `present`'s entry transition is still running.
  private(set) var isPresenting = false
  /// A dismissal that arrived during that transition, carried to its completion.
  private var dismissWhenPresented = false
  /// Whether that carried dismissal animates (a JS write) or not (a teardown).
  private var dismissAnimatedWhenPresented = false
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
    isPresenting = true
    dismissWhenPresented = false
    dismissAnimatedWhenPresented = false
    presenter.present(controller, animated: animated) { [weak self] in
      guard let self else { return }
      self.isPresenting = false
      if self.counted.insert(ObjectIdentifier(controller)).inserted {
        self.counter.opened()
      }
      onShown?()
      if self.dismissWhenPresented {
        self.dismissWhenPresented = false
        self.dismissNow(animated: self.dismissAnimatedWhenPresented)
      }
    }
  }

  /// Keep a presentation that a teardown asked to close during its entry transition,
  /// because a new request wants the same window: a press arriving now on a mount that
  /// replaced the one that asked. Cancelling the pending close is what makes the flag
  /// the caller just wrote true.
  func cancelPendingDismissal() {
    dismissWhenPresented = false
  }

  /// Close the presentation for a teardown (recycle, drop): not animated, because the
  /// view that owned it is going away in the same turn, and hidden at once if the entry
  /// transition is still running (see the class).
  func dismissForTeardown() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      if isPresenting {
        hideImmediately()
        dismissWhenPresented = true
        dismissAnimatedWhenPresented = false
        return
      }
      dismissNow(animated: false)
    }
  }

  /// Close the presentation because the app asked to (a dialog's `isPresented` written
  /// `false`): animated, and carried to the completion if the entry transition is still
  /// running - but never hidden early, since nothing is being torn down.
  func dismissAnimated() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      if isPresenting {
        dismissWhenPresented = true
        dismissAnimatedWhenPresented = true
        return
      }
      dismissNow(animated: true)
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
  private func hideImmediately() {
    controller?.presentationController?.containerView?.isHidden = true
  }

  /// The dismissal UIKit can perform right now.
  @MainActor
  private func dismissNow(animated: Bool) {
    guard let controller, controller.presentingViewController != nil else {
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
    requested.insert(key)
    controller.dismiss(animated: animated) { [weak self] in
      if wasCounted {
        counter.closed()
      }
      self?.requested.remove(key)
    }
  }

  // MARK: - Finding a presenter

  /// The controller a view can present from right now, or `nil`.
  ///
  /// The nearest view controller on the view's responder chain that is not a
  /// navigation or tab controller (the walk `NitroSwiftUIHost` does for containment),
  /// then up its `presentedViewController` chain to the top - which is what lets a
  /// dialog open over an RN `Modal`, over another dialog, or over the app's own
  /// presentation. `nil` while the view has no window, and while the top of the chain
  /// is still animating in or out: UIKit refuses to present from a controller in a
  /// transition, so the caller waits for ``transitionInFlight(for:)`` instead.
  @MainActor
  static func topPresenter(for view: UIView) -> UIViewController? {
    guard let window = view.window else { return nil }
    guard var top = nearestViewController(of: view) ?? window.rootViewController else {
      return nil
    }
    while let presented = top.presentedViewController {
      top = presented
    }
    if top.isBeingDismissed || top.isBeingPresented {
      return nil
    }
    return top
  }

  /// The transition coordinator of whatever is animating at the top of `view`'s
  /// presentation chain, so a presentation refused by ``topPresenter(for:)`` can be
  /// retried when it ends. `nil` when nothing is in flight.
  @MainActor
  static func transitionInFlight(for view: UIView) -> UIViewControllerTransitionCoordinator? {
    guard view.window != nil else { return nil }
    guard var top = nearestViewController(of: view) ?? view.window?.rootViewController else {
      return nil
    }
    while let presented = top.presentedViewController {
      top = presented
    }
    return top.transitionCoordinator
  }

  /// The nearest view controller on `view`'s responder chain that can present: not a
  /// navigation or tab controller, which cannot host a presentation cleanly.
  static func nearestViewController(of view: UIView) -> UIViewController? {
    var responder: UIResponder? = view.next
    while let current = responder {
      if let controller = current as? UIViewController,
        !(controller is UINavigationController),
        !(controller is UITabBarController) {
        return controller
      }
      responder = current.next
    }
    return nil
  }
}
