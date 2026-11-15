// A no-op on iOS, where `<Host>` renders a plain `View` and never instantiates this type.
// It exists because nitrogen requires a native implementation on every platform.

import NitroModules
import UIKit

final class HybridNitroUiHost: HybridNitroUiHostSpec {
  /// A plain container. No hosting controller, no sizing, no containment.
  let view: UIView = UIView()

  override init() {
    super.init()
    // RN lays a container's children out; this view draws nothing.
    view.isUserInteractionEnabled = true
  }
}
