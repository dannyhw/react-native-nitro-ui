import UIKit

/// Presentations go on the app's top-most presented controller, unless that is a React Native
/// `Modal` host: RN closes a `Modal` by dismissing its controller, and UIKit would take down the
/// presentation on top of it instead, stranding the Modal. Those present from a window of their
/// own. Main thread only.
enum NitroUiPresenterChain {
  /// The top-most controller in `window`: the last one presented there, or its root.
  static func appTopController(in window: UIWindow?) -> UIViewController? {
    guard var top = window?.rootViewController else { return nil }
    while let next = top.presentedViewController {
      top = next
    }
    return top
  }

  /// The class of the top-most controller presented in `window`, or `-` when nothing
  /// is presented there.
  static func topPresentedClass(in window: UIWindow?) -> String {
    guard let top = appTopController(in: window), top.presentingViewController != nil else {
      return "-"
    }
    return String(describing: type(of: top))
  }

  /// Whether `controller` is an RN `Modal`'s host - by class name, so the library does
  /// not link against React (`RCTFabricModalHostViewController`).
  static func isModalHost(_ controller: UIViewController) -> Bool {
    String(describing: type(of: controller)).contains("ModalHostViewController")
  }

  /// How many RN `Modal` hosts are presented in `window`. One left after its `Modal` closed has
  /// been stranded.
  static func modalHostCount(near window: UIWindow?) -> Int {
    var count = 0
    var current = window?.rootViewController
    while let controller = current {
      if isModalHost(controller) { count += 1 }
      current = controller.presentedViewController
    }
    return count
  }

  /// Whether UIKit would drop a presentation asked of `controller` right now: it refuses one from a
  /// chain that is mid-transition silently, with no error and no completion.
  static func isBusy(_ controller: UIViewController) -> Bool {
    controller.isBeingDismissed || controller.isBeingPresented
      || controller.presentingViewController?.isBeingDismissed == true
  }
}
