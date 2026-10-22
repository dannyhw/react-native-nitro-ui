//
//  NitroUIContent.swift
//  react-native-nitro-ui
//

import SwiftUI

/// The SwiftUI side of a component: a concrete `View` built from a model.
///
/// The generic parameter stays concrete (no `AnyView`) so SwiftUI keeps
/// structural identity and diffs cheaply.
///
/// Implementations hold the model in an `@ObservedObject` - that is what
/// subscribes them to ``NitroUiModel/objectWillChange``:
///
/// ```swift
/// struct SwitchContent: NitroUIContent {
///   @ObservedObject var model: SwitchModel
///   var body: some View { ... }
/// }
/// ```
protocol NitroUIContent<Model>: View {
  associatedtype Model: NitroUiModel
  init(model: Model)
}

/// Root of a hosted control.
///
/// A named wrapper instead of `content.eraseToAnyView()` or an opaque stored
/// property: the type stays concrete and stable for the instance's lifetime, and
/// it is where the safe-area rule lives. `NitroSwiftUIHost` clears
/// `UIHostingController.safeAreaRegions` on iOS 16.4+; `.ignoresSafeArea()`
/// covers older systems and also stops SwiftUI insetting a control that sits near
/// the top of a scroll view (the classic "control jumps when scrolled under the
/// status bar" bug). It costs nothing when there is no inset.
struct NitroUiRoot<Content: NitroUIContent>: View {
  private let content: Content

  init(model: Content.Model) {
    content = Content(model: model)
  }

  var body: some View {
    content.ignoresSafeArea(edges: .all)
  }
}
