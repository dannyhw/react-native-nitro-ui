//
//  HybridNitroUiHost.swift
//  react-native-nitro-ui
//
//  The Hybrid View behind `<Host>` on iOS (T17 spike): a container whose nitro-ui
//  children render into **one** SwiftUI hierarchy instead of one each.
//
//  Not the no-op `docs/tasks/T16-host-spike.report.md` left here for the iOS half
//  of the spec. This is the thing that file said would go here, built: one
//  `UIHostingController` whose root composes the children. The Android half of the
//  same JS component is on branch `task/T16-host-spike`; `Host.tsx` picks per
//  platform, so the two never both claim a child.
//

import NitroModules
import UIKit

/// The Hybrid View React renders as `NitroUiHost`.
///
/// No props and no methods: the Host stores nothing, so everything this class does
/// is own the view. Created once per Fabric node by the generated component and
/// never replaced, which is the perf contract's rule for a hosting view.
///
/// Deliberately **not** a `RecyclableView`, on either platform: a recycled Host
/// would have to give up its hosting controller (the expensive part it exists to
/// amortise) or hand the next mount a controller that still composes the previous
/// mount's children. `<Host>` is one node per screen section, not a cell.
final class HybridNitroUiHost: HybridNitroUiHostSpec {
  /// The Nitro `view` - created once here and never replaced.
  let view: NitroUiHostContainerView

  override init() {
    view = NitroUiHostContainerView()
    super.init()
  }

  /// Un-compose every child.
  ///
  /// RN removes a Host's children one by one on a normal unmount and the container
  /// releases each from `willRemoveSubview`; this is for the teardown that takes the
  /// container away with its children still in it, which would otherwise leave a
  /// control hidden and touch-deaf for whatever mounts it next.
  func onDropView() {
    view.releaseAllChildren()
  }
}
