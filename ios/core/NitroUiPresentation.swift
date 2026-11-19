// UIKit presentation from a plain view, shared by every component that presents a view controller.

import UIKit

/// How many presentations of one kind this process has open. Process-wide, one counter per
/// component, so a test can check that no presentation outlives the mount that opened it. Locked
/// because writes are on the main thread and tests read it from the JS thread, which must not hop
/// to main.
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

/// One component's presentation. The component builds and configures the controller; this class
/// presents it, counts it and takes it down. UIKit refuses a dismissal during the entry transition,
/// so one that arrives then is carried out by the presentation's completion (a teardown also hides
/// the container view at once). State is per controller: a recycled view can present its next
/// controller while the previous one is still animating in. Main thread only.
final class NitroUiPresentation: NSObject {
  let counter: NitroUiPresentationCounter

  /// A dismissal that arrived during a controller's entry transition, carried to that
  /// transition's completion.
  private struct CarriedDismissal {
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
  /// The presentations counted and not yet uncounted, by controller, so each is decremented exactly
  /// once even when a programmatic dismissal's completion and UIKit's own report both arrive.
  private var counted = Set<ObjectIdentifier>()
  /// The controllers whose dismissal this class asked for and UIKit has not finished,
  /// so a component's "the controller went away" witness can tell that from a
  /// dismissal UIKit did on its own.
  private var requested = Set<ObjectIdentifier>()
  /// The windows of presentations made with `presentInOwnWindow`, by controller, each released when
  /// its presentation ends.
  private var windows: [ObjectIdentifier: OwnWindow] = [:]

  init(counter: NitroUiPresentationCounter) {
    self.counter = counter
    super.init()
  }

  /// Whether ``controller`` is on screen (or on its way): it has a presenter.
  var isOnScreen: Bool {
    controller?.presentingViewController != nil
  }

  /// Present `controller` from `presenter`; the caller has already configured its style. `onShown`
  /// runs in the presentation's completion, after the count has gone up and before a carried
  /// dismissal is honoured.
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
    // `self` is held strongly until the completion runs, so a carried dismissal still happens when
    // the view that owned the presentation was released meanwhile.
    presenter.present(controller, animated: animated) {
      guard let carried = self.entering.removeValue(forKey: key) else {
        // A teardown gave this presentation up as never started, and UIKit started it late after
        // all: end it, uncounted.
        self.dismissNow(controller, animated: false)
        return
      }
      if self.counted.insert(key).inserted {
        self.counter.opened()
      }
      onShown?()
      if carried.requested {
        self.dismissNow(controller, animated: carried.animated)
      }
    }
  }

  /// Present `controller` from a window of its own, above the app's. A controller presented in the
  /// app's chain sits on top of whatever is presented there, and React Native closes a `Modal` by
  /// dismissing what the Modal's controller presented: with a dialog on top, the dialog goes and
  /// the Modal stays. A separate window is out of that chain. Returns `false` when the anchor has
  /// no window scene.
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
    // While the presentation is up UIKit asks this root about the status bar and orientations; it
    // answers as the screen it covers.
    root.coveredWindow = appWindow
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

  /// Let go of the last controller, whose dismissal is under way or done. A view in Fabric's
  /// recycle pool keeps this object, and would keep the controller's whole view hierarchy until it
  /// presents again.
  func forgetController() {
    controller = nil
  }

  /// Give up a presentation that never began. UIKit refuses a present it will not carry out
  /// without saying so: the completion never runs and the controller never gets a presenter.
  /// `present` installs the presentation before it returns, so no presenter means it was refused,
  /// and no completion is coming. The entry is dropped here so a completion that arrives after
  /// all ends the presentation uncounted, as `dismissForTeardown` does. `false` when UIKit had
  /// taken the controller - the only answer for a present that is merely slow.
  @MainActor
  func forgetUnstarted(_ refused: UIViewController) -> Bool {
    let key = ObjectIdentifier(refused)
    guard entering[key] != nil, refused.presentingViewController == nil else { return false }
    entering.removeValue(forKey: key)
    releaseWindow(for: refused)
    if controller === refused { controller = nil }
    return true
  }

  func isInOwnWindow(_ controller: UIViewController) -> Bool {
    windows[ObjectIdentifier(controller)] != nil
  }

  /// The root of the window `controller` was presented in, if it has one of its own.
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

  /// Cancel a close that a teardown asked for during the entry transition, because a new request
  /// wants the same presentation kept.
  func cancelPendingDismissal() {
    guard let controller else { return }
    let key = ObjectIdentifier(controller)
    if entering[key] != nil {
      entering[key] = CarriedDismissal()
    }
  }

  /// Close the presentation for a teardown (recycle, drop): not animated, and hidden at once if the
  /// entry transition is still running. A present UIKit refused has no presenter and no completion
  /// coming, so it is given up here instead of carried.
  func dismissForTeardown() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      guard let controller else { return }
      let key = ObjectIdentifier(controller)
      if entering[key] != nil {
        if controller.presentingViewController == nil {
          entering.removeValue(forKey: key)
          releaseWindow(for: controller)
          return
        }
        hideImmediately(controller)
        entering[key] = CarriedDismissal(requested: true, animated: false)
        return
      }
      dismissNow(controller, animated: false)
    }
  }

  /// Close the presentation because the app asked to: animated, and carried to the completion if
  /// the entry transition is still running, but never hidden early.
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

  func isDismissingOnRequest(_ controller: UIViewController) -> Bool {
    requested.contains(ObjectIdentifier(controller))
  }

  /// Take the presentation out of the app's way without waiting for UIKit's teardown. UIKit
  /// installs a presentation in one full-screen container view holding the dimming view and the
  /// presented view, so hiding it removes both from drawing and hit-testing. The carried dismissal
  /// still dismisses for real.
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
      // would be refused, so this one waits for that dismissal instead.
      releaseAfterDismissal(controller)
      return
    }
    // Remove the count entry before asking and hand it to the completion, so an uncounted
    // presentation is never decremented. The completion must not need `self`: on a drop the owning
    // view is already gone.
    let key = ObjectIdentifier(controller)
    let wasCounted = counted.remove(key) != nil
    let counter = self.counter
    // The window is captured for the completion for the same reason.
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

  /// Release the count and window of `controller` when a dismissal this class did not ask for ends.
  /// UIKit takes an alert down by itself when an action is tapped; if the view is torn down during
  /// that exit, nothing else would release them.
  @MainActor
  private func releaseAfterDismissal(_ controller: UIViewController) {
    let key = ObjectIdentifier(controller)
    let wasCounted = counted.remove(key) != nil
    let owned = windows.removeValue(forKey: key)
    guard wasCounted || owned != nil else { return }
    let release = NitroUiPresentationRelease(counter: counter, wasCounted: wasCounted, owned: owned)
    // The coordinator's completion runs when the dismissal's transition ends. No coordinator means
    // there is no transition left to wait for.
    if let coordinator = controller.transitionCoordinator,
      coordinator.animate(alongsideTransition: nil, completion: { context in
        if context.isCancelled, controller.presentingViewController != nil {
          // An interactive dismissal the user abandoned: it is still up, and the
          // teardown still wants it gone.
          controller.dismiss(animated: false) { release.run() }
        } else {
          release.run()
        }
      }) {
      return
    }
    release.run()
  }

  /// The count and window of one presentation, released exactly once.
  private final class NitroUiPresentationRelease {
    private let counter: NitroUiPresentationCounter
    private var wasCounted: Bool
    private var owned: OwnWindow?

    init(counter: NitroUiPresentationCounter, wasCounted: Bool, owned: OwnWindow?) {
      self.counter = counter
      self.wasCounted = wasCounted
      self.owned = owned
    }

    func run() {
      if wasCounted {
        wasCounted = false
        counter.closed()
      }
      if let window = owned {
        owned = nil
        NitroUiPresentation.close(window)
      }
    }
  }
}

/// The root of a presentation window. It draws nothing and passes touches through, so a hidden
/// presentation that is still animating in does not block the app. While the window is up UIKit
/// asks this root, not the app's controllers, about the status bar and orientations, so it forwards
/// the answers of the app window's top-most controller, looked up each time.
final class NitroUiPresentationRootController: UIViewController {
  /// The app's window this one covers. Weak: the presentation must not keep the app's
  /// screen alive.
  weak var coveredWindow: UIWindow?

  /// The controller this window covers right now: the last one presented in the app's
  /// window, or its root.
  var covered: UIViewController? {
    var top = coveredWindow?.rootViewController
    while let next = top?.presentedViewController {
      top = next
    }
    return top
  }

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
