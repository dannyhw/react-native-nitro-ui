//
//  NitroUiPresenterChain.swift
//  react-native-nitro-ui
//
//  Where a presentation that belongs to the screen's own chain presents from, and
//  when it must not (DECISIONS D35). BottomSheet (G14) was the first component to
//  apply D35's rule; Tooltip (G18) is the second, so the rule's questions moved here
//  from `HybridNitroUiBottomSheet` unchanged.
//
//  D35, in one line: present in the app's chain - from its top-most presented
//  controller - unless that controller is an RN `Modal` host; then from a window of
//  one's own (`NitroUiPresentation.presentInOwnWindow`), because RN closes a `Modal`
//  by dismissing its controller, and a presentation on top of it is what UIKit would
//  take down instead, stranding the Modal (G11, S2).
//

import UIKit

/// The questions D35's rule asks of the app's presentation chain. Main thread only.
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

  /// How many RN `Modal` hosts are presented in `window`: one left after its `Modal`
  /// closed is the strand D35's rule exists to prevent.
  static func modalHostCount(near window: UIWindow?) -> Int {
    var count = 0
    var current = window?.rootViewController
    while let controller = current {
      if isModalHost(controller) { count += 1 }
      current = controller.presentedViewController
    }
    return count
  }

  /// Whether UIKit would drop a presentation asked of `controller` right now: it
  /// refuses one from a chain that is mid-transition, silently - no error and no
  /// completion (S2's `presentQueued`).
  static func isBusy(_ controller: UIViewController) -> Bool {
    controller.isBeingDismissed || controller.isBeingPresented
      || controller.presentingViewController?.isBeingDismissed == true
  }
}
