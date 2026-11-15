import SwiftUI

/// The SwiftUI side of a component. The type stays concrete (no `AnyView`) so SwiftUI keeps
/// structural identity. Implementations hold the model in an `@ObservedObject`, which is what
/// subscribes them to its changes.
protocol NitroUIContent<Model>: View {
  associatedtype Model: NitroUiModel
  init(model: Model)
}

/// Root of a hosted control. `.ignoresSafeArea()` stops SwiftUI insetting a control that sits under
/// the status bar or near the top of a scroll view; on iOS 16.4+ the host also clears
/// `UIHostingController.safeAreaRegions`.
struct NitroUiRoot<Content: NitroUIContent>: View {
  private let content: Content

  init(model: Content.Model) {
    content = Content(model: model)
  }

  var body: some View {
    content.ignoresSafeArea(edges: .all)
  }
}
