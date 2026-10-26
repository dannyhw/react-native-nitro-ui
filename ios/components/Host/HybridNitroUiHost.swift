//
//  HybridNitroUiHost.swift
//  react-native-nitro-ui
//
//  A documented no-op (`docs/tasks/T16-host-spike.md`). `<Host>` renders a shared
//  native composition on Android; on iOS `Host.tsx` renders a plain `View` and never
//  instantiates this
//  type. It exists because nitrogen refuses to generate a Hybrid View with no
//  native implementation on a platform, `@platforms` included - so the iOS half of
//  the spec has to be satisfiable, and this is the smallest thing that satisfies it.
//
//  It stayed a no-op on purpose. T17 built the iOS shape anyway (one shared hosting
//  controller, N children) and measured it on Switch: memory 0.92x/0.75x the shared
//  SwiftUI host, but mount UI CPU 1.40x and unmount 6.27x. D23's rule is that a Host
//  may only take a control out of the app's tree when it pays for that control's own
//  hosting miss; a container that trades memory for mount CPU does not, so H3 is not
//  built and this passthrough is the design (D23 outcome,
//  docs/tasks/T17-ios-host-spike.report.md). Nothing here composes anything, and a
//  control inside a `<Host>` on iOS renders exactly as it does outside one.
//

import NitroModules
import UIKit

/// See ``HybridNitroUiHostSpec``. Passthrough: see the file header.
final class HybridNitroUiHost: HybridNitroUiHostSpec {
  /// A plain container. No hosting controller, no sizing, no containment.
  let view: UIView = UIView()

  override init() {
    super.init()
    // RN lays a container's children out; this view draws nothing.
    view.isUserInteractionEnabled = true
  }
}
