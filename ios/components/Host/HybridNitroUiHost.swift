//
//  HybridNitroUiHost.swift
//  react-native-nitro-ui
//
//  A documented no-op (T16 spike). `<Host>` renders a shared native composition on
//  Android; on iOS `Host.tsx` renders a plain `View` and never instantiates this
//  type. It exists because nitrogen refuses to generate a Hybrid View with no
//  native implementation on a platform, `@platforms` included - so the iOS half of
//  the spec has to be satisfiable, and this is the smallest thing that satisfies it.
//
//  If a Host is ever built for iOS, this is where it goes: one
//  `UIHostingController` whose root view holds N SwiftUI children, which is the
//  shape `docs/tasks/T16-host-spike.report.md` estimates against the iOS memory
//  misses (Slider, Button, Progress). Until then nothing here composes anything,
//  and a control inside a `<Host>` on iOS renders exactly as it does outside one.
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
